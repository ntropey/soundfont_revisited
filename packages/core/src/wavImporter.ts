import { setZoneAdsr, setZoneRange, setZoneScalar } from "./sf2Helpers.js";
import { type Sf2Bank, SF2_GENERATOR, type Sf2Instrument, type Sf2Preset, type Sf2Sample } from "./types.js";

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Int16Array;
  loopStart?: number;
  loopEnd?: number;
  midiUnityNote?: number;
}

export interface PitchEstimate {
  midiKey: number;
  frequencyHz: number;
  confidence: number;
}

export interface AddWavOptions {
  name: string;
  samples: Int16Array;
  sampleRate: number;
  createPreset?: boolean;
  loopStart?: number;
  loopEnd?: number;
  originalPitch?: number;
}

export interface AddWavResult {
  sampleIndex: number;
  instrumentIndex?: number;
  presetIndex?: number;
  originalPitch: number;
}

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function clampInt16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return Math.round(v);
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/**
 * Parse a RIFF WAVE file (16-bit, 24-bit, 32-bit int PCM, or 32-bit IEEE float),
 * downmixing multi-channel audio to mono Int16Array and extracting `smpl` loop points if present.
 */
export function parseWav(input: ArrayBuffer | Uint8Array): ParsedWav {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < 12) {
    throw new Error("Invalid WAV file: header too short.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
    throw new Error("Invalid WAV file: missing RIFF/WAVE signature.");
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let hasFmt = false;

  let dataOffset = -1;
  let dataSize = 0;

  let loopStart: number | undefined;
  let loopEnd: number | undefined;
  let midiUnityNote: number | undefined;

  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkDataStart = pos + 8;
    const chunkDataEnd = Math.min(bytes.byteLength, chunkDataStart + chunkSize);

    if (chunkId === "fmt " && chunkDataEnd - chunkDataStart >= 16) {
      audioFormat = view.getUint16(chunkDataStart, true);
      channels = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      blockAlign = view.getUint16(chunkDataStart + 12, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);

      // Handle WAVE_FORMAT_EXTENSIBLE (0xFFFE)
      if (audioFormat === 0xfffe && chunkDataEnd - chunkDataStart >= 26) {
        audioFormat = view.getUint16(chunkDataStart + 24, true);
      }
      hasFmt = true;
    } else if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataSize = chunkDataEnd - chunkDataStart;
    } else if (chunkId === "smpl" && chunkDataEnd - chunkDataStart >= 36) {
      const unity = view.getUint32(chunkDataStart + 12, true);
      if (unity <= 127) {
        midiUnityNote = unity;
      }
      const numLoops = view.getUint32(chunkDataStart + 28, true);
      if (numLoops > 0 && chunkDataEnd - chunkDataStart >= 36 + 24) {
        loopStart = view.getUint32(chunkDataStart + 36 + 8, true);
        loopEnd = view.getUint32(chunkDataStart + 36 + 12, true);
      }
    }

    // RIFF chunks are word-aligned (2-byte boundary)
    pos = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!hasFmt) {
    throw new Error("Invalid WAV file: missing fmt chunk.");
  }
  if (dataOffset < 0) {
    throw new Error("Invalid WAV file: missing data chunk.");
  }
  if (channels < 1 || sampleRate <= 0) {
    throw new Error(`Invalid WAV format: channels=${channels}, sampleRate=${sampleRate}.`);
  }

  const isPcmInt = audioFormat === 1 && (bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32);
  const isIeeeFloat = audioFormat === 3 && bitsPerSample === 32;
  if (!isPcmInt && !isIeeeFloat) {
    throw new Error(
      `Unsupported WAV format: format=${audioFormat}, bitsPerSample=${bitsPerSample}. Supported: 16/24/32-bit PCM and 32-bit IEEE float.`
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = blockAlign >= channels * bytesPerSample ? blockAlign : channels * bytesPerSample;
  const numFrames = Math.floor(dataSize / frameBytes);
  const samples = new Int16Array(numFrames);

  for (let frame = 0; frame < numFrames; frame++) {
    const frameBase = dataOffset + frame * frameBytes;
    let sum = 0;

    for (let ch = 0; ch < channels; ch++) {
      const sOff = frameBase + ch * bytesPerSample;
      let normalized = 0;

      if (audioFormat === 1 && bitsPerSample === 16) {
        normalized = view.getInt16(sOff, true) / 32768;
      } else if (audioFormat === 1 && bitsPerSample === 24) {
        const b0 = bytes[sOff];
        const b1 = bytes[sOff + 1];
        const b2 = bytes[sOff + 2];
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= ~0xffffff;
        normalized = val / 8388608;
      } else if (audioFormat === 1 && bitsPerSample === 32) {
        normalized = view.getInt32(sOff, true) / 2147483648;
      } else if (audioFormat === 3 && bitsPerSample === 32) {
        normalized = view.getFloat32(sOff, true);
      }

      sum += normalized;
    }

    const mono = sum / channels;
    samples[frame] = clampInt16(mono * 32767);
  }

  let clampedLoopStart: number | undefined;
  let clampedLoopEnd: number | undefined;
  if (loopStart !== undefined && loopEnd !== undefined && numFrames > 0) {
    const ls = Math.max(0, Math.min(numFrames - 1, loopStart));
    const le = Math.max(ls, Math.min(numFrames, loopEnd));
    if (le > ls) {
      clampedLoopStart = ls;
      clampedLoopEnd = le;
    }
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    samples,
    loopStart: clampedLoopStart,
    loopEnd: clampedLoopEnd,
    midiUnityNote,
  };
}

/**
 * Deterministic normalized autocorrelation pitch detector.
 * Returns estimated MIDI root key (0..127), frequency in Hz, and confidence (0..1).
 */
export function estimateMidiRootKey(samples: Int16Array, sampleRate: number): PitchEstimate {
  if (samples.length < 64 || sampleRate <= 0) {
    return { midiKey: 60, frequencyHz: 261.6256, confidence: 0 };
  }

  // Skip leading silence so attack/silence doesn't skew the window
  let startIdx = 0;
  const silenceThreshold = 327; // ~1% of full scale
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > silenceThreshold) {
      startIdx = i;
      break;
    }
  }

  const windowSize = Math.min(4096, samples.length - startIdx);
  if (windowSize < 64) {
    return { midiKey: 60, frequencyHz: 261.6256, confidence: 0 };
  }

  // Copy window to float64 and remove DC offset
  const buf = new Float64Array(windowSize);
  let mean = 0;
  for (let i = 0; i < windowSize; i++) {
    const v = samples[startIdx + i] / 32768;
    buf[i] = v;
    mean += v;
  }
  mean /= windowSize;

  let energy = 0;
  for (let i = 0; i < windowSize; i++) {
    buf[i] -= mean;
    energy += buf[i] * buf[i];
  }

  const rms = Math.sqrt(energy / windowSize);
  if (rms < 1e-4) {
    return { midiKey: 60, frequencyHz: 261.6256, confidence: 0 };
  }

  const minLag = Math.max(2, Math.floor(sampleRate / 2000));
  const maxLag = Math.min(Math.floor(windowSize / 2), Math.floor(sampleRate / 50));
  if (maxLag <= minLag + 2) {
    return { midiKey: 60, frequencyHz: 261.6256, confidence: 0 };
  }

  const corr = new Float64Array(maxLag + 1);
  let globalMax = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const n = windowSize - lag;
    let sumXY = 0;
    let sumXX = 0;
    let sumYY = 0;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = buf[i + lag];
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }
    const denom = Math.sqrt(sumXX * sumYY);
    const r = denom > 0 ? sumXY / denom : 0;
    corr[lag] = r;
    if (r > globalMax) {
      globalMax = r;
    }
  }

  if (globalMax <= 0.1) {
    return { midiKey: 60, frequencyHz: 261.6256, confidence: 0 };
  }

  // Pick the first strong local maximum (>= 90% of globalMax) to avoid octave-down subharmonic errors
  const threshold = globalMax * 0.9;
  let bestLag = minLag;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= threshold && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      bestLag = lag;
      break;
    }
  }

  // Parabolic interpolation for sub-sample lag accuracy
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = corr[bestLag - 1];
    const y1 = corr[bestLag];
    const y2 = corr[bestLag + 1];
    const denom = 2 * (y0 - 2 * y1 + y2);
    if (Math.abs(denom) > 1e-12) {
      const delta = (y0 - y2) / denom;
      if (Math.abs(delta) < 1) {
        refinedLag = bestLag + delta;
      }
    }
  }

  const frequencyHz = sampleRate / refinedLag;
  const rawMidi = 69 + 12 * Math.log2(frequencyHz / 440);
  const midiKey = Math.max(0, Math.min(127, Math.round(rawMidi)));
  const confidence = Math.max(0, Math.min(1, corr[bestLag]));

  return { midiKey, frequencyHz, confidence };
}

/**
 * Find the nearest zero crossing to `targetIdx` within `samples`.
 */
export function findZeroCrossing(samples: Int16Array, targetIdx: number, maxRadius = 4096): number {
  const len = samples.length;
  if (len === 0) return 0;

  const clamped = Math.max(0, Math.min(len - 1, Math.round(targetIdx)));
  if (samples[clamped] === 0) return clamped;

  const isCrossing = (idx: number): boolean => {
    if (idx <= 0 || idx >= len) return false;
    const prev = samples[idx - 1];
    const curr = samples[idx];
    return curr === 0 || (prev < 0 && curr >= 0) || (prev > 0 && curr <= 0);
  };

  if (isCrossing(clamped)) return clamped;

  const limit = Math.min(maxRadius, len);
  for (let offset = 1; offset <= limit; offset++) {
    const right = clamped + offset;
    if (right < len && isCrossing(right)) return right;
    const left = clamped - offset;
    if (left > 0 && isCrossing(left)) return left;
  }

  return clamped;
}

function sanitizeSf2Name(name: string, fallback: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return (base || fallback).slice(0, 20);
}

function findNextFreePresetNumber(bank: Sf2Bank): number {
  const used = new Set(bank.presets.filter((p) => p.bank === 0).map((p) => p.preset));
  for (let p = 0; p <= 127; p++) {
    if (!used.has(p)) return p;
  }
  return bank.presets.length;
}

/**
 * Append a mono Int16Array WAV sample (and optionally a matching Instrument + Preset) to an Sf2Bank.
 */
export function addWavSampleToBank(bank: Sf2Bank, options: AddWavOptions): AddWavResult {
  const { name, samples, sampleRate, createPreset = true } = options;
  const cleanName = sanitizeSf2Name(name, `WAV_${bank.samples.length + 1}`);
  const pitch =
    options.originalPitch !== undefined && options.originalPitch >= 0 && options.originalPitch <= 127
      ? Math.round(options.originalPitch)
      : estimateMidiRootKey(samples, sampleRate).midiKey;

  const hasExplicitLoop =
    options.loopStart !== undefined &&
    options.loopEnd !== undefined &&
    options.loopEnd > options.loopStart;

  const loopStart = hasExplicitLoop ? Math.max(0, Math.min(samples.length, options.loopStart!)) : 0;
  const loopEnd = hasExplicitLoop
    ? Math.max(loopStart, Math.min(samples.length, options.loopEnd!))
    : samples.length;

  const sf2Sample: Sf2Sample = {
    name: cleanName,
    start: 0,
    end: samples.length,
    loopStart,
    loopEnd,
    sampleRate,
    originalPitch: pitch,
    pitchCorrection: 0,
    sampleLink: 0,
    sampleType: 1, // mono
    pcmData: samples,
  };

  const sampleIndex = bank.samples.length;
  bank.samples.push(sf2Sample);

  if (!createPreset) {
    return { sampleIndex, originalPitch: pitch };
  }

  const instZone = { generators: [], modulators: [] };
  setZoneRange(instZone, SF2_GENERATOR.keyRange, 0, 127);
  setZoneRange(instZone, SF2_GENERATOR.velRange, 0, 127);
  setZoneScalar(instZone, SF2_GENERATOR.overridingRootKey, pitch);
  setZoneScalar(instZone, SF2_GENERATOR.sampleModes, hasExplicitLoop ? 1 : 0);
  setZoneAdsr(instZone, {
    delaySec: 0,
    attackSec: 0.005,
    holdSec: 0,
    decaySec: 0.25,
    sustainLevel: 0.8,
    releaseSec: 0.25,
  });
  setZoneScalar(instZone, SF2_GENERATOR.sampleID, sampleIndex);

  const inst: Sf2Instrument = {
    name: cleanName,
    zones: [instZone],
  };
  const instrumentIndex = bank.instruments.length;
  bank.instruments.push(inst);

  const presetZone = { generators: [], modulators: [] };
  setZoneRange(presetZone, SF2_GENERATOR.keyRange, 0, 127);
  setZoneScalar(presetZone, SF2_GENERATOR.instrument, instrumentIndex);

  const preset: Sf2Preset = {
    name: cleanName,
    preset: findNextFreePresetNumber(bank),
    bank: 0,
    library: 0,
    genre: 0,
    morphology: 0,
    zones: [presetZone],
  };
  const presetIndex = bank.presets.length;
  bank.presets.push(preset);

  return {
    sampleIndex,
    instrumentIndex,
    presetIndex,
    originalPitch: pitch,
  };
}
