// Copyright 2026 The MathWorks, Inc.
//
// dropDecision is the PURE predictor behind the drag-and-drop cursor and hover
// tooltip. The bottom line it must honor: drag-drop mirrors cut/copy-paste — if
// you can cut/copy you can drag, and if you can paste you can drop. So its
// accept/reject logic mirrors pasteEntry's allow-check exactly, and its labels
// mirror the Kind an entry shows AFTER the paste (a pasted entry loses its
// SystemComposer classification, so a derived Bus becomes a "Data Interface").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dropDecision, isNoopMove, rejectReason } from '../src/view/model/actions/dropDecision.js';
import { getModel, invalidate } from '../src/view/model/workspace/SlddModel.js';
import { sectionRules } from '../src/view/model/actions/sectionRules.js';

// Allow-lists mirror SectionNode.ALLOWED_TYPES (only the classes these tests use).
// 'MatlabVariable' and 'Constant' are in the real lists too, and they matter here:
// a classless payload is judged by the one it will BE in the target section, so a
// list that omitted them would refuse an ordinary variable.
const DESIGN_ALLOWED = [
  'MatlabVariable',
  'MatlabStruct',
  'Simulink.Signal',
  'Simulink.Bus',
  'Simulink.ConnectionBus',
  'Simulink.Parameter',
  'Simulink.ValueType',
  'Simulink.NumericType',
];
const ARCH_ALLOWED = [
  'Constant',
  'Simulink.Signal',
  'Simulink.Bus',
  'Simulink.ConnectionBus',
  'Simulink.ServiceBus',
  'Simulink.ValueType',
  'Simulink.NumericType',
];
// Configurations: the section behind the reported defect. It holds config objects
// and nothing else — in particular no MatlabVariable, which is why a classless
// payload must be judged rather than waved through.
const CONFIG_ALLOWED = [
  'Simulink.ConfigSet',
  'Simulink.ConfigSetRef',
  'Simulink.VariantConfigurationData',
  'Simulink.VariantConfigurations',
];

// Each item carries the section it was dragged from, as the drag descriptor's do.
function designSource(items: any[], docUri = 'a.sldd') {
  return { docUri, items: items.map((it) => ({ ...it, sectionName: 'design' })) };
}
function archSource(items: any[], docUri = 'a.sldd') {
  return { docUri, items: items.map((it) => ({ ...it, sectionName: 'arch' })) };
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
function configTarget(docUri = 'a.sldd') {
  return {
    docUri,
    sectionName: 'config',
    sectionLabel: 'Configurations',
    isDerived: false,
    allowedTypes: CONFIG_ALLOWED,
  };
}

// Convenience item builders. Object entries carry isScalarNumeric: false — it is
// only consulted for MATLAB variables (isMatlabVariable), so its value is inert
// for objects; the field is required by the DragItem type.
const bus = (kind = 'Bus') => ({ className: 'Simulink.Bus', arrayClass: 'Simulink.Bus', kind, isMatlabVariable: false, isScalarNumeric: false });
const dataInterface = () => bus('Data Interface');
const param = () => ({
  className: 'Simulink.Parameter',
  arrayClass: 'Simulink.Parameter',
  kind: 'Simulink Parameter',
  isMatlabVariable: false,
  isScalarNumeric: false,
});
const service = () => ({
  className: 'Simulink.ServiceBus',
  arrayClass: 'Simulink.ServiceBus',
  kind: 'Service Interface',
  isMatlabVariable: false,
  isScalarNumeric: false,
});
// A scalar-numeric MATLAB variable (the common case — a Constant-eligible value).
const matlabVar = (kind = 'MATLAB Variable') => ({
  className: 'double',
  arrayClass: '',
  kind,
  isMatlabVariable: true,
  isScalarNumeric: true,
});
// A NON-scalar-numeric MATLAB variable (an array/struct/cell) — cannot become a
// Constant, so it must be rejected when dropped into Architectural Data.
const nonScalarVar = (kind = 'MATLAB Variable') => ({
  className: 'double',
  arrayClass: '',
  kind,
  isMatlabVariable: true,
  isScalarNumeric: false,
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

  it('accepts a scalar-numeric MATLAB variable into arch (it becomes a Constant)', () => {
    // A MATLAB variable has no _array_class; a scalar-numeric one is a valid
    // Constant, so it drops into arch.
    const d = dropDecision(designSource([matlabVar()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
  });
});

describe('dropDecision — a MATLAB variable is judged by the allow-list, not waived', () => {
  // The reported defect, on the predictor side: a variable carries no _array_class,
  // and "no class" was read as "no restriction" — so the cursor invited a drop into
  // Configurations that the file format cannot hold.
  it('rejects a scalar-numeric MATLAB variable dropped into Configurations', () => {
    const d = dropDecision(designSource([matlabVar()], 'b.sldd'), configTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
    expect(d.tooltip).toBe('MATLAB Variable cannot be in Configurations');
  });

  it('rejects a non-scalar MATLAB variable dropped into Configurations', () => {
    const d = dropDecision(designSource([nonScalarVar()], 'b.sldd'), configTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('MATLAB Variable cannot be in Configurations');
  });

  it('rejects an object entry Configurations cannot hold either', () => {
    // The path that already worked, kept beside the one that did not, so the pair
    // reads as one rule rather than two.
    const d = dropDecision(designSource([param()], 'b.sldd'), configTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('Simulink Parameter cannot be in Configurations');
  });

  it('multi-select into Configurations: the variable rejects the whole drop', () => {
    const d = dropDecision(designSource([matlabVar(), matlabVar()], 'b.sldd'), configTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('MATLAB Variable cannot be in Configurations');
  });
});

describe('dropDecision — Variable→Constant scalar-numeric gate', () => {
  it('rejects a NON-scalar-numeric MATLAB variable dropped into Architectural Data', () => {
    // An array/struct/cell variable can't become a (scalar) Constant.
    const d = dropDecision(designSource([nonScalarVar()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
    expect(d.tooltip).toBe('MATLAB Variable must be scalar and numeric to be a Constant');
  });

  it('allows a NON-scalar-numeric MATLAB variable within Design Data (stays a Variable)', () => {
    // Moving among Design Data keeps it a MATLAB Variable — no Constant rule applies.
    const d = dropDecision(designSource([nonScalarVar()], 'b.sldd'), designTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(true);
  });

  it('multi-select into arch: one non-scalar variable rejects the whole drop', () => {
    const d = dropDecision(designSource([matlabVar(), nonScalarVar()], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('MATLAB Variable must be scalar and numeric to be a Constant');
  });
});

describe('dropDecision — dynamic can-drop tooltip mirrors the post-paste Kind', () => {
  it('design Bus -> another design section in COPY mode reads "Copy Bus"', () => {
    const d = dropDecision(designSource([bus()], 'b.sldd'), designTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy Bus');
  });

  it('design Bus -> another design section in MOVE mode reads "Move Bus"', () => {
    const d = dropDecision(designSource([bus()], 'b.sldd'), designTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Move Bus');
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
    expect(d.tooltip).toBe('Copy Bus');
  });

  it('cross-doc same-section-name move is NOT a no-op', () => {
    const d = dropDecision(designSource([bus()], 'a.sldd'), designTarget('b.sldd'), 'move');
    expect(d.noop).toBe(false);
    expect(d.canDrop).toBe(true);
  });
});

// A MAT-file is ONE target: its host posts a rule for section '' and its items carry '' as
// their source section (design D2), so the same-section rule above needs no case of its own.
describe("dropDecision — a section-less document's '' section", () => {
  const matTarget = (docUri = 'gains.mat') => ({
    docUri, sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: ['MatlabVariable', 'Simulink.Parameter'],
  });
  const fromMat = (items: any[], docUri = 'gains.mat') => ({ docUri, items: items.map((it) => ({ ...it, sectionName: '' })) });

  it('a move within one MAT-file is the same-section no-op; a copy duplicates', () => {
    expect(dropDecision(fromMat([param()]), matTarget(), 'move')).toMatchObject({ noop: true, canDrop: false });
    expect(dropDecision(fromMat([param()]), matTarget(), 'copy')).toMatchObject({ noop: false, canDrop: true });
  });

  it('between two MAT-files, or a dictionary and a MAT-file, a move really moves', () => {
    expect(dropDecision(fromMat([param()], 'other.mat'), matTarget(), 'move')).toMatchObject({ noop: false, canDrop: true });
    expect(dropDecision(designSource([param()], 'gains.mat'), matTarget(), 'move').noop).toBe(false);
    expect(dropDecision(fromMat([bus()]), designTarget('gains.mat'), 'move').noop).toBe(false);
  });

  it('an item that names no section is never part of a no-op, even onto the empty-named one', () => {
    // dragState items always name one; a clipboard item from an older host may not, and
    // `undefined` must not read as ''.
    expect(dropDecision({ docUri: 'gains.mat', items: [param()] }, matTarget(), 'move').noop).toBe(false);
  });

  it("refuses what the file does not admit, naming the file", () => {
    expect(dropDecision(designSource([bus()], 'a.sldd'), matTarget(), 'move')).toMatchObject({
      canDrop: false,
      tooltip: 'Bus cannot be in gains.mat',
    });
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

  it('multiple allowed same-shape items in COPY mode use a count label', () => {
    const d = dropDecision(designSource([bus(), bus()], 'b.sldd'), designTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy 2 items');
  });

  it('multiple allowed same-shape items in MOVE mode use a count label', () => {
    const d = dropDecision(designSource([bus(), bus()], 'b.sldd'), designTarget('a.sldd'), 'move');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Move 2 items');
  });
});

describe('dropDecision — empty payload', () => {
  it('no items cannot drop', () => {
    const d = dropDecision(designSource([], 'b.sldd'), archTarget('a.sldd'), 'copy');
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
  });

  it('a descriptor with no items list at all reads as nothing to drop', () => {
    // The descriptor arrives over postMessage from the host, so its shape is not
    // guaranteed by this module's types. This runs inside a dragover handler,
    // where a throw would leave the cursor stuck mid-drag with no way to cancel;
    // "nothing to drop" is the answer that keeps the drag cancellable.
    const d = dropDecision(
      { docUri: 'b.sldd' } as any,
      archTarget('a.sldd'),
      'copy',
    );
    expect(d.canDrop).toBe(false);
    expect(d.cursor).toBe('no-drop');
    expect(d.tooltip).toBe('Nothing to drop');
  });
});

describe('dropDecision — a target with no allow-list is unrestricted', () => {
  // SectionNode.allowsType treats an empty allowed-types list as "no restriction"
  // (`allowed.length === 0 || …`), and sectionRules ships [] for any section that
  // has no ALLOWED_TYPES entry. The predictor must mirror that, or the webview
  // would show no-drop for a drop the host would happily accept — the exact
  // drag/paste divergence this module exists to prevent.
  const unrestricted = (docUri = 'a.sldd') => ({
    docUri,
    sectionName: 'custom',
    sectionLabel: 'Custom Section',
    isDerived: false,
    allowedTypes: [] as string[],
  });

  it('accepts an object entry that no allow-list mentions', () => {
    const d = dropDecision(designSource([param()], 'b.sldd'), unrestricted('a.sldd'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.cursor).toBe('copy');
  });

  it('accepts a class that the restricted sections would both reject', () => {
    // Simulink.ServiceBus has no home in Design Data; an unrestricted section
    // still takes it.
    const d = dropDecision(archSource([service()], 'b.sldd'), unrestricted('a.sldd'), 'move');
    expect(d.canDrop).toBe(true);
  });

  it('still applies the Variable→Constant gate when unrestricted AND derived', () => {
    // "No allow-list" only waives the CLASS check. A derived section must still
    // reject a non-scalar variable, since it would become an invalid Constant.
    const d = dropDecision(
      designSource([nonScalarVar()], 'b.sldd'),
      { ...unrestricted('a.sldd'), isDerived: true },
      'copy',
    );
    expect(d.canDrop).toBe(false);
    expect(d.tooltip).toBe('MATLAB Variable must be scalar and numeric to be a Constant');
  });
});

// C-180. Core admits a paste of an mpt.Parameter or mpt.Signal entry into Design Data, and
// nowhere else. The targets here are built by sectionRules from a real model, not from a list
// written in this file, so they say what the host's paste would say.
describe('dropDecision — an mpt entry, against the rules a real model posts', () => {
  const archText = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');
  function realTarget(sectionName: string) {
    const uri = 'test://drop-mpt.sldd';
    invalidate(uri);
    const rule = sectionRules(getModel(uri, 'arch.sldd', archText)).find((r) => r.sectionName === sectionName)!;
    return { docUri: 'a.sldd', ...rule };
  }
  // The facts a drag of a MATLAB-written mpt entry carries: its node is a ParameterNode or
  // SignalNode, so the Kind is the superclass's.
  const mptParam = () => ({ ...param(), className: 'mpt.Parameter', arrayClass: 'mpt.Parameter' });
  const mptSignal = () => ({
    className: 'mpt.Signal',
    arrayClass: 'mpt.Signal',
    kind: 'Simulink Signal',
    isMatlabVariable: false,
    isScalarNumeric: false,
  });

  it('lets an mpt.Parameter or mpt.Signal into Design Data', () => {
    expect(rejectReason(realTarget('design'), mptParam())).toBeNull();
    expect(rejectReason(realTarget('design'), mptSignal())).toBeNull();
    const d = dropDecision(designSource([mptParam(), mptSignal()], 'b.sldd'), realTarget('design'), 'copy');
    expect(d.canDrop).toBe(true);
    expect(d.tooltip).toBe('Copy 2 items');
  });

  it('still refuses them in Architectural Data and Configurations', () => {
    expect(rejectReason(realTarget('arch'), mptParam())).toBe('Simulink Parameter cannot be in Architectural Data');
    expect(rejectReason(realTarget('arch'), mptSignal())).toBe('Simulink Signal cannot be in Architectural Data');
    expect(rejectReason(realTarget('config'), mptParam())).toBe('Simulink Parameter cannot be in Configurations');
  });
});

// The no-op is one rule asked from two places: a drop (dropDecision) and the Paste of a cut
// (menuItems, review #7). isNoopMove IS that rule; this pins dropDecision to it, case by case.
describe('isNoopMove — the rule dropDecision\'s no-op is', () => {
  const docs = ['a.sldd', 'b.sldd'];
  const sectionSets = [['design'], ['arch'], ['design', 'design'], ['design', 'arch'], [''], []];
  for (const docUri of docs) {
    for (const sections of sectionSets) {
      for (const mode of ['move', 'copy'] as const) {
        it(`${docUri} ${JSON.stringify(sections)} ${mode} onto a.sldd design`, () => {
          const source = { docUri, items: sections.map((sectionName) => ({ ...bus(), sectionName })) };
          const target = designTarget('a.sldd');
          expect(dropDecision(source, target, mode).noop).toBe(isNoopMove(source, target, mode));
        });
      }
    }
  }

  it('is never a no-op without a source document or a target section to compare', () => {
    const items = [{ ...bus(), sectionName: 'design' }];
    expect(isNoopMove({ docUri: '', items }, { ...designTarget(''), docUri: '' }, 'move')).toBe(false);
    expect(isNoopMove({ docUri: 'a.sldd', items: [bus()] }, { ...designTarget('a.sldd'), sectionName: undefined as any }, 'move')).toBe(false);
  });
});

// An entry whose name its document holds twice (a MAT-file's two records of one name) can be
// copied, never moved — the host refuses the move (transfer.ts), so the cursor does too. The
// no-op of a move back into its own file is still the no-op.
describe('a dragged entry that shares its name in its file', () => {
  const FILE = { docUri: 'file:///gains.mat', sectionName: '', sectionLabel: 'gains.mat', isDerived: false, allowedTypes: [] as string[] };
  const DICT = { docUri: 'file:///d.sldd', sectionName: 'design', sectionLabel: 'Design Data', isDerived: false, allowedTypes: DESIGN_ALLOWED };
  const x = { className: 'double', arrayClass: '', kind: 'MATLAB Variable', isMatlabVariable: true, isScalarNumeric: true, sectionName: '', sharedName: true };
  const kp = { ...x, sharedName: undefined };
  const source = { docUri: 'file:///gains.mat', items: [kp, x] };

  it('refuses a move anywhere, saying to copy it', () => {
    for (const target of [DICT, { ...FILE, docUri: 'file:///other.mat' }]) {
      expect(dropDecision(source, target, 'move')).toEqual({
        canDrop: false,
        cursor: 'no-drop',
        tooltip: 'Its name is not unique in its file: copy it instead',
        noop: false,
      });
    }
  });

  it('allows a copy', () => {
    expect(dropDecision(source, DICT, 'copy')).toMatchObject({ canDrop: true, cursor: 'copy' });
  });

  it('moved within its own file, is the no-op', () => {
    expect(dropDecision(source, FILE, 'move')).toMatchObject({ canDrop: false, noop: true });
  });
});
