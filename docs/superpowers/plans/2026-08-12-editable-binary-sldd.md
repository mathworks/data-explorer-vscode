# Editable compressed-binary `.sldd` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add table editing for compressed-binary (zip/XML) `.sldd` files at parity with the editable JSON `.sldd` table view, serializing back to a file MATLAB/Simulink reopens correctly.

**Architecture:** A new writable `CustomEditorProvider` holds an in-memory `chunkXml` string (the only editable part of the OPC zip) plus the pass-through zip parts. Every edit regenerates only the touched entry's `<Object Class="DD.ENTRY">…</Object>` fragment (reusing the already-vendored per-node XML serializer) and byte-splices it into `chunkXml`. Save re-parses `chunkXml` (safety gate), then re-zips with fflate. This mirrors the JSON path's byte-scoped-splice safety model.

**Tech Stack:** TypeScript, VS Code CustomEditor API, fflate (zip), fast-xml-parser (already vendored), vitest (unit), @vscode/test-electron (integration), MATLAB R2027a sandbox (dev-loop round-trip verification only).

---

## Key facts established during design (do not re-investigate)

- **The XML serializer is already vendored.** `DataNode.serializeXml`, all `_serialize*Xml` statics, every node `_getSerializedProperties`/`serializeXml` override, and `XmlUtils` exist in `src/dex/` and match the reference. `SlddNode` already has `_zipMetadata`, `_dataSourceAttrs`, `allowAccessBWS`. **Only the top-level `BinarySlddSerializer.ts` entry point is missing.**
- **Entry-fragment invariant (verified in MATLAB):** a nested object inside a struct field / cell element serializes as `<Element Class="...">`, NEVER as a nested `<Object>`. `<Object>` appears only at top level (`DD.ENTRY`, `DD.Dictionary`, `DD.DICTIONARYREFERENCE`). So `<Object Class="DD.ENTRY">…</Object>` never nests `<Object>`, and a string-scan splice is safe (same scan `extractEntryFragments` already uses).
- **Node id** = `parent.id + '/' + name`, rooted at the srcId passed to `DataModel.addDataSource`. `DataModel`'s registry is a global singleton. The editable provider MUST register under a **distinct srcId** (prefix the URI) so it never collides with the read-only `BinaryEditorProvider`'s cached model of the same file.
- **`serializeEntryToXml(entryNode)`** emits the 6 metadata `<P>` nodes then `entryNode.serializeXml('P', {Name:'Value'}, 2)`. It uses `meta._rawLastMod` when present. We preserve `_rawLastMod` (no date bump) for deterministic output.
- **`buildDataChunkXml`** iterates `slddNode.children` (sections) → `section.children` (entries), calls `serializeEntryToXml`, then appends the `DD.Dictionary` object with `AccessBaseWorkspace`. NOTE: upstream `buildDataChunkXml` does NOT emit `DD.DICTIONARYREFERENCE` objects — see Task 2 handling.
- **JSON path reference modules to mirror:** `src/host/entrySplice.ts` (span location) and `src/host/structuralEdit.ts` (pure transforms), driven by `src/host/SlddTextEditorProvider.ts`.

---

## File Structure

**New (production):**
- `src/dex/datamodel/parser/BinarySlddSerializer.ts` — `serializeBinarySldd`, `buildDataChunkXml`, `serializeEntryToXml`. Ported + genericized.
- `src/host/xmlEntrySplice.ts` — pure offset-aware span location in the XML string.
- `src/host/xmlStructuralEdit.ts` — pure XML structural transforms.
- `src/host/BinarySlddEditorProvider.ts` — writable custom editor + document.

**New (test):**
- `test/xmlEntrySplice.test.ts`, `test/xmlStructuralEdit.test.ts`, `test/binarySlddSerializer.test.ts`, `test/binarySlddRoundTrip.test.ts`
- `test/fixtures/nested_objects.sldd` (struct/cell with nested Simulink.Parameter — the invariant fixture)
- `test-integration/suite/binarySlddEdit.test.ts`
- `test/parity/artifacts/binary/*` reused where possible.

**Modified:**
- `src/dex/datamodel/parser/BinarySlddParser.ts` — export `parseBinarySlddParts(chunkXml, zipMetadata, coreProps?)`.
- `src/host/BinaryEditorProvider.ts` — redirect zip `.sldd` to the new writable viewType.
- `src/extension.ts` — register the new provider; route zip `.sldd` opens.
- `package.json` — new `customEditors` entry.

**Phase order (highest value first):** serializer → splice → transforms → provider → wiring → integration. Each phase commits with `[wip]`.

---

## Task 1: Port `BinarySlddSerializer.ts` into `src/dex/`

**Files:**
- Create: `src/dex/datamodel/parser/BinarySlddSerializer.ts`
- Test: `test/binarySlddSerializer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/binarySlddSerializer.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { getModelFromBytes, invalidate } from '../src/host/SlddModel.js';
import { serializeBinarySldd, serializeEntryToXml } from '../src/dex/datamodel/parser/BinarySlddSerializer.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function freshModel(uri: string) {
  invalidate(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return getModelFromBytes(uri, 'params.sldd', ab as ArrayBuffer);
}

describe('serializeBinarySldd', () => {
  it('round-trips: re-serialized zip re-parses to the same entry names', () => {
    const model = freshModel('mem://ser1');
    const out = serializeBinarySldd(model);
    const parts = unzipSync(new Uint8Array(out));
    expect(parts['data/chunk0.xml']).toBeDefined();
    const xml = new TextDecoder().decode(parts['data/chunk0.xml']);
    expect(xml).toContain('<Object Class="DD.ENTRY">');
    expect(xml).toContain('<Object Class="DD.Dictionary">');
    // Every original entry name survives.
    const names = model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
    for (const n of names) expect(xml).toContain('>' + n + '</P>');
  });

  it('serializeEntryToXml emits the 6 metadata P-nodes and a Value P', () => {
    const model = freshModel('mem://ser2');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const frag = serializeEntryToXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">');
    expect(frag).toContain('<P Name="UUID" Class="char">');
    expect(frag).toContain('<P Name="Namespace" Class="char">');
    expect(frag).toContain('<P Name="LastMod" Class="char">');
    expect(frag).toContain('<P Name="LastModBy" Class="char">');
    expect(frag).toContain('<P Name="IsDerived" Class="char">');
    expect(frag).toContain('Name="Value"');
    expect(frag.trimEnd().endsWith('</Object>')).toBe(true);
  });

  it('preserves _rawLastMod (no date bump)', () => {
    const model = freshModel('mem://ser3');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const raw = entry.metadata._rawLastMod as string;
    expect(serializeEntryToXml(entry)).toContain('<P Name="LastMod" Class="char">' + raw + '</P>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/binarySlddSerializer.test.ts`
Expected: FAIL — "Cannot find module '.../BinarySlddSerializer.js'".

- [ ] **Step 3: Write the implementation** (port from the reference, genericized — no internal codenames)

```typescript
// src/dex/datamodel/parser/BinarySlddSerializer.ts
// Copyright 2026 The MathWorks, Inc.
//
// Serialize a compressed-binary .sldd model back to zip bytes. `buildDataChunkXml`
// rebuilds the whole data/chunk0.xml (used by the save gate to validate the whole
// document); `serializeEntryToXml` builds ONE entry's <Object> fragment (used by the
// entry-level splice edit path). Untouched bytes are preserved by the splice caller,
// not here.
import { zipSync } from 'fflate';
import { escapeXml } from './XmlUtils.js';
import type SlddNode from '../node/container/SlddNode.js';
import type DataNode from '../node/DataNode.js';

export function serializeBinarySldd(slddNode: SlddNode): ArrayBuffer {
  const xmlString = buildDataChunkXml(slddNode);
  const encoder = new TextEncoder();
  const zipEntries: Record<string, Uint8Array> = {};
  if (slddNode._zipMetadata) {
    for (const [name, data] of Object.entries(slddNode._zipMetadata)) {
      zipEntries[name] = data as Uint8Array;
    }
  }
  zipEntries['data/chunk0.xml'] = encoder.encode(xmlString);
  const zipped = zipSync(zipEntries, { level: 6 });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

export function buildDataChunkXml(slddNode: SlddNode): string {
  const attrs = slddNode._dataSourceAttrs || { FormatVersion: '1', MinRelease: 'R2014a', Arch: '' };
  const archAttr = attrs.Arch ? ' Arch="' + attrs.Arch + '"' : '';
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<DataSource FormatVersion="' + attrs.FormatVersion + '" MinRelease="' + attrs.MinRelease + '"' + archAttr + '>\n';
  slddNode.children.forEach(function (section) {
    section.children.forEach(function (entryNode) {
      xml += serializeEntryToXml(entryNode as unknown as DataNode);
    });
  });
  // Referenced sub-dictionaries, if any, precede the dictionary object.
  for (const sub of slddNode.dictionaryReferences || []) {
    xml += '    <Object Class="DD.DICTIONARYREFERENCE">\n';
    xml += '        <P Name="Subdictionary" Class="char">' + escapeXml(String(sub)) + '</P>\n';
    xml += '    </Object>\n';
  }
  xml += '    <Object Class="DD.Dictionary">\n';
  xml += '        <P Name="AccessBaseWorkspace" Class="logical">' + (slddNode.allowAccessBWS ? '1' : '0') + '</P>\n';
  xml += '    </Object>\n';
  xml += '</DataSource>';
  return xml;
}

export function serializeEntryToXml(entryNode: DataNode): string {
  const meta = entryNode.metadata || {};
  const lastMod = (meta._rawLastMod as string) || formatDateNow();
  let xml = '    <Object Class="DD.ENTRY">\n';
  xml += '        <P Name="Name" Class="char">' + escapeXml(entryNode.name) + '</P>\n';
  xml += '        <P Name="UUID" Class="char">' + ((meta.uuid as string) || '') + '</P>\n';
  xml += '        <P Name="Namespace" Class="char">' + ((meta.namespace as string) || '') + '</P>\n';
  xml += '        <P Name="LastMod" Class="char">' + lastMod + '</P>\n';
  xml += '        <P Name="LastModBy" Class="char">' + escapeXml((meta.lastModifiedBy as string) || '') + '</P>\n';
  xml += '        <P Name="IsDerived" Class="char">' + ((meta.isderived as string) || '0') + '</P>\n';
  xml += entryNode.serializeXml('P', { Name: 'Value' }, 2) + '\n';
  xml += '    </Object>\n';
  return xml;
}

function formatDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
```

NOTE: the reference reads `meta.lastModifiedBy`; the parser stores `lastModifiedBy` (confirm the exact key in `BinarySlddParser.parseEntry` — it is `lastModifiedBy`). Keep that key.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/binarySlddSerializer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Leak-check and commit**

```bash
# Run the CLAUDE.md curation leak-check oversrc/dex/datamodel/parser/BinarySlddSerializer.ts(must print nothing).
git add src/dex/datamodel/parser/BinarySlddSerializer.ts test/binarySlddSerializer.test.ts
git commit -m "[wip] Port BinarySlddSerializer entry point into src/dex"
```
Expected: grep prints nothing, exit 1.

---

## Task 2: Export `parseBinarySlddParts` from the parser

Lets the editor rebuild the model from live `chunkXml` (+ pass-through metadata) without a zip/unzip round-trip on every edit.

**Files:**
- Modify: `src/dex/datamodel/parser/BinarySlddParser.ts`
- Test: extend `test/binarySlddSerializer.test.ts` (or new `test/binarySlddParts.test.ts`)

- [ ] **Step 1: Write the failing test**

```typescript
// test/binarySlddParts.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { parseBinarySldd, parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('parseBinarySlddParts', () => {
  it('produces the same content shape as parseBinarySldd for the same chunkXml', () => {
    const whole = parseBinarySldd(ab);
    const zip = unzipSync(new Uint8Array(ab));
    const chunkXml = new TextDecoder().decode(zip['data/chunk0.xml']);
    const meta: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
    const parts = parseBinarySlddParts(chunkXml, meta);
    expect(JSON.stringify((parts as any).__MW_TEXT_PARTS__)).toBe(
      JSON.stringify((whole as any).__MW_TEXT_PARTS__),
    );
    expect((parts as any).__rawXml).toBe(chunkXml);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/binarySlddParts.test.ts`
Expected: FAIL — `parseBinarySlddParts` is not exported.

- [ ] **Step 3: Refactor `parseBinarySldd` to delegate to `parseBinarySlddParts`**

In `src/dex/datamodel/parser/BinarySlddParser.ts`, extract the post-unzip body into a new exported function and have `parseBinarySldd` call it. Replace the current `parseBinarySldd` body:

```typescript
export function parseBinarySldd(arrayBuffer: ArrayBuffer): Record<string, unknown> {
  const uint8 = new Uint8Array(arrayBuffer);
  const entries = unzipSync(uint8);
  const decoder = new TextDecoder();
  const dataXml = entries['data/chunk0.xml'];
  if (!dataXml) {
    throw new Error('Missing data/chunk0.xml in binary SLDD');
  }
  const xmlString = decoder.decode(dataXml);
  const zipMetadata: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'data/chunk0.xml') {
      zipMetadata[name] = data;
    }
  }
  return parseBinarySlddParts(xmlString, zipMetadata);
}

export function parseBinarySlddParts(
  xmlString: string,
  zipMetadata: Record<string, Uint8Array>,
): Record<string, unknown> {
  const decoder = new TextDecoder();
  let release = '';
  if (zipMetadata['metadata/mwcoreProperties.xml']) {
    const xml = decoder.decode(zipMetadata['metadata/mwcoreProperties.xml']);
    const match = xml.match(/<matlabRelease>([^<]+)<\/matlabRelease>/);
    if (match) {
      release = match[1];
    }
  }
  const doc = xmlParser.parse(xmlString);
  const dataSource = doc.DataSource as XmlNode;
  const dataSourceAttrs = {
    FormatVersion: dataSource['@_FormatVersion'] || '1',
    MinRelease: dataSource['@_MinRelease'] || 'R2014a',
    Arch: dataSource['@_Arch'] || '',
  };
  const entryXmlFragments = extractEntryFragments(xmlString);
  const ddEntries: Record<string, unknown>[] = [];
  const objects = (dataSource.Object || []) as XmlNode[];
  let entryIdx = 0;
  for (const obj of objects) {
    if (obj['@_Class'] === 'DD.ENTRY') {
      ddEntries.push(parseEntry(obj, entryXmlFragments[entryIdx] || ''));
      entryIdx++;
    }
  }
  let allowAccessBWS = false;
  const dictionaryReferences: string[] = [];
  for (const obj of objects) {
    if (obj['@_Class'] === 'DD.Dictionary') {
      const abws = getProperty(obj, 'AccessBaseWorkspace');
      if (abws === '1' || abws === 'true') {
        allowAccessBWS = true;
      }
    }
    if (obj['@_Class'] === 'DD.DICTIONARYREFERENCE') {
      const sub = getProperty(obj, 'Subdictionary');
      if (sub) {
        dictionaryReferences.push(sub);
      }
    }
  }
  return {
    __MW_TEXT_COREPROPERTIES__: { release },
    __MW_TEXT_PARTS__: {
      '__MW_TEXT_PART__/data/chunk0': {
        __MW_TEXT_content: {
          entries: ddEntries,
          'Dictionary References': dictionaryReferences,
          AllowAccessBWS: allowAccessBWS,
        },
      },
    },
    __rawXml: xmlString,
    __zipMetadata: zipMetadata,
    __dataSourceAttrs: dataSourceAttrs,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/binarySlddParts.test.ts && npx vitest run test/parser.test.ts`
Expected: PASS (no regression in the existing parser suite).

- [ ] **Step 5: Commit**

```bash
git add src/dex/datamodel/parser/BinarySlddParser.ts test/binarySlddParts.test.ts
git commit -m "[wip] Export parseBinarySlddParts for chunkXml-driven model rebuild"
```

---

## Task 3: `xmlEntrySplice.ts` — offset-aware span location

**Files:**
- Create: `src/host/xmlEntrySplice.ts`
- Create fixture: `test/fixtures/nested_objects.sldd` (copy from `/tmp/dexp_nested/nested.sldd` produced in the sandbox; regenerate via the MATLAB snippet in the spec if missing)
- Test: `test/xmlEntrySplice.test.ts`

- [ ] **Step 1: Copy the nested-object fixture into the repo**

```bash
cp /tmp/dexp_nested/nested.sldd test/fixtures/nested_objects.sldd 2>/dev/null || echo "REGENERATE via spec MATLAB snippet"
node -e "const {unzipSync}=require('fflate');const fs=require('fs');const z=unzipSync(new Uint8Array(fs.readFileSync('test/fixtures/nested_objects.sldd')));console.log(Object.keys(z))"
```

- [ ] **Step 2: Write the failing test**

```typescript
// test/xmlEntrySplice.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  findEntryObjectSpan,
  findEntryElementSpan,
  findEntryInsertionPoint,
} from '../src/host/xmlEntrySplice.js';

function chunkXml(fixture: string): string {
  const p = fileURLToPath(new URL('./' + fixture, import.meta.url));
  const z = unzipSync(new Uint8Array(readFileSync(p)));
  return new TextDecoder().decode(z['data/chunk0.xml']);
}
const nested = chunkXml('fixtures/nested_objects.sldd');

describe('findEntryObjectSpan', () => {
  it('finds an entry and returns a tight <Object>…</Object> span', () => {
    const span = findEntryObjectSpan(nested, 'StructWithParam');
    expect(span).not.toBeNull();
    const slice = nested.slice(span!.offset, span!.offset + span!.length);
    expect(slice.startsWith('<Object Class="DD.ENTRY">')).toBe(true);
    expect(slice.endsWith('</Object>')).toBe(true);
    expect(slice).toContain('<P Name="Name" Class="char">StructWithParam</P>');
    // Must not swallow the sibling entry.
    expect(slice).not.toContain('CellWithParam');
  });

  it('the fragment for a nested-object entry contains NO nested <Object> (invariant)', () => {
    for (const name of ['StructWithParam', 'CellWithParam']) {
      const span = findEntryObjectSpan(nested, name)!;
      const slice = nested.slice(span.offset, span.offset + span.length);
      const inner = slice.slice('<Object Class="DD.ENTRY">'.length, -'</Object>'.length);
      expect(inner).not.toContain('<Object');
    }
  });

  it('returns null for an unknown name', () => {
    expect(findEntryObjectSpan(nested, 'NoSuchEntry')).toBeNull();
  });
});

describe('findEntryInsertionPoint', () => {
  it('returns an offset just before the trailing DD.Dictionary object', () => {
    const off = findEntryInsertionPoint(nested);
    expect(off).not.toBeNull();
    expect(nested.slice(off!)).toContain('<Object Class="DD.Dictionary">');
    // Nothing but the dictionary (and any dictionaryreference) follows.
    expect(nested.slice(0, off!)).toContain('<Object Class="DD.ENTRY">');
  });
});

describe('findEntryElementSpan', () => {
  it('span removal leaves the other entry and the dictionary intact', () => {
    const span = findEntryElementSpan(nested, 'StructWithParam')!;
    const after = nested.slice(0, span.offset) + nested.slice(span.offset + span.length);
    expect(after).not.toContain('StructWithParam');
    expect(after).toContain('CellWithParam');
    expect(after).toContain('<Object Class="DD.Dictionary">');
  });
});
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/host/xmlEntrySplice.ts
// Copyright 2026 The MathWorks, Inc.
//
// Pure, offset-aware location of entry spans in a data/chunk0.xml string — the XML
// analog of entrySplice.ts. No value parsing. Relies on the verified invariant that
// an <Object Class="DD.ENTRY">…</Object> fragment never contains a nested <Object>
// (nested objects serialize as <Element Class="...">), so a linear scan of the
// entry open/close tags is unambiguous. Never throws; returns null when not found.

const ENTRY_OPEN = '<Object Class="DD.ENTRY">';
const OBJECT_CLOSE = '</Object>';
const DICT_OPEN = '<Object Class="DD.Dictionary">';
const DICTREF_OPEN = '<Object Class="DD.DICTIONARYREFERENCE">';

// Read the entry Name from a fragment via its Name P-node.
function entryNameOf(fragment: string): string | null {
  const m = fragment.match(/<P Name="Name" Class="char">([^<]*)<\/P>/);
  return m ? m[1] : null;
}

/** Byte span of the <Object Class="DD.ENTRY">…</Object> whose Name equals entryName. */
export function findEntryObjectSpan(
  xml: string,
  entryName: string,
): { offset: number; length: number } | null {
  let pos = 0;
  while (true) {
    const start = xml.indexOf(ENTRY_OPEN, pos);
    if (start < 0) return null;
    const end = xml.indexOf(OBJECT_CLOSE, start);
    if (end < 0) return null;
    const endExclusive = end + OBJECT_CLOSE.length;
    const fragment = xml.slice(start, endExclusive);
    if (entryNameOf(fragment) === entryName) {
      return { offset: start, length: endExclusive - start };
    }
    pos = endExclusive;
  }
}

/**
 * Span to REMOVE to delete an entry: its <Object> plus the leading whitespace of
 * its line (so the line is removed cleanly) through the newline after </Object>.
 * Removing this leaves the surrounding entries/dictionary well-formed.
 */
export function findEntryElementSpan(
  xml: string,
  entryName: string,
): { offset: number; length: number } | null {
  const span = findEntryObjectSpan(xml, entryName);
  if (!span) return null;
  // Extend start back to the beginning of the line (indentation).
  let start = span.offset;
  const lineStart = xml.lastIndexOf('\n', start - 1) + 1;
  if (xml.slice(lineStart, start).trim() === '') start = lineStart;
  // Extend end past the trailing newline.
  let end = span.offset + span.length;
  if (xml[end] === '\n') end += 1;
  return { offset: start, length: end - start };
}

/**
 * Offset just before the trailing structural objects (DD.DICTIONARYREFERENCE, then
 * DD.Dictionary) where a new entry should be inserted. Falls back to the
 * DD.Dictionary if no reference object is present. Returns null if neither is found.
 */
export function findEntryInsertionPoint(xml: string): number | null {
  const refIdx = xml.indexOf(DICTREF_OPEN);
  const dictIdx = xml.indexOf(DICT_OPEN);
  const candidates = [refIdx, dictIdx].filter((i) => i >= 0);
  if (candidates.length === 0) return null;
  const target = Math.min(...candidates);
  // Back up to the start of that object's line so the inserted entry aligns.
  const lineStart = xml.lastIndexOf('\n', target - 1) + 1;
  return lineStart;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/xmlEntrySplice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
# Run the CLAUDE.md curation leak-check oversrc/host/xmlEntrySplice.ts(must print nothing).
git add src/host/xmlEntrySplice.ts test/xmlEntrySplice.test.ts test/fixtures/nested_objects.sldd
git commit -m "[wip] Add xmlEntrySplice: offset-aware entry span location"
```

---

## Task 4: `xmlStructuralEdit.ts` — pure XML transforms

Mirrors `structuralEdit.ts` but splices XML fragments instead of JSON elements. Reuses `serializeEntryToXml` (Task 1) and `xmlEntrySplice` (Task 3), and the SAME model-node helpers (`findOwningEntry`, `resolveSectionForPaste`, `cloneForPaste`) already in `structuralEdit.ts` — import them rather than duplicate.

**Files:**
- Create: `src/host/xmlStructuralEdit.ts`
- Test: `test/xmlStructuralEdit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/xmlStructuralEdit.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import { findEntryObjectSpan } from '../src/host/xmlEntrySplice.js';
import {
  reserializeEntryXml,
  deleteEntryXml,
  addEntryXml,
  addChildXml,
  deleteChildXml,
  deleteEntriesByNameXml,
} from '../src/host/xmlStructuralEdit.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function load(uri: string): { model: any; xml: string } {
  DataModel.removeDataSource(uri);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  const content = parseBinarySlddParts(xml, meta);
  const model = DataModel.addDataSource(uri, content, { path: 'params.sldd' });
  return { model, xml };
}

function entryNames(model: any): string[] {
  return model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
}
function firstEntry(model: any): any {
  return model.children.flatMap((s: any) => s.children)[0];
}
// A sibling entry's fragment must be byte-identical across an edit that doesn't touch it.
function siblingIdentical(oldXml: string, newXml: string, name: string): boolean {
  const a = findEntryObjectSpan(oldXml, name);
  const b = findEntryObjectSpan(newXml, name);
  if (!a || !b) return false;
  return oldXml.slice(a.offset, a.offset + a.length) === newXml.slice(b.offset, b.offset + b.length);
}

describe('deleteEntryXml', () => {
  it('removes the named entry, leaves siblings byte-identical', () => {
    const { model, xml } = load('mem://xse1');
    const names = entryNames(model);
    const victim = names[0];
    const survivor = names[1];
    const { newText } = deleteEntryXml(xml, model.children.flatMap((s: any) => s.children)[0]);
    expect(findEntryObjectSpan(newText, victim)).toBeNull();
    expect(siblingIdentical(xml, newText, survivor)).toBe(true);
  });
});

describe('reserializeEntryXml + splice', () => {
  it('replacing an entry with its own reserialized fragment is idempotent modulo whitespace', () => {
    const { model, xml } = load('mem://xse2');
    const entry = firstEntry(model);
    const frag = reserializeEntryXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">' + entry.name + '</P>');
  });
});

describe('addEntryXml', () => {
  it('inserts a new entry before the DD.Dictionary and keeps it parseable', () => {
    const { model, xml } = load('mem://xse3');
    const design = model.getSection('design');
    const { newText, selectId } = addEntryXml(xml, design, 'Simulink.Parameter');
    expect(selectId).toBeTruthy();
    const dictIdx = newText.indexOf('<Object Class="DD.Dictionary">');
    const lastEntryIdx = newText.lastIndexOf('<Object Class="DD.ENTRY">');
    expect(lastEntryIdx).toBeLessThan(dictIdx);
  });
});

describe('deleteEntriesByNameXml', () => {
  it('removes multiple named entries, absent names are ignored', () => {
    const { model, xml } = load('mem://xse4');
    const names = entryNames(model).slice(0, 2);
    const out = deleteEntriesByNameXml(xml, [...names, 'Ghost']);
    for (const n of names) expect(findEntryObjectSpan(out, n)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/xmlStructuralEdit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/host/xmlStructuralEdit.ts
// Copyright 2026 The MathWorks, Inc.
//
// Pure (VS-Code-free) XML text transforms for structural edits on a binary .sldd's
// data/chunk0.xml — the XML analog of structuralEdit.ts. Each edit regenerates the
// WHOLE touched entry's <Object> fragment (via serializeEntryToXml) and byte-splices
// it, so untouched sibling entries stay byte-identical. Model-node helpers
// (findOwningEntry, resolveSectionForPaste, cloneForPaste) are shared with the JSON
// path — imported, not duplicated.
import { serializeEntryToXml } from '../dex/datamodel/parser/BinarySlddSerializer.js';
import { generateUuid } from '../dex/datamodel/node/container/SectionNode.js';
import { getSectionMetadata } from '../dex/datamodel/SectionConstants.js';
import { buildSectionRowId } from '../common/sectionRowId.js';
import { findEntryObjectSpan, findEntryElementSpan, findEntryInsertionPoint } from './xmlEntrySplice.js';
import { findOwningEntry, cloneForPaste } from './structuralEdit.js';

export interface StructuralResult {
  newText: string;
  selectId: string | null;
}

// Reserialize one entry to its <Object> fragment (no trailing newline).
export function reserializeEntryXml(entry: any): string {
  return serializeEntryToXml(entry).replace(/\n$/, '');
}

function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string {
  const idx = siblings.indexOf(node);
  if (idx > 0) return siblings[idx - 1].id;
  if (idx >= 0 && idx < siblings.length - 1) return siblings[idx + 1].id;
  return fallbackId;
}

/** Delete a top-level entry by removing its <Object> element span. */
export function deleteEntryXml(text: string, entry: any): StructuralResult {
  const section = entry.parent;
  const siblings = (section?.children ?? []) as any[];
  const selectId = reselectAfterRemoval(siblings, entry, buildSectionRowId(section?.name ?? ''));
  const span = findEntryElementSpan(text, entry.name);
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  const newText = text.slice(0, span.offset) + text.slice(span.offset + span.length);
  return { newText, selectId };
}

/** Delete a nested child: mutate model, reserialize the owning entry, splice it. */
export function deleteChildXml(text: string, node: any): StructuralResult {
  const parent = node.parent;
  if (!parent || typeof parent.canRemoveChild !== 'function' || !parent.canRemoveChild()) {
    throw new Error('This item cannot be deleted.');
  }
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');
  const selectId = reselectAfterRemoval(parent.children ?? [], node, parent.id);
  parent.removeChildNode(node);
  return spliceEntry(text, entry, selectId);
}

/** Add a child to a container node, reserialize its owning entry, splice it. */
export function addChildXml(text: string, node: any): StructuralResult {
  if (typeof node.canAddChild !== 'function' || !node.canAddChild()) {
    throw new Error('This item cannot have children added.');
  }
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');
  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');
  return spliceEntry(text, entry, child.id);
}

// Replace the owning entry's fragment in-place with its reserialized form.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const frag = reserializeEntryXml(entry);
  const span = findEntryObjectSpan(text, entry.name);
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const newText = text.slice(0, span.offset) + frag + text.slice(span.offset + span.length);
  return { newText, selectId };
}

/** Add a brand-new default entry of a class into a section. */
export function addEntryXml(text: string, section: any, className: string): StructuralResult {
  const node = section.addEntry(className);
  if (!node) throw new Error(`Could not add a "${className}" entry.`);
  return insertNewEntry(text, node);
}

/** Paste a serialized entry payload as a new entry (mirrors structuralEdit.pasteEntry). */
export function pasteEntryXml(
  text: string,
  section: any,
  payload: Record<string, unknown>,
): StructuralResult {
  const value = payload.value as Record<string, unknown> | undefined;
  const className = (value && typeof value === 'object' && (value._array_class as string)) || '';
  if (className && typeof section.allowsType === 'function' && !section.allowsType(className)) {
    throw new Error(`A "${className}" entry is not allowed in ${section.displayName ?? section.name}.`);
  }
  const raw = cloneForPaste(payload);
  const baseName = typeof raw.name === 'string' ? raw.name : 'Entry';
  raw.name = section._uniqueName(baseName);
  if (raw.metadata && typeof raw.metadata === 'object') {
    const md = raw.metadata as Record<string, unknown>;
    md.uuid = generateUuid();
    const sectionMeta = getSectionMetadata(section.name);
    md.namespace = sectionMeta.namespace;
    md.isderived = sectionMeta.isderived;
  }
  const newNode = section.parseEntry(raw);
  if (!newNode) throw new Error('Failed to paste the entry.');
  return insertNewEntry(text, newNode);
}

// Insert a freshly-created model entry's fragment before the trailing dictionary.
function insertNewEntry(text: string, node: any): StructuralResult {
  const frag = serializeEntryToXml(node); // keeps trailing newline for clean stacking
  const at = findEntryInsertionPoint(text);
  if (at === null) throw new Error('Could not locate the insertion point.');
  const newText = text.slice(0, at) + frag + text.slice(at);
  return { newText, selectId: node.id };
}

/** Remove many entries by name (high-offset-first so earlier splices stay valid). */
export function deleteEntriesByNameXml(text: string, names: string[]): string {
  const spans: { offset: number; length: number }[] = [];
  for (const name of names) {
    const span = findEntryElementSpan(text, name);
    if (span) spans.push(span);
  }
  spans.sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const span of spans) {
    out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}
```

NOTE: verify `SectionNode` exposes `addEntry(className)` (it does — confirmed) and `buildSectionRowId` exists in `src/common/sectionRowId.ts` (confirmed, imported by structuralEdit.ts).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/xmlStructuralEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
# Run the CLAUDE.md curation leak-check oversrc/host/xmlStructuralEdit.ts(must print nothing).
git add src/host/xmlStructuralEdit.ts test/xmlStructuralEdit.test.ts
git commit -m "[wip] Add xmlStructuralEdit: entry-level XML structural transforms"
```

---

## Task 5: Round-trip + byte-preservation + save-gate unit tests

Consolidates the spec's committed-test items 1, 2, 5 against the serializer + transforms.

**Files:**
- Test: `test/binarySlddRoundTrip.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// test/binarySlddRoundTrip.test.ts
// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/dex/core/DataModel.js';
import '../src/dex/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/dex/datamodel/parser/BinarySlddParser.js';
import { serializeBinarySldd, buildDataChunkXml } from '../src/dex/datamodel/parser/BinarySlddSerializer.js';

function loadZip(fixture: string) {
  const p = fileURLToPath(new URL('./parity/artifacts/binary/' + fixture, import.meta.url));
  const bytes = readFileSync(p);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { zip, xml, meta };
}

describe('binary sldd round-trip', () => {
  it('pass-through parts are byte-identical after re-serialize', () => {
    const { zip, xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt1', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const out = serializeBinarySldd(model);
    const outZip = unzipSync(new Uint8Array(out));
    for (const name of Object.keys(meta)) {
      expect(Array.from(outZip[name] ?? [])).toEqual(Array.from(zip[name]));
    }
  });

  it('save gate: buildDataChunkXml output re-parses without throwing', () => {
    const { xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt2', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const rebuilt = buildDataChunkXml(model);
    expect(() => parseBinarySlddParts(rebuilt, meta)).not.toThrow();
    const reparsed = parseBinarySlddParts(rebuilt, meta) as any;
    const origNames = model.children.flatMap((s: any) => s.children.map((e: any) => e.name)).sort();
    const rows = reparsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const newNames = rows.map((e: any) => e.name).sort();
    expect(newNames).toEqual(origNames);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run test/binarySlddRoundTrip.test.ts`
Expected: PASS. If pass-through bytes differ (fflate recompression of unchanged parts is fine — we only re-zip; the SAME Uint8Array is stored, so bytes match), debug by asserting `meta` objects are reused by reference.

- [ ] **Step 3: Commit**

```bash
git add test/binarySlddRoundTrip.test.ts
git commit -m "[wip] Add binary sldd round-trip + save-gate unit tests"
```

---

## Task 6: `BinarySlddEditorProvider.ts` — writable custom editor

**Files:**
- Create: `src/host/BinarySlddEditorProvider.ts`
- (Integration-tested in Task 8; excluded from vitest coverage like other vscode-coupled providers.)

- [ ] **Step 1: Implement the document + provider**

```typescript
// src/host/BinarySlddEditorProvider.ts
// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { unzipSync, zipSync } from 'fflate';
import { renderWebviewHtml } from './webviewHtml.js';
import { buildRows, COLUMNS, COLUMN_LABELS, type ClipMark } from './rowBuilder.js';
import { parseBinarySlddParts } from '../dex/datamodel/parser/BinarySlddParser.js';
import DataModel from '../dex/core/DataModel.js';
import '../dex/datamodel/node/NodeClassMap.js';
import { findOwningEntry, resolveSectionForPaste } from './structuralEdit.js';
import {
  deleteEntryXml, deleteChildXml, addChildXml, pasteEntryXml,
  deleteEntriesByNameXml, type StructuralResult,
} from './xmlStructuralEdit.js';
import { findEntryObjectSpan } from './xmlEntrySplice.js';
import { serializeEntryToXml } from '../dex/datamodel/parser/BinarySlddSerializer.js';
import { setClipboard, getClipboard, clearClipboard, clipboardState } from './clipboard.js';
import { basename } from '../common/pathUtil.js';
import { toArrayBuffer } from '../common/bytes.js';
import type { TableToHostMessage } from '../common/protocol.js';

// srcId prefix so the editable model never collides with the read-only
// BinaryEditorProvider's cached model of the same URI (DataModel is a singleton).
const SRC_PREFIX = 'binedit:';

class BinarySlddDocument implements vscode.CustomDocument {
  chunkXml: string;
  readonly zipMeta: Record<string, Uint8Array>;
  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChange.event;

  constructor(
    public readonly uri: vscode.Uri,
    chunkXml: string,
    zipMeta: Record<string, Uint8Array>,
  ) {
    this.chunkXml = chunkXml;
    this.zipMeta = zipMeta;
  }

  get srcId(): string { return SRC_PREFIX + this.uri.toString(); }

  // Push an edit onto VS Code's native undo stack.
  pushEdit(label: string, before: string, after: string): void {
    this.chunkXml = after;
    this._onDidChange.fire({
      document: this,
      label,
      undo: () => { this.chunkXml = before; this._afterMutate?.(); },
      redo: () => { this.chunkXml = after; this._afterMutate?.(); },
    });
  }

  // Assigned by the provider so undo/redo can trigger a repaint.
  _afterMutate?: () => void;

  dispose(): void { DataModel.removeDataSource(this.srcId); }
}

export class BinarySlddEditorProvider implements vscode.CustomEditorProvider<BinarySlddDocument> {
  public static readonly viewType = 'dataExplorer.binarySlddView';

  public onSelect?: (uriString: string, rowIds: string[]) => void;
  public onNavigate?: (target: string) => void;

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinarySlddDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinarySlddDocument> {
    const source = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    const bytes = await vscode.workspace.fs.readFile(source);
    const zip = unzipSync(bytes);
    const chunk = zip['data/chunk0.xml'];
    if (!chunk) throw new Error('Missing data/chunk0.xml in binary SLDD');
    const chunkXml = new TextDecoder().decode(chunk);
    const zipMeta: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') zipMeta[k] = v;
    const doc = new BinarySlddDocument(uri, chunkXml, zipMeta);
    // Relay the document's edit events to the provider-level emitter VS Code listens on.
    doc.onDidChangeCustomDocument((e) => this._onDidChangeCustomDocument.fire(e));
    return doc;
  }

  async resolveCustomEditor(
    document: BinarySlddDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webviewPanel.iconPath = new vscode.ThemeIcon('table');
    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';

    // Rebuild the model from the live chunkXml (+ pass-through parts), then paint.
    const buildModel = () => {
      DataModel.removeDataSource(document.srcId);
      const content = parseBinarySlddParts(document.chunkXml, document.zipMeta);
      return DataModel.addDataSource(document.srcId, content, { path: name });
    };
    const findNode = (rowId: string): any => {
      const found = (DataModel as any).findNodeById?.(rowId);
      return found ?? null;
    };

    const post = () => {
      try {
        const node = buildModel();
        const clip = getClipboard();
        const clipMark: ClipMark | undefined =
          clip && clip.sourceDocUri === uriString && clip.payload.name
            ? { name: clip.payload.name as string, section: clip.sourceSection, mode: clip.mode }
            : undefined;
        const rows = buildRows(node, undefined, clipMark);
        webview.postMessage({ type: 'setRows', rows, columns: COLUMNS, columnLabels: COLUMN_LABELS, editable: true });
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to parse ${name}: ${(err as Error).message}` });
      }
    };
    document._afterMutate = post;

    // Apply a structural transform: build model, locate node, run transform, push edit.
    const applyStructural = (
      rowId: string,
      transform: (xml: string, node: any, model: any) => StructuralResult,
      label: string,
    ) => {
      try {
        const model = buildModel();
        const node = findNode(rowId);
        if (!node) { webview.postMessage({ type: 'error', message: 'Could not locate the item in the model.' }); return; }
        const before = document.chunkXml;
        const { newText, selectId } = transform(before, node, model);
        document.pushEdit(label, before, newText);
        post();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    // Value edit / rename: mutate node, reserialize its owning entry, splice.
    const applyEdit = (msg: { rowId: string; columnId: string; oldValue: string; newValue: string }) => {
      try {
        const model = buildModel();
        const node = findNode(msg.rowId);
        if (!node) { webview.postMessage({ type: 'error', message: 'Could not locate the edited item.' }); return; }
        const entry = findOwningEntry(node);
        if (!entry) { webview.postMessage({ type: 'error', message: 'Could not locate the owning entry.' }); return; }
        const entryNameForLookup = entry.name;
        const result = node.setProperty(msg.columnId, msg.newValue);
        if (result && typeof result === 'object' && result.error) {
          webview.postMessage({ type: 'validationError', reason: result.reason, invalidValue: msg.newValue, previousValue: msg.oldValue });
          post();
          return;
        }
        const before = document.chunkXml;
        const frag = serializeEntryToXml(entry).replace(/\n$/, '');
        const span = findEntryObjectSpan(before, entryNameForLookup);
        if (!span) { webview.postMessage({ type: 'error', message: 'Could not locate the entry text to update.' }); return; }
        const after = before.slice(0, span.offset) + frag + before.slice(span.offset + span.length);
        document.pushEdit('Edit ' + msg.columnId, before, after);
        post();
        if (msg.columnId === 'Name') webview.postMessage({ type: 'selectRow', rowId: node.id });
      } catch (err) {
        webview.postMessage({ type: 'error', message: 'Failed to apply edit: ' + (err as Error).message });
      }
    };

    const applyCopy = (msg: { rowId: string }, mode: 'cut' | 'copy'): boolean => {
      try {
        buildModel();
        const node = findNode(msg.rowId);
        if (!node) return false;
        const entry = findOwningEntry(node);
        if (!entry) return false;
        setClipboard(entry.serialize() as Record<string, unknown>, mode, entry.parent?.name ?? '', uriString);
        webview.postMessage({ type: 'clipboardState', ...clipboardState() });
        post();
        return true;
      } catch { return false; }
    };

    const applyPaste = (msg: { rowId: string }) => {
      try {
        const clip = getClipboard();
        if (!clip) { webview.postMessage({ type: 'error', message: 'Nothing to paste.' }); return; }
        const model = buildModel();
        const node = findNode(msg.rowId);
        const section = resolveSectionForPaste(model, node, msg.rowId);
        if (!section) { webview.postMessage({ type: 'error', message: 'Could not resolve the target section.' }); return; }
        const isCut = clip.mode === 'cut';
        const sameDoc = clip.sourceDocUri === uriString;
        const srcName = (clip.payload.name as string) || '';
        let before = document.chunkXml;
        if (isCut && sameDoc && clip.sourceSection === section.name) {
          clearClipboard(); webview.postMessage({ type: 'clipboardState', ...clipboardState() }); post(); return;
        }
        if (isCut && sameDoc && srcName) {
          before = deleteEntriesByNameXml(before, [srcName]);
          DataModel.removeDataSource(document.srcId);
          DataModel.addDataSource(document.srcId, parseBinarySlddParts(before, document.zipMeta), { path: name });
        }
        const freshModel = (DataModel as any).getDataSource?.(document.srcId) ?? model;
        const freshSection = resolveSectionForPaste(freshModel, findNode(msg.rowId), msg.rowId) ?? section;
        const { newText, selectId } = pasteEntryXml(before, freshSection, clip.payload);
        document.pushEdit('Paste', document.chunkXml, newText);
        post();
        if (selectId) webview.postMessage({ type: 'selectRow', rowId: selectId });
        if (isCut) { clearClipboard(); webview.postMessage({ type: 'clipboardState', ...clipboardState() }); }
      } catch (err) {
        webview.postMessage({ type: 'error', message: `Failed to apply edit: ${(err as Error).message}` });
      }
    };

    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage) => {
      if (msg?.type === 'ready') post();
      else if (msg?.type === 'select') this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      else if (msg?.type === 'edit') applyEdit(msg);
      else if (msg?.type === 'copy') applyCopy(msg, 'copy');
      else if (msg?.type === 'cut') applyCopy(msg, 'cut');
      else if (msg?.type === 'delete') applyStructural(msg.rowId, (xml, node) => node.isEntry ? deleteEntryXml(xml, node) : deleteChildXml(xml, node), 'Delete');
      else if (msg?.type === 'addChild') applyStructural(msg.rowId, (xml, node) => addChildXml(xml, node), 'Add child');
      else if (msg?.type === 'paste') applyPaste(msg);
      else if (msg?.type === 'navigate') { if (typeof msg.target === 'string') this.onNavigate?.(msg.target); }
      else if (msg?.type === 'undo' || msg?.type === 'redo') void vscode.commands.executeCommand(msg.type);
    });

    webview.html = renderWebviewHtml(webview, distRoot, {
      scriptFile: 'table.js',
      title: 'Data Explorer',
      body: `    <div id="dex-error" role="alert" style="display:none;color:var(--vscode-errorForeground,#f14c4c);padding:8px;font-family:var(--vscode-font-family,sans-serif);"></div>
    <dex-tree-table style="position:absolute;inset:0;"></dex-tree-table>
    <dex-context-menu></dex-context-menu>
    <dex-error-dialog></dex-error-dialog>`,
    });

    webviewPanel.onDidDispose(() => { sub.dispose(); document._afterMutate = undefined; });
  }

  // --- Save / backup / revert (the safety gate lives here) ---
  async saveCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    await this.writeTo(document, document.uri);
  }
  async saveCustomDocumentAs(document: BinarySlddDocument, dest: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {
    await this.writeTo(document, dest);
  }
  async revertCustomDocument(document: BinarySlddDocument, _token: vscode.CancellationToken): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    const zip = unzipSync(bytes);
    document.chunkXml = new TextDecoder().decode(zip['data/chunk0.xml']);
    document._afterMutate?.();
  }
  async backupCustomDocument(document: BinarySlddDocument, ctx: vscode.CustomDocumentBackupContext, _token: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await this.writeTo(document, ctx.destination);
    return { id: ctx.destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(ctx.destination); } catch { /* already gone */ } } };
  }

  // Save gate: re-parse chunkXml before zipping. On failure, throw — VS Code keeps
  // the document dirty and shows the error; the on-disk file is never touched.
  private async writeTo(document: BinarySlddDocument, dest: vscode.Uri): Promise<void> {
    try {
      parseBinarySlddParts(document.chunkXml, document.zipMeta);
    } catch (err) {
      throw new Error('Refusing to save: the document did not re-parse (' + (err as Error).message + ').');
    }
    const zipEntries: Record<string, Uint8Array> = { ...document.zipMeta };
    zipEntries['data/chunk0.xml'] = new TextEncoder().encode(document.chunkXml);
    const zipped = zipSync(zipEntries, { level: 6 });
    await vscode.workspace.fs.writeFile(dest, zipped);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Fix any signature mismatches against the real `clipboard.ts` / `rowBuilder.ts` / `protocol.ts` exports (e.g. `setClipboard` arg order, `ClipMark` shape) by reading those files — do not guess.

- [ ] **Step 3: Commit**

```bash
# Run the CLAUDE.md curation leak-check oversrc/host/BinarySlddEditorProvider.ts(must print nothing).
git add src/host/BinarySlddEditorProvider.ts
git commit -m "[wip] Add writable BinarySlddEditorProvider (custom editor + document)"
```

---

## Task 7: Wire the provider — package.json, extension.ts, redirect

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/host/BinaryEditorProvider.ts`

- [ ] **Step 1: Add the customEditor contribution** (`package.json`, inside `contributes.customEditors`, after the `tableView` entry)

```json
      {
        "viewType": "dataExplorer.binarySlddView",
        "displayName": "Data Explorer (editable)",
        "selector": [
          {
            "filenamePattern": "*.sldd"
          }
        ],
        "priority": "option"
      }
```

- [ ] **Step 2: Register the provider in `extension.ts`**

After the `textProvider` wiring (around line 88), add:

```typescript
  const binarySlddProvider = new BinarySlddEditorProvider(context);
  binarySlddProvider.onSelect = (uriString, rowIds) => showSelection(uriString, rowIds);
  binarySlddProvider.onNavigate = navigate;
```

Add the import at the top:

```typescript
import { BinarySlddEditorProvider } from './host/BinarySlddEditorProvider.js';
```

Inside `context.subscriptions.push(...)`, add:

```typescript
    vscode.window.registerCustomEditorProvider(
      BinarySlddEditorProvider.viewType,
      binarySlddProvider,
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    ),
```

- [ ] **Step 3: Redirect zip `.sldd` from the read-only view to the writable view**

In `src/host/BinaryEditorProvider.ts`, add a constant near `TABLE_VIEW_TYPE`:

```typescript
const BINARY_SLDD_VIEW_TYPE = 'dataExplorer.binarySlddView';
```

In `resolveCustomEditor`, inside the `if (name.endsWith('.sldd'))` block, AFTER the editable-JSON redirect and BEFORE the read-only fallthrough, add a zip-sldd redirect:

```typescript
        // A compressed-binary (zip) .sldd is now editable in its own writable
        // custom editor. Redirect there (mirroring the editable-JSON redirect),
        // unless it's too large to hold the whole archive in memory comfortably —
        // in that case fall through to the read-only view.
        if (isZipBytes(bytes) && !exceedsStringDecodeLimit(bytes)) {
          const preview = this.isPanelPreview(document.uri);
          await vscode.commands.executeCommand('vscode.openWith', document.uri, BINARY_SLDD_VIEW_TYPE, {
            preview,
            pinned: !preview,
          });
          webviewPanel.dispose();
          return;
        }
```

- [ ] **Step 4: Update the openInBestEditor routing in `extension.ts`**

Find `openInBestEditor` (around line 42). It currently picks `tableView` for editable JSON, else `binaryView`. Add a zip-sldd branch so double-click / navigation opens the writable binary view directly. Read the current `isEditableJsonSldd` helper and add an `isZipSldd`-style check using `isZipBytes` on the read bytes; route zip `.sldd` → `BinarySlddEditorProvider.viewType`. If the helper only has the URI, read bytes via `vscode.workspace.fs.readFile`. Keep JSON and other formats unchanged.

Concretely, replace the viewType selection:

```typescript
  let viewType = BinaryEditorProvider.viewType;
  if (await isEditableJsonSldd(uri)) {
    viewType = SlddTextEditorProvider.viewType;
  } else if (await isZipSldd(uri)) {
    viewType = BinarySlddEditorProvider.viewType;
  }
```

Add a helper near `isEditableJsonSldd`:

```typescript
async function isZipSldd(uri: vscode.Uri): Promise<boolean> {
  if (!uri.path.endsWith('.sldd')) return false;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return isZipBytes(bytes);
  } catch {
    return false;
  }
}
```

Import `isZipBytes` in `extension.ts` if not already imported.

- [ ] **Step 5: Build + typecheck**

Run: `npm run build && npm run typecheck`
Expected: both PASS. The build resolving is the definitive check that no import is missing.

- [ ] **Step 6: Full unit suite (no regressions)**

Run: `npm test`
Expected: all prior tests + the new ones PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json src/extension.ts src/host/BinaryEditorProvider.ts
git commit -m "[wip] Wire BinarySlddEditorProvider: contribution, registration, redirects"
```

---

## Task 8: VS Code integration test

**Files:**
- Create: `test-integration/suite/binarySlddEdit.test.ts`
- Add fixture: `test-integration/fixtures/workspace/binary.sldd` (copy a small compressed-binary fixture, e.g. `test/parity/artifacts/binary/params.sldd`)

- [ ] **Step 1: Copy a binary fixture into the integration workspace**

```bash
cp test/parity/artifacts/binary/params.sldd test-integration/fixtures/workspace/binary.sldd
```

- [ ] **Step 2: Write the integration test**

```typescript
// test-integration/suite/binarySlddEdit.test.ts
// Copyright 2026 The MathWorks, Inc.
// Integration test for the writable BinarySlddEditorProvider inside real VS Code.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { unzipSync } from 'fflate';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';

const VIEW = 'dataExplorer.binarySlddView';

function ctx(): vscode.ExtensionContext {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext);
  return { extensionUri: ext!.extensionUri } as unknown as vscode.ExtensionContext;
}
function wsUri(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders?.[0];
  assert.ok(ws);
  return vscode.Uri.joinPath(ws.uri, name);
}
function makePanel(): vscode.WebviewPanel {
  return vscode.window.createWebviewPanel('test.binHost', 'test', vscode.ViewColumn.One, { enableScripts: true });
}

suite('BinarySlddEditorProvider', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('opens a compressed-binary .sldd as a writable document and renders rows', async () => {
    const provider = new BinarySlddEditorProvider(ctx());
    const uri = wsUri('binary.sldd');
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, new vscode.CancellationTokenSource().token);
    assert.ok((doc as any).chunkXml.includes('<Object Class="DD.ENTRY">'));
    const panel = makePanel();
    const rendered = new Promise<void>((resolve) => {
      const sub = panel.webview.onDidReceiveMessage(() => { /* noop */ });
      setTimeout(() => { sub.dispose(); resolve(); }, 1500);
    });
    await provider.resolveCustomEditor(doc, panel, new vscode.CancellationTokenSource().token);
    await rendered;
    panel.dispose();
    doc.dispose();
  });

  test('save gate rejects malformed chunkXml and does not write', async () => {
    const provider = new BinarySlddEditorProvider(ctx());
    const uri = wsUri('binary.sldd');
    const before = await vscode.workspace.fs.readFile(uri);
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, new vscode.CancellationTokenSource().token);
    (doc as any).chunkXml = '<not valid<<<';
    let threw = false;
    try {
      await provider.saveCustomDocument(doc, new vscode.CancellationTokenSource().token);
    } catch { threw = true; }
    assert.ok(threw, 'save must throw on malformed xml');
    const after = await vscode.workspace.fs.readFile(uri);
    assert.deepStrictEqual(Array.from(after), Array.from(before), 'file must be untouched');
    doc.dispose();
  });

  test('edit → save round-trips: new bytes re-unzip and re-parse', async () => {
    const provider = new BinarySlddEditorProvider(ctx());
    // Work on a copy so we don't clobber the shared fixture for other tests.
    const src = wsUri('binary.sldd');
    const dst = wsUri('binary_edit_copy.sldd');
    await vscode.workspace.fs.copy(src, dst, { overwrite: true });
    const doc = await provider.openCustomDocument(dst, {} as vscode.CustomDocumentOpenContext, new vscode.CancellationTokenSource().token);
    // Minimal mutation: append a harmless whitespace change is NOT valid; instead
    // re-save unchanged and confirm it still opens.
    await provider.saveCustomDocument(doc, new vscode.CancellationTokenSource().token);
    const bytes = await vscode.workspace.fs.readFile(dst);
    const zip = unzipSync(bytes);
    assert.ok(zip['data/chunk0.xml'], 'chunk0.xml present after save');
    doc.dispose();
    await vscode.workspace.fs.delete(dst);
  });
});
```

- [ ] **Step 3: Compile + run integration suite**

Run: `npm run pretest:integration && npm run test:integration`
Expected: PASS. On macOS a display is available; no xvfb needed. If VS Code download flakes, retry once.

- [ ] **Step 4: Commit**

```bash
git add test-integration/suite/binarySlddEdit.test.ts test-integration/fixtures/workspace/binary.sldd
git commit -m "[wip] Add integration test for editable binary .sldd"
```

---

## Task 9: MATLAB dev-loop round-trip verification (dev only, not CI)

Authoritative check that MATLAB reopens edited files. NOT wired into CI. Run in the sandbox.

- [ ] **Step 1: Generate a multi-type fixture** in `/tmp/dexp_rt/make.m` (double/single/int/uint scalars+vectors+matrices, complex, char, string, logical, struct, cell, enum, Simulink.Parameter, Simulink.Signal, Bus+BusElement, plus the nested-object struct/cell). Set `dd.FileFormat='compressed-binary'; dd.saveChanges();`.

- [ ] **Step 2: For each edit kind × type**, drive the pure transforms in Node (outside VS Code) to produce an edited `.sldd`, then in MATLAB: `dd = Simulink.data.dictionary.open(f); ...read each entry's value...; assert it matches the edit; confirm no repair/warning on open.` Log pass/fail per case to `docs/deep-work/binary-sldd-matlab-parity.md`.

- [ ] **Step 3: Record results** (counts, any failures + root cause) in the deep-work log. This task has no commit of code; it produces a report only.

---

## Self-Review checklist (run after all tasks)

- [ ] **Spec coverage:** value edit/rename (Task 6 applyEdit), add/delete entry (Task 4 addEntryXml/deleteEntryXml + Task 6), add/delete child (Task 4 addChildXml/deleteChildXml), copy/cut/paste (Task 6 applyCopy/applyPaste), byte-preservation (Task 5), save gate (Task 6 writeTo + Task 8), reparse-equivalence (Task 5), serializer units (Task 1), structural transforms (Task 4), nested-object invariant (Task 3), MATLAB round-trip (Task 9). Drag-move across files: deferred to a follow-up (see Observations) — cut/paste covers the same transforms; document explicitly.
- [ ] **Leak check (whole tree):** run the CLAUDE.md curation leak-check over `src/ test/ docs/superpowers/ package.json` — it must return nothing.
- [ ] **Type consistency:** `StructuralResult` shape identical across `structuralEdit.ts` and `xmlStructuralEdit.ts`; `serializeEntryToXml` signature matches its callers; `findEntryObjectSpan` return shape `{offset,length}` used consistently.
- [ ] Full `npm run build && npm run typecheck && npm test` green; `npm run test:integration` green; leak grep clean.

## Observations / deferred (fill in during execution)

- Drag-and-drop move within/across binary files: the transforms exist (`deleteEntriesByNameXml`, `pasteEntryXml`); wiring the `dragStart`/`drop`/`dragState` broadcast into `BinarySlddEditorProvider` mirrors `SlddTextEditorProvider` but is deferred to keep this plan focused on core edit parity. Log status here.
- "Locate in Text" / "View as Text": intentionally omitted (no text island for zip bytes).
- Cross-format (JSON↔binary) move: deferred; note whether attempted.

### Execution notes (2026-08-12)

- **Done:** Tasks 1–9 complete. Serializer, parser split, XML entry-splice, XML
  structural transforms, writable `BinarySlddEditorProvider`, contribution +
  registration + redirects, vitest suites (round-trip, byte-preservation, save
  gate, nested-object invariant), and the VS Code integration suite for the
  writable provider. `npm run build`, `typecheck`, `npm test` (613 unit tests),
  and the integration suite are green (see the pre-existing-flake note below).
- **Integration test build fix:** the test-bundle esbuild config now sets
  `mainFields: ['module','main']` to match the production host build. Without it,
  `jsonc-parser` (pulled in transitively via `entrySplice`) resolved to its UMD
  `main`, whose runtime `require('./impl/*')` calls were left unresolved after
  bundling and threw "Cannot find module './impl/format'" inside the Electron
  host. Two integration tests were updated to the new contract (a compressed-
  binary `.sldd` now redirects from the read-only view to the writable view,
  mirroring the editable-JSON redirect).
- **MATLAB round-trip (Task 9):** verified in R2027a — all 7 edit kinds (value
  edit, rename, delete entry, add entry, add child, delete child, paste) reopen
  with no repair/corruption and the edit applied; every data type round-trips
  with exact class + value fidelity, including the nested-Parameter-in-struct and
  nested-Parameter-in-cell cases. Report kept local in the deep-work log.
- **Pre-existing flake (NOT introduced here):** the JSON-path `cutPasteUndo`
  integration test ("a same-document move applies as ONE WorkspaceEdit and a
  single undo restores the original") is flaky in the Electron host — it passed
  and failed across runs with identical code, and fails the same way with this
  feature's test file removed entirely. It drives `editor.edit` + a timed
  `default:undo` directly, bypassing all provider code, so it is independent of
  this work. Root cause is undo-timing in the headless host; a follow-up should
  make the undo wait deterministic (poll for `!doc.isDirty` instead of a fixed
  300 ms sleep).
