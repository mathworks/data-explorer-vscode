// Copyright 2026 The MathWorks, Inc.
// PropertiesViewProvider's wiring of the inspector's page (view's InspectorPage): the view's
// `ready` is the page's `loaded`, and a disposed view is the page's `closed`. VS Code only hands a
// real WebviewView to a contributed view on resolve, so resolveWebviewView is driven with a minimal
// fake webview that records postMessage. What the page sends on which `ready`, on a clear and for a
// node shown again is view's test/inspectorPage.test.ts; the referrer the provider hands a link
// click is navigateReferrer.test.ts.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PropertiesViewProvider } from '../../src/host/PropertiesViewProvider';

// A node whose toPIObject yields one group with one property, so showNode
// produces a non-empty groups payload (mirrors the piBuilder contract).
function fakeNode(name = 'Kp') {
  return {
    toPIObject() {
      return {
        objects: [{ Name: name }],
        propertySheet: {
          groups: [{ name: 'g', displayName: 'General', items: [{ type: 'property', name: 'Name' }] }],
          properties: [{ name: 'Name', displayName: 'Name' }],
        },
      };
    },
  };
}

interface Recorded {
  posted: any[];
  fireReady: () => void;
  fireDispose: () => void;
  view: vscode.WebviewView;
}

// Build a fake WebviewView backed by recording stubs. onDidReceiveMessage and
// onDidDispose expose fire hooks so the test can simulate the webview lifecycle.
function fakeView(extensionUri: vscode.Uri): Recorded {
  const posted: any[] = [];
  let messageHandler: ((m: any) => void) | undefined;
  let disposeHandler: (() => void) | undefined;

  const webview: Partial<vscode.Webview> = {
    options: {},
    cspSource: 'vscode-webview://test',
    asWebviewUri: (u: vscode.Uri) => u,
    onDidReceiveMessage: ((h: (m: any) => void) => {
      messageHandler = h;
      return { dispose() {} };
    }) as vscode.Webview['onDidReceiveMessage'],
    postMessage: (async (m: any) => {
      posted.push(m);
      return true;
    }) as vscode.Webview['postMessage'],
    set html(_v: string) {
      /* assigning html is exercised by resolveWebviewView; value irrelevant here */
    },
  };
  // `html` is a setter-only accessor above; define it on the object so the
  // assignment inside resolveWebviewView succeeds.
  Object.defineProperty(webview, 'html', { set() {}, configurable: true });

  const view: Partial<vscode.WebviewView> = {
    webview: webview as vscode.Webview,
    onDidDispose: ((h: () => void) => {
      disposeHandler = h;
      return { dispose() {} };
    }) as vscode.WebviewView['onDidDispose'],
  };

  return {
    posted,
    fireReady: () => messageHandler?.({ type: 'ready' }),
    fireDispose: () => disposeHandler?.(),
    view: view as vscode.WebviewView,
  };
}

function extensionUri(): vscode.Uri {
  const ext = vscode.extensions.getExtension('mathworks.simulink-data-explorer');
  assert.ok(ext, 'the extension must be present');
  return ext!.extensionUri;
}

suite('PropertiesViewProvider', () => {
  test('exposes the properties viewType', () => {
    assert.strictEqual(PropertiesViewProvider.viewType, 'dataExplorer.properties');
  });

  test('showNode before the webview is ready buffers, then flushes on ready', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());

    // No view resolved yet: showNode buffers, nothing posted.
    provider.showNode(fakeNode());

    provider.resolveWebviewView(rec.view);
    // Resolved but not 'ready' yet: still buffered.
    assert.strictEqual(rec.posted.length, 0, 'nothing posts before the webview reports ready');

    rec.fireReady();
    assert.strictEqual(rec.posted.length, 1, 'the buffered node flushes on ready');
    assert.strictEqual(rec.posted[0].type, 'showProps');
    assert.strictEqual(rec.posted[0].groups[0].title, 'General');
    assert.strictEqual(rec.posted[0].groups[0].properties[0].name, 'Name');
  });

  test('a disposed view takes what it held with it: the next view starts empty', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const first = fakeView(extensionUri());
    provider.resolveWebviewView(first.view);
    provider.showNode(fakeNode()); // waiting for a ready that never comes
    first.fireDispose();

    const second = fakeView(extensionUri());
    provider.resolveWebviewView(second.view);
    second.fireReady();
    assert.deepStrictEqual(second.posted, [], 'nothing of the view that went');
  });
});
