import { describe, expect, it } from "vitest";
import {
  addWavSampleToBank,
  createDemoBank,
  createDemoMidiSequence,
  estimateMidiRootKey,
  findZeroCrossing,
  parseMidi,
  parseSf2,
  parseWav,
  validateBank,
  writeSf2,
} from "../src/index.js";

function buildPcm16MonoWav(samples: Int16Array, sampleRate: number, smpl?: { loopStart: number; loopEnd: number; unityNote: number }): Uint8Array {
  const dataSize = samples.length * 2;
  const smplSize = smpl ? 36 + 24 : 0;
  const smplChunkTotal = smpl ? 8 + smplSize : 0;
  const riffSize = 4 + (8 + 16) + (8 + dataSize) + smplChunkTotal;
  const buf = new ArrayBuffer(8 + riffSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };

  writeStr(0, "RIFF");
  view.setUint32(4, riffSize, true);
  writeStr(8, "WAVE");

  // fmt chunk
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  if (smpl) {
    const off = 44 + dataSize;
    writeStr(off, "smpl");
    view.setUint32(off + 4, smplSize, true);
    view.setUint32(off + 8 + 12, smpl.unityNote, true);
    view.setUint32(off + 8 + 28, 1, true); // 1 loop
    view.setUint32(off + 8 + 36 + 8, smpl.loopStart, true);
    view.setUint32(off + 8 + 36 + 12, smpl.loopEnd, true);
  }

  return bytes;
}

function buildFloat32StereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const frames = left.length;
  const dataSize = frames * 2 * 4;
  const riffSize = 4 + (8 + 16) + (8 + dataSize);
  const buf = new ArrayBuffer(8 + riffSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };

  writeStr(0, "RIFF");
  view.setUint32(4, riffSize, true);
  writeStr(8, "WAVE");

  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 8, true);
  view.setUint16(32, 8, true);
  view.setUint16(34, 32, true);

  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < frames; i++) {
    view.setFloat32(44 + i * 8, left[i], true);
    view.setFloat32(44 + i * 8 + 4, right[i], true);
  }

  return bytes;
}

function buildSimpleMidi(format: 0 | 1, ticksPerQuarter: number, tracks: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(14);
  const hView = new DataView(header.buffer);
  header.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
  hView.setUint32(4, 6, false);
  hView.setUint16(8, format, false);
  hView.setUint16(10, tracks.length, false);
  hView.setUint16(12, ticksPerQuarter, false);

  const chunks: Uint8Array[] = [header];
  for (const trk of tracks) {
    const trkHead = new Uint8Array(8);
    const tView = new DataView(trkHead.buffer);
    trkHead.set([0x4d, 0x54, 0x72, 0x6b], 0); // MTrk
    tView.setUint32(4, trk.length, false);
    chunks.push(trkHead, trk);
  }

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

describe("WAV importer, pitch detector, and MIDI parser", () => {
  it("parses 16-bit PCM mono WAV and smpl loop chunk", () => {
    const sr = 44100;
    const pcm = new Int16Array(1000);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 16000);
    }
    const wavBytes = buildPcm16MonoWav(pcm, sr, { loopStart: 100, loopEnd: 800, unityNote: 69 });
    const parsed = parseWav(wavBytes);

    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.samples.length).toBe(1000);
    expect(parsed.samples[50]).toBe(pcm[50]);
    expect(parsed.loopStart).toBe(100);
    expect(parsed.loopEnd).toBe(800);
    expect(parsed.midiUnityNote).toBe(69);
  });

  it("parses 32-bit IEEE float stereo WAV and downmixes to mono Int16Array", () => {
    const left = new Float32Array([0.5, -0.5, 1.0, -1.0]);
    const right = new Float32Array([0.5, 0.5, 0.0, -1.0]);
    const wavBytes = buildFloat32StereoWav(left, right, 48000);
    const parsed = parseWav(wavBytes);

    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.channels).toBe(2);
    expect(parsed.bitsPerSample).toBe(32);
    expect(parsed.samples.length).toBe(4);
    expect(parsed.samples[0]).toBeCloseTo(16384, -1);
    expect(parsed.samples[1]).toBe(0);
    expect(parsed.samples[2]).toBeCloseTo(16384, -1);
    expect(parsed.samples[3]).toBeCloseTo(-32767, -1);
  });

  it("estimates MIDI root key accurately on a synthesized 440 Hz sine wave", () => {
    const sr = 44100;
    const len = 8192;
    const pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 24000);
    }
    const est = estimateMidiRootKey(pcm, sr);
    expect(est.midiKey).toBe(69);
    expect(est.frequencyHz).toBeGreaterThan(438);
    expect(est.frequencyHz).toBeLessThan(442);
    expect(est.confidence).toBeGreaterThan(0.95);
  });

  it("snaps to nearest zero crossing", () => {
    const pcm = new Int16Array([-1000, -500, 200, 800, 1200, 500, -100, -600]);
    const zc = findZeroCrossing(pcm, 3);
    expect(zc).toBe(2);
  });

  it("adds WAV sample + preset to bank and round-trips through SF2 writer/parser", () => {
    const bank = createDemoBank();
    const initialPresets = bank.presets.length;
    const sr = 44100;
    const pcm = new Int16Array(2048);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 20000);
    }

    const res = addWavSampleToBank(bank, {
      name: "TestSine440.wav",
      samples: pcm,
      sampleRate: sr,
      createPreset: true,
    });

    expect(res.originalPitch).toBe(69);
    expect(bank.presets.length).toBe(initialPresets + 1);
    expect(bank.presets[res.presetIndex!].name).toBe("TestSine440");

    const diags = validateBank(bank);
    expect(diags.some((d) => d.severity === "error")).toBe(false);

    const sf2Bytes = writeSf2(bank);
    const reparsed = parseSf2(sf2Bytes);
    expect(reparsed.presets.length).toBe(initialPresets + 1);
    expect(reparsed.samples[res.sampleIndex].pcmData.length).toBe(2048);
    expect(reparsed.samples[res.sampleIndex].originalPitch).toBe(69);
  });

  it("parses SMF Format 1 MIDI with Set Tempo (0xFF 0x51) and generates demo sequence", () => {
    // Track 0: Set Tempo = 250000 us/quarter (240 BPM = 0.25s per quarter) at tick 0, End of Track
    const track0 = new Uint8Array([
      0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, // delta 0, Set Tempo 250000 (0x03D090)
      0x00, 0xff, 0x2f, 0x00, // End of Track
    ]);
    // Track 1: Note On C4 (60) vel 100 at tick 0, Note Off C4 at tick 480 (1 quarter = 0.25s)
    const track1 = new Uint8Array([
      0x00, 0x90, 0x3c, 0x64, // delta 0, Note On ch 0, 60, 100
      0x83, 0x60, 0x80, 0x3c, 0x00, // delta 480 (VLQ 0x83 0x60), Note Off ch 0, 60, 0
      0x00, 0xff, 0x2f, 0x00, // End of Track
    ]);

    const midiBytes = buildSimpleMidi(1, 480, [track0, track1]);
    const parsed = parseMidi(midiBytes);

    expect(parsed.format).toBe(1);
    expect(parsed.ticksPerQuarter).toBe(480);
    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].midi).toBe(60);
    expect(parsed.events[0].velocity).toBe(100);
    expect(parsed.events[0].timeSec).toBeCloseTo(0, 4);
    expect(parsed.events[0].durationSec).toBeCloseTo(0.25, 3);

    const demo = createDemoMidiSequence();
    expect(demo.events.length).toBeGreaterThan(20);
    expect(demo.durationSec).toBeGreaterThan(3);
  });
});
