// Copyright 2026 The MathWorks, Inc.

import type { INode, IContainerNode, ISourceNode } from './NodeInterfaces.js';

export interface Topics {
  'active/changed': void;
  'preview/changed': void;
  'datamodel/source-added': { srcId: string; slddNode: ISourceNode };
  'datamodel/source-removed': { srcId: string };
  'datamodel/cleared': void;
  'node/edited': { source: string; nodeId: string; kind: string };
  'node/added': { node: INode; sectionKey: string };
  'node/deleted': { node: INode; section: IContainerNode };
  'node/children-changed': { parent: INode };
  'undo/changed': { srcId: string };
  'clipboard/changed': { mode: string; nodeId: string; nodeIds?: string[] } | null;
  'selection/multi': { nodeIds: string[] };
  'document/switched': { srcId: string; sectionKey: string | null; entryNode: INode | null };
  toolstrip: { actionId: string };
  'graph/expand-node': { nodeId: string };
  'app/open-folder': void;
  'app/push-graphture': void;
}

export interface Subscription {
  remove(): void;
}

type Listener<T> = T extends void ? () => void : (payload: T) => void;

const listeners: { [K in keyof Topics]?: Array<Listener<Topics[K]>> } = {};

export function publish<K extends keyof Topics>(topic: K, ...args: Topics[K] extends void ? [] : [Topics[K]]): void {
  const fns = listeners[topic] as Array<Listener<Topics[K]>> | undefined;
  if (fns) {
    fns.forEach((fn) => (fn as Function)(...args));
  }
}

export function subscribe<K extends keyof Topics>(topic: K, fn: Listener<Topics[K]>): Subscription {
  if (!listeners[topic]) {
    (listeners as any)[topic] = [];
  }
  (listeners[topic] as Array<Listener<Topics[K]>>).push(fn);
  return {
    remove() {
      const arr = listeners[topic] as Array<Listener<Topics[K]>>;
      (listeners as any)[topic] = arr.filter((f) => f !== fn);
    },
  };
}

export function clear(): void {
  (Object.keys(listeners) as Array<keyof Topics>).forEach((k) => delete listeners[k]);
}
