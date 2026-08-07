// Diagnostic (not assertions): dump every params.sldd entry's parsed row for
// text vs binary so we can eyeball content parity and spot mismatches.
// Run: npx vitest run test/parity/dump.test.ts --reporter=basic 2>&1
import { describe, it } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../src/dex/datamodel/node/NodeClassMap.js';
import { getModel, getModelFromBytes, invalidate } from '../../src/host/SlddModel.js';

const ART = (v: string, n: string) => fileURLToPath(new URL(`./artifacts/${v}/${n}`, import.meta.url));
const HAVE = existsSync(ART('text', 'params.sldd'));

function loadParams(variant: string): Map<string, any> {
  const uri = `dump://${variant}/params.sldd`;
  const path = ART(variant, 'params.sldd');
  const raw = readFileSync(path);
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  invalidate(uri);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const node = isZip ? getModelFromBytes(uri, 'params.sldd', ab) : getModel(uri, 'params.sldd', raw.toString('utf8'));
  const m = new Map<string, any>();
  for (const s of node.children ?? []) for (const e of s.children ?? []) m.set(e.name, e);
  return m;
}

function describeEntry(n: any): string {
  let dv = '';
  try {
    dv = String(n.displayValue ?? '');
  } catch (e) {
    dv = 'ERR:' + (e as Error).message;
  }
  let dt = '';
  try {
    dt = String(n.className ?? '');
  } catch {
    /* ignore */
  }
  const kids = (n.children ?? []).map((c: any) => c.name).join(',');
  return `dt=${dt} | value=${dv.slice(0, 60)} | kids=[${kids}]`;
}

(HAVE ? describe : describe.skip)('DUMP params.sldd content (text vs binary)', () => {
  it('prints each entry side by side', () => {
    const t = loadParams('text');
    const b = loadParams('binary');
    const names = Array.from(new Set([...t.keys(), ...b.keys()])).sort();
    const lines: string[] = [];
    let mismatches = 0;
    for (const name of names) {
      const tn = t.get(name);
      const bn = b.get(name);
      const td = tn ? describeEntry(tn) : '(absent)';
      const bd = bn ? describeEntry(bn) : '(absent)';
      const same = td === bd ? '  ' : '≠≠';
      if (td !== bd) mismatches++;
      lines.push(`${same} ${name}\n     TEXT:   ${td}\n     BINARY: ${bd}`);
    }
    const out =
      '===== params.sldd entry dump (' + names.length + ' entries) =====\n' +
      lines.join('\n') +
      `\n\n===== ${mismatches} text/binary mismatches =====\n`;
    writeFileSync(fileURLToPath(new URL('./dump-output.txt', import.meta.url)), out);
    console.log(out);
  });
});
