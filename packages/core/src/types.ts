/**
 * SoundFont 2.01 (SF2) data structures and generator identifiers.
 * Pure TypeScript, zero DOM/Node dependencies.
 */

export const SF2_GENERATOR = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  delayModLfo: 21,
  freqModLfo: 22,
  delayVibLfo: 23,
  freqVibLfo: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  keynumToModEnvHold: 31,
  keynumToModEnvDecay: 32,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
  endOper: 60,
} as const;

export type Sf2GeneratorOper = number;

export interface Sf2Range {
  lo: number;
  hi: number;
}

export interface Sf2Generator {
  oper: Sf2GeneratorOper;
  /** Signed 16-bit integer for scalar generators, or { lo, hi } (0..127) for keyRange/velRange. */
  amount: number | Sf2Range;
}

export interface Sf2Modulator {
  srcOper: number;
  destOper: number;
  amount: number;
  amtSrcOper: number;
  transOper: number;
}

export interface Sf2Zone {
  generators: Sf2Generator[];
  modulators: Sf2Modulator[];
}

export interface Sf2Sample {
  name: string;
  /** Offset in samples relative to start of this sample's pcmData (usually 0). */
  start: number;
  /** Length in samples (equals pcmData.length). */
  end: number;
  /** Loop start offset in samples relative to this sample's pcmData start. */
  loopStart: number;
  /** Loop end offset in samples relative to this sample's pcmData start. */
  loopEnd: number;
  sampleRate: number;
  /** MIDI note number (0-127, 255 = unpitched). */
  originalPitch: number;
  /** Pitch correction in cents (-99..99). */
  pitchCorrection: number;
  sampleLink: number;
  /** 1 = mono, 2 = right, 4 = left, 8 = linked, 0x8000 bit = ROM. */
  sampleType: number;
  pcmData: Int16Array;
}

export interface Sf2Instrument {
  name: string;
  zones: Sf2Zone[];
}

export interface Sf2Preset {
  name: string;
  preset: number;
  bank: number;
  library: number;
  genre: number;
  morphology: number;
  zones: Sf2Zone[];
}

export interface Sf2Info {
  ifil: { major: number; minor: number };
  isng: string;
  inam: string;
  irom?: string;
  iver?: { major: number; minor: number };
  icrd?: string;
  ieng?: string;
  iprd?: string;
  icop?: string;
  icmt?: string;
  isft?: string;
}

export interface Sf2Bank {
  info: Sf2Info;
  samples: Sf2Sample[];
  instruments: Sf2Instrument[];
  presets: Sf2Preset[];
}

export interface AdsrEnvelope {
  /** Delay in seconds (0..20) */
  delaySec: number;
  /** Attack in seconds (0.001..20) */
  attackSec: number;
  /** Hold in seconds (0..20) */
  holdSec: number;
  /** Decay in seconds (0.001..20) */
  decaySec: number;
  /** Sustain level in 0..1 (converted from SF2 centibels attenuation 0..1000) */
  sustainLevel: number;
  /** Release in seconds (0.001..20) */
  releaseSec: number;
}

export type LoopMode = 0 | 1 | 3; // 0 = no loop, 1 = continuous, 3 = loop + release

export interface BankDiagnostic {
  severity: "error" | "warning" | "info";
  scope: "bank" | "preset" | "instrument" | "sample";
  targetName: string;
  message: string;
}
