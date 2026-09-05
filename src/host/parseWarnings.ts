// Copyright 2026 The MathWorks, Inc.
//
// What this host does with core's parse diagnostics.
//
// Every reader in data-explorer-core can now come back with a `ParseWarning`: the
// source opened, a named piece of it did not, and the tree you are holding is
// therefore short. That is the failure this extension is worst at showing, because
// a short tree renders as a perfectly ordinary table — the sections are there, the
// rows that survived are there, and nothing anywhere says the file had more in it.
// Before this module the warnings were collected and dropped on the floor.
//
// Two decisions live here, and they are here rather than in each provider so that
// three views cannot answer them three ways:
//
//   1. WHICH LOSSES ARE FATAL. `source-unreadable` means the reader found the
//      source, could not read it, recovered, and answered with nothing — so the
//      table would be empty for a file that is not. That is refused: the throw
//      becomes the "Failed to parse" banner every provider already renders, which
//      is the honest answer, and for the writable dictionary editor it is also what
//      keeps a save from zipping that emptiness over the file on disk. Everything
//      else opens and reports.
//
//   2. `source-empty` is NOT fatal, and the line is core's, not ours: it means
//      nothing was found to read rather than something was found and refused. A
//      `.prj` whose store holds no readable entry and a `.sldd` with no content
//      part both say precisely what happened in their own message, and showing that
//      sentence over an empty table tells the user more than "Failed to parse"
//      would. So it becomes the banner's headline instead of an exception.
//
// Kept VS-Code-free: the providers own the postMessage, this owns the rule.
import type { ParseWarning } from 'data-explorer-core';

/** The `code`s that describe the whole source rather than one piece of it. */
const SOURCE_LEVEL = new Set(['source-empty', 'source-unreadable']);

/**
 * How many individual messages the banner spells out. A `.mat` with a truncated
 * record tail can report a warning per variable, and a banner tall enough to hold
 * twenty of them is a banner that hides the table it is describing. The count in
 * the headline is never capped, so the cap can shorten the list without ever
 * understating the loss.
 */
export const MAX_BANNER_DETAILS = 5;

/** The parse-warning banner a table view renders above its rows. */
export interface WarningBanner {
  /** One line: what was lost, in total. Always present. */
  headline: string;
  /** Core's own per-warning messages, deduped and capped. May be empty. */
  details: string[];
}

/**
 * Refuse a source the reader could not read.
 *
 * The binary dictionary readers, the `.mdl` reader and the project reader all
 * recover from a source they cannot read and answer an EMPTY result with a
 * `source-unreadable` warning — right where they live, because a bad file in a
 * workspace scan should not take the scan down and the warning can name the file.
 * This is the boundary that turns that back into a failure, for every format at
 * once, because every caller here either skips the file, refuses to save it, or
 * paints an error.
 *
 * `part-unreadable` deliberately does not qualify: it is one piece of a source
 * whose other pieces are all there, and refusing the whole file for it would lose
 * far more than it reports.
 */
export function refuseIfUnreadable(warnings: ParseWarning[] | undefined): void {
  const lost = warnings?.find((w) => w.code === 'source-unreadable');
  if (lost) {
    throw new Error(lost.message);
  }
}

/**
 * The warnings a registered source node carries, or none.
 *
 * `ISourceNode.warnings` is ABSENT on a clean read rather than empty — core made
 * that choice so a host cannot read a `[]` from a reader with no diagnostics
 * channel as proof the file was whole — so every consumer has to cope with the
 * field not being there. Doing it once here is what stops three providers each
 * writing their own optional chain.
 */
export function sourceWarnings(node: unknown): ParseWarning[] {
  const warnings = (node as { warnings?: unknown } | null | undefined)?.warnings;
  return Array.isArray(warnings) ? (warnings as ParseWarning[]) : [];
}

/**
 * The banner for a source's warnings, or undefined when there is nothing to say.
 *
 * The headline is a source-level warning's own message when there is one, because
 * core writes those as a whole sentence about the whole file ("…so this project
 * reads as empty") and that is the larger fact; otherwise it counts the parts. The
 * details are core's messages verbatim — each already names what it lost, so the
 * `part` field is used to tell two warnings apart here and never rendered.
 */
export function warningBanner(warnings: ParseWarning[] | undefined): WarningBanner | undefined {
  if (!warnings || warnings.length === 0) {
    return undefined;
  }
  // A reader that walks a record chain can reach the same conclusion twice (the
  // same undecoded variable found through two paths), and one loss should read as
  // one line. `part` is in the key because two parts legitimately share a message.
  const seen = new Set<string>();
  const unique: ParseWarning[] = [];
  for (const w of warnings) {
    const key = `${w.code}\n${w.part ?? ''}\n${w.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(w);
  }

  const sourceLevel = unique.find((w) => SOURCE_LEVEL.has(w.code));
  const rest = unique.filter((w) => w !== sourceLevel);
  const headline = sourceLevel
    ? sourceLevel.message
    : rest.length === 1
      ? 'One part of this file could not be read, so what you see below is incomplete.'
      : `${rest.length} parts of this file could not be read, so what you see below is incomplete.`;

  const details = rest.slice(0, MAX_BANNER_DETAILS).map((w) => w.message);
  const hidden = rest.length - details.length;
  if (hidden > 0) {
    details.push(`…and ${hidden} more.`);
  }
  return { headline, details };
}
