// Copyright 2026 The MathWorks, Inc.
// Integration tests for PropertiesViewProvider. Its untested logic is the
// ready/pending buffering state machine: showNode()/clear() called before the
// webview signals 'ready' must buffer and flush on ready, and calls after ready
// must post immediately. VS Code only hands a real WebviewView to a contributed
// view on resolve, so we drive resolveWebviewView with a minimal fake webview
// that records postMessage — the provider's branching (the code under test) is
// real, and getHtml still builds genuine vscode.Uri values. buildPropertyGroups
// is covered separately by the piBuilder vitest suite.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PropertiesViewProvider } from '../../src/host/PropertiesViewProvider';

// A node whose toPIObject yields one group with one property, so showNode
// produces a non-empty groups payload (mirrors the piBuilder contract).
function fakeNode() {
  return {
    toPIObject() {
      return {
        objects: [{ Name: 'Kp' }],
        propertySheet: {
          groups: [{ name: 'g', displayName: 'General', items: [{ type: 'property', name: 'Name' }] }],
          properties: [{ name: 'Name', displayName: 'Name' }],
        },
      };
    },
  };
}

// A node with an id and one property core says is editable, and one it says is not.
function editableNode(id: string) {
  return {
    id,
    toPIObject() {
      return {
        objects: [{ Name: 'Kp', wordLength: '16' }],
        propertySheet: {
          groups: [{ name: 'g', displayName: 'General', items: [{ type: 'property', name: 'Name' }, { type: 'property', name: 'wordLength' }] }],
          properties: [{ name: 'Name', displayName: 'Name', editable: false }, { name: 'wordLength', displayName: 'Word Length', editable: true }],
        },
      };
    },
  };
}

interface Recorded {
  posted: any[];
  send: (m: any) => void;
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
    send: (m: any) => messageHandler?.(m),
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

  test('showNode after ready posts immediately', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());
    provider.resolveWebviewView(rec.view);
    rec.fireReady();

    provider.showNode(fakeNode());
    assert.strictEqual(rec.posted.length, 1, 'a ready view posts on showNode');
    assert.strictEqual(rec.posted[0].type, 'showProps');
  });

  test('clear after ready posts an empty message', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());
    provider.resolveWebviewView(rec.view);
    rec.fireReady();

    provider.clear();
    assert.strictEqual(rec.posted.length, 1);
    assert.strictEqual(rec.posted[0].type, 'empty');
  });

  test('clear before ready discards any pending node (no post on ready)', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());

    provider.showNode(fakeNode()); // buffered
    provider.clear(); // clears the buffer
    provider.resolveWebviewView(rec.view);
    rec.fireReady();

    assert.strictEqual(rec.posted.length, 0, 'a cleared buffer posts nothing on ready');
  });

  test('a node shown with an edit channel has its editable rows, and an edit of it goes to the channel', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());
    provider.resolveWebviewView(rec.view);
    rec.fireReady();
    const edits: string[][] = [];
    provider.showNode(editableNode('m/nt'), 'file:///x.mat', (...a) => edits.push(a));
    const shown = rec.posted.pop();
    assert.strictEqual(shown.nodeId, 'm/nt');
    assert.deepStrictEqual(
      shown.groups[0].properties.map((p: any) => [p.name, p.editable, p.key]),
      [['Name', false, undefined], ['Word Length', true, 'wordLength']],
    );
    rec.send({ type: 'editProperty', nodeId: 'm/nt', propName: 'wordLength', newValue: '8', oldValue: '16' });
    assert.deepStrictEqual(edits, [['m/nt', 'wordLength', '8', '16']]);
    // An edit of a node no longer on display (the selection moved while it was typed) is dropped.
    rec.send({ type: 'editProperty', nodeId: 'm/other', propName: 'wordLength', newValue: '4', oldValue: '16' });
    assert.strictEqual(edits.length, 1);
    provider.refuse('wordLength', 'Cannot edit "nt": no.');
    assert.deepStrictEqual(rec.posted.pop(), { type: 'propertyRefused', propName: 'wordLength', reason: 'Cannot edit "nt": no.' });
  });

  test('a node shown without one is read-only, and an edit of it goes nowhere', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());
    provider.resolveWebviewView(rec.view);
    rec.fireReady();
    const edits: string[][] = [];
    provider.showNode(editableNode('s/nt'), 'file:///x.sldd', (...a) => edits.push(a));
    provider.showNode(editableNode('s/nt'), 'file:///x.sldd');
    assert.ok(rec.posted.pop().groups[0].properties.every((p: any) => p.editable === false && p.key === undefined));
    rec.send({ type: 'editProperty', nodeId: 's/nt', propName: 'wordLength', newValue: '8', oldValue: '16' });
    assert.deepStrictEqual(edits, [], 'the channel of the node shown before is not this one');
  });

  test('after dispose, showNode buffers again instead of posting to a dead view', () => {
    const provider = new PropertiesViewProvider(extensionUri());
    const rec = fakeView(extensionUri());
    provider.resolveWebviewView(rec.view);
    rec.fireReady();

    rec.fireDispose(); // the view goes away
    provider.showNode(fakeNode());
    assert.strictEqual(rec.posted.length, 0, 'no post to a disposed view');
  });
});
