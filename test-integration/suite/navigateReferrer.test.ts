// Copyright 2026 The MathWorks, Inc.
// A link click carries the view it came from.
//
// A Model Reference or External Data link names its file by basename only, so which file it
// opens depends on where it was clicked: the copy in the referrer's own project or folder
// wins, as in the tree (navigate.test.ts drives that resolution). That only works if every
// view that can relay a click says which document it is showing. Each of the four is driven
// here as the real provider around a fake panel, with a real webview `navigate` message,
// and the referrer it hands onNavigate is read back.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { BinarySlddEditorProvider } from '../../src/host/BinarySlddEditorProvider';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { PropertiesViewProvider } from '../../src/host/PropertiesViewProvider';
import { ctx, fakePanel, token, wsUri } from './tools/hostHarness';

type Click = [target: string, referrer: string | undefined];

suite('a link click names the document it was clicked in', () => {
  test('the model view (BinaryEditorProvider) passes its model', async () => {
    const uri = wsUri('model.slx');
    const provider = new BinaryEditorProvider(ctx());
    const clicks: Click[] = [];
    provider.onNavigate = (target, referrer) => clicks.push([target, referrer]);
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'navigate', target: 'plant.slx' });
      assert.deepStrictEqual(clicks, [['plant.slx', uri.toString()]]);
    } finally {
      view.close();
    }
  });

  test('the JSON dictionary view (SlddTextEditorProvider) passes its dictionary', async () => {
    const uri = wsUri('data.sldd');
    const provider = new SlddTextEditorProvider(ctx());
    const clicks: Click[] = [];
    provider.onNavigate = (target, referrer) => clicks.push([target, referrer]);
    const doc = await vscode.workspace.openTextDocument(uri);
    const view = fakePanel();
    try {
      await provider.resolveCustomTextEditor(doc, view.panel, token());
      view.send({ type: 'navigate', target: 'Kp@params.sldd' });
      assert.deepStrictEqual(clicks, [['Kp@params.sldd', uri.toString()]]);
    } finally {
      view.close();
    }
  });

  test('the editable binary dictionary view passes its file, not its binedit: srcId', async () => {
    const uri = wsUri('binary.sldd');
    const provider = new BinarySlddEditorProvider(ctx());
    const clicks: Click[] = [];
    provider.onNavigate = (target, referrer) => clicks.push([target, referrer]);
    const doc = await provider.openCustomDocument(uri, {} as vscode.CustomDocumentOpenContext, token());
    const view = fakePanel();
    try {
      await provider.resolveCustomEditor(doc, view.panel, token());
      view.send({ type: 'navigate', target: 'Kp@params.sldd' });
      // The tree's graph keys files by their plain uri; `binedit:file:///…` would be a
      // referrer it does not know, which silently drops the scoping.
      assert.deepStrictEqual(clicks, [['Kp@params.sldd', uri.toString()]]);
    } finally {
      view.close();
    }
  });

  test('the Properties view passes the document of the node it shows, and nothing once cleared', () => {
    const provider = new PropertiesViewProvider(ctx().extensionUri);
    const clicks: Click[] = [];
    provider.onNavigate = (target, referrer) => clicks.push([target, referrer]);
    const view = fakePanel();
    provider.resolveWebviewView({
      webview: view.panel.webview,
      onDidDispose: view.panel.onDidDispose,
    } as unknown as vscode.WebviewView);
    const node = {
      toPIObject: () => ({
        objects: [{ Name: 'Gain1' }],
        propertySheet: {
          groups: [{ name: 'g', displayName: 'General', items: [{ type: 'property', name: 'Name' }] }],
          properties: [{ name: 'Name', displayName: 'Name' }],
        },
      }),
    };
    const from = wsUri('model.slx').toString();
    try {
      provider.showNode(node, from);
      view.send({ type: 'navigate', target: 'Kp@params.sldd' });
      provider.clear();
      view.send({ type: 'navigate', target: 'Kp@params.sldd' });
      assert.deepStrictEqual(clicks, [
        ['Kp@params.sldd', from],
        ['Kp@params.sldd', undefined],
      ]);
    } finally {
      view.close();
    }
  });
});
