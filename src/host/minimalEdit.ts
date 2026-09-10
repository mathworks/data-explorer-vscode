// Copyright 2026 The MathWorks, Inc.
//
// The smallest single replacement that turns one text into another.
//
// For the writes that cannot say which region they changed: a same-document move (delete the
// sources, paste the copies — two transforms folded through one text) and a cross-document
// source delete both hand back whole text. Written as a full-document replace, that is VS
// Code rewriting all 47.8 MB of a real dictionary to say a 1 KB thing, and then storing the
// rewrite, so the undo costs the same again.
//
// The transforms that CAN name their region report it themselves (structuralEdit's
// TextPatch) and never come through here.
import type { TextPatch } from './structuralEdit.js';

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * The one region to replace in `oldText` to make it read exactly `newText`.
 *
 * Trims the common prefix and suffix, which is all the safety argument this needs: replacing
 * the middle with the corresponding middle of the new text yields the new text, whatever the
 * two texts are. There is no attempt to find several regions — one is what a WorkspaceEdit
 * range replacement is, and for these callers the change is one contiguous stretch anyway.
 *
 * SURROGATE PAIRS are why the boundaries are nudged. An offset that falls between the two
 * code units of an emoji is not a position VS Code will honour — it validates a range out to
 * the pair boundary, which would move the write and leave the document holding half a
 * character. A real dictionary carries emoji in Description strings, so this is reachable.
 *
 * Identical texts answer with the whole-document replacement rather than an empty edit: that
 * is the edit these callers made before this function existed, and an empty one would not
 * mark the document dirty. No caller reaches it (each of them changed something), but the
 * answer should not depend on that.
 */
export function minimalReplacement(oldText: string, newText: string): TextPatch {
  const shorter = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < shorter && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  if (prefix === oldText.length && oldText.length === newText.length) {
    return { offset: 0, length: oldText.length, text: newText };
  }
  if (prefix > 0 && isHigh(oldText.charCodeAt(prefix - 1)) && isLow(oldText.charCodeAt(prefix))) prefix--;

  // Bounded by what the prefix did not already claim, so the two never overlap — otherwise
  // "aaaa" → "aa" would trim four units off a two-unit change.
  const room = shorter - prefix;
  let suffix = 0;
  while (
    suffix < room &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  const end = oldText.length - suffix;
  if (suffix > 0 && isLow(oldText.charCodeAt(end)) && isHigh(oldText.charCodeAt(end - 1))) suffix--;

  return {
    offset: prefix,
    length: oldText.length - suffix - prefix,
    text: newText.slice(prefix, newText.length - suffix),
  };
}
