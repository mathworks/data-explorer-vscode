// Copyright 2026 The MathWorks, Inc.
//
// sectionRules distills, from a live model, the per-section facts the webview
// needs to PREDICT a drop locally (dropDecision) without a host round-trip on
// every dragover: the section name, its human label, whether it is derived
// (architectural), and the classes it accepts. It is posted to each webview
// alongside its rows, and mirrors SectionNode's allow-list + the section→
// isderived mapping so the webview's prediction matches what the host paste
// would actually do.
import { getSectionMetadata } from '../dex/datamodel/SectionConstants.js';

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
    allowedTypes: typeof s.getAllowedTypes === 'function' ? s.getAllowedTypes() : [],
  }));
}
