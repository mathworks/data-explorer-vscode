// Copyright 2026 The MathWorks, Inc.
// The webviews of the REGISTERED editors and views (the instances VS Code itself resolves a tab or a
// view with) and every message each was sent.
//
// activate() returns no API, so a test cannot reach those provider instances: hostHarness's
// fakePanel drives a provider of the test's own. What a test can reach is the webviews they are
// handed. Every one is an instance of the extension host's own webview class, which this wraps for as
// long as a suite runs: its `html` setter, where a provider sets a view's shell (once per view, so a
// view is known from the moment it exists), and `postMessage`, whose messages it keeps. A view's own
// messages (its `ready`, a link click) are delivered through the emitter the extension host fires a
// webview's from, so the provider answers them as it answers the page's.
//
// A tab's page loads in a renderer of its own, and only in a window that draws. Nothing here waits
// for it: a test delivers the `ready` the page would send. customEditorSavePoint.test.ts drives real
// tabs the same way, with a copy of its own.
//
// This is a `tools/` module: the runner's glob is `dist-test/suite/**/*.test.js`, so nothing here runs
// as a test of its own.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { srcIdToUriString } from 'data-explorer-view/model';
import { waitFor } from './hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A webview a provider set a shell on while the tap was on, and every message posted to it. */
export interface TappedView {
  webview: any;
  html: string;
  posts: any[];
}

export interface WebviewTap {
  /** Every view seen so far, in the order their shells were set. */
  readonly views: TappedView[];
  /** A point to look for new views after. */
  mark(): number;
  /** The first view since `mark` that `match` accepts, waited for as `what`. */
  next(mark: number, what: string, match: (v: TappedView) => boolean): Promise<TappedView>;
  /** Deliver `message` to the view's provider, as its page would. */
  send(view: TappedView, message: unknown): void;
  /** The editor panel a view belongs to, once its provider has asked the panel for it. */
  panelOf(view: TappedView): vscode.WebviewPanel | undefined;
  /** Put the extension host's webview class back as it was. */
  restore(): void;
}

/** Which page a view's shell loads. */
export const isTableShell = (v: TappedView): boolean => /\/table\.js"/.test(v.html);
export const isProjectShell = (v: TappedView): boolean => /\/project\.js"/.test(v.html);
export const isPropertiesShell = (v: TappedView): boolean => /\/pi\.js"/.test(v.html);

/** The messages of `type` a view was sent. */
export const postsOf = (v: TappedView, type: string): any[] => v.posts.filter((m) => m?.type === type);

/** The file a view's last whole paint names, read back from the srcId a provider may spell it as. */
export function docOf(v: TappedView): string | undefined {
  const rows = postsOf(v, 'setRows').pop();
  return typeof rows?.docUri === 'string' ? srcIdToUriString(rows.docUri) : undefined;
}

/** The message types a view was sent, for a wait's detail. */
export const typesOf = (v: TappedView): string => JSON.stringify(v.posts.map((m) => m?.type));

export function tapWebviews(): WebviewTap {
  const probe = vscode.window.createWebviewPanel('dataExplorer.webviewTapProbe', 'probe', { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {});
  const proto = Object.getPrototypeOf(probe.webview);
  const panelProto = Object.getPrototypeOf(probe);
  const emits = typeof (probe.webview as any)._onMessageEmitter?.fire === 'function';
  probe.dispose();
  const html = Object.getOwnPropertyDescriptor(proto, 'html');
  const post = proto.postMessage;
  const panelWebview = Object.getOwnPropertyDescriptor(panelProto, 'webview');
  assert.ok(
    emits && html?.set && html.get && typeof post === 'function' && panelWebview?.get,
    "the extension host's webview has the shape this tap drives: a `_onMessageEmitter`, an `html` accessor and `postMessage` on its class, and a `webview` getter on its panel's",
  );
  // Which panel a webview is the page of, learnt as a provider reads `panel.webview`, which every
  // provider does before it sets the shell. A panel's `active` is what the Add command asks.
  const panels = new WeakMap<object, vscode.WebviewPanel>();
  Object.defineProperty(panelProto, 'webview', {
    ...panelWebview,
    get() {
      const webview = panelWebview.get!.call(this);
      panels.set(webview, this);
      return webview;
    },
  });
  const views: TappedView[] = [];
  const entry = (webview: any): TappedView | undefined => views.find((v) => v.webview === webview);
  Object.defineProperty(proto, 'html', {
    ...html,
    set(value: string) {
      const seen = entry(this);
      if (seen) seen.html = value;
      else views.push({ webview: this, html: value, posts: [] });
      html.set!.call(this, value);
    },
  });
  proto.postMessage = function (message: any) {
    entry(this)?.posts.push(message);
    return post.call(this, message);
  };
  return {
    views,
    mark: () => views.length,
    async next(mark, what, match) {
      let found: TappedView | undefined;
      await waitFor(what, () => !!(found = views.slice(mark).find(match)), 20000, () =>
        JSON.stringify(views.slice(mark).map((v) => v.html.match(/\/(\w+)\.js"/)?.[1] ?? '?')),
      );
      return found!;
    },
    send: (view, message) => view.webview._onMessageEmitter.fire(message),
    panelOf: (view) => panels.get(view.webview),
    restore() {
      Object.defineProperty(proto, 'html', html);
      proto.postMessage = post;
      Object.defineProperty(panelProto, 'webview', panelWebview);
    },
  };
}

/** The tabs open on `uri`, in every group. */
export const tabsOn = (uri: vscode.Uri): vscode.Tab[] =>
  vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri?.toString() === uri.toString());

/** A tab's custom-editor view type, or undefined for any other tab. */
export const viewTypeOf = (tab: vscode.Tab): string | undefined =>
  tab.input instanceof vscode.TabInputCustom ? tab.input.viewType : undefined;

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('every tab to close', () => vscode.window.tabGroups.all.every((g) => g.tabs.length === 0));
}

/**
 * Open `uri` in the registered `viewType`, and answer its view once the page's `ready` has been
 * delivered and the provider has painted it.
 */
export async function openTab(tap: WebviewTap, uri: vscode.Uri, viewType: string): Promise<TappedView> {
  const mark = tap.mark();
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
  return paintedView(tap, mark, uri);
}

/** The first table view since `mark` showing `uri`, after delivering its `ready`. */
export async function paintedView(tap: WebviewTap, mark: number, uri: vscode.Uri): Promise<TappedView> {
  const name = uri.path.split('/').pop();
  const view = await tap.next(mark, `${name}'s table shell`, isTableShell);
  tap.send(view, { type: 'ready' });
  await waitFor(`${name}'s first paint`, () => postsOf(view, 'setRows').length > 0 || postsOf(view, 'error').length > 0, 20000, () => typesOf(view));
  assert.strictEqual(docOf(view), uri.toString(), `the view that opened shows ${name}`);
  return view;
}
