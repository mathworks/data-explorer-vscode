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
import { parseBinarySldd } from 'data-explorer-core';
import { isZipBytes } from './slddFormat.js';

/**
 * The parsed content of a .sldd. Throws on corrupt input, exactly as the two
 * underlying parsers do — a caller that wants to skip an unreadable file catches.
 *
 * Dispatches on the ZIP magic bytes, never on the extension: a `.sldd` is
 * compressed-binary or JSON text depending only on what MATLAB wrote, and both
 * spellings carry the same extension.
 */
export function readSlddContent(bytes: ArrayBuffer): Record<string, unknown> {
  const u8 = new Uint8Array(bytes);
  return isZipBytes(u8)
    ? (parseBinarySldd(bytes) as Record<string, unknown>)
    : (JSON.parse(new TextDecoder().decode(u8)) as Record<string, unknown>);
}
