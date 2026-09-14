// Copyright 2026 The MathWorks, Inc.
//
// Where a clicked link is answered: here, or by the host.
//
// A Data Type link always points into the document it was rendered from — core builds the
// target out of the source the entry lives in — so its row is already in this table. The
// host path still works for it (navigate.ts opens the already-open tab and posts a
// selectByName back), it just costs a round-trip and a tab focus to select a row that never
// moved.
//
// Narrow on purpose. Every other grammar that reaches dex-link-clicked goes to the host,
// including two that LOOK local: `blocks:<sid>@<uri>` and `workspace:<name>@<uri>` name
// things this table cannot select by that spelling, so claiming them here would turn a
// working navigation into a click that selects nothing. A dictionary entry name cannot
// contain a colon, which is what makes "has a colon in the name half" a sound test for
// them — and the same fact core's first-colon split relies on.
export type LinkRoute = { kind: 'local'; name: string } | { kind: 'host' };

export function linkRoute(target: string, docUri: string): LinkRoute {
  // Before the first setRows this table has no identity, and '' === '' would route
  // everything locally.
  if (!docUri) return { kind: 'host' };
  // The FIRST at-sign, matching core's splitLinkTarget: a name may contain one, a uri
  // certainly may, and reading the last would re-point the link at a different document.
  const at = target.indexOf('@');
  if (at <= 0) return { kind: 'host' };
  const name = target.slice(0, at);
  if (target.slice(at + 1) !== docUri) return { kind: 'host' };
  if (name.includes(':')) return { kind: 'host' };
  return { kind: 'local', name };
}
