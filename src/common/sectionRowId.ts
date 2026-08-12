// Copyright 2026 The MathWorks, Inc.
// Shared helpers for the `section:<name>` row-id convention used in tables.

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
