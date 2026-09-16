// Copyright 2026 The MathWorks, Inc.
//
// A read that already happened, handed to the first consumer that asks for one.
//
// `BinaryEditorProvider` has to read a whole `.sldd` before it can decide which editor the
// file belongs in — `vscode.workspace.fs` has no partial read, so there is no prefix to
// classify from — and the files that end up STAYING in that read-only view are by
// definition the largest ones: a zip too big to decode into a string, or a JSON dictionary
// over VS Code's 50 MB TextDocument sync limit. Those bytes were then dropped and the same
// file read a second time to build the tree, which is the worst place in the extension to
// read twice.
//
// This is deliberately NOT a cache. A cache would answer every later ask, and the later
// asks are the ones that must not be answered from memory: a repost comes from a save, a
// watcher event or a refresh, each of which is a claim that the file on disk is no longer
// what was read. So the value is handed over at most ONCE and the holder is empty
// afterwards — which is both halves of the contract, since the read is spent AND nothing
// of that size is retained for the life of a tab.
export interface SeededRead<T> {
  /** The seed on the first ask, `read()` on every ask after it. */
  read: () => Promise<T>;
  /**
   * Forget the seed whether or not it was taken.
   *
   * The seeder owes this at the end of the first attempt, because an ask is not guaranteed
   * to happen: an attempt can throw before asking, or take a route that needs no bytes at
   * all. Without it such an attempt would leave the seed both held for the life of the
   * holder and, by the time something finally asks, arbitrarily old.
   */
  drop: () => void;
}

/**
 * Wrap `read` so that the first ask is answered by `seed` instead. With no seed
 * (`undefined`) every ask is a real read, which is how a caller that could not produce one
 * — an unreadable file, a format that classifies without reading — gets exactly the
 * unseeded behaviour and needs no branch of its own.
 */
export function seededRead<T>(seed: T | undefined, read: () => Promise<T>): SeededRead<T> {
  let held = seed;
  return {
    read: async () => {
      const first = held;
      // Cleared synchronously, before the fallback is even entered, so two asks that
      // overlap cannot both be served the seed.
      held = undefined;
      return first ?? read();
    },
    drop: () => {
      held = undefined;
    },
  };
}
