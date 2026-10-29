// Copyright 2026 The MathWorks, Inc.
// The global entry-search overlay's one rule this host keeps: what view's filter matches is what
// the QuickPick item shows. The match and cap rule itself (filterEntries) and the item text
// (searchItem) are view's, and tested there (its test/filterEntries.test.ts); the end-to-end index
// build is covered by test-integration/suite/nameIndex.test.ts.
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

// The QuickPick re-filters the items we hand it, by label and description. So a field
// matched here that the item does not SHOW is a hit the user never sees: it passes this
// filter and is then dropped by the widget's own. One rule, two places, and the path
// between them is the one that was missing.
describe('everything matched here is visible on the item the overlay builds', () => {
  it('searchSources puts the block path in the item description', async () => {
    // Read rather than run: searchSources.ts imports `vscode`, which does not exist in
    // this suite. View's searchItem puts the block path and the file name in its
    // `description` (view's test 'searchItem puts the block path in the item description');
    // what is pinned here is that the overlay shows that description and that label as they
    // are, on items built from view's search over the records.
    const src = await readFile(new URL('../src/host/searchSources.ts', import.meta.url), 'utf8');
    expect(src).toContain('searchEntries(records, qp.value, MAX_SEARCH_RESULTS)');
    expect(src).toContain('label: item.label');
    expect(src).toContain('description: item.description');
  });
});
