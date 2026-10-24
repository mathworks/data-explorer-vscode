// Copyright 2026 The MathWorks, Inc.
//
// The messages every table view answers the same way, dispatched once.
//
// Each table provider answers the webview's messages from an `if / else if` chain of its own, and
// most of every chain is the same in all of them: the `ready` handshake, a selection relayed to
// the Property Inspector, a Usage link followed, a Variable Editor's cells, the rows under a row
// the payload held back, and undo and redo handed to VS Code. Spelled out in each provider, those
// branches are where one editor quietly drops a check another makes (a selection that is not an
// array, a link target that is not a string). So they are answered here, from a table of handlers
// whose KEYS ARE THE MESSAGE TYPES: what a provider answers is what its table holds, which
// test/messageDispatch.test.ts reads off each provider and holds to its capability tier.
//
// What each handler does is the provider's (its webview, its document, its planner). The checks on
// what arrived are this module's. vscode-free, so that they are unit-tested
// (test/tableDispatch.test.ts).

/**
 * How a provider answers the messages every table view answers alike, keyed by message type: the
 * four every view must (`ready`, `select`, `navigate`, `requestMatrix`), `requestChildren` where its
 * payload defers rows, and `undo` and `redo` where its document is editable.
 */
export interface CommonHandlers {
  /** The webview is up: paint it. */
  ready(): void;
  /** The table's selection, always an array (an empty one for anything else). */
  select(rowIds: string[]): void;
  /** A Usage-column link was clicked; only a string target is followed. */
  navigate(target: string): void;
  /** A Variable Editor panel is opening on `nodeId`. */
  requestMatrix(nodeId: string): void;
  /** A row the payload deferred is being opened. */
  requestChildren?(nodeId: string): void;
  /** The webview's own Undo, for VS Code's stack. */
  undo?(): void;
  /** The webview's own Redo, for VS Code's stack. */
  redo?(): void;
}

/**
 * Answer `msg` from `handlers` if it is a message they answer, and say whether it was. A message
 * they do not answer — every other type, and an optional one the table leaves out — is the
 * provider's own to dispatch, or to ignore.
 */
export function dispatchCommon(msg: unknown, handlers: CommonHandlers): boolean {
  const m = (msg ?? {}) as { type?: unknown; rowIds?: unknown; target?: unknown; nodeId?: unknown };
  switch (m.type) {
    case 'ready':
      handlers.ready();
      return true;
    case 'select':
      handlers.select(Array.isArray(m.rowIds) ? (m.rowIds as string[]) : []);
      return true;
    case 'navigate':
      if (typeof m.target === 'string') handlers.navigate(m.target);
      return true;
    case 'requestMatrix':
      handlers.requestMatrix(m.nodeId as string);
      return true;
    case 'requestChildren':
      if (!handlers.requestChildren) return false;
      handlers.requestChildren(m.nodeId as string);
      return true;
    case 'undo':
    case 'redo': {
      const run = handlers[m.type];
      if (!run) return false;
      run.call(handlers);
      return true;
    }
    default:
      return false;
  }
}
