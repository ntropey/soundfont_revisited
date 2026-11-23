import { isRangeGenerator } from "./sf2Helpers.js";
import {
  type Sf2Bank,
  type Sf2Generator,
  type Sf2Info,
  type Sf2Instrument,
  type Sf2Modulator,
  type Sf2Preset,
  type Sf2Sample,
  type Sf2Zone,
} from "./types.js";

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readFixedString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = Math.min(bytes.length, offset + length);
  let out = "";
  while (end < max && bytes[end] !== 0) {
    out += String.fromCharCode(bytes[end]);
    end++;
  }
  return out;
}

function readZStr(bytes: Uint8Array, offset: number, size: number): string {
  return readFixedString(bytes, offset, size).trimEnd();
}

interface RiffChunk {
  id: string;
  offset: number; // start of payload
  size: number;
}

function* iterChunks(view: DataView, start: number, end: number): Generator<RiffChunk> {
  let pos = start;
  while (pos + 8 <= end) {
    const id = readFourCC(view, pos);
    const size = view.getUint32(pos + 4, true);
    const payloadStart = pos + 8;
    const payloadEnd = Math.min(end, payloadStart + size);
    yield { id, offset: payloadStart, size: payloadEnd - payloadStart };
    pos = payloadStart + size + (size & 1);
  }
}

interface RawPhdr {
  name: string;
  preset: number;
  bank: number;
  bagNdx: number;
  library: number;
  genre: number;
  morphology: number;
}

interface RawInst {
  name: string;
  bagNdx: number;
}

interface RawBag {
  genNdx: number;
  modNdx: number;
}

interface RawShdr {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
  sampleLink: number;
  sampleType: number;
}

function buildZones(
  bagStart: number,
  bagEnd: number,
  bags: RawBag[],
  gens: Sf2Generator[],
  mods: Sf2Modulator[]
): Sf2Zone[] {
  const zones: Sf2Zone[] = [];
  for (let b = bagStart; b < bagEnd; b++) {
    const cur = bags[b];
    const next = bags[b + 1];
    if (!cur || !next) continue;
    const zoneGens = gens.slice(cur.genNdx, next.genNdx).map((g) => ({
      oper: g.oper,
      amount: typeof g.amount === "object" ? { ...g.amount } : g.amount,
    }));
    const zoneMods = mods.slice(cur.modNdx, next.modNdx).map((m) => ({ ...m }));
    zones.push({ generators: zoneGens, modulators: zoneMods });
  }
  return zones;
}

function parseGenList(view: DataView, offset: number, size: number): Sf2Generator[] {
  const count = Math.floor(size / 4);
  const gens: Sf2Generator[] = [];
  for (let i = 0; i < count; i++) {
    const p = offset + i * 4;
    const oper = view.getUint16(p, true);
    if (isRangeGenerator(oper)) {
      const lo = view.getUint8(p + 2);
      const hi = view.getUint8(p + 3);
      gens.push({ oper, amount: { lo, hi } });
    } else {
      const amount = view.getInt16(p + 2, true);
      gens.push({ oper, amount });
    }
  }
  return gens;
}

function parseModList(view: DataView, offset: number, size: number): Sf2Modulator[] {
  const count = Math.floor(size / 10);
  const mods: Sf2Modulator[] = [];
  for (let i = 0; i < count; i++) {
    const p = offset + i * 10;
    mods.push({
      srcOper: view.getUint16(p, true),
      destOper: view.getUint16(p + 2, true),
      amount: view.getInt16(p + 4, true),
      amtSrcOper: view.getUint16(p + 6, true),
      transOper: view.getUint16(p + 8, true),
    });
  }
  return mods;
}

function parseBagList(view: DataView, offset: number, size: number): RawBag[] {
  const count = Math.floor(size / 4);
  const bags: RawBag[] = [];
  for (let i = 0; i < count; i++) {
    const p = offset + i * 4;
    bags.push({
      genNdx: view.getUint16(p, true),
      modNdx: view.getUint16(p + 2, true),
    });
  }
  return bags;
}

/**
 * Parse a binary SoundFont 2.01 (.sf2) RIFF buffer into a structured Sf2Bank.
 */
export function parseSf2(input: ArrayBuffer | Uint8Array): Sf2Bank {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 12) {
    throw new Error("Invalid SF2: file too small for RIFF header.");
  }
  const riffId = readFourCC(view, 0);
  const formType = readFourCC(view, 8);
  if (riffId !== "RIFF" || formType !== "sfbk") {
    throw new Error(`Invalid SF2: expected RIFF/sfbk, got ${riffId}/${formType}.`);
  }

  const riffSize = Math.min(bytes.byteLength, view.getUint32(4, true) + 8);

  const info: Sf2Info = {
    ifil: { major: 2, minor: 1 },
    isng: "EMU8000",
    inam: "Untitled Bank",
  };

  let smplData = new Int16Array(0);
  let phdrs: RawPhdr[] = [];
  let pbags: RawBag[] = [];
  let pmods: Sf2Modulator[] = [];
  let pgens: Sf2Generator[] = [];
  let insts: RawInst[] = [];
  let ibags: RawBag[] = [];
  let imods: Sf2Modulator[] = [];
  let igens: Sf2Generator[] = [];
  let shdrs: RawShdr[] = [];

  for (const listChunk of iterChunks(view, 12, riffSize)) {
    if (listChunk.id !== "LIST" || listChunk.size < 4) continue;
    const listType = readFourCC(view, listChunk.offset);
    const subStart = listChunk.offset + 4;
    const subEnd = listChunk.offset + listChunk.size;

    if (listType === "INFO") {
      for (const sub of iterChunks(view, subStart, subEnd)) {
        switch (sub.id) {
          case "ifil":
            if (sub.size >= 4) {
              info.ifil = {
                major: view.getUint16(sub.offset, true),
                minor: view.getUint16(sub.offset + 2, true),
              };
            }
            break;
          case "iver":
            if (sub.size >= 4) {
              info.iver = {
                major: view.getUint16(sub.offset, true),
                minor: view.getUint16(sub.offset + 2, true),
              };
            }
            break;
          case "isng":
            info.isng = readZStr(bytes, sub.offset, sub.size);
            break;
          case "INAM":
            info.inam = readZStr(bytes, sub.offset, sub.size);
            break;
          case "irom":
            info.irom = readZStr(bytes, sub.offset, sub.size);
            break;
          case "ICRD":
            info.icrd = readZStr(bytes, sub.offset, sub.size);
            break;
          case "IENG":
            info.ieng = readZStr(bytes, sub.offset, sub.size);
            break;
          case "IPRD":
            info.iprd = readZStr(bytes, sub.offset, sub.size);
            break;
          case "ICOP":
            info.icop = readZStr(bytes, sub.offset, sub.size);
            break;
          case "ICMT":
            info.icmt = readZStr(bytes, sub.offset, sub.size);
            break;
          case "ISFT":
            info.isft = readZStr(bytes, sub.offset, sub.size);
            break;
        }
      }
    } else if (listType === "sdta") {
      for (const sub of iterChunks(view, subStart, subEnd)) {
        if (sub.id === "smpl") {
          const sampleCount = Math.floor(sub.size / 2);
          smplData = new Int16Array(sampleCount);
          for (let i = 0; i < sampleCount; i++) {
            smplData[i] = view.getInt16(sub.offset + i * 2, true);
          }
        }
      }
    } else if (listType === "pdta") {
      for (const sub of iterChunks(view, subStart, subEnd)) {
        switch (sub.id) {
          case "phdr": {
            const count = Math.floor(sub.size / 38);
            for (let i = 0; i < count; i++) {
              const p = sub.offset + i * 38;
              phdrs.push({
                name: readFixedString(bytes, p, 20),
                preset: view.getUint16(p + 20, true),
                bank: view.getUint16(p + 22, true),
                bagNdx: view.getUint16(p + 24, true),
                library: view.getUint32(p + 26, true),
                genre: view.getUint32(p + 30, true),
                morphology: view.getUint32(p + 34, true),
              });
            }
            break;
          }
          case "pbag":
            pbags = parseBagList(view, sub.offset, sub.size);
            break;
          case "pmod":
            pmods = parseModList(view, sub.offset, sub.size);
            break;
          case "pgen":
            pgens = parseGenList(view, sub.offset, sub.size);
            break;
          case "inst": {
            const count = Math.floor(sub.size / 22);
            for (let i = 0; i < count; i++) {
              const p = sub.offset + i * 22;
              insts.push({
                name: readFixedString(bytes, p, 20),
                bagNdx: view.getUint16(p + 20, true),
              });
            }
            break;
          }
          case "ibag":
            ibags = parseBagList(view, sub.offset, sub.size);
            break;
          case "imod":
            imods = parseModList(view, sub.offset, sub.size);
            break;
          case "igen":
            igens = parseGenList(view, sub.offset, sub.size);
            break;
          case "shdr": {
            const count = Math.floor(sub.size / 46);
            for (let i = 0; i < count; i++) {
              const p = sub.offset + i * 46;
              shdrs.push({
                name: readFixedString(bytes, p, 20),
                start: view.getUint32(p + 20, true),
                end: view.getUint32(p + 24, true),
                loopStart: view.getUint32(p + 28, true),
                loopEnd: view.getUint32(p + 32, true),
                sampleRate: view.getUint32(p + 36, true),
                originalPitch: view.getUint8(p + 40),
                pitchCorrection: view.getInt8(p + 41),
                sampleLink: view.getUint16(p + 42, true),
                sampleType: view.getUint16(p + 44, true),
              });
            }
            break;
          }
        }
      }
    }
  }

  // Convert shdrs (excluding terminal EOS record)
  const samples: Sf2Sample[] = [];
  const sampleCount = Math.max(0, shdrs.length - 1);
  for (let i = 0; i < sampleCount; i++) {
    const sh = shdrs[i];
    const sStart = Math.min(sh.start, smplData.length);
    const sEnd = Math.max(sStart, Math.min(sh.end, smplData.length));
    const pcmData = smplData.slice(sStart, sEnd);
    const len = pcmData.length;
    const relLoopStart = Math.max(0, Math.min(len, sh.loopStart - sStart));
    const relLoopEnd = Math.max(relLoopStart, Math.min(len, sh.loopEnd - sStart));
    samples.push({
      name: sh.name,
      start: 0,
      end: len,
      loopStart: relLoopStart,
      loopEnd: relLoopEnd,
      sampleRate: sh.sampleRate || 44100,
      originalPitch: sh.originalPitch,
      pitchCorrection: sh.pitchCorrection,
      sampleLink: sh.sampleLink,
      sampleType: sh.sampleType,
      pcmData,
    });
  }

  // Convert insts (excluding terminal EOI record)
  const instruments: Sf2Instrument[] = [];
  const instCount = Math.max(0, insts.length - 1);
  for (let i = 0; i < instCount; i++) {
    const cur = insts[i];
    const next = insts[i + 1];
    instruments.push({
      name: cur.name,
      zones: buildZones(cur.bagNdx, next.bagNdx, ibags, igens, imods),
    });
  }

  // Convert phdrs (excluding terminal EOP record)
  const presets: Sf2Preset[] = [];
  const presetCount = Math.max(0, phdrs.length - 1);
  for (let i = 0; i < presetCount; i++) {
    const cur = phdrs[i];
    const next = phdrs[i + 1];
    presets.push({
      name: cur.name,
      preset: cur.preset,
      bank: cur.bank,
      library: cur.library,
      genre: cur.genre,
      morphology: cur.morphology,
      zones: buildZones(cur.bagNdx, next.bagNdx, pbags, pgens, pmods),
    });
  }

  return { info, samples, instruments, presets };
}
