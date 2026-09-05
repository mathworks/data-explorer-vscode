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

// The one rule both readers below enforce: a dictionary this host could not read must
// not be handed on as a dictionary with nothing in it. The binary reader answers an
// empty dictionary plus a `source-unreadable` warning rather than throwing — right
// where it lives, since a bad file in a workspace scan should not take the scan down
// and the warning can name the file — so the throw is raised here, at the boundary
// where every caller either skips the file, refuses to save it, or paints an error.
//
// Only a source-level warning counts. `part-unreadable` is one piece of a dictionary
// whose entries are otherwise all there (a sub-dictionary reference whose name could
// not be read), and refusing the whole file for it would lose far more than it reports.
function throwIfUnread(warnings: ParseWarning[]): void {
  const lost = warnings.find((w) => w.code === 'source-unreadable');
  if (lost) throw new Error(lost.message);
}

/**
 * The parsed content of a .sldd. Throws on corrupt input — a caller that wants to
 * skip an unreadable file catches, and one that opens a single file lets the throw
 * become the "Failed to parse" banner.
 *
 * Dispatches on the ZIP magic bytes, never on the extension: a `.sldd` is
 * compressed-binary or JSON text depending only on what MATLAB wrote, and both
 * spellings carry the same extension.
 *
 * The two formats no longer FAIL the same way, which is why `throwIfUnread` is here:
 * `JSON.parse` still throws on a corrupt textual dictionary, and the binary reader
 * recovers, so without it the rule would be true of JSON and silently false of zip.
 */
export function readSlddContent(bytes: ArrayBuffer): Record<string, unknown> {
  const u8 = new Uint8Array(bytes);
  if (!isZipBytes(u8)) return JSON.parse(new TextDecoder().decode(u8)) as Record<string, unknown>;
  const warnings: ParseWarning[] = [];
  const content = parseBinarySldd(bytes, warnings) as Record<string, unknown>;
  throwIfUnread(warnings);
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
): Record<string, unknown> {
  const warnings: ParseWarning[] = [];
  const content = parseBinarySlddParts(chunkXml, zipMeta, warnings);
  throwIfUnread(warnings);
  return content;
}
