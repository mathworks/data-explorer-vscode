# Editable compressed-binary `.sldd` — Design

**Date:** 2026-08-12
**Status:** Approved (design), pending implementation plan
**Scope:** Add table-based editing for compressed-binary (zip/XML) Simulink Data
Dictionary files, at parity with the existing editable JSON `.sldd` table view.

---

## 1. Background & motivation

Today the extension edits **only** JSON (`uncompressed-text`) `.sldd` files. Those
open in `SlddTextEditorProvider`, a `CustomTextEditorProvider` backed by a native
VS Code `TextDocument`; editing is done by **byte-scoped splices** on that text so
untouched entries stay byte-identical, and VS Code provides undo/redo/dirty/save
for free.

Compressed-binary `.sldd` files (`FileFormat = 'compressed-binary'`) currently open
**read-only** in `BinaryEditorProvider`, because they are zip archives (NUL bytes)
that VS Code refuses to open as a `TextDocument`.

A compressed-binary `.sldd` is an **OPC/zip package** whose only meaningful editable
payload is the text part `data/chunk0.xml`, in which every dictionary entry is a
self-contained `<Object Class="DD.ENTRY">…</Object>` XML fragment. This is the
**same class of problem** as JSON `.sldd` — structured text edited by byte-scoped
splice — just XML-in-a-zip instead of JSON-on-disk. Therefore the editing risk is
the same level as JSON `.sldd`, and the same design discipline applies.

### Empirically verified before design (MATLAB R2027a)

- A compressed-binary `.sldd` is a standard OPC package: `[Content_Types].xml`,
  `_rels/.rels`, `data/chunk0.xml`, and four `metadata/*.xml` parts.
- Each entry is `<Object Class="DD.ENTRY">` with `<P>` properties; object-valued
  entries (`Simulink.Parameter`, `Simulink.Signal`, Bus, …) nest deep
  `<Element>/<P>` sub-trees. A trailing `<Object Class="DD.Dictionary">` always
  follows the entries.
- **Round-trip proven:** unzip → edit one value in `chunk0.xml` → re-zip with
  **fflate `zipSync`** (the library the extension already bundles) → MATLAB reopens
  the file, reads the edited value correctly, and preserves `FileFormat`.

## 2. Goals & non-goals

**Goals**
- Full parity with the JSON `.sldd` table view: value edits, rename, add/delete
  entries, add/delete nested children (struct fields, bus elements), copy/cut/
  paste, and drag-move (within a file and across files).
- Serialization that MATLAB/Simulink reopens correctly. **We must not break the
  user's file.**
- Same risk profile as the existing JSON `.sldd` editor — no higher.

**Non-goals (this version)**
- Editing `.slx`, `.mat`, or `.prj` (a future `.mat` editor can reuse this
  editor's binary edit-stack plumbing — see §3.1).
- A "View as Text" tab for binary `.sldd` (cannot open zip bytes as a
  `TextDocument`); "Locate in Text" is likewise dropped for this format.
- Auto-rewriting cross-entry *references* on rename (semantic, not byte-level; see
  §6).
- Re-sorting entries or normalizing whitespace/indentation.

## 3. Architecture

### 3.1 Editor: a new writable custom editor

Add **`BinarySlddEditorProvider implements vscode.CustomEditorProvider`** (writable),
registered under a new viewType (e.g. `dataExplorer.binarySlddView`), handling
compressed-binary `.sldd` only.

- `BinaryEditorProvider` stays **read-only** for `.slx` / `.mat` / `.prj`.
- Its existing byte-inspection routing gains one branch: a zip `.sldd` →
  `vscode.openWith` the new writable viewType, then dispose itself — the same
  redirect pattern it already uses to send editable-JSON `.sldd` to the table view.

**Why a writable `CustomEditorProvider` (not a shadow `TextDocument`, not a temp
file):** it is VS Code's blessed mechanism for editing binary/custom files, gives
native undo/redo/dirty/save/hot-exit on one self-contained tab, and is the **only**
approach that generalizes to a future pure-binary `.mat` editor (a `.mat` has no
text island to shadow). Customer-visible behavior is identical to what a shadow
document would provide.

**`BinarySlddDocument` (in-memory edit model):**
- `zipEntries: Record<string, Uint8Array>` — the full archive; pass-through parts
  kept verbatim.
- `chunkXml: string` — the live, mutable `data/chunk0.xml`. **This is the single
  edit surface.** All edits are string transforms on it.
- An undo/redo stack of `chunkXml` snapshots (label + before/after).

**Native VS Code integration:**
- Each edit fires `onDidChangeCustomDocument({ undo, redo })` → VS Code drives
  dirty state and Cmd+Z / Cmd+Shift+Z.
- `saveCustomDocument()` → set `zipEntries['data/chunk0.xml'] = encode(chunkXml)`,
  `zipSync`, write via `workspace.fs.writeFile` (only after the save gate, §5).
- `saveCustomDocumentAs()`, `revertCustomDocument()` (re-read disk),
  `backupCustomDocument()` (hot-exit; same save gate before writing backup).

**Webview:** reuses the existing table webview (`table.js`) with `editable: true`
and the existing table↔host message protocol (`edit`, `delete`, `addChild`, `cut`,
`copy`, `paste`, `dragStart`/`drop`, `undo`, `redo`). Host handlers are new but
structurally parallel to `SlddTextEditorProvider`. "Locate in Text" is omitted
(no text tab for zip bytes).

### 3.2 Edit mechanism: entry-level granularity

**Principle.** Every structural edit regenerates the **whole touched entry's**
`<Object Class="DD.ENTRY">…</Object>` fragment from the model, then splices that one
fragment into the original `chunkXml`. Untouched sibling entries stay
**byte-for-byte identical**.

This is the exact analog of the JSON path's `reserializeEntry` (which stringifies
the *whole* entry and splices its span) — so binary `.sldd` inherits the **same risk
profile as JSON `.sldd`**, no more. It is also strictly safer than the upstream
data explorer product, which rebuilds the **entire** `chunk0.xml` (all entries) on
every save; we blast-radius the regeneration to only the touched entries.

**Why entry-level, not sub-entry splice.** Regenerating only a changed `<P>`/
`<Element>` sub-tree is unsafe because edits have intra-entry ripple effects the
model already accounts for but a local text splice would miss. Example: **adding a
`BusElement` also changes the owning `Bus` entry's `Dimension` attribute** (and
element ordering). Regenerating the whole entry from the model emits a consistent
fragment; a sub-entry splice would leave a stale `Dimension` — silent corruption.

**No edit forces a full-file serialization.** Each `<Object>` is self-contained in
`chunk0.xml`; there are no cross-entry byte dependencies (no offset tables, no
interleaving, no whole-package digest — `zipSync` recomputes per-entry CRCs, and OPC
has no cross-part checksum). Blast radius per edit:

| Edit | Blast radius |
|---|---|
| Value edit / rename | the 1 touched entry fragment |
| Add / delete entry | insert/remove 1 fragment (before trailing `DD.Dictionary`) |
| Add / delete nested child (struct field, bus element) | the 1 **owning entry** fragment |
| Multi-delete, cut/paste, drag-move | the N touched entry fragments, each spliced independently |
| Toggle `AllowAccessBWS` / edit sub-dictionary reference | the single non-entry `<Object>` (DD.Dictionary / DD.DICTIONARYREFERENCE) |

### 3.3 New host modules (mirroring the JSON pair)

**`xmlEntrySplice.ts`** — pure, offset-aware *location* of spans in the XML string
(no value parsing), the XML analog of `entrySplice.ts`:
- `findEntryObjectSpan(xml, entryName)` → byte span of the entry's `<Object>…
  </Object>`, matched via its own `<P Name="Name" Class="char">NAME</P>` (depth-aware
  scan; `<Element>` sub-trees nest, entries do not).
- `findEntryElementSpan(xml, entryName)` → span plus surrounding whitespace for a
  clean delete.
- `findEntryInsertionPoint(xml)` → offset just before the trailing
  `<Object Class="DD.Dictionary">` where new entries are inserted.

**`xmlStructuralEdit.ts`** — pure text transforms, parallel to `structuralEdit.ts`:
- `reserializeEntryXml(entryNode)` — preserves the entry's `_rawLastMod` (no forced
  date bump), matching the JSON path (which never re-stamps `LastMod`) and keeping
  serializer output deterministic for tests. MATLAB re-stamps `LastMod` itself the
  next time the entry is edited there.
- `deleteEntryXml`, `addEntryXml`, `pasteEntryXml`, `addChildXml`/`deleteChildXml`
  (these regenerate the **owning entry** — the Bus/Dimension case), and
  `deleteEntriesByNameXml` for multi/move.
- Non-entry `<Object>` handling for `AllowAccessBWS` and sub-dictionary references
  at their own granularity.

### 3.4 Serializer reuse (mostly already vendored)

The per-node model→XML serializer is **already present in `src/dex/`** and needs no
porting: `DataNode.serializeXml`, the `_serialize*Xml` statics, every node
`_getSerializedProperties`/`serializeXml` override (Parameter, Signal, Struct, Bus,
Enum, Alias, Numeric/Value types, ConfigSet, Variant*, LookupTable, Breakpoint,
CustomObject, MatlabVariable, …), and `XmlUtils`. `SlddNode` already carries the
`_zipMetadata`, `_dataSourceAttrs`, and `allowAccessBWS` fields the serializer reads.

Only the **top-level entry point** is missing and must be added to `src/dex/` (from
the upstream product, genericized):
- `serializeBinarySldd(slddNode)` / `buildDataChunkXml` — whole-file serialize +
  re-zip. We use `buildDataChunkXml` for the save-gate re-parse comparison, not for
  routine per-edit writes.
- `serializeEntryToXml(entryNode)` — the per-entry fragment builder, which is the
  reuse target for entry-level splice. Our only difference from upstream is **blast
  radius**: we call `serializeEntryToXml` for the touched entry and splice it, rather
  than rebuilding all entries.

Additionally, `BinarySlddParser` gains an exported `parseBinarySlddParts(chunkXml,
zipMetadata)` so the editor can rebuild the model from the live `chunkXml` without a
re-zip/re-unzip round-trip on every edit. All added comments/codenames are
genericized per the repo curation rules before commit.

## 4. Data flow

1. Open zip `.sldd` → `BinarySlddEditorProvider` parses the archive into
   `zipEntries` + `chunkXml`; builds the model via `parseBinarySldd`; renders the
   editable table.
2. Table action → host handler locates the node, runs the pure transform
   (`xmlStructuralEdit`) producing a new `chunkXml`, updates the document, fires
   `onDidChangeCustomDocument`, repaints.
3. Undo/redo → VS Code invokes the stack entry's `undo`/`redo`, restoring the
   prior/next `chunkXml`; repaint.
4. Save → **save gate (§5)** → `zipSync` → `workspace.fs.writeFile`.

## 5. Error handling & safety

**Overriding rule: never write a file we cannot prove is well-formed. Any failure
leaves the on-disk `.sldd` untouched.**

- **Parse/open failure** (missing `data/chunk0.xml`, corrupt zip, malformed XML) →
  read-only error banner; editor never enters an editable state it can't serialize.
- **Edit-time guard**: entry not locatable or transform throws → post error,
  discard the edit, repaint from last-good `chunkXml`. Validation errors reuse the
  existing `validationError` webview flow and revert the cell.
- **Save gate (core safety net)**: after building the new `chunkXml`, **re-parse it
  with `BinarySlddParser` before zipping.** If it does not parse, abort the save,
  keep the document dirty, surface an error. This is the analog of the JSON path's
  `ensureValidJson()` — a serializer bug becomes a *failed save*, never a *corrupted
  file*. `backupCustomDocument` applies the same gate.
- **External change**: disk changes while dirty → VS Code's standard dirty-vs-
  external prompt; if not dirty, revert to disk (matches today's watcher refresh).
- **Concurrent views**: read-only and editable views of the same `.sldd` coexist;
  the read-only view refreshes from disk on save via its existing watcher.
- **Cross-file move**: the source file's removal is its own save/edit. A binary
  source is a second writable-document edit; a not-open source is opened, edited,
  re-zipped. Mixed JSON↔binary moves are a specific test case (shared payload shape,
  different serializers).

## 6. Known behaviors (documented, not silently assumed)

- **Cross-entry references are semantic, not byte-level.** Renaming a type entry
  (e.g. `MyBus`) does not rewrite referrers (`DataType="Bus: MyBus"`). MATLAB does
  not auto-rewrite these on a raw DD rename either; we match that behavior.
- **Within a touched entry**, properties the user did not edit still pass through
  the model serializer, so a serializer bug could drift them — identical to the JSON
  path's existing behavior, and the reason for the per-type × per-edit round-trip
  test matrix (§7).

## 7. Testing strategy

**A. Committed tests (vitest, no MATLAB — run in CI on every change)**
1. **Byte-preservation** (core safety property): parse fixture → edit one entry →
   re-zip → re-unzip; assert every **untouched** entry fragment and all pass-through
   parts (`[Content_Types].xml`, `_rels/.rels`, `metadata/*`) are byte-identical.
2. **Reparse-equivalence**: edited archive reparses; touched entry reflects the
   edit, everything else unchanged.
3. **Serializer unit tests** per type: `double`/`single`/typed-int scalars, vectors,
   matrices (column-major transpose), complex, `char`, `string`, `logical`, struct,
   cell, enum, and objects (Parameter, Signal, Bus + BusElement incl. the
   Dimension-update case). Assert exact XML text. Includes the **nested-object case**
   — a struct field / cell element holding a `Simulink.Parameter` — which is the
   splice boundary's worst case.
   - **Confirmed invariant (verified in MATLAB R2027a):** an object nested inside a
     struct field or cell element serializes as `<Element Class="Simulink.Parameter">`,
     NOT as a nested `<Object>`. `<Object>` appears only at top level (`DD.ENTRY`,
     `DD.Dictionary`, `DD.DICTIONARYREFERENCE`). Therefore an entry's
     `<Object Class="DD.ENTRY">…</Object>` fragment never contains a nested `<Object>`,
     and the string-scan span location (the same scan `extractEntryFragments` already
     uses) is safe. `xmlEntrySplice` tests assert this on the nested fixture.
4. **Structural transforms**: `deleteEntryXml`, `addEntryXml`, `pasteEntryXml`,
   `add/deleteChildXml`, `deleteEntriesByNameXml`; assert spliced XML and
   insertion-before-`DD.Dictionary` placement.
5. **Save gate**: a deliberately-broken serialize output fails the re-parse gate and
   does **not** write.

Fixtures are **committed static binary `.sldd` bytes**, generated once by a
documented MATLAB script (reproducible by anyone with MATLAB).

**B. Dev-loop verification (MATLAB — authoritative, not wired into CI)**
- A parity-style harness: for **every data type × every edit kind**, `parse → edit →
  re-zip → reopen in MATLAB → assert value/structure survived and the file opens
  with no repair/warning`. Run during development and before release. CI has no
  MATLAB, so this is not a CI gate.

**C. Integration test (VS Code `test:integration`)**
- Open binary `.sldd` → edit a cell → dirty dot → save → reopen → edit persisted;
  undo/redo. Exercises the writable-custom-editor plumbing.

## 8. Files (anticipated)

**New**
- `src/host/BinarySlddEditorProvider.ts` — writable custom editor + document.
- `src/host/xmlEntrySplice.ts` — offset-aware XML span location.
- `src/host/xmlStructuralEdit.ts` — pure XML structural transforms.
- Ported serializer + `XmlUtils` under `src/dex/datamodel/parser/` and node
  `serializeXml` overrides under `src/dex/datamodel/node/**`.
- Tests under `test/` and a MATLAB fixture generator + parity harness under
  `test/parity/`.

**Modified**
- `src/extension.ts` — register the new provider.
- `src/host/BinaryEditorProvider.ts` — redirect zip `.sldd` to the writable view.
- `package.json` — new `customEditors` entry for the binary `.sldd` view.

## 9. Curation / leak note

This repo is a curated public snapshot. Ported code and comments must be genericized
(no internal codenames, hosts, or paths) and the leak grep must pass before commit.
