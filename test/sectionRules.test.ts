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
});
