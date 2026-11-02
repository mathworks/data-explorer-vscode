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
// The pair of functions is view's (srcIdToUriString, binaryEditSrcId), and view proves them
// (test/srcId.test.ts). What stays here is this extension's wiring half: that navigate.ts comes
// through them rather than comparing or parsing a raw srcId, asserted as source shape, and
// end-to-end through a real editable binary dictionary in
// test-integration/suite/typeLinkBinary.test.ts — which is what caught the original bug: a
// Data Type link in a binary .sldd opened an empty `binedit:`-scheme tab.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binaryEditSrcId } from 'data-explorer-view/host';
import { blankCommentsAndKeepLines, sourceFiles } from './tools/moduleGraph.js';

// The prefix, as the model spells it: what it puts before an empty uriString. Not imported, because
// view keeps the constant to itself; only the pair of functions is its interface.
const BINARY_EDIT_SRC_PREFIX = binaryEditSrcId('');

const SRC = join(import.meta.dirname, '..', 'src');

describe('the prefix is defined once', () => {
  // Its whole problem is that it escapes the host: it reaches the webview inside a link
  // target and comes back through navigate.ts. Three places already have to agree about it,
  // so a second literal is how they start disagreeing — and the symptom is not a failing
  // test but a link that opens a blank tab.
  const files = sourceFiles(SRC);

  it("appears as a literal nowhere under src/: it is view's srcId.ts's", () => {
    const holders = files.filter((f) =>
      blankCommentsAndKeepLines(readFileSync(join(SRC, f), 'utf8')).includes(BINARY_EDIT_SRC_PREFIX),
    );
    expect(holders).toEqual([]);
  });
});

describe('both readers of a srcId come through it', () => {
  // navigate.ts imports vscode, so vitest cannot call it; this pins the wiring in the cheap
  // suite — the bug was not a wrong rule, it was a rule that a call site did not use. The other
  // reader is the table's link rule (view's localLinkName), which view proves reads every
  // spelling of a srcId (test/messageSource.test.ts › link targets).
  const read = (rel: string): string =>
    blankCommentsAndKeepLines(readFileSync(join(SRC, rel), 'utf8'));

  it('navigate.ts resolves a source through it', () => {
    expect(read('host/navigate.ts')).toMatch(/srcIdToUriString\(/);
  });
});
