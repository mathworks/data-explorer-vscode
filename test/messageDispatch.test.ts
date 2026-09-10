// Copyright 2026 The MathWorks, Inc.
//
// One table UI, three editors behind it, and the same fifteen messages dispatched three
// times.
//
// `TableToHostMessage` is the whole vocabulary the webview can speak. Every custom
// editor receives it through its own `webview.onDidReceiveMessage`, and each one answers
// with an `if / else if` chain of its own:
//
//   SlddTextEditorProvider    a JSON `.sldd`, editable, backed by a TextDocument
//   BinarySlddEditorProvider  a compressed-binary `.sldd`, editable, no text at all
//   BinaryEditorProvider      `.slx` / `.mdl` / `.mat` / `.prj`, read-only
//
// The first two are the SAME dictionary in two on-disk formats, which is exactly the
// shape of the recurring defect in this codebase: one rule, two paths, and the copies
// drift. A chain that omits a branch does not fail, warn, or log — the message arrives
// and nothing happens. So "paste works in a JSON dictionary and silently does nothing in
// a compressed one" is a complete, shipped bug whose only symptom is a user's report,
// and TypeScript cannot help: an `if / else if` chain has no exhaustiveness check, and
// omitting a branch is not a type error anywhere.
//
// This pins the three chains against the protocol union AND against each other, by
// capability rather than by snapshot. The tiers below say WHY a provider may skip a
// message; a provider that skips one for no reason in its tier fails, and — the part
// that matters for the next person — a message added to the protocol belongs to no tier
// and so fails the partition test until someone decides, per editor, what it means.
//
// The tier a provider sits in is read off the vscode interface it declares rather than
// listed here, so it cannot be quietly wrong: making the read-only viewer editable means
// changing `CustomReadonlyEditorProvider` to `CustomEditorProvider`, and that alone makes
// this file demand all eleven editing messages of it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndKeepLines } from './tools/moduleGraph.js';

const read = (p: string) => blankCommentsAndKeepLines(readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8'));

// ── the vocabulary ────────────────────────────────────────────────────────────────
// Taken from the union rather than restated, so the two cannot disagree. `UndoRedoMessage`
// is the reason this reads discriminants and not interface names: one interface carries
// two of them (`'undo' | 'redo'`), and it is the message TYPE a chain branches on.
const protocol = read('src/common/protocol.ts');

function discriminantsOf(unionName: string): string[] {
  const union = new RegExp(`export type ${unionName} =([\\s\\S]*?);`).exec(protocol);
  expect(union, `${unionName} is still declared in protocol.ts`).toBeTruthy();
  const members = [...union![1].matchAll(/\|\s*(\w+)/g)].map((m) => m[1]);
  const found = new Set<string>();
  for (const member of members) {
    const body = new RegExp(`export interface ${member} \\{([\\s\\S]*?)\\n\\}`).exec(protocol);
    expect(body, `${member} is still an interface in protocol.ts`).toBeTruthy();
    const field = /\btype:\s*([^;]+);/.exec(body![1]);
    expect(field, `${member} still declares a \`type\` discriminant`).toBeTruthy();
    for (const literal of field![1].matchAll(/'([^']+)'/g)) found.add(literal[1]);
  }
  return [...found];
}

const VOCABULARY = discriminantsOf('TableToHostMessage');

// ── the tiers ─────────────────────────────────────────────────────────────────────
// Every message a provider may legitimately skip is skippable for a REASON, and the
// reason is a property of the document behind it. These three sets must partition the
// vocabulary; the test below is what enforces that.

// True of any editor at all. A table you cannot select a row in, or navigate a link out
// of, is broken however read-only the file is — and `ready` is the handshake, without
// which the webview never receives its rows and the panel stays blank.
const ALWAYS = ['ready', 'select', 'navigate'];

// Everything that MUTATES the document. A read-only editor never receives these because
// the webview is told it is read-only and does not offer the gestures; an EDITABLE one
// has no excuse, and this is the list that had to be implemented twice — once against a
// TextDocument's edits, once against a re-zipped archive.
const EDITING = ['edit', 'delete', 'addChild', 'copy', 'cut', 'paste', 'drop', 'dragStart', 'dragEnd', 'undo', 'redo'];

// Reveal a range in the underlying text. Only meaningful for the one provider whose
// document IS text: there is no offset to jump to inside a zip, and no text editor to
// jump into. A binary editor that answered this would have to invent a location.
const TEXT_BACKED_ONLY = ['locateInText'];

// ── the providers ─────────────────────────────────────────────────────────────────
interface Provider {
  file: string;
  /** vscode interface it declares, which is what puts it in a tier. */
  contract: string;
  handled: Set<string>;
}

const PROVIDERS: Provider[] = [
  'src/host/SlddTextEditorProvider.ts',
  'src/host/BinarySlddEditorProvider.ts',
  'src/host/BinaryEditorProvider.ts',
].map((file) => {
  const source = read(file);
  const contract = /implements vscode\.(Custom\w*EditorProvider)/.exec(source);
  expect(contract, `${file} still declares which custom-editor contract it implements`).toBeTruthy();
  return {
    file: file.replace('src/host/', ''),
    contract: contract![1],
    handled: new Set([...source.matchAll(/msg\??\.type\s*===\s*'([^']+)'/g)].map((m) => m[1])),
  };
});

// `CustomReadonlyEditorProvider` is the vscode contract for a document that cannot be
// edited — the type itself has no `saveCustomDocument`. Anything else is editable.
const isEditable = (p: Provider) => p.contract !== 'CustomReadonlyEditorProvider';
// Only `CustomTextEditorProvider` is handed a `vscode.TextDocument`.
const isTextBacked = (p: Provider) => p.contract === 'CustomTextEditorProvider';

describe('the message vocabulary and the editors that speak it are both still here', () => {
  it('reads the union out of the protocol', () => {
    // A parse that quietly returned nothing would make every test below vacuous.
    expect(VOCABULARY.length).toBeGreaterThan(10);
    expect(VOCABULARY).toContain('undo');
    expect(VOCABULARY).toContain('redo');
  });

  it('finds all three dispatch chains, one per contract', () => {
    expect(PROVIDERS.map((p) => p.contract).sort()).toEqual([
      'CustomEditorProvider',
      'CustomReadonlyEditorProvider',
      'CustomTextEditorProvider',
    ]);
    for (const p of PROVIDERS) expect(p.handled.size, `${p.file} dispatches on message types`).toBeGreaterThan(2);
  });
});

describe('every message belongs to exactly one capability tier', () => {
  it('partitions the vocabulary, so a new message cannot slip in unclassified', () => {
    // This is the forcing function, and the only test here that a normal change is
    // expected to break. Add a sixteenth message to `TableToHostMessage` and it lands in
    // no tier, so this fails and the question "which of the three editors should answer
    // it, and why not the others?" has to be answered before the build is green. Without
    // it, a new message wired into the JSON editor alone looks finished.
    const tiered = [...ALWAYS, ...EDITING, ...TEXT_BACKED_ONLY];
    expect([...tiered].sort()).toEqual([...VOCABULARY].sort());
    expect(new Set(tiered).size, 'and no message is in two tiers').toBe(tiered.length);
  });
});

describe('each editor answers everything its contract makes meaningful', () => {
  for (const provider of PROVIDERS) {
    it(`${provider.file} answers the messages every editor must`, () => {
      const missing = ALWAYS.filter((t) => !provider.handled.has(t));
      expect(missing, `${provider.file} ignores ${missing.join(', ')}`).toEqual([]);
    });

    if (isEditable(provider)) {
      it(`${provider.file} is editable, so it answers every editing message`, () => {
        // The one that catches the real defect: a gesture that works in one `.sldd`
        // flavour and silently does nothing in the other, with no error to notice.
        const missing = EDITING.filter((t) => !provider.handled.has(t));
        expect(missing, `${provider.file} is a ${provider.contract} but ignores ${missing.join(', ')}`).toEqual([]);
      });
    } else {
      it(`${provider.file} is read-only, so it answers no editing message`, () => {
        // The other direction, and not symmetry for its own sake: a read-only editor
        // that half-handles `edit` would mutate a document vscode will never save, so the
        // change is lost at the next reload with no indication it was never real.
        const extra = EDITING.filter((t) => provider.handled.has(t));
        expect(extra, `${provider.file} is a ${provider.contract} but answers ${extra.join(', ')}`).toEqual([]);
      });
    }

    it(`${provider.file} answers locateInText only if it has text to locate in`, () => {
      expect(provider.handled.has('locateInText')).toBe(isTextBacked(provider));
    });

    it(`${provider.file} answers nothing outside the protocol`, () => {
      // A stale or mistyped branch is unreachable code that reads as a working feature.
      // tsc catches most of these on the union's discriminant, but only where the value
      // is actually typed as `TableToHostMessage` at the comparison.
      const unknown = [...provider.handled].filter((t) => !VOCABULARY.includes(t));
      expect(unknown).toEqual([]);
    });
  }
});
