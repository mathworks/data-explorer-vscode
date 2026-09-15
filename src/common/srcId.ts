// Copyright 2026 The MathWorks, Inc.
// The spelling of a DataModel srcId, in one place.
//
// A srcId is the key a source is registered under in core's DataModel singleton. Two of the
// three table providers use the document's plain uriString. BinarySlddEditorProvider cannot:
// DataModel is a singleton, and its EDITABLE model of a zip .sldd would collide with the
// read-only BinaryEditorProvider's cached model of the very same uri. So it prefixes.
//
// That prefix does not stay inside the host. Core builds every link target as
// `<name>@<srcId>`, so a Data Type link out of an editable binary dictionary reads
// `MyAlias@binedit:file:///w/x.sldd` — which is not a uri. `Uri.parse` accepts it anyway and
// yields a `binedit:`-scheme uri whose path is the whole `file:///…` string, naming no file,
// which the editor router then opens as an empty tab. Anything that turns a srcId back into
// a document must come through `srcIdToUriString`.
export const BINARY_EDIT_SRC_PREFIX = 'binedit:';

// The srcId BinarySlddEditorProvider registers `uriString` under. Paired with
// srcIdToUriString below; keeping both here is what makes the two directions one rule.
export function binaryEditSrcId(uriString: string): string {
  return BINARY_EDIT_SRC_PREFIX + uriString;
}

// The document a srcId names, whichever provider built it. Every spelling but the
// binary-edit one is already a uriString, so this is the identity for those.
export function srcIdToUriString(srcId: string): string {
  return srcId.startsWith(BINARY_EDIT_SRC_PREFIX)
    ? srcId.slice(BINARY_EDIT_SRC_PREFIX.length)
    : srcId;
}
