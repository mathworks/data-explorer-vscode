// Copyright 2026 The MathWorks, Inc.
//
// dropDecision is the PURE predictor behind the drag-and-drop cursor and hover
// tooltip. The bottom line it must honor: drag-drop mirrors cut/copy-paste — if
// you can cut/copy you can drag, and if you can paste you can drop. So its
// accept/reject logic mirrors pasteEntry's allow-check exactly, and its labels
// mirror the Kind an entry shows AFTER the paste (a pasted entry loses its
// SystemComposer classification, so a derived Bus becomes a "Data Interface").
import { describe, it, expect } from 'vitest';
import { dropDecision } from '../src/webview/dropDecision.js';

// Allow-lists mirror SectionNode.ALLOWED_TYPES (only the classes these tests use).
const DESIGN_ALLOWED = [
  'Simulink.Signal',
  'Simulink.Bus',
  'Simulink.ConnectionBus',
  'Simulink.Parameter',
  'Simulink.ValueType',
  'Simulink.NumericType',
];
const ARCH_ALLOWED = [
  'Simulink.Signal',
  'Simulink.Bus',
  'Simulink.ConnectionBus',
  'Simulink.ServiceBus',
  'Simulink.ValueType',
  'Simulink.NumericType',
];

function designSource(items: any[], docUri = 'a.sldd') {
  return { docUri, sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, items };
}
function archSource(items: any[], docUri = 'a.sldd') {
  return { docUri, sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, items };
}
function designTarget(docUri = 'a.sldd') {
  return {
    docUri,
    sectionName: 'design',
    sectionLabel: 'Design Data',
    isDerived: false,
    allowedTypes: DESIGN_ALLOWED,
  };
}
function archTarget(docUri = 'a.sldd') {
  return { docUri, sectionName: 'arch', sectionLabel: 'Architectural Data', isDerived: true, allowedTypes: ARCH_ALLOWED };
}

// Convenience item builders.
const bus = (kind = 'Bus') => ({ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind, isMatlabVariable: false });
const dataInterface = () => bus('Data Interface');
const param = () => ({
  className: 'Simulink.Parameter',
  arrayClass: 'Simulink.Parameter',
  kind: 'Simulink Parameter',
  isMatlabVariable: false,
});
const service = () => ({
  className: 'Simulink.ServiceBus',
  arrayClass: 'Simulink.ServiceBus',
  kind: 'Service Interface',
  isMatlabVariable: false,
});
const matlabVar = (kind = 'MATLAB Variable') => ({
  className: 'double',
  arrayClass: '',
  kind,
  isMatlabVariable: true,
});

describe('dropDecision — accept/reject mirrors pasteEntry allow-check', () => {
  it('rejects a Simulink.Parameter dropped into Architectural Data with a reason tooltip', () => {
    const d = dropDecision(designSource([param()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
    expect(d.tooltip).toBe('Simulink Parameter cannot be in Architectural Data');
  });

  it('rejects a ServiceInterface dropped into Design Data', () => {
    const d = dropDecision(archSource([service()], 'b.sldd'), designTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
    expect(d.tooltip).toBe('Service Interface cannot be in Design Data');
  });

  it('accepts a Bus into Architectural Data (allowed type)', () => {
    const d = dropDecision(designSource([bus()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
  });

  it('accepts a MATLAB variable into any section (empty array-class skips the check)', () => {
    // A MATLAB variable has no _array_class, so pasteEntry never rejects it —
    // even into arch, where it becomes a Constant.
    const d = dropDecision(designSource([matlabVar()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
  });
});

describe('dropDecision — dynamic can-drop tooltip mirrors the post-paste Kind', () => {
  it('design Bus -> another design section reads "Copy/Move Bus"', () => {
    const d = dropDecision(designSource([bus()], 'b.sldd'), designTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy/Move Bus');
  });

  it('design Bus -> arch reads "Convert Bus to Data Interface"', () => {
    const d = dropDecision(designSource([bus()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Convert Bus to Data Interface');
  });

  it('arch Data Interface -> design reads "Convert Data Interface to Bus"', () => {
    const d = dropDecision(archSource([dataInterface()], 'b.sldd'), designTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Convert Data Interface to Bus');
  });

  it('a MATLAB variable design -> arch reads "Convert MATLAB Variable to Constant"', () => {
    const d = dropDecision(designSource([matlabVar()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.tooltip).toBe('Convert MATLAB Variable to Constant');
  });
});

describe('dropDecision — cursor reflects the drag mode', () => {
  it('copy mode yields a copy cursor', () => {
    expect(dropDecision(designSource([bus()], 'b.sldd'), archTarget('a.sldd'), 'copy').cursor).toBe('copy');
  });
  it('move mode yields a move cursor', () => {
    expect(dropDecision(designSource([bus()], 'b.sldd'), designTarget('a.sldd'), 'move').cursor).toBe('move');
  });
});

describe('dropDecision — same-section move is a no-op', () => {
  it('same doc + same section + move is a no-op (no delete/re-add)', () => {
    const d = dropDecision(designSource([bus()], 'a.sldd'), designTarget('a.sldd'), 'move');
    expect(d.noop).toBe(true);
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
  });

  it('same doc + same section + COPY still duplicates (not a no-op)', () => {
    const d = dropDecision(designSource([bus()], 'a.sldd'), designTarget('a.sldd'), 'copy');
    expect(d.noop).toBe(false);
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy/Move Bus');
  });

  it('cross-doc same-section-name move is NOT a no-op', () => {
    const d = dropDecision(designSource([bus()], 'a.sldd'), designTarget('b.sldd'), 'move');
    expect(d.noop).toBe(false);
    expect(d.canDrop).toBe(true);
  });
});

describe('dropDecision — multi-select: any rejected rejects all', () => {
  it('a Bus + a Parameter dropped into arch is rejected (the Parameter has no home)', () => {
    const d = dropDecision(designSource([bus(), param()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('Simulink Parameter cannot be in Architectural Data');
  });

  it('multiple allowed items use a count label', () => {
    const d = dropDecision(designSource([bus(), bus()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Convert 2 items to Architectural Data');
  });

  it('multiple allowed same-shape items use a count label', () => {
    const d = dropDecision(designSource([bus(), bus()], 'b.sldd'), designTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy/Move 2 items');
  });
});

describe('dropDecision — empty payload', () => {
  it('no items cannot drop', () => {
    const d = dropDecision(designSource([], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
  });
});
