// Copyright 2026 The MathWorks, Inc.
//
// The drag register is the host-side singleton that holds the rows currently
// being dragged, mirroring the clipboard singleton. HTML5 dataTransfer does not
// survive the webview iframe boundary, so the host holds the payloads and
// broadcasts a lightweight descriptor (source metadata + per-item class/kind,
// but NOT the full payloads) to every webview, which each run dropDecision on
// dragover. Drop reads the payloads back from the register.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setDrag,
  getDrag,
  clearDrag,
  dragDescriptor,
  type DragRegisterItem,
} from '../src/host/dragState.js';

const item = (name: string, className: string, arrayClass: string, kind: string): DragRegisterItem => ({
  payload: { name, metadata: { uuid: 'u-' + name }, value: arrayClass ? { _array_class: arrayClass } : 1 },
  className,
  arrayClass,
  kind,
  isMatlabVariable: !arrayClass,
  isScalarNumeric: !arrayClass,
});

describe('drag register', () => {
  beforeEach(() => clearDrag());

  it('is empty until a drag starts', () => {
    expect(getDrag()).toBeNull();
    expect(dragDescriptor()).toBeNull();
  });

  it('holds the dragged items and their source', () => {
    const items = [item('Bus', 'Simulink.Bus', 'Simulink.Bus', 'Bus')];
    setDrag('a.sldd', 'design', 'Design Data', false, items);
    const d = getDrag();
    expect(d).not.toBeNull();
    expect(d!.sourceDocUri).toBe('a.sldd');
    expect(d!.sourceSection).toBe('design');
    expect(d!.items).toHaveLength(1);
    expect(d!.items[0].payload).toEqual(items[0].payload);
  });

  it('descriptor exposes source + per-item class/kind but NOT the payloads', () => {
    setDrag('a.sldd', 'arch', 'Architectural Data', true, [
      item('DataInterface', 'Simulink.Bus', 'Simulink.Bus', 'Data Interface'),
    ]);
    const desc = dragDescriptor();
    expect(desc).toEqual({
      docUri: 'a.sldd',
      sectionName: 'arch',
      sectionLabel: 'Architectural Data',
      isDerived: true,
      items: [
        {
          className: 'Simulink.Bus',
          arrayClass: 'Simulink.Bus',
          kind: 'Data Interface',
          isMatlabVariable: false,
          isScalarNumeric: false,
        },
      ],
    });
    // The descriptor must not leak the full payloads to the webview.
    expect(JSON.stringify(desc)).not.toContain('_array_class');
  });

  it('clears', () => {
    setDrag('a.sldd', 'design', 'Design Data', false, [item('X', 'Simulink.Bus', 'Simulink.Bus', 'Bus')]);
    clearDrag();
    expect(getDrag()).toBeNull();
    expect(dragDescriptor()).toBeNull();
  });
});
