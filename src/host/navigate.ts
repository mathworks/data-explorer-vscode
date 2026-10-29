// Copyright 2026 The MathWorks, Inc.
// Cross-tab navigation for Usage-column links. Each data/model table is its own
// webview tab, so a click can't navigate in-page (as the vendored dex-app does
// via dex-link-clicked -> LitRenderer). Instead the webview relays the click to
// its host provider, which resolves the target to a workspace file, opens that
// tab, and asks it to select the referenced row.
//
// Link target grammar (mirrors data explorer):
//   blocks:<blockName>@<source>     data row -> a block that uses the variable
//   workspace:<paramName>@<source>  block row -> a model-workspace param
//   <paramName>@<source>            block row -> a dictionary/MAT variable
// <source> is a full uriString in every Usage cell, because the host writes those
// from the workspace graph (usageCells.ts), whose sources are keyed by uri. A bare
// basename still arrives in two places: a Model Reference or External Data link,
// which is a file name as Simulink recorded it (see handleNavigate), and core's own
// block -> parameter link `<param>@<dictionary name>`, which the host replaces with
// the graph's and which survives only when that fill failed (rowBuilder.ts). A bare
// name is resolved as the tree resolves it, preferring the referrer's own project or
// folder (navTarget.resolveNavSource).
import * as vscode from 'vscode';
import { parseNavTarget, parseFileTarget, resolveNavSource, type ScopedResolve } from './navTarget.js';
import { srcIdToUriString } from 'data-explorer-view/model';

export { parseNavTarget, parseFileTarget };

// Pending selection per target uri, consumed by that editor's next paint. This
// covers the just-opened case: the click fires requestSelect BEFORE the new
// editor exists to hear the live event, so its first post() drains this instead.
const pending = new Map<string, string>();
const emitter = new vscode.EventEmitter<{ uri: string; name: string }>();

// Fired when a view asks that row `name` be selected in the document at `uri`.
// An already-open target editor handles this live; a just-opened one uses the
// pending map above.
export const onNavigateSelect = emitter.event;

export function requestSelect(uriString: string, name: string): void {
  pending.set(uriString, name);
  emitter.fire({ uri: uriString, name });
}

// Internal: read-and-clear the pending selection for a uri. Exposed to providers
// only through drainNavigateSelect / wireNavigateSelect below.
function consumePendingSelect(uriString: string): string | undefined {
  const name = pending.get(uriString);
  pending.delete(uriString);
  return name;
}

// Drain any pending cross-tab selection for THIS file and ask the webview to
// select that row. Called by a table provider from its FIRST paint (once rows
// exist) to cover the just-opened case: a Usage-link click or the global entry
// search fires requestSelect before this editor exists to hear the live event,
// so the target lands in the pending map and is drained here.
export function drainNavigateSelect(
  webview: Pick<vscode.Webview, 'postMessage'>,
  uriString: string,
): void {
  const name = consumePendingSelect(uriString);
  if (name) void webview.postMessage({ type: 'selectByName', name });
}

// Wire live cross-tab selection for an already-open editor: when a navigation
// targets THIS file, consume its pending entry (so it can't re-fire on a later
// repaint) and ask the webview to select the named row. The just-opened case is
// drained separately in each provider's first paint via drainNavigateSelect.
// Returns the subscription for the caller to dispose on panel teardown. Shared
// by all three table providers (SlddTextEditorProvider, BinaryEditorProvider,
// BinarySlddEditorProvider).
export function wireNavigateSelect(
  webview: Pick<vscode.Webview, 'postMessage'>,
  uriString: string,
): vscode.Disposable {
  return onNavigateSelect((e) => {
    if (e.uri !== uriString) return;
    drainNavigateSelect(webview, uriString);
  });
}

// A full uriString parses directly; a bare basename is resolved by `scoped` (the tree's
// group-first rule) when the click names its referrer, else by the first workspace match.
//
// `source` is a core srcId, so it can also arrive in a provider's own spelling of one:
// BinarySlddEditorProvider registers `binedit:file:///…`. That still contains '://' and
// Uri.parse still accepts it — as scheme `binedit` with the whole `file:///…` as its path,
// naming no file at all, which the caller then opens as an empty tab. srcIdToUriString is
// what makes every provider's srcId read back as the document it names.
async function resolveSource(
  srcId: string,
  referrer: string | undefined,
  scoped: ScopedResolve | undefined,
): Promise<vscode.Uri | undefined> {
  const uriString = await resolveNavSource(srcIdToUriString(srcId), referrer, {
    scoped,
    firstMatch: async (name) => (await vscode.workspace.findFiles('**/' + name, undefined, 1))[0]?.toString(),
  });
  if (uriString === undefined) return undefined;
  try {
    return vscode.Uri.parse(uriString);
  } catch {
    return undefined;
  }
}

// Handle a link click. Two grammars land here:
//  - Usage-cell links carry `name@source`: open the source file (via `open`, the
//    host's content-aware editor router) and select the referenced row there.
//  - Model Reference / External Data links carry a bare filename: just open that
//    file. There is no row to select.
// `referrer` is the uriString of the document the link was clicked in; with `scoped` (the
// tree's SectionsTreeProvider.resolveReference), it is what picks between two same-named
// files in the workspace.
export async function handleNavigate(
  target: string,
  open: (uri: vscode.Uri) => Promise<void>,
  referrer?: string,
  scoped?: ScopedResolve,
): Promise<void> {
  const fileTarget = parseFileTarget(target);
  if (fileTarget) {
    const uri = await resolveSource(fileTarget, referrer, scoped);
    if (!uri) return;
    await open(uri);
    return;
  }
  const parsed = parseNavTarget(target);
  if (!parsed) return;
  const uri = await resolveSource(parsed.source, referrer, scoped);
  if (!uri) return;
  requestSelect(uri.toString(), parsed.name);
  await open(uri);
}
