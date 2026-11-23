import {
  getZoneAdsr,
  getZoneGenerator,
  getZoneRange,
  getZoneScalar,
  type MidiNoteEvent,
  type Sf2Bank,
  SF2_GENERATOR,
  type Sf2Sample,
} from "@soundfont/core";

interface ActiveVoice {
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
  releaseSec: number;
}

export class AuditionEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices = new Map<number, ActiveVoice>();
  private bufferCache = new WeakMap<Int16Array, AudioBuffer>();
  private sequenceTimers: number[] = [];

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private getAudioBuffer(ctx: AudioContext, sample: Sf2Sample): AudioBuffer {
    const cached = this.bufferCache.get(sample.pcmData);
    if (cached && cached.sampleRate === sample.sampleRate) {
      return cached;
    }
    const sr = Math.max(4000, Math.min(192000, sample.sampleRate || 44100));
    const buf = ctx.createBuffer(1, Math.max(1, sample.pcmData.length), sr);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < sample.pcmData.length; i++) {
      channel[i] = sample.pcmData[i] / 32768;
    }
    this.bufferCache.set(sample.pcmData, buf);
    return buf;
  }

  public setMasterVolume(volume: number): void {
    const ctx = this.ensureContext();
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, volume)),
        ctx.currentTime,
        0.015
      );
    }
  }

  public playPresetNote(bank: Sf2Bank, presetIndex: number, midi: number, velocity = 100): void {
    const preset = bank.presets[presetIndex];
    if (!preset) return;
    const ctx = this.ensureContext();
    this.stopVoiceImmediate(midi);

    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];
    let maxRelease = 0.2;

    for (const pZone of preset.zones) {
      const instGen = getZoneGenerator(pZone, SF2_GENERATOR.instrument);
      if (!instGen || typeof instGen.amount !== "number") continue;

      const pKey = getZoneRange(pZone, SF2_GENERATOR.keyRange);
      const pVel = getZoneRange(pZone, SF2_GENERATOR.velRange);
      if (midi < pKey.lo || midi > pKey.hi || velocity < pVel.lo || velocity > pVel.hi) {
        continue;
      }

      const inst = bank.instruments[instGen.amount];
      if (!inst) continue;

      const globalIZone =
        inst.zones.length > 0 && !getZoneGenerator(inst.zones[0], SF2_GENERATOR.sampleID)
          ? inst.zones[0]
          : undefined;

      for (const iZone of inst.zones) {
        const sampleGen = getZoneGenerator(iZone, SF2_GENERATOR.sampleID);
        if (!sampleGen || typeof sampleGen.amount !== "number") continue;
        const sample = bank.samples[sampleGen.amount];
        if (!sample || sample.pcmData.length === 0) continue;

        const iKey = getZoneRange(iZone, SF2_GENERATOR.keyRange);
        const iVel = getZoneRange(iZone, SF2_GENERATOR.velRange);
        if (midi < iKey.lo || midi > iKey.hi || velocity < iVel.lo || velocity > iVel.hi) {
          continue;
        }

        const rootKey = getZoneScalar(
          iZone,
          SF2_GENERATOR.overridingRootKey,
          sample.originalPitch <= 127 ? sample.originalPitch : 60
        );
        const coarseTune = getZoneScalar(iZone, SF2_GENERATOR.coarseTune, 0);
        const fineTune = getZoneScalar(iZone, SF2_GENERATOR.fineTune, 0);
        const totalCents = (midi - rootKey) * 100 + coarseTune * 100 + fineTune + sample.pitchCorrection;
        const playbackRate = Math.pow(2, totalCents / 1200);

        const sampleMode = getZoneScalar(
          iZone,
          SF2_GENERATOR.sampleModes,
          globalIZone ? getZoneScalar(globalIZone, SF2_GENERATOR.sampleModes, 0) : 0
        );
        const adsr = getZoneAdsr(iZone, globalIZone);
        const attenCb = getZoneScalar(iZone, SF2_GENERATOR.initialAttenuation, 0);
        const attenGain = Math.pow(10, -Math.max(0, attenCb) / 200);
        const velGain = Math.max(0.05, velocity / 127) * attenGain;

        const src = ctx.createBufferSource();
        src.buffer = this.getAudioBuffer(ctx, sample);
        src.playbackRate.value = Math.max(0.0625, Math.min(16, playbackRate));

        if ((sampleMode === 1 || sampleMode === 3) && sample.loopEnd > sample.loopStart) {
          src.loop = true;
          src.loopStart = sample.loopStart / sample.sampleRate;
          src.loopEnd = sample.loopEnd / sample.sampleRate;
        }

        const envGain = ctx.createGain();
        const now = ctx.currentTime;
        const startAt = now + Math.max(0, adsr.delaySec);
        const attackEnd = startAt + Math.max(0.002, adsr.attackSec);
        const holdEnd = attackEnd + Math.max(0, adsr.holdSec);
        const decayEnd = holdEnd + Math.max(0.005, adsr.decaySec);
        const sustainVal = Math.max(0.0001, velGain * adsr.sustainLevel);

        envGain.gain.setValueAtTime(0.0001, now);
        envGain.gain.setValueAtTime(0.0001, startAt);
        envGain.gain.linearRampToValueAtTime(velGain, attackEnd);
        envGain.gain.setValueAtTime(velGain, holdEnd);
        envGain.gain.exponentialRampToValueAtTime(sustainVal, decayEnd);

        const panRaw = getZoneScalar(iZone, SF2_GENERATOR.pan, 0);
        if (panRaw !== 0 && typeof ctx.createStereoPanner === "function") {
          const panner = ctx.createStereoPanner();
          panner.pan.value = Math.max(-1, Math.min(1, panRaw / 500));
          src.connect(envGain);
          envGain.connect(panner);
          panner.connect(this.masterGain!);
        } else {
          src.connect(envGain);
          envGain.connect(this.masterGain!);
        }

        src.start(startAt);
        sources.push(src);
        gains.push(envGain);
        maxRelease = Math.max(maxRelease, adsr.releaseSec);
      }
    }

    if (sources.length > 0) {
      this.activeVoices.set(midi, { sources, gains, releaseSec: maxRelease });
    }
  }

  public playSampleNote(sample: Sf2Sample, midi: number, velocity = 100): void {
    if (sample.pcmData.length === 0) return;
    const ctx = this.ensureContext();
    this.stopVoiceImmediate(midi);

    const rootKey = sample.originalPitch <= 127 ? sample.originalPitch : 60;
    const totalCents = (midi - rootKey) * 100 + sample.pitchCorrection;
    const playbackRate = Math.pow(2, totalCents / 1200);

    const src = ctx.createBufferSource();
    src.buffer = this.getAudioBuffer(ctx, sample);
    src.playbackRate.value = Math.max(0.0625, Math.min(16, playbackRate));
    if (sample.loopEnd > sample.loopStart) {
      src.loop = true;
      src.loopStart = sample.loopStart / sample.sampleRate;
      src.loopEnd = sample.loopEnd / sample.sampleRate;
    }

    const envGain = ctx.createGain();
    const now = ctx.currentTime;
    const velGain = Math.max(0.05, velocity / 127);
    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(velGain, now + 0.008);

    src.connect(envGain);
    envGain.connect(this.masterGain!);
    src.start(now);

    this.activeVoices.set(midi, { sources: [src], gains: [envGain], releaseSec: 0.15 });
  }

  public noteOff(midi: number): void {
    const voice = this.activeVoices.get(midi);
    if (!voice || !this.ctx) return;
    this.activeVoices.delete(midi);

    const now = this.ctx.currentTime;
    const rel = Math.max(0.015, voice.releaseSec);
    for (const g of voice.gains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + rel);
      } catch {
        // Ignore already-stopped nodes
      }
    }
    for (const s of voice.sources) {
      try {
        s.stop(now + rel + 0.02);
      } catch {
        // Ignore already-stopped nodes
      }
    }
  }

  private stopVoiceImmediate(midi: number): void {
    const voice = this.activeVoices.get(midi);
    if (!voice) return;
    this.activeVoices.delete(midi);
    for (const s of voice.sources) {
      try {
        s.stop();
      } catch {
        // Ignore
      }
    }
  }

  public playSequence(
    events: MidiNoteEvent[],
    onNoteOn: (midi: number, velocity: number) => void,
    onNoteOff: (midi: number) => void,
    onComplete?: () => void
  ): void {
    this.stopSequence();
    this.ensureContext();
    if (events.length === 0) {
      onComplete?.();
      return;
    }

    let maxEndMs = 0;
    for (const ev of events) {
      const startMs = Math.max(0, Math.round(ev.timeSec * 1000));
      const endMs = Math.max(startMs + 30, Math.round((ev.timeSec + ev.durationSec) * 1000));
      if (endMs > maxEndMs) maxEndMs = endMs;

      const onTimer = window.setTimeout(() => {
        onNoteOn(ev.midi, ev.velocity);
      }, startMs);
      const offTimer = window.setTimeout(() => {
        onNoteOff(ev.midi);
      }, endMs);
      this.sequenceTimers.push(onTimer, offTimer);
    }

    const doneTimer = window.setTimeout(() => {
      this.sequenceTimers = [];
      onComplete?.();
    }, maxEndMs + 40);
    this.sequenceTimers.push(doneTimer);
  }

  public stopSequence(): void {
    for (const id of this.sequenceTimers) {
      window.clearTimeout(id);
    }
    this.sequenceTimers = [];
    this.allNotesOff();
  }

  public allNotesOff(): void {
    for (const id of this.sequenceTimers) {
      window.clearTimeout(id);
    }
    this.sequenceTimers = [];
    for (const midi of Array.from(this.activeVoices.keys())) {
      this.stopVoiceImmediate(midi);
    }
  }
}
