import {
  type AdsrEnvelope,
  type BankDiagnostic,
  type Sf2Bank,
  type Sf2Generator,
  SF2_GENERATOR,
  type Sf2Range,
  type Sf2Zone,
} from "./types.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Convert MIDI note number (0..127) to human-readable name like "C4" (60 = C4). */
export function midiNoteToName(note: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(note)));
  const octave = Math.floor(clamped / 12) - 1;
  const name = NOTE_NAMES[clamped % 12];
  return `${name}${octave}`;
}

/** Convert SF2 timecents (-12000..8000) to seconds. -12000 or lower effectively means ~0s. */
export function timecentsToSeconds(tc: number): number {
  if (tc <= -12000) return 0.001;
  return Math.pow(2, tc / 1200);
}

/** Convert seconds to SF2 timecents (clamped to -12000..8000). */
export function secondsToTimecents(seconds: number): number {
  if (seconds <= 0.001) return -12000;
  const tc = Math.round(1200 * Math.log2(seconds));
  return Math.max(-12000, Math.min(8000, tc));
}

/** Convert SF2 sustainVolEnv centibels attenuation (0..1000 cB = 0..100 dB) to linear 0..1. */
export function sustainCbToLevel(cb: number): number {
  const clamped = Math.max(0, Math.min(1000, cb));
  if (clamped >= 1000) return 0;
  return Math.pow(10, -clamped / 200);
}

/** Convert linear sustain level (0..1) to SF2 sustainVolEnv centibels (0..1000). */
export function levelToSustainCb(level: number): number {
  if (level <= 0.0001) return 1000;
  if (level >= 1) return 0;
  const cb = Math.round(-200 * Math.log10(level));
  return Math.max(0, Math.min(1000, cb));
}

export function isRangeGenerator(oper: number): boolean {
  return oper === SF2_GENERATOR.keyRange || oper === SF2_GENERATOR.velRange;
}

export function getZoneGenerator(zone: Sf2Zone, oper: number): Sf2Generator | undefined {
  return zone.generators.find((g) => g.oper === oper);
}

export function getZoneScalar(zone: Sf2Zone, oper: number, fallback: number): number {
  const gen = getZoneGenerator(zone, oper);
  if (!gen || typeof gen.amount !== "number") return fallback;
  return gen.amount;
}

export function setZoneScalar(zone: Sf2Zone, oper: number, value: number): void {
  const intVal = Math.max(-32768, Math.min(32767, Math.round(value)));
  const existing = zone.generators.find((g) => g.oper === oper);
  if (existing) {
    existing.amount = intVal;
  } else {
    // Keep terminal generators (instrument=41, sampleID=53) at the end of the zone per SF2 spec
    const termIdx = zone.generators.findIndex(
      (g) => g.oper === SF2_GENERATOR.instrument || g.oper === SF2_GENERATOR.sampleID
    );
    const newGen: Sf2Generator = { oper, amount: intVal };
    if (termIdx >= 0) {
      zone.generators.splice(termIdx, 0, newGen);
    } else {
      zone.generators.push(newGen);
    }
  }
}

export function getZoneRange(zone: Sf2Zone, oper: number): Sf2Range {
  const gen = getZoneGenerator(zone, oper);
  if (!gen) return { lo: 0, hi: 127 };
  if (typeof gen.amount === "object") {
    return { lo: gen.amount.lo, hi: gen.amount.hi };
  }
  return { lo: gen.amount & 0xff, hi: (gen.amount >> 8) & 0xff };
}

export function setZoneRange(zone: Sf2Zone, oper: number, lo: number, hi: number): void {
  const clampedLo = Math.max(0, Math.min(127, Math.round(lo)));
  const clampedHi = Math.max(clampedLo, Math.min(127, Math.round(hi)));
  const existing = zone.generators.find((g) => g.oper === oper);
  const rangeVal: Sf2Range = { lo: clampedLo, hi: clampedHi };
  if (existing) {
    existing.amount = rangeVal;
  } else {
    // keyRange/velRange should appear first in a zone per SF2 spec
    zone.generators.unshift({ oper, amount: rangeVal });
  }
}

export function getZoneAdsr(zone: Sf2Zone, globalZone?: Sf2Zone): AdsrEnvelope {
  const getVal = (oper: number, def: number): number => {
    const local = getZoneGenerator(zone, oper);
    if (local && typeof local.amount === "number") return local.amount;
    if (globalZone) {
      const glob = getZoneGenerator(globalZone, oper);
      if (glob && typeof glob.amount === "number") return glob.amount;
    }
    return def;
  };

  return {
    delaySec: timecentsToSeconds(getVal(SF2_GENERATOR.delayVolEnv, -12000)),
    attackSec: timecentsToSeconds(getVal(SF2_GENERATOR.attackVolEnv, -12000)),
    holdSec: timecentsToSeconds(getVal(SF2_GENERATOR.holdVolEnv, -12000)),
    decaySec: timecentsToSeconds(getVal(SF2_GENERATOR.decayVolEnv, -12000)),
    sustainLevel: sustainCbToLevel(getVal(SF2_GENERATOR.sustainVolEnv, 0)),
    releaseSec: timecentsToSeconds(getVal(SF2_GENERATOR.releaseVolEnv, -12000)),
  };
}

export function setZoneAdsr(zone: Sf2Zone, adsr: AdsrEnvelope): void {
  setZoneScalar(zone, SF2_GENERATOR.delayVolEnv, secondsToTimecents(adsr.delaySec));
  setZoneScalar(zone, SF2_GENERATOR.attackVolEnv, secondsToTimecents(adsr.attackSec));
  setZoneScalar(zone, SF2_GENERATOR.holdVolEnv, secondsToTimecents(adsr.holdSec));
  setZoneScalar(zone, SF2_GENERATOR.decayVolEnv, secondsToTimecents(adsr.decaySec));
  setZoneScalar(zone, SF2_GENERATOR.sustainVolEnv, levelToSustainCb(adsr.sustainLevel));
  setZoneScalar(zone, SF2_GENERATOR.releaseVolEnv, secondsToTimecents(adsr.releaseSec));
}

export function cloneZone(zone: Sf2Zone): Sf2Zone {
  return {
    generators: zone.generators.map((g) => ({
      oper: g.oper,
      amount: typeof g.amount === "object" ? { ...g.amount } : g.amount,
    })),
    modulators: zone.modulators.map((m) => ({ ...m })),
  };
}

/** Deterministic symbolic validator for SF2 bank integrity. */
export function validateBank(bank: Sf2Bank): BankDiagnostic[] {
  const diagnostics: BankDiagnostic[] = [];

  if (!bank.info.inam.trim()) {
    diagnostics.push({
      severity: "warning",
      scope: "bank",
      targetName: "INFO.INAM",
      message: "Bank name (INAM) is empty.",
    });
  }

  for (let sIdx = 0; sIdx < bank.samples.length; sIdx++) {
    const s = bank.samples[sIdx];
    if (s.pcmData.length === 0) {
      diagnostics.push({
        severity: "error",
        scope: "sample",
        targetName: s.name || `Sample #${sIdx}`,
        message: "Sample has 0 PCM frames.",
      });
    }
    if (s.sampleRate < 4000 || s.sampleRate > 192000) {
      diagnostics.push({
        severity: "warning",
        scope: "sample",
        targetName: s.name || `Sample #${sIdx}`,
        message: `Unusual sample rate (${s.sampleRate} Hz).`,
      });
    }
    if (s.loopStart > s.loopEnd || s.loopEnd > s.pcmData.length) {
      diagnostics.push({
        severity: "error",
        scope: "sample",
        targetName: s.name || `Sample #${sIdx}`,
        message: `Invalid loop bounds (${s.loopStart}..${s.loopEnd}) for length ${s.pcmData.length}.`,
      });
    }
    if (s.originalPitch > 127 && s.originalPitch !== 255) {
      diagnostics.push({
        severity: "warning",
        scope: "sample",
        targetName: s.name || `Sample #${sIdx}`,
        message: `Invalid originalPitch (${s.originalPitch}).`,
      });
    }
  }

  for (const inst of bank.instruments) {
    if (inst.zones.length === 0) {
      diagnostics.push({
        severity: "warning",
        scope: "instrument",
        targetName: inst.name,
        message: "Instrument has no zones.",
      });
      continue;
    }
    for (let zIdx = 0; zIdx < inst.zones.length; zIdx++) {
      const z = inst.zones[zIdx];
      const sampleGen = getZoneGenerator(z, SF2_GENERATOR.sampleID);
      if (!sampleGen) {
        if (zIdx !== 0) {
          diagnostics.push({
            severity: "warning",
            scope: "instrument",
            targetName: inst.name,
            message: `Zone #${zIdx} is missing a sampleID generator.`,
          });
        }
        continue;
      }
      const sid = typeof sampleGen.amount === "number" ? sampleGen.amount : -1;
      if (sid < 0 || sid >= bank.samples.length) {
        diagnostics.push({
          severity: "error",
          scope: "instrument",
          targetName: inst.name,
          message: `Zone #${zIdx} references out-of-range sampleID ${sid}.`,
        });
      }
    }
  }

  for (const preset of bank.presets) {
    if (preset.zones.length === 0) {
      diagnostics.push({
        severity: "warning",
        scope: "preset",
        targetName: preset.name,
        message: "Preset has no zones.",
      });
      continue;
    }
    for (let zIdx = 0; zIdx < preset.zones.length; zIdx++) {
      const z = preset.zones[zIdx];
      const instGen = getZoneGenerator(z, SF2_GENERATOR.instrument);
      if (!instGen) {
        if (zIdx !== 0) {
          diagnostics.push({
            severity: "warning",
            scope: "preset",
            targetName: preset.name,
            message: `Preset zone #${zIdx} is missing an instrument generator.`,
          });
        }
        continue;
      }
      const iid = typeof instGen.amount === "number" ? instGen.amount : -1;
      if (iid < 0 || iid >= bank.instruments.length) {
        diagnostics.push({
          severity: "error",
          scope: "preset",
          targetName: preset.name,
          message: `Preset zone #${zIdx} references out-of-range instrument ${iid}.`,
        });
      }
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      severity: "info",
      scope: "bank",
      targetName: bank.info.inam,
      message: `All ${bank.presets.length} presets, ${bank.instruments.length} instruments, and ${bank.samples.length} samples passed structural checks.`,
    });
  }

  return diagnostics;
}
