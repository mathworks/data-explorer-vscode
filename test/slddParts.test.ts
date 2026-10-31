// Copyright 2026 The MathWorks, Inc.
//
// The one part a `.sldd` keeps its entries in is named ONCE, by core: its reader looks the zip
// member up, its writer puts it back, its `slddChunkContent` and `jsonEntryScan` walk the JSON
// path to the content. The editors that used to navigate the same part themselves (the save path's
// re-zip, the raw-text scan for byte offsets) are view's engines on core's own reader, writer and
// scan now, and what this file pinned of those two paths is core's, in data-explorer-core's
// slddPartsHost.test.ts. What is left here is the forcing function: no host file spells one of
// the names, or walks the part, again.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

// The forcing function. The strings are core's now, and the way that stops being true is a
// new caller spelling one rather than importing it — which is how the extension list got
// written six times and `endsWith('.sldd')` eight. There is no owner in this tree to allow
// any more: every one of these belongs to core.
describe('no host file keeps its own copy of the part names', () => {
  const tsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...tsFiles(rel));
      else if (entry.name.endsWith('.ts')) out.push(rel);
    }
    return out;
  };

  // Comments are stripped first: a header explaining what `__MW_TEXT_PARTS__` is, or why
  // this walk is core's to do, is documentation and not a second copy. Only code counts, or
  // the guard would punish the explanations that make the decision legible.
  const code = (p: string) =>
    readFileSync(join(root, p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  const files = tsFiles('src');

  it('scans a source tree it is actually reading', () => {
    // A walker that found nothing would make the assertions below pass forever.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('src/host/slddFormat.ts');
    expect(files).toContain('src/host/BinarySlddEditorProvider.ts');
  });

  for (const literal of ['data/chunk0', '__MW_TEXT_PART__', '__MW_TEXT_PARTS__', '__MW_TEXT_content']) {
    it(`spells ${literal} nowhere in src/`, () => {
      const strays = files.filter((f) => code(f).includes(literal));
      expect(strays, 'take it from data-explorer-core, or ask core’s slddChunkContent').toEqual([]);
    });
  }

  it('and no host file navigates the part: the scan that does is core’s', () => {
    // The other direction: a scan for absent literals also passes for a file that stopped
    // navigating the part at all, so say where the navigating went. Neither dictionary editor
    // does it: their engines (view's BinaryEngine and JsonEngine) read the package through core's
    // readBinarySlddPackage and the text through core's jsonEntryScan. No host file walks the text
    // part, nor keeps the scan that does.
    expect(files).not.toContain('src/host/jsonEntryScan.ts');
    const walkers = files.filter((f) => /\b(findEntriesArrayStart|indexEntries|scanEntries)\(/.test(code(f)));
    expect(walkers, 'the text part is walked by core').toEqual([]);
  });
});
