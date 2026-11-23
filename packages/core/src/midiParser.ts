export interface MidiNoteEvent {
  timeSec: number;
  durationSec: number;
  midi: number;
  velocity: number;
  channel: number;
}

export interface ParsedMidi {
  format: number;
  ticksPerQuarter: number;
  durationSec: number;
  events: MidiNoteEvent[];
}

interface RawTempoEvent {
  tick: number;
  usPerQuarter: number;
}

interface RawNoteSpan {
  startTick: number;
  endTick: number;
  midi: number;
  velocity: number;
  channel: number;
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function readVlq(bytes: Uint8Array, state: { pos: number }, end: number): number {
  let value = 0;
  for (let i = 0; i < 4 && state.pos < end; i++) {
    const b = bytes[state.pos++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return value;
}

function buildTickToSec(tempoEvents: RawTempoEvent[], ticksPerQuarter: number): (tick: number) => number {
  const sorted = [...tempoEvents].sort((a, b) => a.tick - b.tick);
  const segments: { tick: number; sec: number; secPerTick: number }[] = [];

  let currentTick = 0;
  let currentSec = 0;
  let currentUsPerQuarter = 500000; // Default 120 BPM

  segments.push({
    tick: 0,
    sec: 0,
    secPerTick: currentUsPerQuarter / 1_000_000 / ticksPerQuarter,
  });

  for (const ev of sorted) {
    if (ev.usPerQuarter <= 0) continue;
    const dt = ev.tick - currentTick;
    if (dt > 0) {
      currentSec += dt * (currentUsPerQuarter / 1_000_000 / ticksPerQuarter);
      currentTick = ev.tick;
    }
    currentUsPerQuarter = ev.usPerQuarter;
    segments.push({
      tick: currentTick,
      sec: currentSec,
      secPerTick: currentUsPerQuarter / 1_000_000 / ticksPerQuarter,
    });
  }

  return (tick: number): number => {
    let seg = segments[0];
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].tick <= tick) {
        seg = segments[i];
      } else {
        break;
      }
    }
    return seg.sec + (tick - seg.tick) * seg.secPerTick;
  };
}

/**
 * Parse a Standard MIDI File (.mid, SMF Format 0 & 1) into timed note events
 * with Set Tempo (0xFF 0x51) tempo-map support.
 */
export function parseMidi(input: ArrayBuffer | Uint8Array): ParsedMidi {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < 14) {
    throw new Error("Invalid MIDI file: header too short.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readFourCC(bytes, 0) !== "MThd") {
    throw new Error("Invalid MIDI file: missing MThd header.");
  }

  const headerLen = view.getUint32(4, false);
  if (headerLen < 6 || 8 + headerLen > bytes.byteLength) {
    throw new Error("Invalid MIDI file: malformed MThd length.");
  }

  const format = view.getUint16(8, false);
  const numTracks = view.getUint16(10, false);
  const division = view.getUint16(12, false);

  // If bit 15 is set, division is SMPTE frames/sec * ticks/frame; otherwise ticks per quarter note
  let ticksPerQuarter = 480;
  if ((division & 0x8000) === 0) {
    ticksPerQuarter = Math.max(1, division);
  } else {
    const smpteFrames = 256 - ((division >> 8) & 0xff);
    const ticksPerFrame = division & 0xff;
    ticksPerQuarter = Math.max(1, Math.round((smpteFrames * ticksPerFrame) / 2));
  }

  const tempoEvents: RawTempoEvent[] = [];
  const rawSpans: RawNoteSpan[] = [];

  let pos = 8 + headerLen;
  let tracksRead = 0;

  while (pos + 8 <= bytes.byteLength && tracksRead < numTracks) {
    const chunkId = readFourCC(bytes, pos);
    const chunkLen = view.getUint32(pos + 4, false);
    const trackStart = pos + 8;
    const trackEnd = Math.min(bytes.byteLength, trackStart + chunkLen);
    pos = trackEnd;

    if (chunkId !== "MTrk") {
      continue;
    }
    tracksRead++;

    const state = { pos: trackStart };
    let tick = 0;
    let runningStatus = 0;
    const activeNotes = new Map<number, { startTick: number; velocity: number }[]>();

    const closeNote = (channel: number, midi: number, endTick: number) => {
      const key = (channel << 8) | midi;
      const stack = activeNotes.get(key);
      if (!stack || stack.length === 0) return;
      const open = stack.shift()!;
      rawSpans.push({
        startTick: open.startTick,
        endTick: Math.max(open.startTick + 1, endTick),
        midi,
        velocity: open.velocity,
        channel,
      });
    };

    while (state.pos < trackEnd) {
      const delta = readVlq(bytes, state, trackEnd);
      tick += delta;
      if (state.pos >= trackEnd) break;

      let status = bytes[state.pos];
      if (status < 0x80) {
        if (runningStatus === 0) {
          state.pos++;
          continue;
        }
        status = runningStatus;
      } else {
        state.pos++;
        if (status < 0xf0) {
          runningStatus = status;
        } else if (status < 0xf8) {
          runningStatus = 0;
        }
      }

      if (status === 0xff) {
        if (state.pos >= trackEnd) break;
        const metaType = bytes[state.pos++];
        const metaLen = readVlq(bytes, state, trackEnd);
        const metaEnd = Math.min(trackEnd, state.pos + metaLen);
        if (metaType === 0x51 && metaEnd - state.pos >= 3) {
          const usPerQuarter =
            (bytes[state.pos] << 16) | (bytes[state.pos + 1] << 8) | bytes[state.pos + 2];
          tempoEvents.push({ tick, usPerQuarter });
        }
        state.pos = metaEnd;
        if (metaType === 0x2f) {
          break;
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysexLen = readVlq(bytes, state, trackEnd);
        state.pos = Math.min(trackEnd, state.pos + sysexLen);
        continue;
      }

      const type = status & 0xf0;
      const channel = status & 0x0f;

      if (type === 0xc0 || type === 0xd0) {
        state.pos = Math.min(trackEnd, state.pos + 1);
      } else if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        if (state.pos + 2 > trackEnd) break;
        const d1 = bytes[state.pos++];
        const d2 = bytes[state.pos++];

        if (type === 0x90 && d2 > 0) {
          const key = (channel << 8) | (d1 & 0x7f);
          let stack = activeNotes.get(key);
          if (!stack) {
            stack = [];
            activeNotes.set(key, stack);
          }
          stack.push({ startTick: tick, velocity: d2 & 0x7f });
        } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
          closeNote(channel, d1 & 0x7f, tick);
        }
      }
    }

    // Close any hanging notes at end of track
    const fallbackTicks = Math.max(1, Math.round(ticksPerQuarter / 2));
    for (const [key, stack] of activeNotes.entries()) {
      const channel = (key >> 8) & 0x0f;
      const midi = key & 0x7f;
      for (const open of stack) {
        rawSpans.push({
          startTick: open.startTick,
          endTick: Math.max(open.startTick + fallbackTicks, tick),
          midi,
          velocity: open.velocity,
          channel,
        });
      }
    }
  }

  const tickToSec = buildTickToSec(tempoEvents, ticksPerQuarter);
  const events: MidiNoteEvent[] = rawSpans
    .map((span) => {
      const timeSec = tickToSec(span.startTick);
      const endSec = tickToSec(span.endTick);
      return {
        timeSec,
        durationSec: Math.max(0.03, endSec - timeSec),
        midi: span.midi,
        velocity: span.velocity,
        channel: span.channel,
      };
    })
    .sort((a, b) => a.timeSec - b.timeSec || a.midi - b.midi);

  const durationSec = events.reduce((max, ev) => Math.max(max, ev.timeSec + ev.durationSec), 0);

  return {
    format,
    ticksPerQuarter,
    durationSec,
    events,
  };
}

/**
 * Generate a built-in polyphonic chord + arpeggio demo riff so users can audition
 * any preset or imported WAV instrument in 1 click without uploading a .mid file.
 */
export function createDemoMidiSequence(): ParsedMidi {
  const step = 0.18;
  const events: MidiNoteEvent[] = [];

  // 4-bar progression: Cmaj7 -> Am7 -> Fmaj7 -> G7 -> final C major resolve
  const bars: { bass: number; chord: number[]; arp: number[] }[] = [
    { bass: 48, chord: [60, 64, 67, 71], arp: [60, 64, 67, 71, 72, 71, 67, 64] },
    { bass: 45, chord: [57, 60, 64, 67], arp: [57, 60, 64, 67, 69, 67, 64, 60] },
    { bass: 41, chord: [57, 60, 64, 65], arp: [57, 60, 64, 65, 69, 65, 64, 60] },
    { bass: 43, chord: [59, 62, 65, 67], arp: [59, 62, 65, 67, 71, 67, 65, 62] },
  ];

  let t = 0;
  for (const bar of bars) {
    // Bass root
    events.push({ timeSec: t, durationSec: step * 7.5, midi: bar.bass, velocity: 92, channel: 0 });
    // Soft sustained pad chord
    for (const note of bar.chord) {
      events.push({ timeSec: t, durationSec: step * 3.8, midi: note, velocity: 68, channel: 0 });
    }
    // Melodic arpeggio
    for (let i = 0; i < bar.arp.length; i++) {
      events.push({
        timeSec: t + i * step,
        durationSec: step * 0.9,
        midi: bar.arp[i],
        velocity: i % 2 === 0 ? 105 : 88,
        channel: 0,
      });
    }
    t += bar.arp.length * step;
  }

  // Final resolve chord
  for (const midi of [48, 60, 64, 67, 72]) {
    events.push({ timeSec: t, durationSec: 0.9, midi, velocity: 96, channel: 0 });
  }

  events.sort((a, b) => a.timeSec - b.timeSec || a.midi - b.midi);
  const durationSec = events.reduce((max, ev) => Math.max(max, ev.timeSec + ev.durationSec), 0);

  return {
    format: 0,
    ticksPerQuarter: 480,
    durationSec,
    events,
  };
}
