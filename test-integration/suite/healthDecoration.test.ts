// Copyright 2026 The MathWorks, Inc.
// Integration tests for HealthDecorationProvider. It is a thin vscode adapter
// over the pure, unit-tested health.ts: it decodes a resourceUri's `?dexHealth=`
// query into a vscode.FileDecoration (badge + ThemeColor + tooltip). The decode
// logic itself is covered by the vitest health suite; here we assert the vscode
// side the unit suite cannot construct — that a decorated URI yields a
// FileDecoration with the expected badge/tooltip and a plain URI yields none.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { HealthDecorationProvider } from '../../src/host/HealthDecorationProvider';
import { encode, DECORATIONS } from '../../src/host/health';

function fileUri(query?: string): vscode.Uri {
  const base = vscode.Uri.file('/tmp/x.sldd');
  return query ? base.with({ query }) : base;
}

suite('HealthDecorationProvider', () => {
  let provider: HealthDecorationProvider;
  setup(() => (provider = new HealthDecorationProvider()));

  test('a plain file URI (no health query) is not decorated', () => {
    assert.strictEqual(provider.provideFileDecoration(fileUri()), undefined);
  });

  test('an unrecognized query value is not decorated', () => {
    assert.strictEqual(provider.provideFileDecoration(fileUri('dexHealth=bogus')), undefined);
    assert.strictEqual(provider.provideFileDecoration(fileUri('other=1')), undefined);
  });

  test('a cycle-encoded URI decorates with the cycle badge and tooltip', () => {
    const dec = provider.provideFileDecoration(fileUri(encode('cycle')));
    assert.ok(dec, 'cycle state produces a decoration');
    assert.strictEqual(dec!.badge, DECORATIONS.cycle.badge);
    assert.strictEqual(dec!.tooltip, DECORATIONS.cycle.tooltip);
    assert.ok(dec!.color instanceof vscode.ThemeColor, 'the color is a ThemeColor');
  });

  test('a modified-encoded URI decorates with the modified badge and tooltip', () => {
    const dec = provider.provideFileDecoration(fileUri(encode('modified')));
    assert.ok(dec, 'modified state produces a decoration');
    assert.strictEqual(dec!.badge, DECORATIONS.modified.badge);
    assert.strictEqual(dec!.tooltip, DECORATIONS.modified.tooltip);
  });

  test('refresh() fires onDidChangeFileDecorations', () => {
    let fired = false;
    const sub = provider.onDidChangeFileDecorations(() => (fired = true));
    provider.refresh();
    sub.dispose();
    assert.ok(fired, 'refresh notifies VS Code to re-query decorations');
  });
});
