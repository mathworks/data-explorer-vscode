// Copyright 2026 The MathWorks, Inc.
//
// Read a .sldd's content object out of its bytes, whichever of the two on-disk
// formats it is. Both formats deserialize to the SAME in-memory shape
// (`__MW_TEXT_PARTS__` → `__MW_TEXT_PART__/data/chunk0` → `__MW_TEXT_content`),
// which is why every consumer downstream — the datamodel, the name index, the
// usage graph — can be format-agnostic once it holds this object.
//
// Split out because the format dispatch itself was written three times (the
// datamodel loader, the name index, the usage graph), each an independent chance
// to test the wrong thing: gating on the FILENAME instead of the magic bytes, for
// instance, silently reads a compressed dictionary as JSON and yields no entries
// at all. Two of the three callers import `vscode`, so their copies sat in the
// coverage-excluded set; here it is measurable.
//
// Kept VS-Code-free.
import { parseBinarySldd, parseBinarySlddParts, type ParseWarning } from 'data-explorer-core';
import { isZipBytes } from './slddFormat.js';
import { refuseIfUnreadable } from './parseWarnings.js';

/**
 * The parsed content of a .sldd. Throws on corrupt input — a caller that wants to
 * skip an unreadable file catches, and one that opens a single file lets the throw
 * become the "Failed to parse" banner.
 *
 * Dispatches on the ZIP magic bytes, never on the extension: a `.sldd` is
 * compressed-binary or JSON text depending only on what MATLAB wrote, and both
 * spellings carry the same extension.
 *
 * The two formats no longer FAIL the same way, which is why `refuseIfUnreadable` is
 * called here: `JSON.parse` still throws on a corrupt textual dictionary, and the
 * binary reader recovers, so without it the rule would be true of JSON and silently
 * false of zip.
 *
 * `warnings`, when a caller brings one, collects what the read survived — core's own
 * out-parameter convention, and the array the caller then hands to
 * `DataModel.addDataSource` so the node layer appends its findings to the SAME list
 * and one file reports one list. A caller with nothing to report it to passes
 * nothing, and the fatal warning is refused either way.
 */
export function readSlddContent(
  bytes: ArrayBuffer,
  warnings?: ParseWarning[],
): Record<string, unknown> {
  const u8 = new Uint8Array(bytes);
  if (!isZipBytes(u8)) return JSON.parse(new TextDecoder().decode(u8)) as Record<string, unknown>;
  const collected = warnings ?? [];
  const content = parseBinarySldd(bytes, collected) as Record<string, unknown>;
  refuseIfUnreadable(collected);
  return content;
}

/**
 * The same read for a live `data/chunk0.xml` string plus the pass-through zip parts —
 * what the writable binary editor holds between edits, with no zip round-trip.
 *
 * Same rule, and it is load-bearing at every one of that provider's call sites: the
 * paint path would render a table with zero rows for a dictionary it could not read
 * instead of the "Failed to parse" banner, and the save gate would zip that
 * reads-as-empty content over a good file on disk.
 */
export function readSlddParts(
  chunkXml: string,
  zipMeta: Record<string, Uint8Array>,
  warnings?: ParseWarning[],
): Record<string, unknown> {
  const collected = warnings ?? [];
  const content = parseBinarySlddParts(chunkXml, zipMeta, collected);
  refuseIfUnreadable(collected);
  return content;
}
