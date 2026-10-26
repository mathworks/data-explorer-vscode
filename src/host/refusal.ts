// Copyright 2026 The MathWorks, Inc.
// A structural gesture refused before it changed anything (Add Child, Delete, Add), said the same
// way by every table editor: in the dialog a refused cell edit is shown in, titled by the gesture.
// Not the banner, which the next repaint clears, and a refusal is often followed by one. The
// reason is core's where core gives one (an Add a MAT-file will not take: addEntryRefusal), and
// else the sentence the context menu shows for the row it greys (common/refusals.ts). Each
// editor spells the source ids in it as the file's name, as the MAT-file editor's describe does.
import type { RefusedMessage } from '../common/protocol.js';
import { NOT_REMOVABLE, TAKES_NO_CHILDREN } from '../common/refusals.js';

/**
 * A refusal that changed nothing: a message, and no repair. Thrown by the structural transforms
 * (structuralEdit.ts) only while the model is still exactly as it was, so a provider answers it
 * with `refusedMessage` and nothing else.
 */
export class EditRefused extends Error {
  constructor(
    readonly title: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'EditRefused';
  }
}

/** An Add Child refused. Core gives no reason for one. */
export const addChildRefused = (): EditRefused => new EditRefused('Cannot Add Child', `${TAKES_NO_CHILDREN}.`);

/** A Delete refused. Core gives no reason for one. */
export const deleteRefused = (): EditRefused => new EditRefused('Cannot Delete', `${NOT_REMOVABLE}.`);

/** An Add (the gallery's) refused, for `reason`. */
export const addRefused = (reason: string): EditRefused => new EditRefused('Cannot Add', reason);

/** The message that shows `refusal`, with its reason described (`describe`: srcId -> file name). */
export function refusedMessage(refusal: EditRefused, describe: (text: string) => string): RefusedMessage {
  return { type: 'refused', title: refusal.title, reason: describe(refusal.message) };
}

/**
 * `text` with `srcId` spelled as `name`: a dictionary editor's describe, as the MAT-file editor's
 * (MatDocument.describe). A node's id begins with its source's id, and a message of core's can
 * carry one.
 */
export const describeSource = (srcId: string, name: string) => (text: string): string => text.split(srcId).join(name);
