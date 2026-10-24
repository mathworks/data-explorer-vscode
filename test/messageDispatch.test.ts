// Copyright 2026 The MathWorks, Inc.
//
// One table UI, four editors behind it, and the same sixteen messages dispatched four
// times.
//
// `TableToHostMessage` is the whole vocabulary the webview can speak. Every custom
// editor receives it through its own `webview.onDidReceiveMessage`, and each one answers
// with an `if / else if` chain of its own:
//
//   SlddTextEditorProvider    a JSON `.sldd`, editable, backed by a TextDocument
//   BinarySlddEditorProvider  a compressed-binary `.sldd`, editable, no text at all
//   MatEditorProvider         a `.mat`, editable, the document is core's tree
//   BinaryEditorProvider      `.slx` / `.mdl` / `.prj`, read-only
//
// BinaryEditorProvider serves TWO webviews, because `.prj` shows a main page instead of a
// table (see core's ProjectPage.ts): one dispatch chain, two vocabularies. So a provider's
// branches are checked against the union of the protocols it actually serves, and which
// ones those are is read off the shell builder it calls rather than listed here.
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
// this file demand all twelve editing messages of it.
//
// What a provider answers is its chain's branches AND the keys of its table of the messages
// every view answers alike (`const common: CommonHandlers = { … }`, dispatched by
// tableDispatch.dispatchCommon): a key of that table is a message type, by the interface's
// own definition, so the table says what it answers as plainly as a branch does. The two are
// read together, and held to never answering one message twice.
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
const PAGE_VOCABULARY = discriminantsOf('ProjectToHostMessage');

// ── the tiers ─────────────────────────────────────────────────────────────────────
// Every message a provider may legitimately skip is skippable for a REASON, and the
// reason is a property of the document behind it. These three sets must partition the
// vocabulary; the test below is what enforces that.

// True of any editor at all. A table you cannot select a row in, or navigate a link out
// of, is broken however read-only the file is — and `ready` is the handshake, without
// which the webview never receives its rows and the panel stays blank.
//
// `requestMatrix` is here and not in EDITING because the Variable Editor is READ-ONLY:
// the .mat/.slx viewer is in fact where most matrices are looked at. It is a question,
// not a mutation. An editor that ignores it ships a glyph on every matrix row whose
// panel opens empty and stays empty, with nothing logged — the exact failure mode this
// file exists for.
const ALWAYS = ['ready', 'select', 'navigate', 'requestMatrix'];

// Everything that MUTATES the document. A read-only editor never receives these because
// the webview is told it is read-only and does not offer the gestures; an EDITABLE one
// has no excuse, and this is the list that had to be implemented three times — against a
// TextDocument's edits, a re-zipped archive, and a MAT-file's tree. An editable view may
// still decline one, but it has to say so: a branch that answers, not a message that lands
// and does nothing.
const EDITING = [
  'edit',
  'delete',
  'addChild',
  'addEntry',
  'copy',
  'cut',
  'paste',
  'drop',
  'dragStart',
  'dragEnd',
  'undo',
  'redo',
];

// Reveal a range in the underlying text. Only meaningful for the one provider whose
// document IS text: there is no offset to jump to inside a zip, and no text editor to
// jump into. A binary editor that answered this would have to invent a location.
const TEXT_BACKED_ONLY = ['locateInText'];

// Fetch the children of a row whose payload held them back. Only meaningful for a
// provider that PLANS its rows to a budget (host: lazyRows.ts): one that delivered every
// row it has would stamp no `_lazy`, no twisty would ask, and a branch here would be
// unreachable. All three plan today — the rule is breadth over depth for every data
// source, not for the one format that provoked it — so this currently demands the answer
// of all three. Like `rendersPage`, membership is read off what the provider calls, so a
// provider that starts deferring rows owes the answer in the same edit, and one that
// stops deferring them has to drop it.
const DEFERS_ROWS_ONLY = ['requestChildren'];

// What only the project PAGE can say. Derived rather than listed, so a message added to
// `ProjectToHostMessage` lands here automatically and the per-provider test below starts
// demanding it of whoever renders the page. `ready` is in both protocols and stays in
// ALWAYS: it is the same handshake either way.
const PAGE_ONLY = PAGE_VOCABULARY.filter((t) => !VOCABULARY.includes(t));

// ── the providers ─────────────────────────────────────────────────────────────────
interface Provider {
  file: string;
  /** vscode interface it declares, which is what puts it in a tier. */
  contract: string;
  /** Whether it serves the non-table project page, and so speaks its protocol too. */
  rendersPage: boolean;
  /** Whether its payload is planned to a row budget, and so can defer a row's children. */
  defersRows: boolean;
  /** The message types its own chain branches on. */
  branches: Set<string>;
  /** The keys of its CommonHandlers table, or null where it has none (and dispatches them itself). */
  table: Set<string> | null;
  /** Whether its handler hands each message to that table first (`dispatchCommon(msg, common)`). */
  dispatchesTable: boolean;
  /** Everything it answers: its branches and its table's keys. */
  handled: Set<string>;
}

/**
 * The keys of the object literal, or interface body, that starts at `open` (a `{`): the
 * identifiers at its top level followed by `:` or `(`, optionally after `?` (a property or a
 * method, required or not), read by brace matching. Comments are blanked by `read`, and strings in
 * the handlers hold no unbalanced brace.
 */
function literalKeys(source: string, open: number): Set<string> {
  const keys = new Set<string>();
  let depth = 0;
  let expectKey = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{' || c === '(' || c === '[') {
      depth++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      if (--depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (c === ',' || c === ';') {
      expectKey = true;
      continue;
    }
    if (expectKey && /[A-Za-z_$]/.test(c)) {
      const key = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))![0];
      const after = source.slice(i + key.length).trimStart().replace(/^\?/, '')[0];
      if (after === ':' || after === '(') keys.add(key);
      expectKey = false;
      i += key.length - 1;
      continue;
    }
    if (!/\s/.test(c)) expectKey = false;
  }
  return keys;
}

/** The keys of a provider's `const common: CommonHandlers = { … }`, or null where it has none. */
function tableOf(source: string): Set<string> | null {
  const at = /const common: CommonHandlers = \{/.exec(source);
  return at ? literalKeys(source, at.index + at[0].length - 1) : null;
}

const PROVIDERS: Provider[] = [
  'src/host/SlddTextEditorProvider.ts',
  'src/host/BinarySlddEditorProvider.ts',
  'src/host/MatEditorProvider.ts',
  'src/host/BinaryEditorProvider.ts',
].map((file) => {
  const source = read(file);
  const contract = /implements vscode\.(Custom\w*EditorProvider)/.exec(source);
  expect(contract, `${file} still declares which custom-editor contract it implements`).toBeTruthy();
  return {
    file: file.replace('src/host/', ''),
    contract: contract![1],
    // Read off the shell it builds, not listed: a provider that stopped rendering the page
    // would stop being asked for the page's messages, in one edit.
    rendersPage: /renderProjectWebview\(/.test(source),
    // Read off the builder it calls, for the same reason: a planner is what stamps
    // `_lazy`, so taking one IS what makes the fetch askable of this provider. The
    // planner is also the object that OWNS both halves (rowPlanner.ts), so the thing
    // this regex finds is the thing that guarantees the fetch is answered by the same
    // rule the payload was built with — the branch it replaced named one builder, and
    // was true of exactly the one format that had been planned so far.
    defersRows: /rowPlannerFor\(/.test(source),
    ...answered(source),
  };
});

function answered(source: string): Pick<Provider, 'branches' | 'table' | 'dispatchesTable' | 'handled'> {
  const branches = new Set([...source.matchAll(/msg\??\.type\s*===\s*'([^']+)'/g)].map((m) => m[1]));
  const table = tableOf(source);
  return {
    branches,
    table,
    dispatchesTable: /dispatchCommon\(msg, common\)/.test(source),
    handled: new Set([...branches, ...(table ?? [])]),
  };
}

// The helper every table provider hands the shared messages to, and the type of its table.
const DISPATCH = read('src/host/tableDispatch.ts');
const TABLE_KEYS = (() => {
  const at = /export interface CommonHandlers \{/.exec(DISPATCH);
  expect(at, 'tableDispatch.ts still declares CommonHandlers').toBeTruthy();
  return literalKeys(DISPATCH, at!.index + at![0].length - 1);
})();

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

  it('reads the shared table: its keys are message types, and the helper dispatches each', () => {
    // A key that is not a message type would be a handler no message can reach, and a key the
    // helper has no case for would be read here as answered while nothing answers it.
    expect([...TABLE_KEYS].sort()).toEqual(['navigate', 'ready', 'redo', 'requestChildren', 'requestMatrix', 'select', 'undo']);
    for (const key of TABLE_KEYS) {
      expect(VOCABULARY, `${key} is a message type`).toContain(key);
      expect(DISPATCH, `dispatchCommon has a case for ${key}`).toMatch(new RegExp(`case '${key}':`));
    }
  });

  it('finds every provider handing the shared messages to its table, and answering none twice', () => {
    const tabled = PROVIDERS.filter((p) => p.table);
    // Every table provider: none spells the shared messages out in a chain of its own any more.
    expect(tabled.map((p) => p.file).sort()).toEqual([
      'BinaryEditorProvider.ts',
      'BinarySlddEditorProvider.ts',
      'MatEditorProvider.ts',
      'SlddTextEditorProvider.ts',
    ]);
    for (const p of tabled) {
      expect(p.dispatchesTable, `${p.file} hands each message to its table`).toBe(true);
      const twice = [...p.table!].filter((t) => p.branches.has(t));
      expect(twice, `${p.file} answers ${twice.join(', ')} in its table and its chain`).toEqual([]);
    }
  });

  it('finds all four dispatch chains, and every contract among them', () => {
    expect(PROVIDERS.map((p) => p.contract).sort()).toEqual([
      'CustomEditorProvider',
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
    const tiered = [...ALWAYS, ...EDITING, ...TEXT_BACKED_ONLY, ...DEFERS_ROWS_ONLY];
    expect([...tiered].sort()).toEqual([...VOCABULARY].sort());
    expect(new Set(tiered).size, 'and no message is in two tiers').toBe(tiered.length);
  });

  it('partitions the project page\'s protocol too', () => {
    // The same forcing function for the second webview. A message the page can send that
    // is neither shared with the table nor page-only is a message nobody decided about.
    expect([...PAGE_VOCABULARY].sort()).toEqual(
      [...ALWAYS.filter((t) => PAGE_VOCABULARY.includes(t)), ...PAGE_ONLY].sort(),
    );
    expect(PAGE_ONLY.length, 'and the page says something of its own').toBeGreaterThan(0);
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

    it(`${provider.file} answers requestChildren only if its payload defers rows`, () => {
      // Both directions, and the forward one is the failure this is really about: a
      // payload that holds rows back while nobody answers the fetch is a tree that stops
      // opening at a certain depth, silently, with the rest of the file unreachable —
      // the bug the budget was introduced to fix, reintroduced one level down.
      for (const t of DEFERS_ROWS_ONLY) {
        expect(provider.handled.has(t), `${provider.file} ${provider.defersRows ? 'ignores' : 'answers'} ${t}`).toBe(
          provider.defersRows,
        );
      }
    });

    it(`${provider.file} answers the page's own messages only if it renders the page`, () => {
      // Both directions. A provider that renders the page and ignores `openFile` ships
      // links that do nothing when clicked — the page's whole point. One that answers it
      // without rendering a page has a branch no webview can ever reach.
      const missing = PAGE_ONLY.filter((t) => !provider.handled.has(t));
      expect(missing.length === 0, `${provider.file} ignores ${missing.join(', ')}`).toBe(
        provider.rendersPage,
      );
    });

    it(`${provider.file} answers nothing outside the protocol`, () => {
      // A stale or mistyped branch is unreachable code that reads as a working feature.
      // tsc catches most of these on the union's discriminant, but only where the value
      // is actually typed as `TableToHostMessage` at the comparison.
      const spoken = provider.rendersPage ? [...VOCABULARY, ...PAGE_VOCABULARY] : VOCABULARY;
      const unknown = [...provider.handled].filter((t) => !spoken.includes(t));
      expect(unknown).toEqual([]);
    });
  }
});

describe('every setRows says which document it is describing', () => {
  // The webview answers a link into its own document itself (webview/linkRoute.ts), which
  // it can only do if it knows which document that is. `webview.postMessage` takes `any`,
  // so omitting the field at one of these call sites is not a type error, and the symptom
  // is silent: that one view's local links take the host round-trip instead. Three posts
  // across three providers is exactly the shape this file exists for.
  //
  // Found by brace-matching the payload LITERAL rather than by a regex over the call, and
  // that distinction has already earned itself: the posts now go through `postOrReport`
  // (see postPayload.ts), which put the object one argument deeper and made a
  // `postMessage({ type: 'setRows' …})` pattern match nothing at all — three vacuous
  // passes dressed as three green tests, if the loop below had not also demanded that the
  // scan find something. What this file is about is the payload's FIELDS, so it reads the
  // literal wherever it sits and does not care who it is handed to.
  const payloadsOf = (src: string): string[] => {
    const out: string[] = [];
    for (const m of src.matchAll(/type: 'setRows'/g)) {
      const open = src.lastIndexOf('{', m.index!);
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          out.push(src.slice(open, i + 1));
          break;
        }
      }
    }
    return out;
  };
  const posts = PROVIDERS.map((p) => ({ file: p.file, bodies: payloadsOf(read(`src/host/${p.file}`)) }));

  it('finds all four posts, so none of them is missed below', () => {
    // A regex that matched nothing would make the loop vacuous.
    expect(posts.reduce((n, p) => n + p.bodies.length, 0)).toBe(4);
  });

  for (const { file, bodies } of posts) {
    it(`${file} sets docUri on each of its ${bodies.length} setRows posts`, () => {
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(body).toContain('docUri');
    });
  }
});

describe('every setProject says where the project is', () => {
  // The same hole, on the page's payload. `root` is the project folder's path, and the page
  // cannot derive it: a project store records nothing absolute, by design. Omit it and the
  // page renders `undefined` under the project's name, which no type will catch because
  // `webview.postMessage` takes `any`.
  const bodies = PROVIDERS.flatMap((p) =>
    [...read(`src/host/${p.file}`).matchAll(/postMessage\(\{\s*type: 'setProject'([\s\S]*?)\}\)/g)].map(
      (m) => ({ file: p.file, body: m[1] }),
    ),
  );

  it('finds the post, so the assertion below is not vacuous', () => {
    expect(bodies.length).toBeGreaterThan(0);
  });

  for (const { file, body } of bodies) {
    it(`${file} sets page and root on its setProject post`, () => {
      expect(body).toContain('page:');
      expect(body).toContain('root:');
    });
  }
});
