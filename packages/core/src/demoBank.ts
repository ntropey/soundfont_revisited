import { secondsToTimecents, levelToSustainCb } from "./sf2Helpers.js";
import { type Sf2Bank, SF2_GENERATOR, type Sf2Sample } from "./types.js";

const SAMPLE_RATE = 44100;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Synthesize an integer-period looped waveform so loopStart..loopEnd is 100% click-free.
 */
function buildLoopedWaveform(
  name: string,
  rootMidi: number,
  cycles: number,
  sampleFn: (phase: number) => number
): Sf2Sample {
  const freq = midiToFreq(rootMidi);
  const periodSamples = Math.round(SAMPLE_RATE / freq);
  const totalSamples = periodSamples * cycles;
  const pcmData = new Int16Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const phase = (i % periodSamples) / periodSamples;
    const val = Math.max(-1, Math.min(1, sampleFn(phase)));
    pcmData[i] = Math.round(val * 28000);
  }

  // Loop the middle cycles cleanly at zero-crossing period boundaries
  const loopStart = periodSamples * 2;
  const loopEnd = periodSamples * (cycles - 2);

  return {
    name,
    start: 0,
    end: totalSamples,
    loopStart,
    loopEnd,
    sampleRate: SAMPLE_RATE,
    originalPitch: rootMidi,
    pitchCorrection: 0,
    sampleLink: 0,
    sampleType: 1,
    pcmData,
  };
}

/**
 * Generate a clean, self-contained Retro GM Starter Bank in memory.
 */
export function createDemoBank(): Sf2Bank {
  // 1. Warm Sine (C4 = 60)
  const warmSine = buildLoopedWaveform("Warm Sine", 60, 24, (p) => {
    return 0.85 * Math.sin(2 * Math.PI * p) + 0.15 * Math.sin(4 * Math.PI * p);
  });

  // 2. Square Lead (C4 = 60, band-limited additive harmonics)
  const squareLead = buildLoopedWaveform("Square Lead", 60, 24, (p) => {
    let sum = 0;
    for (let h = 1; h <= 9; h += 2) {
      sum += Math.sin(2 * Math.PI * h * p) / h;
    }
    return sum * 0.8;
  });

  // 3. Saw Brass (C4 = 60, band-limited additive sawtooth)
  const sawBrass = buildLoopedWaveform("Saw Brass", 60, 24, (p) => {
    let sum = 0;
    for (let h = 1; h <= 12; h++) {
      sum += (Math.sin(2 * Math.PI * h * p) / h) * (h % 2 === 0 ? -1 : 1);
    }
    return sum * 0.65;
  });

  // 4. Sub Bass (C2 = 36)
  const subBass = buildLoopedWaveform("Sub Bass", 36, 12, (p) => {
    return 0.88 * Math.sin(2 * Math.PI * p) + 0.12 * Math.sin(6 * Math.PI * p);
  });

  const samples = [warmSine, squareLead, sawBrass, subBass];

  const makeAdsrGens = (
    attackSec: number,
    holdSec: number,
    decaySec: number,
    sustainLevel: number,
    releaseSec: number
  ) => [
    { oper: SF2_GENERATOR.attackVolEnv, amount: secondsToTimecents(attackSec) },
    { oper: SF2_GENERATOR.holdVolEnv, amount: secondsToTimecents(holdSec) },
    { oper: SF2_GENERATOR.decayVolEnv, amount: secondsToTimecents(decaySec) },
    { oper: SF2_GENERATOR.sustainVolEnv, amount: levelToSustainCb(sustainLevel) },
    { oper: SF2_GENERATOR.releaseVolEnv, amount: secondsToTimecents(releaseSec) },
  ];

  const instruments = [
    {
      name: "Warm Sine",
      zones: [
        {
          generators: [
            { oper: SF2_GENERATOR.keyRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.velRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.sampleModes, amount: 1 },
            { oper: SF2_GENERATOR.overridingRootKey, amount: 60 },
            ...makeAdsrGens(0.015, 0.02, 0.35, 0.75, 0.35),
            { oper: SF2_GENERATOR.sampleID, amount: 0 },
          ],
          modulators: [],
        },
      ],
    },
    {
      name: "Square Lead",
      zones: [
        {
          generators: [
            { oper: SF2_GENERATOR.keyRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.velRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.sampleModes, amount: 1 },
            { oper: SF2_GENERATOR.overridingRootKey, amount: 60 },
            ...makeAdsrGens(0.008, 0.01, 0.2, 0.85, 0.22),
            { oper: SF2_GENERATOR.sampleID, amount: 1 },
          ],
          modulators: [],
        },
      ],
    },
    {
      name: "Saw Brass",
      zones: [
        {
          generators: [
            { oper: SF2_GENERATOR.keyRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.velRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.sampleModes, amount: 1 },
            { oper: SF2_GENERATOR.overridingRootKey, amount: 60 },
            ...makeAdsrGens(0.06, 0.05, 0.4, 0.7, 0.45),
            { oper: SF2_GENERATOR.sampleID, amount: 2 },
          ],
          modulators: [],
        },
      ],
    },
    {
      name: "Sub Bass",
      zones: [
        {
          generators: [
            { oper: SF2_GENERATOR.keyRange, amount: { lo: 0, hi: 72 } },
            { oper: SF2_GENERATOR.velRange, amount: { lo: 0, hi: 127 } },
            { oper: SF2_GENERATOR.sampleModes, amount: 1 },
            { oper: SF2_GENERATOR.overridingRootKey, amount: 36 },
            ...makeAdsrGens(0.005, 0.02, 0.3, 0.8, 0.18),
            { oper: SF2_GENERATOR.sampleID, amount: 3 },
          ],
          modulators: [],
        },
      ],
    },
  ];

  const presets = instruments.map((inst, idx) => ({
    name: inst.name,
    preset: idx,
    bank: 0,
    library: 0,
    genre: 0,
    morphology: 0,
    zones: [
      {
        generators: [
          { oper: SF2_GENERATOR.keyRange, amount: { lo: 0, hi: 127 } },
          { oper: SF2_GENERATOR.instrument, amount: idx },
        ],
        modulators: [],
      },
    ],
  }));

  return {
    info: {
      ifil: { major: 2, minor: 1 },
      isng: "EMU8000",
      inam: "Retro GM Starter Bank",
      ieng: "Revisited Labs",
      icop: "GPL-3.0-or-later",
      icmt: "Built-in synthesized starter bank for SoundFont Revisited.",
      isft: "SoundFont Revisited",
    },
    samples,
    instruments,
    presets,
  };
}
