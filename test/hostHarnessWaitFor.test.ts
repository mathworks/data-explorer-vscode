// Copyright 2026 The MathWorks, Inc.
// A named wait that times out says what it saw, not only what it waited for.
//
// The integration suite's waits are `waitFor('<what>', done)` (test-integration/suite/tools/
// hostHarness.ts), and a timeout fails as "timed out after <ms>ms waiting for <what>". Before
// those waits were named, three of them were loops of their own whose failure also printed the
// state they had been watching: the names the index held (forgetOnDiskChange), the message
// types the panel had been sent (twoTabBaseline's `lastRows`), and how many empty dirty-state
// events had arrived (jsonDirtyEventRepaint). A timeout that names only the condition says that
// it failed, and not how. So `waitFor` takes an optional `detail()`, read once, at the timeout,
// and added to the message; the three sites pass what they printed before.
//
// The harness is driven here as the suite uses it. It imports `vscode` for its other helpers;
// `waitFor` touches none of it, so an empty stand-in is enough.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { waitFor } from '../test-integration/suite/tools/hostHarness';

vi.mock('vscode', () => ({}));

/** The message `waitFor` failed with; the test fails if it did not fail. */
async function failure(wait: Promise<void>): Promise<string> {
  try {
    await wait;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('the wait was expected to time out');
}

describe('a named wait that times out says what it saw', () => {
  it('carries its detail text in the error', async () => {
    const message = await failure(waitFor('the thing', () => false, 60, () => 'saw ["ready","setRows"]'));
    expect(message).toBe('timed out after 60ms waiting for the thing (saw ["ready","setRows"])');
  });

  it('reads the detail at the timeout, so it shows the last state the condition saw', async () => {
    let polls = 0;
    const message = await failure(
      waitFor(
        'the count to reach a million',
        async () => {
          polls++;
          return false;
        },
        60,
        () => `saw ${polls} polls`,
      ),
    );
    expect(message).toMatch(/^timed out after 60ms waiting for the count to reach a million \(saw (\d+) polls\)$/);
    expect(Number(/saw (\d+) polls/.exec(message)![1])).toBe(polls);
    expect(polls).toBeGreaterThan(1);
  });

  it('asks for no detail when the condition comes true', async () => {
    let asked = 0;
    let polls = 0;
    await waitFor(
      'the third poll',
      () => ++polls >= 3,
      5000,
      () => {
        asked++;
        return 'never shown';
      },
    );
    expect(polls).toBe(3);
    expect(asked).toBe(0);
  });

  it('still names what it waited for when the detail itself throws', async () => {
    const message = await failure(
      waitFor('the thing', () => false, 60, () => {
        throw new Error('no posts array');
      }),
    );
    expect(message).toBe('timed out after 60ms waiting for the thing (and its detail failed: no posts array)');
  });

  it('without a detail, says what it waited for, as before', async () => {
    expect(await failure(waitFor('the thing', () => false, 60))).toBe('timed out after 60ms waiting for the thing');
  });
});

// --- the three sites that printed what they saw before their waits were named ------------

const SUITE = join(import.meta.dirname, '..', 'test-integration', 'suite');

/** The `waitFor` call in `file` whose name is `what`, with its arguments as source text. */
function waitNamed(file: string, what: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(join(SUITE, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'waitFor' &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) &&
      node.arguments[0].text === what
    ) {
      found.push(node.arguments.map((a) => a.getText(sf)));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  expect(found, `one waitFor('${what}') in ${file}`).toHaveLength(1);
  return found[0];
}

describe('the waits that printed what they saw still do', () => {
  it("forgetOnDiskChange's index wait shows the names the index held", () => {
    const args = waitNamed('forgetOnDiskChange.test.ts', 'the index to follow the file');
    expect(args).toHaveLength(4);
    expect(args[3]).toMatch(/^\(\) =>[\s\S]*JSON\.stringify\(names\)/);
  });

  it("twoTabBaseline's lastRows shows the message types the panel was sent", () => {
    const args = waitNamed('twoTabBaseline.test.ts', 'a whole-table paint');
    expect(args).toHaveLength(4);
    expect(args[3]).toMatch(/^\(\) =>[\s\S]*JSON\.stringify\(posts\.map\(\(m\) => m\?\.type\)\)/);
  });

  it('jsonDirtyEventRepaint shows the events and the posts it counted', () => {
    const args = waitNamed('jsonDirtyEventRepaint.test.ts', 'both events, and the repaint of the edited entry');
    expect(args).toHaveLength(4);
    expect(args[3]).toMatch(/^\(\) =>/);
    for (const seen of ['withChanges', 'empties', 'view.posts']) expect(args[3]).toContain(seen);
  });
});
