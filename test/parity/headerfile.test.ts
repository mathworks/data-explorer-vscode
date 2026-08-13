// Copyright 2026 The MathWorks, Inc.
// Header File column parity: prove the schema `headerFile` column reads the REAL
// serialized CoderInfo.CustomAttributes.HeaderFile from a MATLAB-generated .sldd
// (not just a live MCOS property), for BOTH file formats.
//
//   hdrParam  (ExportToFile CSC, HeaderFile='params_hdr.h')  -> 'params_hdr.h'
//   hdrSignal (ExportToFile CSC, HeaderFile='signals_hdr.h') -> 'signals_hdr.h'
//   plainParam (Auto CSC, no CustomAttributes.HeaderFile)    -> '' (blank cell)
//
// Fixture is produced by test/parity/gen_headerfile_fixture.m under real MATLAB
// into artifacts/{text,binary}/headerfile.sldd. Absent -> the suite is skipped.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../src/dex/datamodel/node/NodeClassMap.js';
import { getModel, getModelFromBytes, invalidate } from '../../src/host/SlddModel.js';

const ART = (variant: string) =>
  fileURLToPath(new URL(`./artifacts/${variant}/headerfile.sldd`, import.meta.url));

const HAVE_FIXTURES = existsSync(ART('text')) && existsSync(ART('binary'));

function bytesOf(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// Read the Header File cell text from a node's row, unwrapping the editable-object
// cell shape when present (schema label columns render as plain strings).
function headerFileCell(node: any): string {
  const cell = node.toRow().headerFile;
  if (cell && typeof cell === 'object') return cell.text ?? '';
  return cell ?? '';
}

const VARIANTS = ['text', 'binary'] as const;

(HAVE_FIXTURES ? describe : describe.skip)('Header File column', () => {
  if (!HAVE_FIXTURES) {
    it('fixtures missing — run test/parity/gen_headerfile_fixture.m under MATLAB', () => {
      expect(HAVE_FIXTURES).toBe(false);
    });
    return;
  }

  describe.each(VARIANTS)('[%s]', (variant) => {
    let byEntry: Map<string, any>;
    beforeAll(() => {
      const uri = `test://headerfile/${variant}`;
      const path = ART(variant);
      const raw = readFileSync(path);
      const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
      invalidate(uri);
      const node = isZip
        ? getModelFromBytes(uri, 'headerfile.sldd', bytesOf(path))
        : getModel(uri, 'headerfile.sldd', raw.toString('utf8'));
      byEntry = new Map();
      for (const section of node.children ?? []) {
        for (const entry of section.children ?? []) byEntry.set(entry.name, entry);
      }
    });

    it('a Parameter with ExportToFile CSC surfaces its HeaderFile', () => {
      expect(headerFileCell(byEntry.get('hdrParam'))).toBe('params_hdr.h');
    });

    it('a Signal with ExportToFile CSC surfaces its HeaderFile', () => {
      expect(headerFileCell(byEntry.get('hdrSignal'))).toBe('signals_hdr.h');
    });

    it('an entry with a plain (Auto) CSC has no HeaderFile — the cell is blank', () => {
      expect(headerFileCell(byEntry.get('plainParam'))).toBe('');
    });
  });
});
