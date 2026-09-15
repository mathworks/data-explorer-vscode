// Copyright 2026 The MathWorks, Inc.
// Reading a core srcId back as the document it names.
//
// core registers a source under whatever string the host hands `addDataSource`, and builds
// every link target as `<name>@<srcId>`. For two of the three table providers that srcId is
// the document's uriString and the round trip is free. BinarySlddEditorProvider has to
// prefix — DataModel is a singleton, and its editable model of a zip .sldd would otherwise
// collide with the read-only BinaryEditorProvider's cached model of the same uri — so its
// link targets carry `binedit:file:///…`, which is not a uri.
//
// This is the pure half of that. The wiring half (that navigate.ts and linkRoute.ts actually
// come through here, rather than comparing or parsing a raw srcId) is asserted below as
// source shape, and end-to-end through a real editable binary dictionary in
// test-integration/suite/typeLinkBinary.test.ts — which is what caught the original bug: a
// Data Type link in a binary .sldd opened an empty `binedit:`-scheme tab.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BINARY_EDIT_SRC_PREFIX, binaryEditSrcId, srcIdToUriString } from '../src/common/srcId.js';
import { blankCommentsAndKeepLines, sourceFiles } from './tools/moduleGraph.js';

const URI = 'file:///w/Controller.sldd';
const SRC = join(import.meta.dirname, '..', 'src');

describe('srcIdToUriString', () => {
  it('round-trips the binary-edit spelling', () => {
    // The one claim that makes the pair a pair. Either function alone is just string
    // surgery; that they compose to the identity is what lets a link target built from a
    // srcId be opened as a file.
    expect(srcIdToUriString(binaryEditSrcId(URI))).toBe(URI);
  });

  it('leaves a plain uriString srcId alone', () => {
    // SlddTextEditorProvider and BinaryEditorProvider both register the uriString itself,
    // so this is the common path and must be untouched.
    expect(srcIdToUriString(URI)).toBe(URI);
  });

  it('leaves a bare basename alone', () => {
    // The block -> dictionary-variable grammar carries only a name; navigate.ts resolves it
    // against the workspace. Mangling it here would break links that work today.
    expect(srcIdToUriString('params.sldd')).toBe('params.sldd');
  });

  it('strips only a LEADING prefix', () => {
    // A file may legitimately be named for the prefix. Stripping anywhere in the string
    // would rewrite its path into one that names nothing.
    const odd = 'file:///w/binedit:notes.sldd';
    expect(srcIdToUriString(odd)).toBe(odd);
  });

  it('strips exactly one prefix', () => {
    // slice, not a repeated replace: nothing doubles the prefix, and quietly unwrapping a
    // srcId twice would resolve two different documents to the same one.
    expect(srcIdToUriString(binaryEditSrcId(binaryEditSrcId(URI)))).toBe(binaryEditSrcId(URI));
  });
});

describe('the prefix is defined once', () => {
  // Its whole problem is that it escapes the host: it reaches the webview inside a link
  // target and comes back through navigate.ts. Three places already have to agree about it,
  // so a second literal is how they start disagreeing — and the symptom is not a failing
  // test but a link that opens a blank tab.
  const files = sourceFiles(SRC);

  it('appears as a literal in common/srcId.ts and nowhere else under src/', () => {
    const holders = files.filter((f) =>
      blankCommentsAndKeepLines(readFileSync(join(SRC, f), 'utf8')).includes(BINARY_EDIT_SRC_PREFIX),
    );
    expect(holders).toEqual(['common/srcId.ts']);
  });
});

describe('both readers of a srcId come through it', () => {
  // navigate.ts imports vscode, so vitest cannot call it; linkRoute is covered behaviourally
  // in linkRoute.test.ts. These pin the wiring in the cheap suite — the bug was not a wrong
  // rule, it was a rule that two call sites did not use.
  const read = (rel: string): string =>
    blankCommentsAndKeepLines(readFileSync(join(SRC, rel), 'utf8'));

  it('navigate.ts resolves a source through it', () => {
    expect(read('host/navigate.ts')).toMatch(/srcIdToUriString\(/);
  });

  it('linkRoute.ts compares through it', () => {
    expect(read('webview/linkRoute.ts')).toMatch(/srcIdToUriString\(/);
  });
});
