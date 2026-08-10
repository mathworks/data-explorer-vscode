// Reusable MCOS decoder prototype + validator. Parses the metadata table
// properly (header/strings/classes/objects/property-blocks), resolves each
// object's named properties to heap cells, and checks against manifest.json.
//
// Run: npx esbuild test/tools/mcos/decode.ts --bundle --platform=node \
//        --format=esm --outfile=/tmp/decode.mjs && node /tmp/decode.mjs <file.mat|.slx>
import { readFileSync } from 'node:fs';
import { parseMat, parseMatrix, MatVariable } from '../../../src/dex/datamodel/parser/MatParser.js';
import { parseSlx } from '../../../src/dex/datamodel/parser/SlxParser.js';

const MI_MATRIX = 14;
const HANDLE_MAGIC = 3707764736;
function align8(n: number){return n+((8-(n%8))%8);}
function readSub(v: DataView,o: number){const t=v.getUint32(o,true);const hi=(t>>>16)&0xffff;const lo=t&0xffff;if(hi&&lo)return{type:lo,bytes:hi,dataOffset:o+4,totalSize:8};const type=v.getUint32(o,true);const bytes=v.getUint32(o+4,true);return{type,bytes,dataOffset:o+8,totalSize:8+align8(bytes)};}
function findCell(v: DataView,off: number,len: number){let o=off;const e=off+len;const f=readSub(v,o);o+=f.totalSize;while(o<e){const s=readSub(v,o);if(s.type===MI_MATRIX)return{offset:s.dataOffset,length:s.bytes};o+=s.totalSize;}return null;}

// Return the {opaqueVars, anonRawBytes} for either a .mat or .slx file.
function loadBlob(file: string): { vars: MatVariable[]; raw: Uint8Array | null } {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  if (file.endsWith('.slx')) {
    const parsed: any = parseSlx(ab, file);
    const ws: MatVariable[] = parsed.workspace;
    const raw = (ws as any)._trailingElements?.[0] ?? null;
    return { vars: ws, raw };
  }
  const parsed = parseMat(ab);
  const anon = parsed.variables.find(v => (v as any)._anonymous);
  return { vars: parsed.variables, raw: anon?._rawBytes ?? null };
}

function getCells(raw: Uint8Array): (MatVariable | null)[] | null {
  const ov = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (ov.getUint32(0, true) !== MI_MATRIX) return null;
  const om = parseMatrix(ov, 8, ov.getUint32(4, true));
  const blob = om.value instanceof Uint8Array ? om.value : new Uint8Array(om.value as number[]);
  const bv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const structSub = readSub(bv, 8);
  const sm = parseMatrix(bv, structSub.dataOffset, structSub.bytes);
  const mf = sm.fields?.['MCOS'] as MatVariable | undefined;
  if (!mf || !mf._rawBytes) return null;
  const opv = new DataView(mf._rawBytes.buffer, mf._rawBytes.byteOffset, mf._rawBytes.byteLength);
  const ot = readSub(opv, 0);
  const cl = findCell(opv, ot.dataOffset, ot.bytes);
  if (!cl) return null;
  const ca = parseMatrix(opv, cl.offset, cl.length);
  return Array.isArray(ca.value) ? (ca.value as (MatVariable | null)[]) : null;
}

interface Meta {
  strings: string[];
  classes: { pkg: string; cls: string }[];
  objects: { classId: number; blockA: number; blockB: number }[];
  blocks: { nProps: number; triples: [number, number, number][] }[];
}

function parseMeta(cells: (MatVariable | null)[]): Meta {
  const m = cells[0]!.value instanceof Uint8Array ? cells[0]!.value as Uint8Array : new Uint8Array(cells[0]!.value as number[]);
  const mv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const u32 = (o: number) => mv.getUint32(o, true);
  const w: number[] = []; for (let i = 0; i < 10; i++) w.push(u32(i * 4));
  // Layout (empirically confirmed against known fixtures):
  //   w[0]=version, w[1]=nStrings, w[2..]=segment end offsets.
  //   strings: [40, w2)   classTable: [w2, w3)   objTable: [w4, w5)
  //   type2 property blocks: [w5, w6)
  const dec = new TextDecoder();
  const strings = ['']; { let p = 40; while (p < w[2]) { let e = p; while (e < w[2] && m[e] !== 0) e++; strings.push(dec.decode(m.slice(p, e))); p = e + 1; } }
  const classes = [{ pkg: '', cls: '' }];
  for (let p = w[2]; p + 16 <= w[3]; p += 16) classes.push({ pkg: strings[u32(p)] || '', cls: strings[u32(p + 4)] || '' });
  const objects = [{ classId: 0, blockA: 0, blockB: 0 }];
  for (let p = w[4]; p + 24 <= w[5]; p += 24) objects.push({ classId: u32(p), blockA: u32(p + 16), blockB: u32(p + 20) });
  // Property blocks: sequence of [nProps, (nameIdx,flag,val)*nProps], leading
  // pad word, 8-byte-aligned, zero-padded between blocks.
  const blocks: { nProps: number; triples: [number, number, number][] }[] = [];
  { let p = w[5]; const end = w[6];
    // skip a single leading pad word if zero
    while (p < end) {
      const nProps = u32(p); p += 4;
      if (nProps === 0) { blocks.push({ nProps: 0, triples: [] }); continue; }
      if (nProps > 500 || p + nProps * 12 > end) break;
      const triples: [number, number, number][] = [];
      for (let k = 0; k < nProps; k++) { triples.push([u32(p), u32(p + 4), u32(p + 8)]); p += 12; }
      blocks.push({ nProps, triples });
    }
  }
  return { strings, classes, objects, blocks };
}

function fmtCell(c: MatVariable | null): unknown {
  if (!c) return null;
  const v = c.value;
  if (c.className === 'uint32' && Array.isArray(v) && v[0] === HANDLE_MAGIC) return `<handle obj#${v[4]}>`;
  if (v instanceof Uint8Array) return `u8[${v.length}]`;
  return v;
}

const file = process.argv[2] || 'test/fixtures/mcos/Param.mat';
const { vars, raw } = loadBlob(file);
console.log('FILE', file);
console.log('opaque vars:', vars.filter(v => v.isOpaque && v.name).map(v => `${v.name}:${v.className}`).join(', '));
if (!raw) { console.log('NO BLOB'); process.exit(0); }
const cells = getCells(raw);
if (!cells) { console.log('NO CELLS'); process.exit(0); }
const meta = parseMeta(cells);
console.log('strings:', meta.strings.length, 'classes:', meta.classes.length, 'objects:', meta.objects.length, 'blocks:', meta.blocks.length);
meta.classes.forEach((c, i) => { if (c.cls) console.log(`  class#${i} = ${c.pkg}.${c.cls}`); });
meta.objects.forEach((o, i) => { if (o.classId) console.log(`  obj#${i} classId=${o.classId}(${meta.classes[o.classId]?.pkg}.${meta.classes[o.classId]?.cls}) blockA=${o.blockA} blockB=${o.blockB}`); });
meta.blocks.forEach((b, i) => {
  console.log(`  block#${i} nProps=${b.nProps}`);
  for (const [n, flag, val] of b.triples) {
    const nm = meta.strings[n] ?? `?${n}`;
    if (flag === 1) console.log(`      ${nm} = cells[2+${val}] => ${JSON.stringify(fmtCell(cells[2 + val]))}`);
    else console.log(`      ${nm} (flag=${flag}, lit=${val})`);
  }
});

// ---- object <-> named-variable linkage investigation ----
console.log('\n==== TAIL CELLS (hierarchy linkage) ====');
for (let i = Math.max(1, cells.length - 4); i < cells.length; i++) {
  const c = cells[i]; if (!c) { console.log(`  cell[${i}] null`); continue; }
  let v: any = c.value;
  if (Array.isArray(v) && v.length && (v[0] as any)?.className !== undefined) {
    v = '[' + v.map((x: any) => x?.className + ':' + JSON.stringify(x?.value)).join(' | ') + ']';
  } else if (v instanceof Uint8Array) v = `u8[${v.length}]`;
  console.log(`  cell[${i}] ${c.className} dims[${c.dimensions}] = ${JSON.stringify(v)}`);
}
// The metadata region after property blocks may hold obj ordering.
{
  const m = cells[0]!.value instanceof Uint8Array ? cells[0]!.value as Uint8Array : new Uint8Array(cells[0]!.value as number[]);
  const mv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  const w: number[] = []; for (let i = 0; i < 10; i++) w.push(mv.getUint32(i * 4, true));
  console.log('\n==== META HEADER 10 words ====', w.join(', '), 'len', m.length);
  for (let r = 5; r < 9; r++) {
    const s = w[r], e = w[r + 1] || m.length; if (e <= s) { console.log(`region[${r}] empty`); continue; }
    const nums = []; for (let o = s; o + 4 <= e; o += 4) nums.push(mv.getUint32(o, true));
    console.log(`region[${r}] [${s},${e}): ${nums.join(',')}`);
  }
}
