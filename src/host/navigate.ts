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
// <source> is a full uriString when the emitter knows it (data->block links,
// which carry the model uri), or a bare basename when it comes from the vendored
// component (block->param links carry only the dictionary name); the latter is
// resolved against the workspace.
import * as vscode from 'vscode';
import { parseNavTarget, parseFileTarget } from './navTarget.js';

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

export function consumePendingSelect(uriString: string): string | undefined {
  const name = pending.get(uriString);
  pending.delete(uriString);
  return name;
}

// A full uriString parses directly; a bare basename is looked up in the
// workspace (first match wins).
async function resolveSource(source: string): Promise<vscode.Uri | undefined> {
  if (source.includes('://')) {
    try {
      return vscode.Uri.parse(source);
    } catch {
      return undefined;
    }
  }
  const matches = await vscode.workspace.findFiles('**/' + source, undefined, 1);
  return matches[0];
}

// Handle a link click. Two grammars land here:
//  - Usage-cell links carry `name@source`: open the source file (via `open`, the
//    host's content-aware editor router) and select the referenced row there.
//  - Model Reference / External Data links carry a bare filename: just open that
//    file, resolved by basename against the workspace. There is no row to select.
export async function handleNavigate(target: string, open: (uri: vscode.Uri) => Promise<void>): Promise<void> {
  const fileTarget = parseFileTarget(target);
  if (fileTarget) {
    const uri = await resolveSource(fileTarget);
    if (!uri) return;
    await open(uri);
    return;
  }
  const parsed = parseNavTarget(target);
  if (!parsed) return;
  const uri = await resolveSource(parsed.source);
  if (!uri) return;
  requestSelect(uri.toString(), parsed.name);
  await open(uri);
}
