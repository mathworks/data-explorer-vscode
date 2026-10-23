// Copyright 2026 The MathWorks, Inc.
//
// sectionRules distills, from a live model, the per-section facts the webview
// needs to PREDICT a drop locally (dropDecision) without a host round-trip on
// every dragover: the section name, its human label, whether it is derived
// (architectural), and the classes it accepts. It is posted to each webview
// alongside its rows, and mirrors the section→isderived mapping and the classes
// SectionNode.allowsType admits, so the webview's prediction matches what the
// host paste would actually do.
//
// `allowedTypes` feeds only that prediction: the drop cursor and the Paste item.
// It is what a paste ADMITS (getAdmittedTypes), not what may be CREATED
// (getAllowedTypes). The two differ by the registered subclasses: a paste or drop
// of an mpt.Parameter or mpt.Signal the dictionary already holds lands in Design
// Data, but none can be created there, so the Add gallery keeps reading
// getAllowedTypes. A core without getAdmittedTypes admits exactly its creation
// list, which is the fallback.
import { getSectionMetadata } from 'data-explorer-core';

export interface SectionRule {
  sectionName: string;
  sectionLabel: string;
  isDerived: boolean;
  allowedTypes: string[];
}

export function sectionRules(model: any): SectionRule[] {
  const sections = (model?.children ?? []) as any[];
  return sections.map((s) => ({
    sectionName: s.name,
    sectionLabel: s.displayName ?? s.name,
    isDerived: getSectionMetadata(s.name).isderived === '1',
    allowedTypes:
      typeof s.getAdmittedTypes === 'function'
        ? s.getAdmittedTypes()
        : typeof s.getAllowedTypes === 'function'
          ? s.getAllowedTypes()
          : [],
  }));
}

/**
 * The section name of a document that has no sections: a MAT-file, whose variables are its
 * root node's own children. Its clipboard and drag items carry it as their source section, and
 * the clip mark keys its variables with it (rowStamp.ts), so a same-file move is the usual
 * same-section no-op and nothing downstream needs a case of its own.
 */
export const WHOLE_FILE_SECTION = '';

/**
 * The rules for a document with no section layer: ONE rule, the whole file, which is the one
 * place a paste or a drop into it can land. Posted by the MAT-file's host the way a
 * dictionary's posts `sectionRules`; the webview reads a '' rule as "this table is one target"
 * (table-main's sectionRuleForRow), and no dictionary posts one.
 *
 * `label` is what the drop tooltip and the Paste item name the target by — the file's name,
 * since the file is the target. `allowedTypes` is what core says the file admits to a paste
 * (getAdmittedTypes), for the reason sectionRules reads a section's: the cursor and Paste must
 * predict what core's paste takes. A core without that list restricts nothing here (an empty
 * list), deliberately NOT the creation list the gallery reads (getAllowedTypes): offering a
 * paste core then refuses in its own words is recoverable, refusing one core would take is
 * not even visible.
 */
export function wholeFileRules(model: any, label: string): SectionRule[] {
  let admitted: unknown = [];
  try {
    admitted = typeof model?.getAdmittedTypes === 'function' ? model.getAdmittedTypes() : [];
  } catch {
    admitted = [];
  }
  return [
    {
      sectionName: WHOLE_FILE_SECTION,
      sectionLabel: label,
      isDerived: false,
      allowedTypes: Array.isArray(admitted) ? admitted.filter((t): t is string => typeof t === 'string') : [],
    },
  ];
}
