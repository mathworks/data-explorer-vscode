// Copyright 2026 The MathWorks, Inc.
// Renders health badges + colors on Data Explorer tree rows. The tree encodes a
// row's health state into its resourceUri query (`?dexHealth=<state>`); this
// provider decodes it into a FileDecoration. All real logic lives in the pure,
// unit-tested health.ts — this is a thin vscode adapter (hence no unit test, per
// the project convention for vscode-coupled host classes).
import * as vscode from 'vscode';
import { decode, DECORATIONS } from './health.js';

export class HealthDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** Re-query decorations for all rows (call when the tree/health changes). */
  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const state = decode(uri.query);
    if (!state) {
      return undefined;
    }
    const d = DECORATIONS[state];
    return new vscode.FileDecoration(d.badge, d.tooltip, new vscode.ThemeColor(d.colorId));
  }
}
