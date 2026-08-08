// Throwaway analyzer: walk the MCOS metadata table on a .mat fixture and
// resolve each object's {propertyName -> heap-cell value}. Validate against the
// manifest. Iterate until byte alignment is exact.
import { readFileSync } from 'node:fs';
import { parseMat } from '../../../src/dex/datamodel/parser/MatParser.js';
import { parseMatrix, MatVariable } from '../../../src/dex/datamodel/parser/MatParser.js';

const MI_MATRIX = 14;
const HANDLE_MAGIC = 3707764736;
function align8(n: number){return n+((8-(n%8))%8);}
function readSub(v: DataView,o: number){const t=v.getUint32(o,true);const hi=(t>>>16)&0xffff;const lo=t&0xffff;if(hi&&lo)return{type:lo,bytes:hi,dataOffset:o+4,totalSize:8};const type=v.getUint32(o,true);const bytes=v.getUint32(o+4,true);return{type,bytes,dataOffset:o+8,totalSize:8+align8(bytes)};}
function findCell(v: DataView,off: number,len: number){let o=off;const e=off+len;const f=readSub(v,o);o+=f.totalSize;while(o<e){const s=readSub(v,o);if(s.type===MI_MATRIX)return{offset:s.dataOffset,length:s.bytes};o+=s.totalSize;}return null;}

const file = process.argv[2] || 'test/fixtures/mcos/Param.mat';
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const parsed = parseMat(ab as ArrayBuffer);
console.log('vars:', parsed.variables.map(v=>`${v.name||'<anon>'}:${v.className}${v.isOpaque?'(opaque)':''}${v._anonymous?'(anon)':''}`).join(', '));

const opaque = parsed.variables.filter(v=>v.isOpaque && v.name);
const anon = parsed.variables.find(v=>(v as any)._anonymous);
if(!anon || !anon._rawBytes){ console.log('no anon blob'); process.exit(1); }

// Navigate blob -> struct.MCOS -> opaque -> cell array (mirrors decodeMcosBlob)
const raw = anon._rawBytes;
const ov = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const outerType = ov.getUint32(0,true); const outerBytes = ov.getUint32(4,true);
console.log('outer type', outerType, 'bytes', outerBytes);
const om = parseMatrix(ov, 8, outerBytes);
console.log('outer matrix class', om.className);
let blob: Uint8Array = om.value instanceof Uint8Array ? om.value : new Uint8Array(om.value as number[]);
const bv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
const structSub = readSub(bv, 8);
const sm = parseMatrix(bv, structSub.dataOffset, structSub.bytes);
console.log('struct fields', sm.fields ? Object.keys(sm.fields) : null);
const mf = sm.fields!['MCOS'] as MatVariable;
const opb = mf._rawBytes!;
const opv = new DataView(opb.buffer, opb.byteOffset, opb.byteLength);
const ot = readSub(opv, 0);
const cl = findCell(opv, ot.dataOffset, ot.bytes)!;
const ca = parseMatrix(opv, cl.offset, cl.length);
const cells = ca.value as (MatVariable|null)[];
console.log('total cells:', cells.length);

// ---- metadata table ----
const meta = cells[0]!.value instanceof Uint8Array ? cells[0]!.value as Uint8Array : new Uint8Array(cells[0]!.value as number[]);
const mv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
const u32 = (o: number)=>mv.getUint32(o,true);
console.log('meta len', meta.length);

// header: N uint32 offsets. First word is often a version/count. Print first 12.
const hdr: number[] = []; for(let i=0;i<12 && i*4<meta.length;i++) hdr.push(u32(i*4));
console.log('header words[0..11]:', hdr.join(', '));

function dumpCells(){
  console.log('--- heap cells ---');
  for(let i=0;i<cells.length;i++){
    const c=cells[i]; if(!c){console.log(`[${i}] null`);continue;}
    let vv: string;
    const val=c.value;
    if(val instanceof Uint8Array) vv=`u8[${val.length}]`;
    else if(Array.isArray(val)){ const isHandle = c.className==='uint32' && val[0]===HANDLE_MAGIC; vv=(isHandle?'HANDLE':'')+`[${val.slice(0,8).join(',')}${val.length>8?'…':''}]`; }
    else if(typeof val==='string') vv=JSON.stringify(val);
    else vv=String(val);
    console.log(`[${i}] ${c.className} dims[${c.dimensions}] ${c.fields?'fields{'+Object.keys(c.fields)+'}':''} = ${vv}`);
  }
}
dumpCells();

// ---- decode metadata regions ----
// Header = 8 uint32 region offsets (bytes). Strings begin at byte 32.
// [Based on MatFileHandler / matio subsystem format.]
const REGION = []; for(let i=0;i<8;i++) REGION.push(u32(i*4));
console.log('\nregion offsets[0..7]:', REGION.join(', '), 'metaLen', meta.length);
const dec = new TextDecoder();
function names_from(start: number, end: number){ const out=['']; let p=start; while(p<end){let e=p;while(e<end&&meta[e]!==0)e++; out.push(dec.decode(meta.slice(p,e))); p=e+1;} return out; }
// Try strings [8, region[1]) since region[0] often small.  Also try [32,..].
for(const [s,label] of [[8,'from8'],[32,'from32'],[40,'from40']] as [number,string][]){
  const strs = names_from(s, REGION[1]);
  const readable = strs.filter(x=>/^[A-Za-z_][A-Za-z0-9_.]*$/.test(x)).slice(0,6);
  console.log(`strings ${label} [${s},${REGION[1]}): count=${strs.length} sample=${JSON.stringify(readable)}`);
}
// Dump every region as uint32.
for(let r=1;r<7;r++){
  const s=REGION[r], e=REGION[r+1]||meta.length;
  if(e<=s){console.log(`region[${r}] [${s},${e}) empty`);continue;}
  const nums=[]; for(let o=s;o+4<=e;o+=4) nums.push(u32(o));
  console.log(`region[${r}] [${s},${e}) (${nums.length} u32): ${nums.join(',')}`);
}

// ---- correlate: parse strings from byte 40 (repo assumption) ----
console.log('\n==== STRING TABLE [40, region2) ====');
const strs40 = names_from(40, REGION[2]);
strs40.forEach((s,i)=>{ if(s.length) console.log(`  str[${i}] = ${JSON.stringify(s)}`); });

// class info [region2, region3): 16 bytes each
console.log('\n==== CLASS INFO [region2,region3) 16B ====');
for(let p=REGION[2]; p+16<=REGION[3]; p+=16){
  console.log(`  numProps=${u32(p)} classNameStrIdx=${u32(p+4)} -> ${strs40[u32(p+4)]}  (w3=${u32(p+8)} w4=${u32(p+12)})`);
}

// Region[4] and Region[5]: property triples. Print as (a,b,c) rows with name resolution.
for(const r of [4,5]){
  const s=REGION[r], e=REGION[r+1]||meta.length;
  if(e<=s) continue;
  console.log(`\n==== REGION[${r}] [${s},${e}) as triples (fieldIdx, flag, val) ====`);
  const nums=[]; for(let o=s;o+4<=e;o+=4) nums.push(u32(o));
  for(let i=0;i+2<nums.length;i+=3){
    const [f,flag,val]=[nums[i],nums[i+1],nums[i+2]];
    const nm = strs40[f]!==undefined?strs40[f]:`?${f}`;
    console.log(`  (${f},${flag},${val})  name[${f}]=${JSON.stringify(nm)}  ${flag===1?`-> cell[${val}]`:`lit ${val}`}`);
  }
}
