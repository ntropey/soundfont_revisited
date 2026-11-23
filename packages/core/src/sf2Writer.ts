import { isRangeGenerator } from "./sf2Helpers.js";
import { type Sf2Bank, type Sf2Generator, type Sf2Modulator, type Sf2Zone } from "./types.js";

const SAMPLE_PAD_FRAMES = 46; // SF2 spec requires >=46 zero samples between/after samples

class ByteBuilder {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  writeFourCC(str: string): void {
    this.ensure(4);
    for (let i = 0; i < 4; i++) {
      this.buf[this.len++] = i < str.length ? str.charCodeAt(i) & 0xff : 0x20;
    }
  }

  writeFixedString(str: string, length: number): void {
    this.ensure(length);
    const copyLen = Math.min(str.length, length - 1);
    for (let i = 0; i < length; i++) {
      this.buf[this.len++] = i < copyLen ? str.charCodeAt(i) & 0xff : 0;
    }
  }

  writeUint8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  writeInt8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  writeUint16(v: number): void {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }

  writeInt16(v: number): void {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }

  writeUint32(v: number): void {
    this.ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
    this.buf[this.len++] = (v >> 16) & 0xff;
    this.buf[this.len++] = (v >> 24) & 0xff;
  }

  writeBytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  writeChunk(id: string, payload: Uint8Array): void {
    this.writeFourCC(id);
    this.writeUint32(payload.length);
    this.writeBytes(payload);
    if (payload.length & 1) {
      this.writeUint8(0);
    }
  }

  writeZStrChunk(id: string, value: string): void {
    const payload = new Uint8Array(value.length + 1);
    for (let i = 0; i < value.length; i++) {
      payload[i] = value.charCodeAt(i) & 0xff;
    }
    payload[value.length] = 0;
    this.writeChunk(id, payload);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function serializeZones(zonesList: Sf2Zone[][]): {
  bags: Array<{ genNdx: number; modNdx: number }>;
  gens: Sf2Generator[];
  mods: Sf2Modulator[];
  bagOffsets: number[];
} {
  const bags: Array<{ genNdx: number; modNdx: number }> = [];
  const gens: Sf2Generator[] = [];
  const mods: Sf2Modulator[] = [];
  const bagOffsets: number[] = [];

  for (const zones of zonesList) {
    bagOffsets.push(bags.length);
    for (const z of zones) {
      bags.push({ genNdx: gens.length, modNdx: mods.length });
      for (const g of z.generators) {
        gens.push(g);
      }
      for (const m of z.modulators) {
        mods.push(m);
      }
    }
  }
  // Terminal record
  bagOffsets.push(bags.length);
  bags.push({ genNdx: gens.length, modNdx: mods.length });
  gens.push({ oper: 0, amount: 0 });
  mods.push({ srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 });

  return { bags, gens, mods, bagOffsets };
}

function writeBags(bags: Array<{ genNdx: number; modNdx: number }>): Uint8Array {
  const b = new ByteBuilder(bags.length * 4);
  for (const bag of bags) {
    b.writeUint16(bag.genNdx);
    b.writeUint16(bag.modNdx);
  }
  return b.toUint8Array();
}

function writeMods(mods: Sf2Modulator[]): Uint8Array {
  const b = new ByteBuilder(mods.length * 10);
  for (const m of mods) {
    b.writeUint16(m.srcOper);
    b.writeUint16(m.destOper);
    b.writeInt16(m.amount);
    b.writeUint16(m.amtSrcOper);
    b.writeUint16(m.transOper);
  }
  return b.toUint8Array();
}

function writeGens(gens: Sf2Generator[]): Uint8Array {
  const b = new ByteBuilder(gens.length * 4);
  for (const g of gens) {
    b.writeUint16(g.oper);
    if (isRangeGenerator(g.oper) && typeof g.amount === "object") {
      b.writeUint8(g.amount.lo);
      b.writeUint8(g.amount.hi);
    } else if (typeof g.amount === "object") {
      b.writeUint8(g.amount.lo);
      b.writeUint8(g.amount.hi);
    } else {
      b.writeInt16(g.amount);
    }
  }
  return b.toUint8Array();
}

/**
 * Serialize an Sf2Bank into a spec-compliant RIFF SoundFont 2.01 (.sf2) binary buffer.
 */
export function writeSf2(bank: Sf2Bank): Uint8Array {
  // 1. INFO LIST
  const infoBody = new ByteBuilder(512);
  infoBody.writeFourCC("INFO");
  const ifilPayload = new Uint8Array(4);
  const ifilView = new DataView(ifilPayload.buffer);
  ifilView.setUint16(0, bank.info.ifil.major, true);
  ifilView.setUint16(2, bank.info.ifil.minor, true);
  infoBody.writeChunk("ifil", ifilPayload);
  infoBody.writeZStrChunk("isng", bank.info.isng || "EMU8000");
  infoBody.writeZStrChunk("INAM", bank.info.inam || "Untitled Bank");
  if (bank.info.irom) infoBody.writeZStrChunk("irom", bank.info.irom);
  if (bank.info.iver) {
    const iverPayload = new Uint8Array(4);
    const iv = new DataView(iverPayload.buffer);
    iv.setUint16(0, bank.info.iver.major, true);
    iv.setUint16(2, bank.info.iver.minor, true);
    infoBody.writeChunk("iver", iverPayload);
  }
  if (bank.info.icrd) infoBody.writeZStrChunk("ICRD", bank.info.icrd);
  if (bank.info.ieng) infoBody.writeZStrChunk("IENG", bank.info.ieng);
  if (bank.info.iprd) infoBody.writeZStrChunk("IPRD", bank.info.iprd);
  if (bank.info.icop) infoBody.writeZStrChunk("ICOP", bank.info.icop);
  if (bank.info.icmt) infoBody.writeZStrChunk("ICMT", bank.info.icmt);
  infoBody.writeZStrChunk("ISFT", bank.info.isft || "SoundFont Revisited");

  // 2. sdta LIST (smpl)
  let totalFrames = 0;
  for (const s of bank.samples) {
    totalFrames += s.pcmData.length + SAMPLE_PAD_FRAMES;
  }
  const smplBytes = new Uint8Array(totalFrames * 2);
  const smplView = new DataView(smplBytes.buffer);
  const sampleOffsets: Array<{ start: number; end: number; loopStart: number; loopEnd: number }> = [];

  let frameCursor = 0;
  for (const s of bank.samples) {
    const start = frameCursor;
    const end = start + s.pcmData.length;
    for (let i = 0; i < s.pcmData.length; i++) {
      smplView.setInt16((frameCursor + i) * 2, s.pcmData[i], true);
    }
    const loopStart = start + Math.max(0, Math.min(s.pcmData.length, s.loopStart));
    const loopEnd = start + Math.max(0, Math.min(s.pcmData.length, s.loopEnd));
    sampleOffsets.push({ start, end, loopStart, loopEnd });
    frameCursor = end + SAMPLE_PAD_FRAMES;
  }

  const sdtaBody = new ByteBuilder(smplBytes.length + 32);
  sdtaBody.writeFourCC("sdta");
  sdtaBody.writeChunk("smpl", smplBytes);

  // 3. pdta LIST
  const presetData = serializeZones(bank.presets.map((p) => p.zones));
  const instData = serializeZones(bank.instruments.map((inst) => inst.zones));

  const phdrBuilder = new ByteBuilder((bank.presets.length + 1) * 38);
  for (let i = 0; i < bank.presets.length; i++) {
    const p = bank.presets[i];
    phdrBuilder.writeFixedString(p.name, 20);
    phdrBuilder.writeUint16(p.preset);
    phdrBuilder.writeUint16(p.bank);
    phdrBuilder.writeUint16(presetData.bagOffsets[i]);
    phdrBuilder.writeUint32(p.library);
    phdrBuilder.writeUint32(p.genre);
    phdrBuilder.writeUint32(p.morphology);
  }
  phdrBuilder.writeFixedString("EOP", 20);
  phdrBuilder.writeUint16(0);
  phdrBuilder.writeUint16(0);
  phdrBuilder.writeUint16(presetData.bagOffsets[bank.presets.length]);
  phdrBuilder.writeUint32(0);
  phdrBuilder.writeUint32(0);
  phdrBuilder.writeUint32(0);

  const instBuilder = new ByteBuilder((bank.instruments.length + 1) * 22);
  for (let i = 0; i < bank.instruments.length; i++) {
    const inst = bank.instruments[i];
    instBuilder.writeFixedString(inst.name, 20);
    instBuilder.writeUint16(instData.bagOffsets[i]);
  }
  instBuilder.writeFixedString("EOI", 20);
  instBuilder.writeUint16(instData.bagOffsets[bank.instruments.length]);

  const shdrBuilder = new ByteBuilder((bank.samples.length + 1) * 46);
  for (let i = 0; i < bank.samples.length; i++) {
    const s = bank.samples[i];
    const off = sampleOffsets[i];
    shdrBuilder.writeFixedString(s.name, 20);
    shdrBuilder.writeUint32(off.start);
    shdrBuilder.writeUint32(off.end);
    shdrBuilder.writeUint32(off.loopStart);
    shdrBuilder.writeUint32(off.loopEnd);
    shdrBuilder.writeUint32(s.sampleRate);
    shdrBuilder.writeUint8(s.originalPitch);
    shdrBuilder.writeInt8(s.pitchCorrection);
    shdrBuilder.writeUint16(s.sampleLink);
    shdrBuilder.writeUint16(s.sampleType);
  }
  shdrBuilder.writeFixedString("EOS", 20);
  for (let i = 0; i < 26; i++) shdrBuilder.writeUint8(0);

  const pdtaBody = new ByteBuilder(4096);
  pdtaBody.writeFourCC("pdta");
  pdtaBody.writeChunk("phdr", phdrBuilder.toUint8Array());
  pdtaBody.writeChunk("pbag", writeBags(presetData.bags));
  pdtaBody.writeChunk("pmod", writeMods(presetData.mods));
  pdtaBody.writeChunk("pgen", writeGens(presetData.gens));
  pdtaBody.writeChunk("inst", instBuilder.toUint8Array());
  pdtaBody.writeChunk("ibag", writeBags(instData.bags));
  pdtaBody.writeChunk("imod", writeMods(instData.mods));
  pdtaBody.writeChunk("igen", writeGens(instData.gens));
  pdtaBody.writeChunk("shdr", shdrBuilder.toUint8Array());

  // 4. Assemble outer RIFF/sfbk
  const infoBytes = infoBody.toUint8Array();
  const sdtaBytes = sdtaBody.toUint8Array();
  const pdtaBytes = pdtaBody.toUint8Array();

  const riff = new ByteBuilder(12 + infoBytes.length + sdtaBytes.length + pdtaBytes.length + 64);
  riff.writeFourCC("RIFF");
  riff.writeUint32(0); // placeholder
  riff.writeFourCC("sfbk");
  riff.writeChunk("LIST", infoBytes);
  riff.writeChunk("LIST", sdtaBytes);
  riff.writeChunk("LIST", pdtaBytes);

  const out = riff.toUint8Array();
  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.length - 8, true);
  return out;
}
