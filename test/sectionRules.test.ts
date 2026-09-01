// Copyright 2026 The MathWorks, Inc.
//
// sectionRules extracts, from a live model, the per-section facts the webview
// needs to predict a drop with dropDecision (name, label, isDerived, allowed
// types). It is posted to each webview so dragover can run entirely client-side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { sectionRules } from '../src/host/sectionRules.js';

const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');

describe('sectionRules', () => {
  it('returns one rule per section with its allow-list and derived flag', () => {
    const uri = 'test://rules.sldd';
    invalidate(uri);
    const m = getModel(uri, 'arch.sldd', archText);
    const rules = sectionRules(m);

    const design = rules.find((r) => r.sectionName === 'design');
    const arch = rules.find((r) => r.sectionName === 'arch');
    expect(design).toBeTruthy();
    expect(arch).toBeTruthy();

    // Derived flag distinguishes arch from design.
    expect(design!.isDerived).toBe(false);
    expect(arch!.isDerived).toBe(true);

    // Allow-lists mirror SectionNode.ALLOWED_TYPES.
    expect(design!.allowedTypes).toContain('Simulink.Parameter');
    expect(arch!.allowedTypes).not.toContain('Simulink.Parameter');
    expect(arch!.allowedTypes).toContain('Simulink.ServiceBus');

    // A human-readable label for the tooltip.
    expect(design!.sectionLabel).toBe('Design Data');
    expect(arch!.sectionLabel).toBe('Architectural Data');
  });

  it('covers all four .sldd sections so no section is left unpredictable', () => {
    // sectionRuleForRow returns null for a section with no rule, and predictDrop
    // then bails — dragging onto that section would silently fall back to the
    // browser default instead of the host's own accept/reject decision.
    const uri = 'test://rules-all.sldd';
    invalidate(uri);
    const rules = sectionRules(getModel(uri, 'arch.sldd', archText));
    expect(rules.map((r) => r.sectionName)).toEqual(['design', 'arch', 'config', 'other']);
  });

  it('yields no rules for a model with no sections rather than throwing', () => {
    // Both callers pass whatever node the provider resolved; a nullish/parentless
    // one must degrade to "cannot predict", not break the whole webview post.
    expect(sectionRules(null)).toEqual([]);
    expect(sectionRules(undefined)).toEqual([]);
    expect(sectionRules({})).toEqual([]);
  });

  it('reports an empty allow-list for a section that declares no restriction', () => {
    // dropDecision treats [] as "no restriction" and permits the drop. A .slx
    // model's sections (ModelSectionNode) have no getAllowedTypes at all, so the
    // shape must still be a real array — `undefined` would crash the predictor on
    // .allowedTypes.length during dragover.
    const rules = sectionRules({ children: [{ name: 'blocks', displayName: 'Model Elements' }] });
    expect(rules).toEqual([
      { sectionName: 'blocks', sectionLabel: 'Model Elements', isDerived: false, allowedTypes: [] },
    ]);
  });

  it('falls back to the section name when the node exposes no display label', () => {
    // The label is what the drop tooltip says ("Move into <label>"); an empty one
    // would read as "Move into ".
    const rules = sectionRules({ children: [{ name: 'design' }] });
    expect(rules[0].sectionLabel).toBe('design');
    // Still resolved through the real section metadata, not defaulted.
    expect(rules[0].sectionName).toBe('design');
  });

  it('treats an unknown section name as non-derived', () => {
    // isDerived drives the "architectural data is read-only" refusal; defaulting an
    // unrecognized section to derived would forbid drops the host would accept.
    const rules = sectionRules({ children: [{ name: 'notASection' }] });
    expect(rules[0].isDerived).toBe(false);
  });
});
