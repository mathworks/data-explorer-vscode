// Copyright 2026 The MathWorks, Inc.

import { publish, subscribe } from './EventBus.js';
import * as UndoManager from './UndoManager.js';
import SlddNode from '../datamodel/node/container/SlddNode.js';
import ModelNode from '../datamodel/node/container/ModelNode.js';
import MatNode from '../datamodel/node/container/MatNode.js';
import ProjectNode from '../datamodel/node/container/ProjectNode.js';
import { parseSlx } from '../datamodel/parser/SlxParser.js';
import { parseMat } from '../datamodel/parser/MatParser.js';
import { parseProject } from '../datamodel/parser/ProjectParser.js';
import type { INode, IContainerNode, ISourceNode, IAllNode, SourceMeta } from './NodeInterfaces.js';

export type { IAllNode as AllNode, SourceMeta };

const allNode: IAllNode = {
  __isAllNode: true,
  isContainer: true,
  name: '__all__',
  displayName: 'Root',
  icon: 'abstractClass',
  parent: null,
  id: '__all__',
};

const dataSources: Map<string, ISourceNode> = new Map();
const nodeIndex: Map<string, INode> = new Map();
let contextNode: INode | IAllNode | null = null;
let entryNodes: INode[] = [];
let previewNode: INode | null = null;
let batchDepth = 0;

function buildMeta(meta?: Partial<SourceMeta>): SourceMeta {
  return {
    path: (meta && meta.path) || '',
    lastModified: (meta && meta.lastModified) || null,
    size: (meta && meta.size) || 0,
    fileHandle: (meta && meta.fileHandle) || null,
  };
}

function registerSource(srcId: string, sourceNode: ISourceNode, meta?: Partial<SourceMeta>): ISourceNode {
  (sourceNode as unknown as { meta: SourceMeta }).meta = buildMeta(meta);
  dataSources.set(srcId, sourceNode);
  indexSource(sourceNode);
  publish('datamodel/source-added', { srcId, slddNode: sourceNode });
  return sourceNode;
}

function indexSource(source: ISourceNode): void {
  const flat = source.flatten();
  for (let i = 0; i < flat.length; i++) {
    nodeIndex.set(flat[i].id, flat[i]);
  }
}

function deindexSource(source: ISourceNode): void {
  const flat = source.flatten();
  for (let i = 0; i < flat.length; i++) {
    nodeIndex.delete(flat[i].id);
  }
}

function beginBatch(): void {
  batchDepth++;
}

function endBatch(): void {
  if (batchDepth > 0) {
    batchDepth--;
  }
  if (batchDepth === 0) {
    publish('active/changed');
  }
}

function publishActiveChanged(): void {
  if (batchDepth === 0) {
    publish('active/changed');
  }
}

function setActiveContext(node: INode | IAllNode): void {
  contextNode = node;
  entryNodes = [];
  publishActiveChanged();
}

function setActiveEntry(nodes: INode | INode[] | null): void {
  if (nodes === null) {
    entryNodes = [];
  } else if (Array.isArray(nodes)) {
    entryNodes = nodes;
  } else {
    entryNodes = [nodes];
  }
  publishActiveChanged();
}

function setActive(context: INode | IAllNode | null, entry: INode | INode[] | null): void {
  contextNode = context;
  if (entry === null) {
    entryNodes = [];
  } else if (Array.isArray(entry)) {
    entryNodes = entry;
  } else {
    entryNodes = [entry];
  }
  publishActiveChanged();
}

function getContextNode(): INode | IAllNode | null {
  return contextNode;
}

function getEntryNode(): INode | null {
  return entryNodes.length > 0 ? entryNodes[0] : null;
}

function getEntryNodes(): INode[] {
  return entryNodes;
}

function getActiveNode(): INode | IAllNode | null {
  return entryNodes.length > 0 ? entryNodes[0] : contextNode;
}

function addDataSource(srcId: string, content: Record<string, unknown>, meta?: Partial<SourceMeta>): ISourceNode {
  const slddNode = SlddNode.parse(content, srcId);
  return registerSource(srcId, slddNode as unknown as ISourceNode, meta);
}

function addParsedSource(srcId: string, slddNode: ISourceNode, meta?: Partial<SourceMeta>): ISourceNode {
  return registerSource(srcId, slddNode, meta);
}

function addModelSource(srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>): ISourceNode {
  const parsed = parseSlx(buffer, srcId);
  const modelNode = ModelNode.fromParsed(
    parsed as unknown as import('../datamodel/node/container/ModelNode.js').ParsedSlx,
    srcId,
  );
  return registerSource(srcId, modelNode as unknown as ISourceNode, meta);
}

function addMatSource(srcId: string, buffer: ArrayBuffer, meta?: Partial<SourceMeta>): ISourceNode {
  const parsed = parseMat(buffer);
  const matNode = MatNode.fromParsed(
    parsed as unknown as {
      header: string;
      variables: import('../datamodel/node/data/MatlabVariableNode.js').MatVariable[];
    },
    srcId,
  );
  return registerSource(srcId, matNode as unknown as ISourceNode, meta);
}

function addProjectSource(
  srcId: string,
  files: Record<string, string>,
  meta?: Partial<SourceMeta>,
): ISourceNode {
  // Filename = basename of srcId (or meta.path) including .prj; display name drops it.
  const basename = ((meta && meta.path) || srcId).split(/[\\/]/).pop() || srcId;
  const name = basename.replace(/\.prj$/i, '');
  const parsed = parseProject(files, name);
  const projectNode = ProjectNode.fromParsed(parsed, basename);
  return registerSource(srcId, projectNode as unknown as ISourceNode, meta);
}

function addModelSourceParsed(srcId: string, parsed: unknown, meta?: Partial<SourceMeta>): ISourceNode {
  const modelNode = ModelNode.fromParsed(
    parsed as unknown as import('../datamodel/node/container/ModelNode.js').ParsedSlx,
    srcId,
  );
  return registerSource(srcId, modelNode as unknown as ISourceNode, meta);
}

function addMatSourceParsed(srcId: string, parsed: unknown, meta?: Partial<SourceMeta>): ISourceNode {
  const matNode = MatNode.fromParsed(
    parsed as unknown as {
      header: string;
      variables: import('../datamodel/node/data/MatlabVariableNode.js').MatVariable[];
    },
    srcId,
  );
  return registerSource(srcId, matNode as unknown as ISourceNode, meta);
}

function removeDataSource(srcId: string): void {
  const source = dataSources.get(srcId);
  if (!source) {
    return;
  }
  deindexSource(source);
  dataSources.delete(srcId);
  publish('datamodel/source-removed', { srcId });
}

function removeAll(): void {
  dataSources.clear();
  nodeIndex.clear();
  publish('datamodel/cleared');
}

function getDataSource(srcId: string): ISourceNode | null {
  return dataSources.get(srcId) || null;
}

function hasDataSource(srcId: string): boolean {
  return dataSources.has(srcId);
}

function getDataSourceIds(): string[] {
  return Array.from(dataSources.keys());
}

function getDataSourceCount(): number {
  return dataSources.size;
}

function isBatching(): boolean {
  return batchDepth > 0;
}

function findNodeById(nodeId: string): INode | null {
  return nodeIndex.get(nodeId) || null;
}

function reindexAll(): void {
  nodeIndex.clear();
  dataSources.forEach((src) => indexSource(src));
}

subscribe('node/added', reindexAll);
subscribe('node/deleted', reindexAll);
subscribe('node/children-changed', reindexAll);

// --- Mutation Actions ---

function editProperty(
  nodeId: string,
  propertyName: string,
  newValue: unknown,
  oldValue?: unknown,
): true | false | { error: boolean; reason: string; invalidValue: string; validValue: string } {
  const activeNode = getActiveNode();
  if (!activeNode || activeNode.id !== nodeId) {
    return false;
  }
  if ('__isAllNode' in activeNode) {
    return false;
  }
  const node = activeNode as INode;
  if (!node.setProperty) {
    return false;
  }

  const result = node.setProperty(propertyName, newValue);
  if (result !== true) {
    return (result as { error: boolean; reason: string; invalidValue: string; validValue: string }) || false;
  }

  const slddNode = getActiveSlddNode();
  const kind = propertyName === 'Name' ? 'rename' : 'property';
  if (slddNode) {
    const cmd = {
      execute() {
        node.setProperty!(propertyName, newValue);
        publish('node/edited', { source: 'undo', nodeId: node.id, kind });
        if (kind === 'rename') {
          publishActiveChanged();
        }
        publish('node/children-changed', { parent: node });
      },
      undo() {
        node.setProperty!(propertyName, oldValue);
        publish('node/edited', { source: 'undo', nodeId: node.id, kind });
        if (kind === 'rename') {
          publishActiveChanged();
        }
        publish('node/children-changed', { parent: node });
      },
    };
    UndoManager.pushExecuted(slddNode.name, cmd);
  }

  publish('node/edited', { source: 'pi', nodeId: node.id, kind });
  if (kind === 'rename') {
    publishActiveChanged();
  }
  publish('node/children-changed', { parent: node });
  return true;
}

function addEntry(sectionKey: string, className: string, entryName?: string): INode | null {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return null;
  }

  let section: IContainerNode | null = slddNode.getSection(sectionKey);
  if (!section) {
    // When at root (sectionKey='sldd'), find the section that accepts this className
    for (const child of slddNode.children) {
      const sec = child as IContainerNode;
      if (sec.getAllowedTypes && sec.getAllowedTypes().includes(className)) {
        section = sec;
        break;
      }
    }
    if (!section) {
      return null;
    }
  }

  if (!section.execAddEntry) {
    return null;
  }
  const result = section.execAddEntry(className, entryName);
  if (!result) {
    return null;
  }

  const srcId = slddNode.name;
  const node = result.node;
  const sectionRef = section;
  UndoManager.pushExecuted(srcId, {
    execute() {
      result.redo();
      nodeIndex.set(node.id, node);
      setActiveEntry(node);
      publish('node/added', { node, sectionKey: sectionRef.name });
    },
    undo() {
      result.undo();
      nodeIndex.delete(node.id);
      setActiveEntry(null);
      publish('node/deleted', { node, section: sectionRef });
    },
  });

  nodeIndex.set(node.id, node);
  publish('node/added', { node, sectionKey: section.name });
  setActiveEntry(node);
  return node;
}

function addChild(): INode | null {
  const node = entryNodes.length === 1 ? entryNodes[0] : null;
  if (!node) {
    return null;
  }
  if (!node.execAddChild) {
    return null;
  }

  const rawResult = node.execAddChild();
  if (!rawResult) {
    return null;
  }
  const result = rawResult as { node: INode; undo: () => void; redo: () => void };

  const slddNode = getActiveSlddNode();
  const child = result.node;
  if (slddNode) {
    UndoManager.pushExecuted(slddNode.name, {
      execute() {
        result.redo();
        nodeIndex.set(child.id, child);
        setActiveEntry(child);
        publish('node/children-changed', { parent: node });
      },
      undo() {
        result.undo();
        nodeIndex.delete(child.id);
        setActiveEntry(node);
        publish('node/children-changed', { parent: node });
      },
    });
  }

  nodeIndex.set(child.id, child);
  publish('node/children-changed', { parent: node });
  return child;
}

function deleteNode(): boolean {
  const nodes = getEntryNodes();
  if (nodes.length === 0) {
    return false;
  }

  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return false;
  }

  if (nodes.length === 1) {
    const node = nodes[0];
    if (node.isEntry) {
      const section = node.parent as IContainerNode;
      if (!section || !section.execRemoveEntry) {
        return false;
      }
      const nodeId = node.id;
      const result = section.execRemoveEntry(node);
      if (!result) {
        return false;
      }
      UndoManager.pushExecuted(slddNode.name, {
        execute() {
          const currentId = node.id;
          result.redo();
          nodeIndex.delete(currentId);
          setActiveEntry(null);
          publish('node/deleted', { node, section });
        },
        undo() {
          result.undo();
          nodeIndex.set(node.id, node);
          setActiveEntry(node);
          publish('node/added', { node, sectionKey: section.name });
        },
      });
      nodeIndex.delete(nodeId);
      setActiveEntry(null);
      publish('node/deleted', { node, section });
    } else {
      const parent = node.parent;
      if (!parent || !parent.execRemoveChild) {
        return false;
      }
      const nodeId = node.id;
      const rawResult = parent.execRemoveChild(node);
      if (!rawResult) {
        return false;
      }
      const result = rawResult as { undo: () => void; redo: () => void };
      UndoManager.pushExecuted(slddNode.name, {
        execute() {
          const currentId = node.id;
          result.redo();
          nodeIndex.delete(currentId);
          setActiveEntry(parent);
          publish('node/children-changed', { parent });
        },
        undo() {
          result.undo();
          nodeIndex.set(node.id, node);
          setActiveEntry(node);
          publish('node/children-changed', { parent });
        },
      });
      nodeIndex.delete(nodeId);
      setActiveEntry(parent);
      publish('node/children-changed', { parent });
    }
  } else {
    const undoInfo: {
      node: INode;
      nodeId: string;
      section: IContainerNode;
      result: { undo: () => void; redo: () => void };
    }[] = [];
    for (const node of nodes) {
      if (!node.isEntry) continue;
      const section = node.parent as IContainerNode;
      if (!section || !section.execRemoveEntry) continue;
      const nodeId = node.id;
      const result = section.execRemoveEntry(node);
      if (result) {
        undoInfo.push({ node, nodeId, section, result });
      }
    }
    if (undoInfo.length === 0) {
      return false;
    }
    UndoManager.pushExecuted(slddNode.name, {
      execute() {
        for (const info of undoInfo) {
          const currentId = info.node.id;
          info.result.redo();
          nodeIndex.delete(currentId);
        }
        setActiveEntry(null);
        publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
      },
      undo() {
        for (let i = undoInfo.length - 1; i >= 0; i--) {
          undoInfo[i].result.undo();
          nodeIndex.set(undoInfo[i].node.id, undoInfo[i].node);
        }
        setActiveEntry(undoInfo.map((info) => info.node));
        publish('node/added', { node: undoInfo[0].node, sectionKey: undoInfo[0].section.name });
      },
    });
    for (const info of undoInfo) {
      nodeIndex.delete(info.nodeId);
    }
    setActiveEntry(null);
    publish('node/deleted', { node: undoInfo[0].node, section: undoInfo[0].section });
  }
  return true;
}

function undoAction(): void {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return;
  }
  UndoManager.undo(slddNode.name);
}

function redoAction(): void {
  const slddNode = getActiveSlddNode();
  if (!slddNode) {
    return;
  }
  UndoManager.redo(slddNode.name);
}

function setPreviewNode(node: INode | null): void {
  previewNode = node;
  publish('preview/changed');
}

function getPreviewNode(): INode | null {
  return previewNode;
}

function clearPreviewNode(): void {
  if (previewNode !== null) {
    previewNode = null;
    publish('preview/changed');
  }
}

function getActiveSlddNode(): ISourceNode | null {
  if (!contextNode) {
    return null;
  }
  if ('__isAllNode' in contextNode && contextNode.__isAllNode) {
    return null;
  }
  let node: INode = contextNode as INode;
  while (node.parent) {
    node = node.parent;
  }
  return (node as IContainerNode).dirty !== undefined ? (node as ISourceNode) : null;
}

function getActiveSourceNode(): ISourceNode | null {
  if (!contextNode) {
    return null;
  }
  if ('__isAllNode' in contextNode && contextNode.__isAllNode) {
    return null;
  }
  let node: INode = contextNode as INode;
  while (node.parent) {
    node = node.parent;
  }
  return node as ISourceNode;
}

const DataModel = {
  allNode,
  addDataSource,
  addParsedSource,
  addModelSource,
  addModelSourceParsed,
  addMatSource,
  addMatSourceParsed,
  addProjectSource,
  removeDataSource,
  removeAll,
  getDataSource,
  hasDataSource,
  getDataSourceIds,
  getDataSourceCount,
  isBatching,
  setActiveContext,
  setActiveEntry,
  setActive,
  getContextNode,
  getEntryNode,
  getEntryNodes,
  getActiveNode,
  getActiveSlddNode,
  getActiveSourceNode,
  setPreviewNode,
  getPreviewNode,
  clearPreviewNode,
  findNodeById,
  beginBatch,
  endBatch,
  editProperty,
  addEntry,
  addChild,
  deleteNode,
  undo: undoAction,
  redo: redoAction,
};

export default DataModel;
