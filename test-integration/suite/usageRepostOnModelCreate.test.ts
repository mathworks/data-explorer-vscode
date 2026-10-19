// Copyright 2026 The MathWorks, Inc.
// An open data file's Usage column follows a MODEL that links it appearing on disk or leaving
// it — through the real providers, a real FileSystemWatcher and the rows they post.
//
// A dictionary's Usage cell names the blocks that read each entry, and only a model can
// originate such an edge (usageScope.ts). Before this, a model created or deleted beside an
// open dictionary dropped the usage graph (extension.ts's refreshAll) and told no tab: each one
// reposted only from its own file's watcher or its own edits, so the column stayed as it was
// until the user edited, saved or reopened the dictionary. A `git checkout` that brought in the
// model which uses half a dictionary's entries left every one of those entries with an empty
// Usage cell.
//
// So an open data tab now reposts when a model file is created or deleted in the workspace,
// once per burst (usageRepost.ts, debounced). Pinned here end to end, for both views that fill a
// data file's Usage column: the JSON dictionary's editable table and the read-only view a
// `.mat` opens in. Nothing in this file tells a provider anything; what is asserted is only
// what each posted. The two absences are pinned too, since both are what keep the cost bounded:
// a file that is not a model does not repost, and a closed tab is never reposted again.
//
// The model is written INTO the workspace folder — unlike every other fixture this suite uses —
// because a model is found by `findFiles`, and that is the route under test. It is deleted
// before the test ends, which is itself half of what is pinned, and again in `finally` in case
// an assertion stopped it first, so the tree and index suites never see it.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { strToU8, zipSync } from 'fflate';
import { BinaryEditorProvider } from '../../src/host/BinaryEditorProvider';
import { SlddTextEditorProvider } from '../../src/host/SlddTextEditorProvider';
import { ctx, fakePanel, nameOf, quiet, token, waitFor, ws, wsUri } from './tools/hostHarness';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODEL = 'usageRepostProbe.slx';
const MAT = 'usageRepostBp.mat';
const NOT_A_MODEL = 'usageRepostProbe.sldd';
const BLOCK = 'RepostGain';

// A one-block model in the shape core reads (see make-usageorder.mjs): `Gain`/`Value` are
// absent from SlxParser's NON_PARAM_PROPS and the value is an identifier, so the block's use of
// `variable` is recorded. No model workspace, so nothing can shadow the linked source.
function modelUsing(variable: string, link: { dictionary?: string; mat?: string }): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(
      JSON.stringify({
        BlockDiagram: {
          ...(link.dictionary ? { DataDictionary: link.dictionary } : {}),
          ModelUUID: 'uuid-usage-repost',
          System: { Ref: 'system_root' },
        },
      }),
    ),
    'simulink/systems/system_root.xml': strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        `<System><Block BlockType="Gain" Name="${BLOCK}" SID="1"><P Name="Gain">${variable}</P></Block></System>`,
    ),
    'metadata/coreProperties.xml': strToU8(
      '<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>',
    ),
  };
  if (link.mat) {
    parts['simulink/ExternalDataSourceSettings.xml'] = strToU8(
      '<?xml version="1.0"?><ExternalDataSourceSettings>' +
        `<ExplicitExternalBrokerSources><fullPathToSource>${link.mat}</fullPathToSource></ExplicitExternalBrokerSources>` +
        '</ExternalDataSourceSettings>',
    );
  }
  return zipSync(parts);
}

const setRowsOf = (posts: any[]): any[] => posts.filter((p) => p.type === 'setRows');

/** The blocks the LATEST rows say use `name` — the cell as the user would read it. */
function usersOf(posts: any[], name: string): string[] {
  const last = setRowsOf(posts).at(-1);
  const row = ((last?.rows ?? []) as any[]).find((r) => nameOf(r) === name);
  assert.ok(row, `the table has a row for "${name}"`);
  const links = row.UsedBy?.blockLinks;
  return Array.isArray(links) ? links.map((l: any) => l.blockName) : [];
}

async function removeIfPresent(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    /* already gone: the test deleted it itself */
  }
}

/**
 * Write `bytes` to `uri` and return once a watcher of this file's own has SEEN it, plus two
 * debounce windows. For the two absences below: "no repost arrived" means nothing until the
 * event that would have caused one is known to have been delivered.
 */
async function writeAndLetItLand(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
  const name = uri.path.split('/').pop() as string;
  const witness = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(ws(), name));
  let seen = false;
  const sub = witness.onDidCreate(() => (seen = true));
  try {
    await vscode.workspace.fs.writeFile(uri, bytes);
    await waitFor(`the create event for ${name}`, () => seen);
    await quiet(800, `two debounce windows after the create event for ${name}, for a repost it would cause`);
  } finally {
    sub.dispose();
    witness.dispose();
  }
}

interface Opened {
  view: ReturnType<typeof fakePanel>;
}

/** Shared by both views: open, see the variable unused, create the model, delete it. */
async function followsTheModel(open: () => Promise<Opened>, variable: string, model: Uint8Array): Promise<void> {
  const modelUri = wsUri(MODEL);
  const notAModel = wsUri(NOT_A_MODEL);
  const { view } = await open();
  let closed = false;
  try {
    view.send({ type: 'ready' });
    await waitFor('the first rows', () => setRowsOf(view.posts).length > 0);
    assert.deepStrictEqual(usersOf(view.posts, variable), [], `nothing in the workspace uses ${variable} yet`);

    // The control: a file appearing that is not a model cannot add a usage edge, and is no
    // reason to rebuild every open table.
    const before = setRowsOf(view.posts).length;
    await writeAndLetItLand(notAModel, strToU8('{}'));
    assert.strictEqual(setRowsOf(view.posts).length, before, 'a non-model file created beside it reposts nothing');
    await removeIfPresent(notAModel);

    // A model that uses the variable appears: the column names its block, unprompted.
    await vscode.workspace.fs.writeFile(modelUri, model);
    await waitFor(`a repost naming ${BLOCK} as a user of ${variable}`, () =>
      usersOf(view.posts, variable).includes(BLOCK),
    );

    // And leaves: the column stops naming it.
    await vscode.workspace.fs.delete(modelUri);
    await waitFor(`a repost no longer naming ${BLOCK}`, () => !usersOf(view.posts, variable).includes(BLOCK));

    // A closed tab is unsubscribed: the same model appearing again posts nothing to it.
    view.close();
    closed = true;
    const atClose = view.posts.length;
    await writeAndLetItLand(modelUri, model);
    assert.strictEqual(view.posts.length, atClose, 'a closed tab is never reposted');
  } finally {
    if (!closed) view.close();
    await removeIfPresent(modelUri);
    await removeIfPresent(notAModel);
  }
}

suite('Usage follows a model created or deleted beside an open data file', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('mathworks.simulink-data-explorer')?.activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('the JSON dictionary table reposts its Usage column', async () => {
    const dict = wsUri('data.sldd');
    await followsTheModel(
      async () => {
        const doc = await vscode.workspace.openTextDocument(dict);
        const view = fakePanel();
        await new SlddTextEditorProvider(ctx()).resolveCustomTextEditor(doc, view.panel, token());
        return { view };
      },
      'Number',
      modelUsing('Number', { dictionary: 'data.sldd' }),
    );
  });

  test('the read-only view of a .mat reposts its Usage column', async () => {
    // A real MATLAB-written MAT-file defining the one variable `Bp` (see make-caserefs.mjs),
    // copied in beside the model for the reason the model is: only `findFiles` puts a data
    // file in the scope of a model that links it.
    //
    // Landed before the tab opens: the view watches its own file, and a create event for it
    // arriving after the first rows would be a repost this test did not cause.
    const mat = wsUri(MAT);
    const source = vscode.Uri.joinPath(ctx().extensionUri, 'test', 'fixtures', 'mcos', 'Bp.mat');
    try {
      await writeAndLetItLand(mat, await vscode.workspace.fs.readFile(source));
      await followsTheModel(
        async () => {
          const provider = new BinaryEditorProvider(ctx());
          const doc = await provider.openCustomDocument(mat, {} as vscode.CustomDocumentOpenContext, token());
          const view = fakePanel();
          await provider.resolveCustomEditor(doc, view.panel, token());
          return { view };
        },
        'Bp',
        modelUsing('Bp', { mat: MAT }),
      );
    } finally {
      await removeIfPresent(mat);
    }
  });
});
