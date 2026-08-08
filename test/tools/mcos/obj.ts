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
console.log('FILE',file,'metaLen',m.length);
console.log('header[0..7]:',w.join(','));
console.log('\nOBJECT TABLE [w4='+w[4]+', w5='+w[5]+') full 6 words each:');
let idx=0;
for(let p=w[4];p+24<=w[5];p+=24){console.log(`  objrec#${idx}: [${u(p)}, ${u(p+4)}, ${u(p+8)}, ${u(p+12)}, ${u(p+16)}, ${u(p+20)}]`);idx++;}
console.log('\nBLOCK REGION [w5='+w[5]+', w6='+w[6]+') raw words:');
const bw:number[]=[];for(let p=w[5];p+4<=w[6];p+=4)bw.push(u(p));
console.log('  '+bw.join(','));
console.log('\nTRAILING region [w6='+w[6]+', end):');
for(let r=6;r<7;r++){const s=w[6],e=m.length;const nn=[];for(let o=s;o+4<=e;o+=4)nn.push(u(o));console.log('  '+nn.join(','));}
