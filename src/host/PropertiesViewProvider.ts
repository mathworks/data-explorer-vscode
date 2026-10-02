// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { buildPropertyGroups } from './piBuilder.js';
import { matrixCellsMessage } from './matrixRequest.js';
import { renderWebviewHtml } from './webviewHtml.js';
import type { PropsToHostMessage } from '../common/protocol.js';

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dataExplorer.properties';
  private view: vscode.WebviewView | null = null;
  private ready = false;
  private pending: any[] | null = null; // pending groups
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

  /** A cross-reference was clicked in the inspector; resolve it as a table link. */
  public onNavigate: ((target: string) => void) | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    view.webview.onDidReceiveMessage((msg: PropsToHostMessage) => {
      if (msg?.type === 'ready') {
        this.ready = true;
        if (this.pending) {
          view.webview.postMessage({ type: 'showProps', groups: this.pending });
          this.pending = null;
        }
      } else if (msg?.type === 'navigate') {
        // Answered by the same closure the three table providers use, so a Data Type link
        // behaves identically whichever pane it was clicked in.
        this.onNavigate?.(msg.target);
      } else if (msg?.type === 'requestMatrix') {
        this.answerMatrix(view.webview, msg.nodeId);
      }
    });
    view.onDidDispose(() => {
      this.view = null;
      this.ready = false;
      this.shown = null;
    });
    view.webview.html = this.getHtml(view.webview, distRoot);
  }

  showNode(node: any): void {
    const groups = buildPropertyGroups(node);
    this.shown = node;
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'showProps', groups });
    } else {
      this.pending = groups;
    }
  }

  clear(): void {
    this.shown = null;
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
