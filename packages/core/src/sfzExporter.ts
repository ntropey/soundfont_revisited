import {
  getZoneAdsr,
  getZoneGenerator,
  getZoneRange,
  getZoneScalar,
} from "./sf2Helpers.js";
import { type Sf2Bank, SF2_GENERATOR } from "./types.js";

export interface SfzExportResult {
  sfzText: string;
  wavFiles: Array<{ filename: string; data: Uint8Array }>;
}

/**
 * Encode a 16-bit mono PCM Int16Array into a standard RIFF WAVE (.wav) binary buffer.
 */
export function encodeWav16(pcmData: Int16Array, sampleRate: number): Uint8Array {
  const dataSize = pcmData.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(44 + i * 2, pcmData[i], true);
  }

  return new Uint8Array(buffer);
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "sample";
}

/**
 * Export a single preset from an Sf2Bank to SFZ text + WAV sample files.
 */
export function exportPresetToSfz(bank: Sf2Bank, presetIndex: number): SfzExportResult {
  const preset = bank.presets[presetIndex];
  if (!preset) {
    throw new Error(`Preset index ${presetIndex} out of range.`);
  }

  const lines: string[] = [
    `// Exported by SoundFont Revisited`,
    `// Bank: ${bank.info.inam}`,
    `// Preset: ${preset.bank}:${preset.preset} - ${preset.name}`,
    ``,
    `<control>`,
    `default_path=samples/`,
    ``,
    `<group>`,
  ];

  const wavMap = new Map<number, { filename: string; data: Uint8Array }>();

  for (const pZone of preset.zones) {
    const instGen = getZoneGenerator(pZone, SF2_GENERATOR.instrument);
    if (!instGen || typeof instGen.amount !== "number") continue;
    const inst = bank.instruments[instGen.amount];
    if (!inst) continue;

    const pKeyRange = getZoneRange(pZone, SF2_GENERATOR.keyRange);
    const pVelRange = getZoneRange(pZone, SF2_GENERATOR.velRange);
    const globalIZone =
      inst.zones.length > 0 && !getZoneGenerator(inst.zones[0], SF2_GENERATOR.sampleID)
        ? inst.zones[0]
        : undefined;

    for (const iZone of inst.zones) {
      const sampleGen = getZoneGenerator(iZone, SF2_GENERATOR.sampleID);
      if (!sampleGen || typeof sampleGen.amount !== "number") continue;
      const sampleIdx = sampleGen.amount;
      const sample = bank.samples[sampleIdx];
      if (!sample) continue;

      if (!wavMap.has(sampleIdx)) {
        const filename = `${sanitizeFilename(sample.name)}_${sampleIdx}.wav`;
        wavMap.set(sampleIdx, {
          filename,
          data: encodeWav16(sample.pcmData, sample.sampleRate),
        });
      }
      const wavInfo = wavMap.get(sampleIdx)!;

      const iKeyRange = getZoneRange(iZone, SF2_GENERATOR.keyRange);
      const iVelRange = getZoneRange(iZone, SF2_GENERATOR.velRange);

      const lokey = Math.max(pKeyRange.lo, iKeyRange.lo);
      const hikey = Math.min(pKeyRange.hi, iKeyRange.hi);
      const lovel = Math.max(pVelRange.lo, iVelRange.lo);
      const hivel = Math.min(pVelRange.hi, iVelRange.hi);
      if (lokey > hikey || lovel > hivel) continue;

      const rootKey = getZoneScalar(
        iZone,
        SF2_GENERATOR.overridingRootKey,
        sample.originalPitch <= 127 ? sample.originalPitch : 60
      );
      const coarseTune = getZoneScalar(iZone, SF2_GENERATOR.coarseTune, 0);
      const fineTune = getZoneScalar(iZone, SF2_GENERATOR.fineTune, 0) + sample.pitchCorrection;
      const sampleMode = getZoneScalar(iZone, SF2_GENERATOR.sampleModes, 0);
      const adsr = getZoneAdsr(iZone, globalIZone);
      const panRaw = getZoneScalar(iZone, SF2_GENERATOR.pan, 0); // -500..500
      const attenCb = getZoneScalar(iZone, SF2_GENERATOR.initialAttenuation, 0);

      lines.push(`<region>`);
      lines.push(`sample=${wavInfo.filename}`);
      lines.push(`lokey=${lokey} hikey=${hikey}`);
      lines.push(`lovel=${lovel} hivel=${hivel}`);
      lines.push(`pitch_keycenter=${rootKey}`);
      if (coarseTune !== 0) {
        lines.push(`transpose=${coarseTune}`);
      }
      if (fineTune !== 0) {
        lines.push(`tune=${fineTune}`);
      }
      if (sampleMode === 1 || sampleMode === 3) {
        lines.push(`loop_mode=loop_continuous`);
        lines.push(`loop_start=${sample.loopStart}`);
        lines.push(`loop_end=${Math.max(sample.loopStart, sample.loopEnd - 1)}`);
      } else {
        lines.push(`loop_mode=no_loop`);
      }
      lines.push(`ampeg_delay=${adsr.delaySec.toFixed(4)}`);
      lines.push(`ampeg_attack=${adsr.attackSec.toFixed(4)}`);
      lines.push(`ampeg_hold=${adsr.holdSec.toFixed(4)}`);
      lines.push(`ampeg_decay=${adsr.decaySec.toFixed(4)}`);
      lines.push(`ampeg_sustain=${(adsr.sustainLevel * 100).toFixed(2)}`);
      lines.push(`ampeg_release=${adsr.releaseSec.toFixed(4)}`);
      if (panRaw !== 0) {
        lines.push(`pan=${(panRaw / 5).toFixed(1)}`);
      }
      if (attenCb !== 0) {
        lines.push(`volume=${(-attenCb / 10).toFixed(2)}`);
      }
      lines.push(``);
    }
  }

  return {
    sfzText: lines.join("\n"),
    wavFiles: Array.from(wavMap.values()),
  };
}
