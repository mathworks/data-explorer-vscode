// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { buildPropertyGroups, type PIPropertyGroup } from './piBuilder.js';
import { matrixCellsMessage } from './matrixRequest.js';
import { renderWebviewHtml } from './webviewHtml.js';
import type { PropsToHostMessage } from '../common/protocol.js';

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dataExplorer.properties';
  private view: vscode.WebviewView | null = null;
  private ready = false;
  // What the inspector shows: the groups of the node on display, or null for the empty pane.
  // Kept whether or not a page can take it now, and sent on EVERY `ready`, not only the first.
  // This view does not retain its context when hidden, so hiding it and showing it again
  // reloads its page, which starts empty and says `ready` again; and a message posted to it
  // while it was hidden never arrived. Sent once, to the first page, it left the pane empty
  // after every hide and show, and a selection made while it was hidden never showed.
  private groups: PIPropertyGroup[] | null = null;
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
        // A page that has just loaded shows the empty pane (pi-main.ts says `ready` after
        // setEmpty), so there is something to send only when the inspector holds a node.
        if (this.groups) view.webview.postMessage({ type: 'showProps', groups: this.groups });
      } else if (msg?.type === 'navigate') {
        // Answered by the same closure the three table providers use, so a Data Type link
        // behaves identically whichever pane it was clicked in.
        this.onNavigate?.(msg.target, this.shownFrom);
      } else if (msg?.type === 'requestMatrix') {
        this.answerMatrix(view.webview, msg.nodeId);
      }
    });
    view.onDidDispose(() => {
      this.view = null;
      this.ready = false;
      // With the node it is about: a next view starts empty, rather than on rows whose node
      // this provider no longer answers a matrix request or a link for.
      this.groups = null;
      this.shown = null;
      this.shownFrom = undefined;
    });
    view.webview.html = this.getHtml(view.webview, distRoot);
  }

  showNode(node: any, fromUri?: string): void {
    const groups = buildPropertyGroups(node);
    this.groups = groups;
    this.shown = node;
    this.shownFrom = fromUri;
    if (this.view && this.ready) this.view.webview.postMessage({ type: 'showProps', groups });
  }

  clear(): void {
    this.groups = null;
    this.shown = null;
    this.shownFrom = undefined;
    if (this.view && this.ready) this.view.webview.postMessage({ type: 'empty' });
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
