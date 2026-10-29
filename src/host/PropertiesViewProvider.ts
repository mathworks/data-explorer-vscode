// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { InspectorPage } from 'data-explorer-view/model';
import { renderWebviewHtml } from './webviewHtml.js';
import type { PropsToHostMessage } from '../common/protocol.js';

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dataExplorer.properties';
  private view: vscode.WebviewView | null = null;
  // What the page shows and was sent, and when a node changes that (inspectorPage.ts): every
  // `ready` is sent what the inspector holds, and a node is sent only when it changes the page.
  private readonly page = new InspectorPage((message) => void this.view?.webview.postMessage(message));

  /** A cross-reference was clicked in the inspector; resolve it as a table link. */
  public onNavigate: ((target: string, referrer?: string) => void) | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.page.opened();
    const distRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    view.webview.onDidReceiveMessage((msg: PropsToHostMessage) => {
      if (msg?.type === 'ready') {
        this.page.loaded();
      } else if (msg?.type === 'navigate') {
        // Answered by the same closure the three table providers use, so a Data Type link
        // behaves identically whichever pane it was clicked in.
        this.onNavigate?.(msg.target, this.page.from);
      } else if (msg?.type === 'requestMatrix') {
        this.page.answerMatrix(msg.nodeId);
      }
    });
    view.onDidDispose(() => {
      this.view = null;
      this.page.closed();
    });
    view.webview.html = this.getHtml(view.webview, distRoot);
  }

  showNode(node: any, fromUri?: string): void {
    this.page.show(node, fromUri);
  }

  clear(): void {
    this.page.clear();
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
