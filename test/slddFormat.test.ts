// Copyright 2026 The MathWorks, Inc.
// Content-format detection that routes .sldd to the right editor: editable JSON
// → text-backed table view (native undo/redo); zip/binary → read-only view.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isZipBytes,
  isEditableJsonSlddBytes,
  exceedsTextSyncLimit,
  exceedsStringDecodeLimit,
  parsesAsJson,
  TEXT_SYNC_LIMIT,
  STRING_DECODE_LIMIT,
} from '../src/host/slddFormat.js';
import { findEntryElementSpan } from '../src/host/entrySplice.js';
import { deleteEntriesByName } from '../src/host/structuralEdit.js';

function bytesOf(relPath: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(relPath, import.meta.url))));
}

describe('slddFormat routing detection', () => {
  it('detects a JSON .sldd as editable', () => {
    const json = bytesOf('../test-integration/fixtures/workspace/data.sldd');
    expect(isZipBytes(json)).toBe(false);
    expect(isEditableJsonSlddBytes(json)).toBe(true);
  });

  it('detects a zip/binary .sldd as NOT editable', () => {
    const zip = bytesOf('../test-integration/fixtures/workspace/binary.sldd');
    expect(isZipBytes(zip)).toBe(true);
    expect(isEditableJsonSlddBytes(zip)).toBe(false);
  });

  it('treats non-JSON, non-zip bytes as not editable', () => {
    const garbage = new TextEncoder().encode('not json at all {');
    expect(isEditableJsonSlddBytes(garbage)).toBe(false);
  });

  it('recognizes the ZIP local-file-header magic', () => {
    expect(isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(isZipBytes(new Uint8Array([0x7b, 0x7d]))).toBe(false); // "{}"
    expect(isZipBytes(new Uint8Array([0x50, 0x4b]))).toBe(false); // too short
  });
});

describe('exceedsTextSyncLimit (large-file routing guard)', () => {
  it('is false for a small file (opens in the editable table view)', () => {
    expect(exceedsTextSyncLimit(new TextEncoder().encode('{}'))).toBe(false);
  });

  it('is false exactly at the limit (boundary: <= limit stays editable)', () => {
    // A real allocation this large is wasteful; fake the length VS Code measures.
    expect(exceedsTextSyncLimit({ length: TEXT_SYNC_LIMIT } as Uint8Array)).toBe(false);
  });

  it('is true one byte past the limit (routes to the read-only view)', () => {
    expect(exceedsTextSyncLimit({ length: TEXT_SYNC_LIMIT + 1 } as Uint8Array)).toBe(true);
  });

  it('matches VS Code TextModel._MODEL_SYNC_LIMIT (50 MB)', () => {
    // If VS Code ever changes this constant, this test flags that our routing
    // threshold has drifted from it. See slddFormat.ts for why they must agree.
    expect(TEXT_SYNC_LIMIT).toBe(50 * 1024 * 1024);
  });
});

describe('exceedsStringDecodeLimit (undecodable-file routing guard)', () => {
  it('is false for a small file', () => {
    expect(exceedsStringDecodeLimit(new TextEncoder().encode('{}'))).toBe(false);
  });

  it('is false exactly at the limit (boundary: <= limit is still decodable)', () => {
    expect(exceedsStringDecodeLimit({ length: STRING_DECODE_LIMIT } as Uint8Array)).toBe(false);
  });

  it('is true one byte past the limit (routes to the plain text editor)', () => {
    expect(exceedsStringDecodeLimit({ length: STRING_DECODE_LIMIT + 1 } as Uint8Array)).toBe(true);
  });

  it('matches V8 max string length (0x1fffffe8)', () => {
    expect(STRING_DECODE_LIMIT).toBe(0x1fffffe8);
  });

  it('treats content above the decode limit as NOT editable JSON (no decode attempt)', () => {
    // Above V8's limit, a real decode would throw; isEditableJsonSlddBytes must
    // short-circuit to false instead of throwing. Fake the length cheaply.
    expect(isEditableJsonSlddBytes({ length: STRING_DECODE_LIMIT + 1 } as Uint8Array)).toBe(false);
  });
});

// Every JSON .sldd write path gates on this before splicing. It is the strict
// counterpart to the tolerant scan the splice helpers use: that scan validates only
// the shape of the entries array, so it will happily recover a span out of text that
// is half-typed ANYWHERE else, and a splice against that text writes back a file that
// is still invalid and now missing a chunk too.
describe('parsesAsJson (the strict gate in front of every write)', () => {
  const fixtureText = readFileSync(
    fileURLToPath(new URL('../test-integration/fixtures/workspace/data.sldd', import.meta.url)),
    'utf8',
  );

  // Mid-edit states a text view really produces, keyed by what the user did.
  const MIDEDIT: Record<string, string> = {
    'closing brace deleted': fixtureText.slice(0, fixtureText.length - 1),
    'tail cut off mid-entry': fixtureText.slice(0, fixtureText.indexOf('"CellMatrix"') + 20),
    'key typed, value not yet': fixtureText.replace('"name": "Array1"', '"name": "Array1", "newKey"'),
    'stray character inside an entry': fixtureText.replace('"name": "Array1"', '"name": "Array1"x'),
    'doubled comma left by a deletion': fixtureText.replace('"name": "Array1",', '"name": "Array1",,'),
  };

  it('accepts the real fixture and rejects every mid-edit state of it', () => {
    expect(parsesAsJson(fixtureText)).toBe(true);
    for (const [label, text] of Object.entries(MIDEDIT)) {
      expect(parsesAsJson(text), label).toBe(false);
    }
  });

  it('accepts a bare scalar or array, since JSON.parse does', () => {
    // The gate answers "is this parseable JSON", not "is this a .sldd" — the
    // structural walk is what rejects a document of the wrong shape.
    expect(parsesAsJson('42')).toBe(true);
    expect(parsesAsJson('[1, 2]')).toBe(true);
    expect(parsesAsJson('')).toBe(false);
  });

  // The finders' own refusal covers only what makes the ENTRIES ARRAY unwalkable.
  // Everything the array's shape survives is still located, which is why the gate
  // in front of it cannot be retired.
  it('the finders refuse text whose entries array no longer closes', () => {
    expect(findEntryElementSpan(MIDEDIT['tail cut off mid-entry'], 'Array1')).toBeNull();
  });

  it('REGRESSION: is the only thing standing between the splice and a broken write', () => {
    // Why the gate exists rather than trusting the splice to fail safe: for every
    // mid-edit state whose entries array is still intact, the entry is still LOCATED
    // in text that does not parse, so the delete goes through and returns text that
    // also does not parse. Left ungated, a cross-document move deleted an entry out
    // of a source file the user had mid-edit, leaving a file too broken to reopen as
    // a table.
    const located = Object.entries(MIDEDIT).filter(
      ([, text]) => findEntryElementSpan(text, 'Array1') !== null,
    );
    expect(located.length).toBeGreaterThan(0);
    for (const [label, text] of located) {
      const trimmed = deleteEntriesByName(text, ['Array1']);
      expect(trimmed, label).not.toBe(text);
      expect(trimmed.includes('"Array1"'), label).toBe(false);
    }
    // Some of those spliced results do not even parse afterwards — the write would
    // have made an invalid file invalid AND shorter.
    const broken = located.filter(([, t]) => !parsesAsJson(deleteEntriesByName(t, ['Array1'])));
    expect(broken.length).toBeGreaterThan(0);
  });
});
