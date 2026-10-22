// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { buildPropertyGroups } from './piBuilder.js';
import { matrixCellsMessage } from './matrixRequest.js';
import { renderWebviewHtml } from './webviewHtml.js';
import type { PropsToHostMessage } from '../common/protocol.js';

/**
 * Where an edit made in the panel goes: the host of the node's document, which makes it a
 * gesture of its own (one undo step, core's refusal reported back through `refuse`). Handed to
 * showNode by a host that takes such edits; the panel is read-only for the others.
 */
export type PropertyEditHandler = (nodeId: string, propName: string, newValue: string, oldValue: string) => void;

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dataExplorer.properties';
  private view: vscode.WebviewView | null = null;
  private ready = false;
  private pending: { groups: any[]; nodeId?: string } | null = null; // pending groups
  // Where an edit of the node on display goes, or null: the panel is then read-only.
  private editor: PropertyEditHandler | null = null;
  // The node currently on display, kept for `requestMatrix` only: its Value row may
  // carry a MatrixDescriptor, and the cells behind one are fetched when the panel
  // opens rather than stamped onto the row (see matrixRequest.ts for why).
  //
  // Resolved from the node in hand rather than through SlddModel.findNode, which the
  // three table providers use: the inspector is handed a node and never learns which
  // document it came from. Matching on `id` is what makes that safe — a request for
  // anything other than what is on screen is refused, so this cannot answer about a
  // node the user is not looking at.
  private shown: any = null;
  // The document `shown` came from, handed to onNavigate as the click's referrer: a bare
  // file name in a link resolves to the copy in that document's own project or folder.
  private shownFrom: string | undefined;

  /** A cross-reference was clicked in the inspector; resolve it as a table link. */
  public onNavigate: ((target: string, referrer?: string) => void) | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    view.webview.onDidReceiveMessage((msg: PropsToHostMessage) => {
      if (msg?.type === 'ready') {
        this.ready = true;
        if (this.pending) {
          view.webview.postMessage({ type: 'showProps', ...this.pending });
          this.pending = null;
        }
      } else if (msg?.type === 'navigate') {
        // Answered by the same closure the three table providers use, so a Data Type link
        // behaves identically whichever pane it was clicked in.
        this.onNavigate?.(msg.target, this.shownFrom);
      } else if (msg?.type === 'requestMatrix') {
        this.answerMatrix(view.webview, msg.nodeId);
      } else if (msg?.type === 'editProperty') {
        // Only an edit of the node on display, and only where its host takes one: a stale
        // edit (the selection moved while it was typed) or one no host takes changes nothing.
        if (this.editor && this.shown && this.shown.id === msg.nodeId) {
          this.editor(msg.nodeId, msg.propName, msg.newValue, msg.oldValue);
        }
      }
    });
    view.onDidDispose(() => {
      this.view = null;
      this.ready = false;
      this.shown = null;
      this.shownFrom = undefined;
      this.editor = null;
    });
    view.webview.html = this.getHtml(view.webview, distRoot);
  }

  /**
   * Show `node`'s properties. With `editor`, the rows core says are editable are, and an edit
   * of one goes to it; without, the panel is read-only.
   */
  showNode(node: any, fromUri?: string, editor?: PropertyEditHandler): void {
    const groups = buildPropertyGroups(node, { editable: !!editor });
    this.shown = node;
    this.shownFrom = fromUri;
    this.editor = editor ?? null;
    const payload = { groups, ...(typeof node?.id === 'string' ? { nodeId: node.id } : {}) };
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'showProps', ...payload });
    } else {
      this.pending = payload;
    }
  }

  /** Say why the panel's last edit was refused. Sent after the showProps that put the row back. */
  refuse(propName: string, reason: string): void {
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'propertyRefused', propName, reason });
    }
  }

  clear(): void {
    this.shown = null;
    this.shownFrom = undefined;
    this.editor = null;
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'empty' });
    } else {
      this.pending = null;
    }
  }

  /**
   * Answer a `requestMatrix` for the node on display. Always posts exactly one
   * `matrixCells`, with the id echoed, on the same terms as the table providers'
   * shared `answerMatrixRequest`: a panel that is open and waiting is worse off with
   * silence than with a reason.
   */
  private answerMatrix(webview: vscode.Webview, nodeId: string): void {
    // Only the node on screen. The inspector's descriptor was built from `this.shown`
    // (piBuilder passes the node, not its Value child), so an id that is not it is
    // either stale — the selection changed while the panel was opening — or not ours.
    const node = this.shown && this.shown.id === nodeId ? this.shown : null;
    // The same envelope the three table providers send, from the same function: the
    // inspector resolves its node differently, and that is the ONLY difference.
    void webview.postMessage(matrixCellsMessage(nodeId, node));
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri): string {
    return renderWebviewHtml(webview, distRoot, {
      scriptFile: 'pi.js',
      title: 'Properties',
      body: `    <div id="dex-empty" style="padding:12px;color:var(--vscode-descriptionForeground,#888);font-family:var(--vscode-font-family,sans-serif);font-size:13px;">Select an entry to view its properties.</div>
    <dex-property-inspector style="display:none;"></dex-property-inspector>`,
    });
  }
}
