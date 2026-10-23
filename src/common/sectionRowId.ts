// Copyright 2026 The MathWorks, Inc.
// Shared helpers for the `section:<name>` row-id convention used in tables, and the
// section name of a document that has no sections.

/**
 * The section name of a document that has no sections: a MAT-file, whose variables are its
 * root node's own children. Its clipboard and drag items carry it as their source section, and
 * the clip mark keys its variables with it (rowStamp.ts), so a same-file move is the usual
 * same-section no-op and nothing downstream needs a case of its own.
 *
 * Here rather than beside the rule that carries it because both sides of the postMessage
 * spell it: the host posts its one rule under it (sectionRules.wholeFileRules) and the
 * webview finds that rule by it (table-main's wholeFileRule). Two copies of '' would be the
 * same rule along two paths with nothing to say they agree.
 */
export const WHOLE_FILE_SECTION = '';

/** The prefix that marks a row id as a section header. */
export const SECTION_ROW_PREFIX = 'section:';

/** Build a section header row id from a section name. */
export function buildSectionRowId(name: string): string {
  return `${SECTION_ROW_PREFIX}${name}`;
}

/** True if `id` is a section header row id. */
export function isSectionRowId(id: string): boolean {
  return id.startsWith(SECTION_ROW_PREFIX);
}

/** Extract the section name from a section row id, or null if it isn't one. */
export function sectionNameFromRowId(id: string): string | null {
  if (!isSectionRowId(id)) return null;
  return id.slice(SECTION_ROW_PREFIX.length);
}
