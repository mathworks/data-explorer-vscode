import { readFileSync } from 'node:fs';
import { parseMat, parseMatrix, MatVariable } from '/Users/weiwang/projects/data-explorer-vscode/src/dex/datamodel/parser/MatParser.js';
import { parseSlx } from '/Users/weiwang/projects/data-explorer-vscode/src/dex/datamodel/parser/SlxParser.js';
const MI=14,HM=3707764736;
function a8(n:number){return n+((8-(n%8))%8);}
function rs(v:DataView,o:number){const t=v.getUint32(o,true);const hi=(t>>>16)&0xffff;const lo=t&0xffff;if(hi&&lo)return{type:lo,bytes:hi,dataOffset:o+4,totalSize:8};const type=v.getUint32(o,true);const bytes=v.getUint32(o+4,true);return{type,bytes,dataOffset:o+8,totalSize:8+a8(bytes)};}
function fc(v:DataView,off:number,len:number){let o=off;const e=off+len;const f=rs(v,o);o+=f.totalSize;while(o<e){const s=rs(v,o);if(s.type===MI)return{offset:s.dataOffset,length:s.bytes};o+=s.totalSize;}return null;}
function loadCells(file:string){
  const buf=readFileSync(file);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength) as ArrayBuffer;
  let raw:Uint8Array|null;
  if(file.endsWith('.slx')){const p:any=parseSlx(ab,file);raw=(p.workspace as any)._trailingElements?.[0]??null;}
  else{const p=parseMat(ab);raw=p.variables.find(v=>(v as any)._anonymous)?._rawBytes??null;}
  if(!raw)return null;
  const ov=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);if(ov.getUint32(0,true)!==MI)return null;
  const om=parseMatrix(ov,8,ov.getUint32(4,true));const blob=om.value instanceof Uint8Array?om.value:new Uint8Array(om.value as number[]);
  const bv=new DataView(blob.buffer,blob.byteOffset,blob.byteLength);const sub=rs(bv,8);const sm=parseMatrix(bv,sub.dataOffset,sub.bytes);
  const mf=sm.fields?.['MCOS'] as MatVariable;if(!mf?._rawBytes)return null;
  const opv=new DataView(mf._rawBytes.buffer,mf._rawBytes.byteOffset,mf._rawBytes.byteLength);const ot=rs(opv,0);const cl=fc(opv,ot.dataOffset,ot.bytes);if(!cl)return null;
  const ca=parseMatrix(opv,cl.offset,cl.length);return ca.value as (MatVariable|null)[];
}
function fmt(cells:(MatVariable|null)[],idx:number){const c=cells[idx];if(!c)return null;const v=c.value;if(c.className==='uint32'&&Array.isArray(v)&&v[0]===HM)return`<obj#${v[4]}>`;if(v instanceof Uint8Array)return`u8[${v.length}]`;if(Array.isArray(v)&&v.length>8)return`[${v.slice(0,8).join(',')}...]`;return v;}
function decode(file:string){
  const cells=loadCells(file);if(!cells)return console.log(file,'NO CELLS');
  const m=cells[0]!.value instanceof Uint8Array?cells[0]!.value as Uint8Array:new Uint8Array(cells[0]!.value as number[]);
  const mv=new DataView(m.buffer,m.byteOffset,m.byteLength);const u32=(o:number)=>mv.getUint32(o,true);
  const w:number[]=[];for(let i=0;i<10;i++)w.push(u32(i*4));
  const dec=new TextDecoder();const S:string[]=[''];{let p=40;while(p<w[2]){let e=p;while(e<w[2]&&m[e]!==0)e++;S.push(dec.decode(m.slice(p,e)));p=e+1;}}
  const C:string[]=[];for(let p=w[2];p+16<=w[3];p+=16)C.push(`${S[u32(p)]}.${S[u32(p+4)]}`);        // 0-based
  const O:number[]=[];for(let p=w[4];p+24<=w[5];p+=24)O.push(u32(p));                                  // classId, 0-based
  // Blocks: one per object in order, 8-byte aligned relative to region start w5.
  const blocks:[number,number,number][][]=[];{let p=w[5];const end=w[6];
    while(p<end){const start=p;const n=u32(p);p+=4;if(n>500){break;}const t:[number,number,number][]=[];for(let k=0;k<n;k++){t.push([u32(p),u32(p+4),u32(p+8)]);p+=12;}blocks.push(t);
      const size=p-start;const pad=(8-(size%8))%8;p+=pad;}}
  console.log(`\n===== ${file} =====  objects=${O.length} blocks=${blocks.length}`);
  for(let i=1;i<O.length;i++){const blk=blocks[i]||[];
    const props=blk.map(([n,flag,val])=>{
      let vs:unknown;
      if(flag===1)vs=fmt(cells,val+2);        // heap cell
      else if(flag===0)vs=`"${S[val]}"`;        // string-table literal
      else vs=`b:${val}`;                       // inline/bool
      return `${S[n]}=${JSON.stringify(vs)}`;
    });
    console.log(`  obj#${i} ${C[O[i]]} : ${props.join(', ')||'(none)'}`);
  }
}
for(const f of process.argv.slice(2))decode(f);
