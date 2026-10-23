// Copyright 2026 The MathWorks, Inc.
// answerMatrixRequest is total (src/host/matrixRequest.ts): a panel that is open and waiting
// gets exactly one `matrixCells`, with its node id, even when the node lookup itself throws —
// a model mid-rebuild, say. Its own file, because the only way to make the lookup throw is to
// mock SlddModel for the whole module graph; the rest of its contract is matrixRequest.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/host/SlddModel.js', () => ({
  findNode: () => {
    throw new Error('the tree is being rebuilt');
  },
}));

const { answerMatrixRequest } = await import('../src/host/matrixRequest.js');

describe('answerMatrixRequest when the lookup throws', () => {
  it('posts one matrixCells, echoing the id, with the reason a panel can show', () => {
    const posts: unknown[] = [];
    expect(() => answerMatrixRequest({ postMessage: (m) => posts.push(m) }, 'file:///a.sldd', 'a.sldd/design/M')).not.toThrow();
    expect(posts).toEqual([
      { type: 'matrixCells', nodeId: 'a.sldd/design/M', message: 'This value could not be read as a table.' },
    ]);
  });
});
