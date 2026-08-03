// Copyright 2026 The MathWorks, Inc.
// Health model for the Data Explorer tree. Pure and vscode-free so it can be
// unit-tested and shared between the tree provider (which encodes state into a
// resourceUri) and the FileDecorationProvider (which decodes it into a badge).
//
// The tree renders the same file at multiple positions; VS Code dedupes
// decorations by URI. To decorate one position differently from another (a
// circular-reference repeat vs. the file's canonical row), the tree encodes the
// health state into the resourceUri's query (`?dexHealth=<state>`). This module
// owns that encoding and the state -> badge/color/tooltip mapping.

// `missing` is handled by the tree's own TreeItem (no real file URI exists for
// an unresolved reference), so it is not a FileDecoration state here.
export type HealthState = 'cycle' | 'modified';

export const HEALTH_QUERY = 'dexHealth';

export interface HealthDecoration {
  /** Badge text — VS Code allows at most 2 characters. */
  badge: string;
  /** A VS Code ThemeColor id (adapts to the active theme). */
  colorId: string;
  tooltip: string;
}

// State -> presentation. Badges are <= 2 chars per the VS Code FileDecoration API.
export const DECORATIONS: Record<HealthState, HealthDecoration> = {
  cycle: {
    badge: '↻',
    colorId: 'list.warningForeground',
    tooltip: 'Circular reference — this link closes a cycle',
  },
  modified: {
    badge: '●',
    colorId: 'gitDecoration.modifiedResourceForeground',
    tooltip: 'Modified — unsaved changes in an open editor',
  },
};

const VALID = new Set<string>(['cycle', 'modified']);

/** Encode a health state as a resourceUri query string, e.g. `dexHealth=cycle`. */
export function encode(state: HealthState): string {
  return `${HEALTH_QUERY}=${state}`;
}

/**
 * Decode a health state from a resourceUri query string. Returns null when the
 * query carries no (recognized) health state, so a plain file URI decorates as
 * nothing.
 */
export function decode(query: string | undefined): HealthState | null {
  if (!query) {
    return null;
  }
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) {
      continue;
    }
    if (pair.slice(0, eq) === HEALTH_QUERY) {
      const value = pair.slice(eq + 1);
      return VALID.has(value) ? (value as HealthState) : null;
    }
  }
  return null;
}
