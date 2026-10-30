// Copyright 2026 The MathWorks, Inc.
//
// The registers view's engines are given (hubRegisters.ts), made of this extension's own: one
// clipboard, one drag register and one set of source deleters with the editors still on this
// extension's copies, and a broadcast that reaches an engine's table and the editors' webviews in
// the order they were opened, each on its own terms.
import { beforeEach, describe, expect, it } from 'vitest';
import { broadcastClipboardState, broadcastDragState, deleteFromSource, registerWebview, unregisterWebview } from '../src/host/editorHub.js';
import { clearClipboard, getClipboard, setClipboard } from '../src/host/clipboard.js';
import { clearDrag, getDrag } from '../src/host/dragState.js';
import { hubRegisters } from '../src/host/hubRegisters.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  clearClipboard();
  clearDrag();
});

const item = (name: string): any => ({ name, sourceSection: 'design', payload: { name } });

describe("the engines' registers, this extension's own", () => {
  it('are the clipboard and the drag register every editor reads', () => {
    const registers = hubRegisters();
    registers.setClipboard([item('a')], 'cut', 'file:///w/a.mat');
    expect(getClipboard()?.items.map((i) => i.name)).toEqual(['a']);
    setClipboard([item('b')], 'copy', 'file:///w/b.sldd');
    expect(registers.getClipboard()?.mode).toBe('copy');
    expect(registers.clipboardState()).toMatchObject({ canPaste: true, mode: 'copy', items: [{ sectionName: 'design' }] });
    registers.setDrag('file:///w/a.mat', [item('c')]);
    expect(getDrag()?.sourceDocUri).toBe('file:///w/a.mat');
    expect(registers.dragDescriptor()?.docUri).toBe('file:///w/a.mat');
  });

  it("reach an engine's table and the webviews in the order they were opened, each on its own terms", () => {
    const order: string[] = [];
    const before = { postMessage: (m: any) => void order.push(`before ${m.type}`) };
    const after = { postMessage: (m: any) => void order.push(`after ${m.type}`) };
    registerWebview(before as any, () => order.push('before repaint'));
    const stop = hubRegisters().listen({
      clipboard: () => {
        order.push('table clipboard');
        throw new Error('the table is gone');
      },
      drag: (descriptor) => void order.push(`table drag ${descriptor === null ? 'none' : 'on'}`),
    });
    registerWebview(after as any, () => order.push('after repaint'));
    try {
      broadcastClipboardState();
      broadcastDragState();
      expect(order).toEqual([
        'before clipboardState',
        'before repaint',
        'table clipboard',
        'after clipboardState',
        'after repaint',
        'before dragState',
        'table drag none',
        'after dragState',
      ]);
      order.length = 0;
      stop();
      broadcastClipboardState();
      expect(order).toEqual(['before clipboardState', 'before repaint', 'after clipboardState', 'after repaint']);
    } finally {
      stop();
      unregisterWebview(before as any);
      unregisterWebview(after as any);
    }
  });

  it("register a document's deleter where every editor's move finds it", async () => {
    const registers = hubRegisters();
    registers.registerSourceDeleter('file:///w/a.mat', () => ({ removed: true }));
    expect(await deleteFromSource('file:///w/a.mat', ['x'])).toEqual({ removed: true });
    registers.unregisterSourceDeleter('file:///w/a.mat');
    expect(await registers.deleteFromSource('file:///w/a.mat', ['x'])).toEqual({ removed: false, reason: 'its table is no longer open' });
  });

  it('read the clipboard as a paste starts, and broadcast through the hub by default', () => {
    const posted: any[] = [];
    const webview = { postMessage: (m: any) => void posted.push(m) };
    registerWebview(webview as any, () => {});
    try {
      const registers = hubRegisters();
      registers.setClipboard([item('a')], 'cut', 'file:///w/a.mat');
      const register = registers.clipboardRegister();
      expect(register.kind).toBe('clipboard');
      const read = register.read();
      expect([read?.items.map((i: any) => i.name), read?.move]).toEqual([['a'], true]);
      // A copy that replaced the cut since the read is not cleared by the cut's paste.
      registers.setClipboard([item('b')], 'copy', 'file:///w/b.sldd');
      register.clear();
      expect(getClipboard()?.items.map((i) => i.name)).toEqual(['b']);
      register.broadcast();
      expect(posted.map((m) => m.type)).toEqual(['clipboardState']);
    } finally {
      unregisterWebview(webview as any);
    }
  });
});
