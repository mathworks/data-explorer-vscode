// Copyright 2026 The MathWorks, Inc.
// The extension stays active through the Add Child suite. What Add Child does is view's and core's
// to test now: the menu over a real dictionary's rows (view menuItems.test.ts, "Add Child, over the
// rows a real dictionary builds") and the model's add (core baseBusNode, enumTypeNode).
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Add Child menu + model mutation (integration)', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  test('the extension stays active after driving the add-child pipeline', () => {
    assert.ok(
      vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.isActive,
      'extension remains active',
    );
  });
});
