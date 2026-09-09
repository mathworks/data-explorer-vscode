// Copyright 2026 The MathWorks, Inc.

// Per-URI baseline store mapping entryName -> canonical serialized JSON string.
// "Modified" is computed as a diff of the current model against the last-saved
// baseline (captured on open and after each save). See the dirty-state design doc.

const baselines = new Map<string, Map<string, string>>();

// Sentinel stored when an entry fails to serialize, so a serialize failure
// counts as "different" rather than crashing the diff. The NUL is written as
// an ESCAPE, never a raw byte: a literal NUL makes git classify this source as
// binary, so every later diff of it collapses to "Bin 2107 -> 2941 bytes" and
// silently hides real changes from review.
const SERIALIZE_ERROR = '\u0000error';

// Walk model.children (sections) -> section.children (entries) and build a map
// of entryName -> canonical JSON.
//
// PRECONDITION (untested) for both `|| []` fallbacks: an SlddNode always exposes
// its four sections and every section always has a children array — even parsing
// `{}` yields four empty sections — and both callers pass a freshly parsed node
// (SlddTextEditorProvider's getModel, BinarySlddEditorProvider's buildModel), so
// neither array is ever absent. They stay because a serialize/diff pass must not
// be the thing that throws on a shape change: a wrong "modified" dot is a far
// smaller failure than an editor that will not open.
// One entry's canonical JSON, or the sentinel if it will not serialize.
function entryJson(entry: any): string {
  try {
    return JSON.stringify(entry.serialize());
  } catch {
    // PRECONDITION (untested): every node type's serialize() returns a plain
    // JSON-safe tree, so neither the call nor the stringify throws for a
    // parsed model. Reaching this needs a cyclic or BigInt-bearing value the
    // parser cannot produce — hence the sentinel rather than a mocked test.
    return SERIALIZE_ERROR;
  }
}

// THE rule for "is this entry modified": its canonical JSON differs from the
// baseline's, or the baseline has never heard of it (a newly added entry).
//
// Extracted so the whole-model diff and the single-entry question below are one
// rule with two callers rather than two implementations. They are asked on the two
// different repaint paths — computeModified on a full rebuild, isEntryModified on
// an entry-scoped one — so a divergence here would be a "Modified" dot that
// appears or clears depending on which repaint the user happened to trigger.
function differsFromBaseline(baseline: Map<string, string>, name: string, json: string): boolean {
  return !baseline.has(name) || baseline.get(name) !== json;
}

function serializeEntries(model: any): Map<string, string> {
  const map = new Map<string, string>();
  const sections = (model && model.children) || [];
  for (const section of sections) {
    const entries = (section && section.children) || [];
    for (const entry of entries) {
      map.set(entry.name, entryJson(entry));
    }
  }
  return map;
}

// Capture the current model's entries as the last-saved baseline for a URI.
export function captureBaseline(uriString: string, model: any): void {
  baselines.set(uriString, serializeEntries(model));
}

// Return the set of entry names whose current serialization differs from the
// baseline (or that have no baseline entry = newly added). If NO baseline exists
// for the URI at all (never captured), return an empty set.
export function computeModified(uriString: string, model: any): Set<string> {
  const result = new Set<string>();
  const baseline = baselines.get(uriString);
  if (!baseline) return result;
  const current = serializeEntries(model);
  for (const [name, json] of current) {
    if (differsFromBaseline(baseline, name, json)) {
      result.add(name);
    }
  }
  return result;
}

/**
 * Whether ONE entry differs from the baseline — the same question computeModified
 * answers for a whole model, asked about a single entry.
 *
 * This is what the entry-scoped repaint needs. Calling computeModified there would
 * defeat the point: it serializes every entry in the dictionary (all 31,000 of them
 * on a real customer file) to answer a question about one.
 *
 * Same "no baseline = nothing is modified" answer as computeModified, for the same
 * reason: before the on-open baseline is captured there is nothing to diff against,
 * and reporting everything as modified would be worse than reporting nothing.
 */
export function isEntryModified(uriString: string, entry: any): boolean {
  const baseline = baselines.get(uriString);
  if (!baseline) return false;
  return differsFromBaseline(baseline, entry.name, entryJson(entry));
}

// Drop the baseline for a URI (on editor dispose).
export function clearBaseline(uriString: string): void {
  baselines.delete(uriString);
}
