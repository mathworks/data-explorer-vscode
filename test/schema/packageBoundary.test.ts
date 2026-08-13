// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = join(__dirname, '../../src/dex/datamodel/schema');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...tsFiles(p)); }
    else if (e.name.endsWith('.ts')) { out.push(p); }
  }
  return out;
}

describe('schema module is self-contained (dex-schema package boundary)', () => {
  it('no .ts file under schema/ imports outside the schema folder', () => {
    const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    for (const file of tsFiles(SCHEMA_DIR)) {
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const spec = m[1];
        // Allowed: local (./...), node built-ins (node:...). Forbidden: ../ escapes
        // (would reach node classes / src/dex runtime) and bare package deps.
        const ok = spec.startsWith('./') || spec.startsWith('node:');
        expect(ok, `${file} imports '${spec}' — schema/ must not depend outward`).toBe(true);
      }
    }
  });
});
