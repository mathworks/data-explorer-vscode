// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { buildPropertyGroups } from './piBuilder.js';
import { renderWebviewHtml } from './webviewHtml.js';

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dataExplorer.properties';
  private view: vscode.WebviewView | null = null;
  private ready = false;
  private pending: any[] | null = null; // pending groups

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        this.ready = true;
        if (this.pending) {
          view.webview.postMessage({ type: 'showProps', groups: this.pending });
          this.pending = null;
        }
      }
    });
    view.onDidDispose(() => {
      this.view = null;
      this.ready = false;
    });
    view.webview.html = this.getHtml(view.webview, distRoot);
  }

  showNode(node: any): void {
    const groups = buildPropertyGroups(node);
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'showProps', groups });
    } else {
      this.pending = groups;
    }
  }

  clear(): void {
    if (this.view && this.ready) {
      this.view.webview.postMessage({ type: 'empty' });
    } else {
      this.pending = null;
    }
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
