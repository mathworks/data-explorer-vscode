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
