// Copyright 2026 The MathWorks, Inc.
// The QuickPicks the extension shows (Search Data Source Entries), kept for a suite to drive.
//
// An extension's `vscode` module is one object for every file of the extension, so wrapping
// `vscode.window.createQuickPick` here wraps the search's own call. Each QuickPick is listened to as
// it is made, before the search's own listeners: the search disposes its QuickPick in its hide
// listener, and with it every listener added after that one. Typing is setting `value`, which VS Code
// echoes back as the change event the search filters on; a pick is VS Code's own accept command over
// the item VS Code made active.
//
// This is a `tools/` module: the runner's glob is `dist-test/suite/**/*.test.js`, so nothing here runs
// as a test of its own.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { waitFor } from './hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A QuickPick the extension made, and what became of it. */
export interface Kept {
  qp: vscode.QuickPick<any>;
  hidden: boolean;
  disposed: boolean;
  /** The items VS Code last said are active. */
  active: readonly any[];
  /** How many times VS Code has echoed a `value` back. */
  echoes: number;
}

/** Keep every QuickPick the extension makes until `restore`. */
export function keepQuickPicks(): { picks: Kept[]; restore(): void } {
  const picks: Kept[] = [];
  const window = vscode.window as any;
  const create = window.createQuickPick;
  window.createQuickPick = function (...args: unknown[]) {
    const qp = create.apply(this, args);
    const kept: Kept = { qp, hidden: false, disposed: false, active: [], echoes: 0 };
    qp.onDidHide(() => (kept.hidden = true));
    qp.onDidChangeActive((items: readonly any[]) => (kept.active = items));
    qp.onDidChangeValue(() => kept.echoes++);
    const dispose = qp.dispose.bind(qp);
    qp.dispose = () => {
      kept.disposed = true;
      dispose();
    };
    picks.push(kept);
    return qp;
  };
  return {
    picks,
    restore() {
      window.createQuickPick = create;
    },
  };
}

/** Run Search Data Source Entries, and answer its QuickPick, with the index loaded into it. */
export async function search(picks: Kept[]): Promise<Kept> {
  const before = picks.length;
  // Resolves once the index is in the QuickPick.
  await vscode.commands.executeCommand('dataExplorer.searchDataSources');
  assert.strictEqual(picks.length, before + 1, 'the command made one QuickPick');
  return picks[before];
}

/** Type `query`, and answer the items the search lists for it. */
export async function typeQuery(s: Kept, query: string): Promise<readonly any[]> {
  const echoes = s.echoes;
  s.qp.value = query;
  // The search's own listener runs in the same event, after this suite's.
  await waitFor(`VS Code to echo "${query}" back to the search`, () => s.echoes > echoes);
  return s.qp.items;
}

/** Close the search, and wait until it has gone. */
export async function close(s: Kept): Promise<void> {
  s.qp.hide();
  await waitFor('the search to close', () => s.hidden);
}
