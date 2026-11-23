import { describe, expect, it } from "vitest";
import {
  createDemoBank,
  encodeWav16,
  exportPresetToSfz,
  getZoneAdsr,
  getZoneRange,
  getZoneScalar,
  midiNoteToName,
  parseSf2,
  secondsToTimecents,
  setZoneAdsr,
  setZoneRange,
  setZoneScalar,
  SF2_GENERATOR,
  timecentsToSeconds,
  validateBank,
  writeSf2,
} from "../src/index.js";

describe("SoundFont Revisited Core", () => {
  it("generates a valid built-in Retro GM Starter Bank", () => {
    const bank = createDemoBank();
    expect(bank.info.inam).toBe("Retro GM Starter Bank");
    expect(bank.presets).toHaveLength(4);
    expect(bank.instruments).toHaveLength(4);
    expect(bank.samples).toHaveLength(4);

    for (const sample of bank.samples) {
      expect(sample.pcmData.length).toBeGreaterThan(100);
      expect(sample.sampleRate).toBe(44100);
      expect(sample.loopStart).toBeGreaterThan(0);
      expect(sample.loopEnd).toBeGreaterThan(sample.loopStart);
      expect(sample.loopEnd).toBeLessThan(sample.pcmData.length);
    }

    const diagnostics = validateBank(bank);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
    expect(diagnostics.some((d) => d.severity === "info")).toBe(true);
  });

  it("round-trips Sf2Bank through writeSf2 and parseSf2 without data loss", () => {
    const original = createDemoBank();
    original.info.inam = "Custom Test Bank";
    original.info.ieng = "Studio Engineer";
    original.info.icop = "CC0";
    original.info.icmt = "Round-trip verification comment.";

    const binary = writeSf2(original);
    expect(binary[0]).toBe("R".charCodeAt(0));
    expect(binary[1]).toBe("I".charCodeAt(0));
    expect(binary[2]).toBe("F".charCodeAt(0));
    expect(binary[3]).toBe("F".charCodeAt(0));
    expect(binary[8]).toBe("s".charCodeAt(0));
    expect(binary[9]).toBe("f".charCodeAt(0));
    expect(binary[10]).toBe("b".charCodeAt(0));
    expect(binary[11]).toBe("k".charCodeAt(0));

    const parsed = parseSf2(binary);
    expect(parsed.info.inam).toBe("Custom Test Bank");
    expect(parsed.info.ieng).toBe("Studio Engineer");
    expect(parsed.info.icop).toBe("CC0");
    expect(parsed.info.icmt).toBe("Round-trip verification comment.");
    expect(parsed.info.ifil).toEqual({ major: 2, minor: 1 });

    expect(parsed.samples).toHaveLength(original.samples.length);
    for (let i = 0; i < original.samples.length; i++) {
      const a = original.samples[i];
      const b = parsed.samples[i];
      expect(b.name).toBe(a.name);
      expect(b.sampleRate).toBe(a.sampleRate);
      expect(b.originalPitch).toBe(a.originalPitch);
      expect(b.loopStart).toBe(a.loopStart);
      expect(b.loopEnd).toBe(a.loopEnd);
      expect(b.pcmData.length).toBe(a.pcmData.length);
      expect(b.pcmData[0]).toBe(a.pcmData[0]);
      expect(b.pcmData[b.pcmData.length - 1]).toBe(a.pcmData[a.pcmData.length - 1]);
    }

    expect(parsed.instruments).toHaveLength(original.instruments.length);
    expect(parsed.presets).toHaveLength(original.presets.length);
    for (let i = 0; i < original.presets.length; i++) {
      expect(parsed.presets[i].name).toBe(original.presets[i].name);
      expect(parsed.presets[i].preset).toBe(original.presets[i].preset);
      expect(parsed.presets[i].bank).toBe(original.presets[i].bank);
      expect(parsed.presets[i].zones.length).toBe(original.presets[i].zones.length);
    }

    // Verify range and ADSR generators survived round-trip
    const origZone = original.instruments[2].zones[0];
    const parsedZone = parsed.instruments[2].zones[0];
    expect(getZoneRange(parsedZone, SF2_GENERATOR.keyRange)).toEqual(
      getZoneRange(origZone, SF2_GENERATOR.keyRange)
    );
    expect(getZoneScalar(parsedZone, SF2_GENERATOR.sampleModes, 0)).toBe(1);
    const origAdsr = getZoneAdsr(origZone);
    const parsedAdsr = getZoneAdsr(parsedZone);
    expect(parsedAdsr.attackSec).toBeCloseTo(origAdsr.attackSec, 2);
    expect(parsedAdsr.releaseSec).toBeCloseTo(origAdsr.releaseSec, 2);
  });

  it("rejects malformed RIFF headers in parseSf2", () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() => parseSf2(bad)).toThrow(/too small/i);

    const header = "RIFF\x04\x00\x00\x00WAVE";
    const wrongMagic = Uint8Array.from(header, (c) => c.charCodeAt(0));
    expect(() => parseSf2(wrongMagic)).toThrow(/expected RIFF\/sfbk/i);
  });

  it("exports valid SFZ text and 16-bit WAV headers", () => {
    const bank = createDemoBank();
    const res = exportPresetToSfz(bank, 1); // Square Lead
    expect(res.sfzText).toContain("<control>");
    expect(res.sfzText).toContain("<region>");
    expect(res.sfzText).toContain("sample=Square_Lead_1.wav");
    expect(res.sfzText).toContain("loop_mode=loop_continuous");
    expect(res.sfzText).toContain("pitch_keycenter=60");
    expect(res.sfzText).toContain("ampeg_attack=");

    expect(res.wavFiles).toHaveLength(1);
    const wav = res.wavFiles[0].data;
    expect(String.fromCharCode(wav[0], wav[1], wav[2], wav[3])).toBe("RIFF");
    expect(String.fromCharCode(wav[8], wav[9], wav[10], wav[11])).toBe("WAVE");
    expect(String.fromCharCode(wav[36], wav[37], wav[38], wav[39])).toBe("data");

    const standaloneWav = encodeWav16(new Int16Array([0, 1000, -1000]), 48000);
    expect(standaloneWav.byteLength).toBe(44 + 6);
  });

  it("supports editing zone ranges, tuning, ADSR, and helper conversions", () => {
    const bank = createDemoBank();
    const zone = bank.instruments[0].zones[0];

    setZoneRange(zone, SF2_GENERATOR.keyRange, 36, 84);
    expect(getZoneRange(zone, SF2_GENERATOR.keyRange)).toEqual({ lo: 36, hi: 84 });

    setZoneScalar(zone, SF2_GENERATOR.coarseTune, -12);
    setZoneScalar(zone, SF2_GENERATOR.fineTune, 25);
    expect(getZoneScalar(zone, SF2_GENERATOR.coarseTune, 0)).toBe(-12);
    expect(getZoneScalar(zone, SF2_GENERATOR.fineTune, 0)).toBe(25);

    setZoneAdsr(zone, {
      delaySec: 0.01,
      attackSec: 0.25,
      holdSec: 0.1,
      decaySec: 0.5,
      sustainLevel: 0.5,
      releaseSec: 1.2,
    });
    const adsr = getZoneAdsr(zone);
    expect(adsr.attackSec).toBeCloseTo(0.25, 2);
    expect(adsr.decaySec).toBeCloseTo(0.5, 2);
    expect(adsr.sustainLevel).toBeCloseTo(0.5, 2);
    expect(adsr.releaseSec).toBeCloseTo(1.2, 2);

    expect(midiNoteToName(60)).toBe("C4");
    expect(midiNoteToName(36)).toBe("C2");
    expect(timecentsToSeconds(secondsToTimecents(0.5))).toBeCloseTo(0.5, 2);
  });
});
