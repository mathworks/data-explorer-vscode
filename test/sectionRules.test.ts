// Copyright 2026 The MathWorks, Inc.
//
// sectionRules extracts, from a live model, the per-section facts the webview
// needs to predict a drop with dropDecision (name, label, isDerived, allowed
// types). It is posted to each webview so dragover can run entirely client-side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel } from 'data-explorer-core';
import { getModel, invalidate } from '../src/host/SlddModel.js';
import { sectionRules, wholeFileRules, WHOLE_FILE_SECTION } from '../src/host/sectionRules.js';

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

    // Allow-lists hold what each section admits to a paste (SectionNode.allowsType).
    expect(design!.allowedTypes).toContain('Simulink.Parameter');
    expect(arch!.allowedTypes).not.toContain('Simulink.Parameter');
    expect(arch!.allowedTypes).toContain('Simulink.ServiceBus');

    // A human-readable label for the tooltip.
    expect(design!.sectionLabel).toBe('Design Data');
    expect(arch!.sectionLabel).toBe('Architectural Data');
  });

  // C-180. Core admits a paste or drop of an mpt.Parameter or mpt.Signal entry into Design
  // Data (SectionNode.allowsType, which the host's paste checks), while creating one stays
  // refused (getAllowedTypes, which the Add gallery reads). These lists feed the drop cursor
  // and the Paste item, so they have to say what a paste admits. Posting the creation list
  // made both refuse an mpt entry the host would have accepted.
  it('lists the mpt classes Design Data admits to a paste, and no other section does', () => {
    const uri = 'test://rules-mpt.sldd';
    invalidate(uri);
    const rules = sectionRules(getModel(uri, 'arch.sldd', archText));
    const listOf = (name: string) => rules.find((r) => r.sectionName === name)!.allowedTypes;

    expect(listOf('design')).toContain('mpt.Parameter');
    expect(listOf('design')).toContain('mpt.Signal');
    for (const name of ['arch', 'config', 'other']) {
      expect(listOf(name), name).not.toContain('mpt.Parameter');
      expect(listOf(name), name).not.toContain('mpt.Signal');
    }
  });

  it('agrees with the section’s own allowsType on every class any section names', () => {
    // The prediction is only right if it is the host's answer. allowsType is what the
    // host's paste asks, so for each section and each class, being on the posted list
    // must be the same as allowsType saying yes. All four lists are non-empty, so the
    // "empty list means no restriction" rule never stands in for an answer here.
    const uri = 'test://rules-agree.sldd';
    invalidate(uri);
    const model = getModel(uri, 'arch.sldd', archText);
    const rules = sectionRules(model);
    const sections = model.children as any[];
    const classes = new Set<string>(['mpt.Parameter', 'mpt.Signal', 'NoSuch.Class']);
    for (const s of sections) for (const c of s.getAllowedTypes()) classes.add(c);

    for (const s of sections) {
      const listed = rules.find((r) => r.sectionName === s.name)!.allowedTypes;
      expect(listed.length, s.name).toBeGreaterThan(0);
      for (const c of classes) {
        expect(listed.includes(c), `${s.name}: ${c}`).toBe(s.allowsType(c));
      }
    }
  });

  it('prefers the admitted list to the creation list when a section has both', () => {
    const rules = sectionRules({
      children: [{ name: 'design', getAllowedTypes: () => ['A'], getAdmittedTypes: () => ['A', 'B'] }],
    });
    expect(rules[0].allowedTypes).toEqual(['A', 'B']);
  });

  it('falls back to the creation list on a core whose sections have no admitted list', () => {
    // A core older than C-180 has getAllowedTypes only, and a paste there admits exactly it.
    const rules = sectionRules({ children: [{ name: 'design', getAllowedTypes: () => ['A'] }] });
    expect(rules[0].allowedTypes).toEqual(['A']);
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

// A MAT-file has no section layer: its variables are the root node's children, and the whole
// file is the one place a paste or a drop can land (design D2). So its rules are ONE rule, for
// a section named '' — the name its clipboard and drag items carry as their source section,
// which is what makes a same-file move the usual same-section no-op in dropDecision.
describe('wholeFileRules', () => {
  it("is one rule for the '' section, labelled as the caller says, never derived", () => {
    const rules = wholeFileRules({ getAdmittedTypes: () => ['MatlabVariable', 'Simulink.Parameter'] }, 'gains.mat');
    expect(rules).toEqual([
      { sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: ['MatlabVariable', 'Simulink.Parameter'] },
    ]);
    expect(WHOLE_FILE_SECTION).toBe('');
  });

  it('allows what core says the file admits to a paste, not what its gallery can create', () => {
    // The same split sectionRules makes for a dictionary section (C-180): the gallery reads
    // getAllowedTypes, the paste prediction reads getAdmittedTypes.
    const model = { getAllowedTypes: () => ['MatlabVariable'], getAdmittedTypes: () => ['MatlabVariable', 'Simulink.Bus'] };
    expect(wholeFileRules(model, 'f.mat')[0].allowedTypes).toEqual(['MatlabVariable', 'Simulink.Bus']);
  });

  it('restricts nothing on a core with no admitted list, rather than borrowing the creation list', () => {
    // An empty list is dropDecision's "no restriction": the cursor and Paste then offer what
    // core's own paste is left to refuse with its own words. Borrowing getAllowedTypes would
    // instead refuse, silently, anything the gallery cannot create.
    expect(wholeFileRules({ getAllowedTypes: () => ['MatlabVariable'] }, 'f.mat')[0].allowedTypes).toEqual([]);
    expect(wholeFileRules(null, 'f.mat')[0].allowedTypes).toEqual([]);
  });

  it('a list core cannot give is no restriction too, and never core’s own array', () => {
    expect(wholeFileRules({ getAdmittedTypes: () => { throw new Error('boom'); } }, 'f.mat')[0].allowedTypes).toEqual([]);
    expect(wholeFileRules({ getAdmittedTypes: () => 'Simulink.Bus' }, 'f.mat')[0].allowedTypes).toEqual([]);
    const own = ['MatlabVariable'];
    const listed = wholeFileRules({ getAdmittedTypes: () => own }, 'f.mat')[0].allowedTypes;
    expect(listed).toEqual(own);
    expect(listed).not.toBe(own);
  });

  it("answers a real MatNode with core's admitted list, or none on a core that has none", () => {
    const uri = 'test://rules-whole.mat';
    DataModel.removeDataSource(uri);
    const mat: any = DataModel.addMatSourceParsed(uri, { header: 'MATLAB 5.0', variables: [] }, { path: uri });
    const expected = typeof mat.getAdmittedTypes === 'function' ? mat.getAdmittedTypes() : [];
    expect(wholeFileRules(mat, 'rules-whole.mat')).toEqual([
      { sectionName: '', sectionLabel: 'rules-whole.mat', isDerived: false, allowedTypes: expected },
    ]);
  });

  it('is a rule no dictionary posts: every section of a real dictionary has a name', () => {
    // The webview reads a '' rule as "this table is one target" (sectionRuleForRow), so a
    // dictionary posting one would turn every row-less right-click into a paste target.
    const uri = 'test://rules-noempty.sldd';
    invalidate(uri);
    expect(sectionRules(getModel(uri, 'arch.sldd', archText)).some((r) => r.sectionName === WHOLE_FILE_SECTION)).toBe(false);
  });
});
