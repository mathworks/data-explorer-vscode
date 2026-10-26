// Copyright 2026 The MathWorks, Inc.
// A structural gesture refused before it changes anything (Add Child, Delete, Add), said the same
// way by every table editor. Each asks core why first, through this module, the one place core's
// reasons come in: `Cannot add to "s.a": ... Nothing was added.`, naming the row by its MATLAB
// path, in the same words for a MAT-file and both dictionary formats. The reason is shown in the
// dialog a refused cell edit is shown in, titled by the gesture, and not in the banner, which the
// next repaint clears; a refusal is often followed by one.
//
// What a transform throws AFTER core said yes is a failure, not a refusal, and is reported as one
// ("Failed to apply edit: ..."): core and the editor disagreeing is a bug to see, not a reason.
import { DataModel } from 'data-explorer-core';
import type { RefusedMessage } from '../common/protocol.js';

export type RefusedGesture = 'addChild' | 'delete' | 'add';

const TITLES: Record<RefusedGesture, string> = { addChild: 'Cannot Add Child', delete: 'Cannot Delete', add: 'Cannot Add' };

/** Why core adds no child to the row `nodeId` names (addChildTo), or null where it adds one. */
export const addChildRefusal = (nodeId: string): string | null => DataModel.addChildRefusal(nodeId);

/**
 * Why core would not delete every row of `nodeIds`, or null where it deletes them all. The rows
 * are those the gesture deletes, after its plan has dropped any under another row it deletes, and
 * each is asked as deleteNodeById takes it: every editor removes a child on its own, and core's
 * answer for a batch (deleteNodesById) is about entries only.
 */
export function deleteRefusal(nodeIds: readonly string[]): string | null {
  for (const id of nodeIds) {
    const why = DataModel.deleteRefusal(id);
    if (why !== null) return why;
  }
  return null;
}

/**
 * Why core adds no `className` to `containerId` (a dictionary's section by its id, a MAT-file by
 * its srcId), or null where it adds one.
 */
export const addEntryRefusal = (containerId: string, className: string): string | null =>
  DataModel.addEntryRefusal(containerId, className);

/** The message that shows `reason`, core's refusal of `gesture`, described (srcId -> file name). */
export function refusedMessage(gesture: RefusedGesture, reason: string, describe: (text: string) => string): RefusedMessage {
  return { type: 'refused', title: TITLES[gesture], reason: describe(reason) };
}

/**
 * `text` with `srcId` spelled as `name`: what every editor shows of a message of core's, which can
 * name the source by its id (a node's id begins with it). The MAT-file editor's describe is this.
 */
export const describeSource = (srcId: string, name: string) => (text: string): string => text.split(srcId).join(name);
