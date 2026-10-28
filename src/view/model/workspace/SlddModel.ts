// Copyright 2026 The MathWorks, Inc.
import { DataModel, createSession, isMatFile, isModelFile, type ParseWarning } from 'data-explorer-core';
import { readSlddContent } from './slddContent.js';
import { refuseIfUnreadable, sourceWarnings } from '../rows/parseWarnings.js';

const cache = new Map<string, any>(); // uriString -> SlddNode

// Every source this module registers passes through here, which is the point: the
// "a source the reader could not read is not passed on as an empty one" rule has to
// hold for a model and a project exactly as it does for a dictionary, and the four
// adders above reach it by four different routes. `.sldd` is refused twice over —
// once inside readSlddContent, on the parser's own sink, and once here on whatever
// the node layer added — which costs a find over a list that is empty in the normal
// case and removes the chance of a format being wired to only one of the two.
//
// A refused source is DE-REGISTERED first. Core attaches the warnings to a node it
// has already put in the session, so throwing while it is still there would leave
// the session holding a tree the provider then reports as failed-to-parse: the
// Property Inspector would resolve selections into it, and re-opening the file would
// hit `deindexSource` on a tree nothing else references.
function registered(srcId: string, node: any): any {
  const warnings = sourceWarnings(node);
  try {
    refuseIfUnreadable(warnings);
  } catch (err) {
    DataModel.removeDataSource(srcId);
    throw err;
  }
  return node;
}

/**
 * A tree of a dictionary's text that nothing else can see: built in a session of its own, so it
 * is not registered under any uri, not cached here, and not found by the Property Inspector or
 * an edit. For a reading that is only ever compared against — the baseline of a document opened
 * with unsaved changes is the FILE's text, while the document holds other text under the uri.
 */
export function parseDetached(name: string, text: string): any {
  return createSession().addDataSource(`detached:${name}`, JSON.parse(text), { path: name });
}

export function getModel(uriString: string, name: string, text: string): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const content = JSON.parse(text);
  // Use a per-URI srcId so multiple open .sldd don't collide in DataModel.
  const node = registered(uriString, DataModel.addDataSource(uriString, content, { path: name }));
  cache.set(uriString, node);
  return node;
}

// Byte-backed formats (.slx, .mdl, .mat, compressed .sldd) parsed from bytes.
export function getModelFromBytes(uriString: string, name: string, bytes: ArrayBuffer): any {
  const cached = cache.get(uriString);
  if (cached) return cached;

  let node: any;
  // Both model containers go to the same adder. A `.mdl` is not necessarily binary
  // — both of its flavours are text — but it arrives here as bytes like the rest,
  // and core's addModelSource sniffs the actual format rather than trusting the
  // extension.
  if (isModelFile(name)) {
    node = DataModel.addModelSource(uriString, bytes, { path: name });
  } else if (isMatFile(name)) {
    node = DataModel.addMatSource(uriString, bytes, { path: name });
  } else {
    // .sldd — compressed (zip) vs JSON-as-bytes; readSlddContent dispatches. The
    // sink is threaded through both halves of the read so the dictionary's warnings
    // arrive as ONE list on the node: the zip parser fills it, then SlddNode.parse
    // appends to the same array. Passing nothing here would silently drop every
    // binary-part warning, since the node layer would start a fresh list.
    const warnings: ParseWarning[] = [];
    const content = readSlddContent(bytes, warnings);
    node = DataModel.addDataSource(uriString, content, { path: name }, warnings);
  }
  node = registered(uriString, node);
  cache.set(uriString, node);
  return node;
}

/**
 * A model whose bytes someone already parsed — the same session entry `getModelFromBytes`
 * makes for one, one `parseModel` earlier.
 *
 * This is the tab's half of the shared parse (sourceCache.ts): the Usage tier may already hold
 * the parse of this very model, because opening its linked dictionary had to summarise it, and
 * re-deriving it here is the duplicate work that made a model open cost two full parses of the
 * same bytes.
 *
 * Everything else about the registration is deliberately identical, `registered()` included:
 * core's `addModelSourceParsed` is `addModelSource` with the parse lifted out, it forwards
 * `parsed.warnings` the same way, and `ModelNode.fromParsed` labels the tree from the srcId
 * rather than from anything in `parsed`. So a model that read short is refused here exactly as
 * it is there — which is the invariant parsedRegistration.test.ts pins between the two.
 */
export function getModelFromParsed(uriString: string, name: string, parsed: unknown): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const node = registered(uriString, DataModel.addModelSourceParsed(uriString, parsed, { path: name }));
  cache.set(uriString, node);
  return node;
}

/** Where a read-only binary tab gets what it registers. Both are vscode reads; neither is made
 *  unless the branch below picks it. */
export interface TabSources {
  /** The SHARED parse of a model, for a model only — sourceReads.parsedModelForTab. */
  parsed: () => Promise<unknown>;
  /** The file's bytes from disk, for every other byte-backed format. */
  bytes: () => Promise<ArrayBuffer>;
}

/**
 * The tree a read-only binary tab shows, by the route its FORMAT takes: a model through the
 * shared parse, everything else through its bytes.
 *
 * A named function rather than a ternary inside `BinaryEditorProvider.post`, and the reason is
 * that this branch is the whole of what phase 2 changed on the tab path — a model's rows now come
 * off the same `ParsedSlx` the Usage tier summarises, so opening a model parses it once instead of
 * once per consumer, and opening it after its linked dictionary (which had to parse it to
 * summarise it) parses it not at all. Left in the provider, that decision sat in a module which
 * imports `vscode` and which therefore no unit test can load: reverting it to the old
 * `getModelFromBytes` call left the entire suite green, because the equality sweep in
 * parsedRegistration.test.ts proves the two routes produce identical rows and nothing else could
 * tell which one a tab took. Here it is testable by behaviour — see tabRoute.test.ts, which asserts
 * that a model tab reads no bytes of its own and that every other format reads nothing else.
 *
 * Both sources are THUNKS, which is the other half of the same point: the read a branch does not
 * take must not happen. A model already parsed for a dictionary costs a `stat`, and passing the
 * bytes in would have paid for them before deciding they were not needed.
 */
export async function getModelForBinaryTab(uriString: string, name: string, sources: TabSources): Promise<any> {
  return isModelFile(name)
    ? getModelFromParsed(uriString, name, await sources.parsed())
    : getModelFromBytes(uriString, name, await sources.bytes());
}

// MATLAB/Simulink Project (.prj): parsed from its resources/project/**/*.xml
// text map, keyed by POSIX relpath relative to the project root.
export function getProjectModel(uriString: string, name: string, files: Record<string, string>): any {
  const cached = cache.get(uriString);
  if (cached) return cached;
  const node = registered(uriString, DataModel.addProjectSource(uriString, files, { path: name }));
  cache.set(uriString, node);
  return node;
}

export function invalidate(uriString: string): void {
  cache.delete(uriString);
}

/**
 * How many open views hold each uri's tree, across BOTH providers that register under the bare
 * uri: the read-only `BinaryEditorProvider` (one per custom document) and the editable
 * `SlddTextEditorProvider` (one per panel). One count rather than one per provider because the
 * two share a srcId — a JSON `.sldd` over the sync limit opens read-only, "Reopen Editor With"
 * moves a file between them, a split panel is a second view — and whichever closes first must
 * not take the tree from under the other.
 *
 * `BinarySlddEditorProvider` is not counted here: it registers under its own prefixed srcId and
 * already releases it from its document's dispose.
 */
const views = new Map<string, number>();

/** Drop both halves of what a uri holds: this module's cached tree and the session's source. */
function release(uriString: string): void {
  cache.delete(uriString);
  // A no-op for a srcId the session does not hold, so this is safe for a view that never
  // got as far as registering (a `.prj` page, a read that failed, a redirect).
  DataModel.removeDataSource(uriString);
}

/** A view of `uriString` has opened; it holds that uri's tree until `releaseSourceView`. */
export function openSourceView(uriString: string): void {
  views.set(uriString, (views.get(uriString) ?? 0) + 1);
}

/**
 * A view of `uriString` has closed. On the LAST one, the cached tree and the session's source
 * are released, and the answer is true.
 *
 * Without this a closed tab's tree lived for the life of the window: 66.8 MB retained per 20 MB
 * dictionary, for every file ever opened. What a release takes away was audited before it was
 * done: every reader of a registration (`findNode`'s selection, matrix and child requests) is a
 * row of an OPEN tab; the Usage column and the tree read from disk, not from the session; and
 * navigating to a file opens it, which registers it again. The one reader that loses something is
 * core's own `UsedBy` cell, which counted every registered model — see usageCells.ts.
 *
 * A release with no view to release (never opened, or one past the last) does nothing and
 * answers false: an unmatched release is a caller's bug, and the tree it would drop is not its own.
 */
export function releaseSourceView(uriString: string): boolean {
  const held = views.get(uriString);
  if (held === undefined) return false;
  if (held > 1) {
    views.set(uriString, held - 1);
    return false;
  }
  views.delete(uriString);
  release(uriString);
  return true;
}

/**
 * Release `uriString`'s tree if no view holds it; true when it did.
 *
 * For a read that lands after its last view closed. A read-only tab's read is asynchronous — a
 * large file is still parsing when the user closes it — and the registration it ends in happened
 * after the release, so nothing would ever release it. A view that opened meanwhile owns the tree,
 * and keeps it.
 */
export function releaseIfUnviewed(uriString: string): boolean {
  if (views.has(uriString)) return false;
  release(uriString);
  return true;
}

/**
 * The tree the session currently holds for a URI, or null — no parse, no registration.
 *
 * What an entry-scoped repaint starts from: the model that is already built, rather than
 * the one getModel would rebuild from text (~300 ms on a 46 MB dictionary, which is the
 * cost that path exists to avoid).
 *
 * The SESSION's copy, deliberately, not this module's `cache`: the two are set together by
 * every adder above, but `invalidate` clears only the cache — and it is called on every
 * keystroke in an open .sldd (see extension.ts, which drops the cache so the tree view and
 * the usage graph re-read an edited file). The registered source is also the one
 * `findNodeById` resolves into, so it is the only answer an entry op can be applied to.
 *
 * Says nothing about whether that tree still matches the text; only its caller knows what
 * has been applied to it since (see SlddTextEditorProvider's modelInSync).
 */
export function peekModel(uriString: string): any | null {
  return (DataModel as any).getDataSource?.(uriString) ?? null;
}

export function findNode(uriString: string, nodeId: string): any | null {
  // Prefer the global registry — it is keyed by the FULL node id (which embeds
  // the source's srcId), so it resolves regardless of which provider registered
  // the model. Crucially, the editable binary/text providers register their
  // model in DataModel under a prefixed srcId but NOT in this module's `cache`,
  // so gating on `cache.get(uriString)` here would wrongly drop their selections
  // (the Property Inspector would never render). Try the registry unconditionally.
  // The pinned data-explorer-core always exports findNodeById on DataModel. The
  // feature-detect exists because core is a git-pinned dependency bumped
  // independently of this repo, so an older pin must degrade to the cache fallback
  // below rather than throw on every selection (test/findNodeSharedName.test.ts);
  // the `try` covers the same risk for a throwing implementation.
  //
  // A null from the registry is FINAL when the registry holds this uri's source. Core
  // answers null for an id that names two nodes (F1-50: two same-named entries in one
  // section, and every row inside them), because it cannot tell which one a row meant.
  // Every adder here registers under the uri and caches the very tree it registered, so
  // flattening the cache would find the FIRST twin, the wrong-entry pick core refuses,
  // and a cell edit, a child delete, a copy, a drag and the Property Inspector all act
  // on what this returns. So the cache answers only what the registry cannot: an old
  // pin without findNodeById, a lookup that threw, or a source it no longer holds.
  try {
    const session = DataModel as any;
    if (typeof session.findNodeById === 'function') {
      const viaRegistry = session.findNodeById(nodeId);
      if (viaRegistry) return viaRegistry;
      if (session.hasDataSource?.(uriString)) return null;
    }
  } catch {
    /* fall through */
  }
  // Fallback: flatten the cached model tree (for models registered via getModel).
  const model = cache.get(uriString);
  if (model && typeof model.flatten === 'function') {
    return model.flatten().find((n: any) => n.id === nodeId) ?? null;
  }
  return null;
}
