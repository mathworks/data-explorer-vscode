// Copyright 2026 The MathWorks, Inc.

import { publish, subscribe } from './EventBus.js';

export interface Command {
    execute(): void;
    undo(): void;
}

interface UndoStack {
    undo: Command[];
    redo: Command[];
}

const stacks: Map<string, UndoStack> = new Map();

function getStack(srcId: string): UndoStack {
    if (!stacks.has(srcId)) {
        stacks.set(srcId, { undo: [], redo: [] });
    }
    return stacks.get(srcId)!;
}

export function execute(srcId: string, command: Command): void {
    command.execute();
    const stack = getStack(srcId);
    stack.undo.push(command);
    stack.redo = [];
    publish('undo/changed', { srcId });
}

export function pushExecuted(srcId: string, command: Command): void {
    const stack = getStack(srcId);
    stack.undo.push(command);
    stack.redo = [];
    publish('undo/changed', { srcId });
}

export function undo(srcId: string): void {
    const stack = getStack(srcId);
    if (stack.undo.length === 0) { return; }
    const command = stack.undo.pop()!;
    command.undo();
    stack.redo.push(command);
    publish('undo/changed', { srcId });
}

export function redo(srcId: string): void {
    const stack = getStack(srcId);
    if (stack.redo.length === 0) { return; }
    const command = stack.redo.pop()!;
    command.execute();
    stack.undo.push(command);
    publish('undo/changed', { srcId });
}

export function canUndo(srcId: string): boolean {
    if (!srcId || !stacks.has(srcId)) { return false; }
    return stacks.get(srcId)!.undo.length > 0;
}

export function canRedo(srcId: string): boolean {
    if (!srcId || !stacks.has(srcId)) { return false; }
    return stacks.get(srcId)!.redo.length > 0;
}

export function clear(srcId?: string): void {
    if (srcId) {
        stacks.delete(srcId);
    } else {
        stacks.clear();
    }
    publish('undo/changed', { srcId: srcId || '' });
}

subscribe('datamodel/source-removed', (evt) => {
    clear(evt.srcId);
});

subscribe('datamodel/cleared', () => {
    clear();
});

const UndoManager = { execute, pushExecuted, undo, redo, canUndo, canRedo, clear };
export default UndoManager;
