import { readFileSync } from 'node:fs';
import { parseMat, parseMatrix, MatVariable } from '../../../src/dex/datamodel/parser/MatParser.js';
const MI_MATRIX=14, HM=3707764736;
function align8(n:number){return n+((8-(n%8))%8);}
function readSub(v:DataView,o:number){const t=v.getUint32(o,true);const hi=(t>>>16)&0xffff;const lo=t&0xffff;if(hi&&lo)return{type:lo,bytes:hi,dataOffset:o+4,totalSize:8};const ty=v.getUint32(o,true);const by=v.getUint32(o+4,true);return{type:ty,bytes:by,dataOffset:o+8,totalSize:8+align8(by)};}
function findCell(v:DataView,off:number,len:number){let o=off;const e=off+len;const f=readSub(v,o);o+=f.totalSize;while(o<e){const s=readSub(v,o);if(s.type===MI_MATRIX)return{offset:s.dataOffset,length:s.bytes};o+=s.totalSize;}return null;}
const file=process.argv[2];
const buf=readFileSync(file);
const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength) as ArrayBuffer;
const parsed=parseMat(ab);
const anon=parsed.variables.find((v:any)=>v._anonymous);
const raw=anon!._rawBytes!;
const ov=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
const om=parseMatrix(ov,8,ov.getUint32(4,true));
const blob=om.value instanceof Uint8Array?om.value:new Uint8Array(om.value as number[]);
const bv=new DataView(blob.buffer,blob.byteOffset,blob.byteLength);
const ss=readSub(bv,8); const sm=parseMatrix(bv,ss.dataOffset,ss.bytes);
const mf=sm.fields!['MCOS'] as MatVariable; const opb=mf._rawBytes!;
const opv=new DataView(opb.buffer,opb.byteOffset,opb.byteLength);
const ot=readSub(opv,0); const cl=findCell(opv,ot.dataOffset,ot.bytes)!;
const ca=parseMatrix(opv,cl.offset,cl.length);
const cells=ca.value as (MatVariable|null)[];
const m=cells[0]!.value instanceof Uint8Array?cells[0]!.value as Uint8Array:new Uint8Array(cells[0]!.value as number[]);
const mv=new DataView(m.buffer,m.byteOffset,m.byteLength);
const u=(o:number)=>mv.getUint32(o,true);
const w:number[]=[];for(let i=0;i<8;i++)w.push(u(i*4));
const dec=new TextDecoder();
// strings from byte 40 to w[2]; index 0 = '' sentinel
const strings=['']; { let p=40; while(p<w[2]){let e=p;while(e<w[2]&&m[e]!==0)e++;strings.push(dec.decode(m.slice(p,e)));p=e+1;} }
// class table [w2,w3): 16B, take pkgIdx,clsIdx. Record raw at each 16B slot.
const classesRaw:{pkgIdx:number;clsIdx:number;w2:number;w3:number}[]=[];
for(let p=w[2];p+16<=w[3];p+=16) classesRaw.push({pkgIdx:u(p),clsIdx:u(p+4),w2:u(p+8),w3:u(p+12)});
const className=(i:number)=>{const c=classesRaw[i-1];if(!c)return`?cid${i}`;const pk=strings[c.pkgIdx]||'';const cn=strings[c.clsIdx]||'';return pk?`${pk}.${cn}`:cn;};
console.log('FILE',file);
console.log('header:',w.join(','),'metaLen',m.length,'nStrings(w1)=',w[1]);
console.log('regions: strings[40,'+w[2]+') class['+w[2]+','+w[3]+') seg1['+w[3]+','+w[4]+') objtab['+w[4]+','+w[5]+') blocks['+w[5]+','+w[6]+') tail['+w[6]+',...)');
console.log('CLASS TABLE (1-based cid -> name):');
classesRaw.forEach((c,i)=>console.log(`  cid ${i+1}: pkg[${c.pkgIdx}]="${strings[c.pkgIdx]}" cls[${c.clsIdx}]="${strings[c.clsIdx]}" extra=(${c.w2},${c.w3})`));
// object table [w4,w5): 24B = 6 words
const objs:{cid:number;w1:number;w2:number;w3:number;w4:number;w5:number}[]=[];
for(let p=w[4];p+24<=w[5];p+=24) objs.push({cid:u(p),w1:u(p+4),w2:u(p+8),w3:u(p+12),w4:u(p+16),w5:u(p+20)});
// block region: scan slots
const slots:{ord:number;nProps:number;names:string[];triples:[number,number,number][]}[]=[];
{ let p=w[5]; let ord=0; const end=w[6];
  while(p+4<=end){ const n=u(p); p+=4;
    if(n===0){slots.push({ord,nProps:0,names:[],triples:[]});ord++;continue;}
    if(n>500||p+n*12>end){break;}
    const tr:[number,number,number][]=[]; const nm:string[]=[];
    for(let k=0;k<n;k++){const a=u(p),b=u(p+4),c=u(p+8);tr.push([a,b,c]);nm.push(strings[a]||`?${a}`);p+=12;}
    slots.push({ord,nProps:n,names:nm,triples:tr});ord++;
  }
}
console.log('OBJECT TABLE (idx -> record):');
objs.forEach((o,i)=>console.log(`  obj#${i}: cid=${o.cid}(${className(o.cid)}) [${o.w1},${o.w2},${o.w3}] w4=${o.w4} w5=${o.w5}`));
console.log('BLOCK SLOTS (scan-ordinal -> content):');
slots.forEach(s=>console.log(`  slot#${s.ord}: nProps=${s.nProps} {${s.names.join(', ')}}`));
// Non-empty slot ordinals in order:
const nonEmpty=slots.filter(s=>s.nProps>0).map(s=>s.ord);
console.log('non-empty slot ordinals:',nonEmpty.join(','));
console.log('per-object w4/w5 vs class prop-count guess:');
objs.forEach((o,i)=>{ if(i===0)return; console.log(`  obj#${i} ${className(o.cid)}: w4=${o.w4} w5=${o.w5}`); });
