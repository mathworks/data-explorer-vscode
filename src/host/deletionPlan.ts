// Copyright 2026 The MathWorks, Inc.
//
// What a multi-row delete amounts to in the model: entries to remove whole, and
// nested children grouped under the entry each belongs to.
//
// Delete is the one action with no DESTINATION, which is why it is row-granular while
// copy/cut/paste/drag stay entry-granular (see webview/operands.ts, and the design
// spec's §2). That makes it the one action whose operands can be a mix of entries and
// children across sections, and this is where that mix becomes work: one removal per
// entry, one text splice per entry whose children changed, all in a single undo step.
//
// Shared by BOTH providers because the two formats differ only in how they get a live
// model and how they splice text — never in what deleting a row means. `findNode` is
// injected for the first difference; the splice stays with the caller for the second.
//
// GROUPING IS THE POINT. Two children of one bus must arrive as ONE group: each group
// reserializes its entry, so two groups over the same entry would each write a stale
// copy and the second would undo the first. Same reason the drop path dedupes by
// owning entry.
import { findOwningEntry } from './structuralEdit.js';

export interface ChildGroup {
  /** The entry to reserialize once, after all its children are removed. */
  entry: any;
  /** Its children to remove, in selection order. */
  children: any[];
}

export interface DeletionPlan {
  /** Whole entries to remove, in selection order. */
  entries: any[];
  /** Children to remove, grouped by owning entry, groups in first-seen order. */
  childGroups: ChildGroup[];
}

// Whether any node STRICTLY above `node` is in the selection. Deleting an ancestor
// already removes this node, so planning both would splice a child out of an entry
// that is about to disappear — and the second model op would throw on a node no longer
// in the tree.
function hasSelectedAncestor(node: any, selected: ReadonlySet<any>): boolean {
  for (let n = node?.parent; n; n = n.parent) {
    if (selected.has(n)) return true;
  }
  return false;
}

/**
 * Plan the deletion of `rowIds`.
 *
 * A row id that resolves to nothing, to a section header, or to a node with no owning
 * entry contributes nothing rather than aborting the gesture: one stale id in a
 * selection must not make Delete do nothing at all.
 *
 * Nothing is mutated here. The plan is read-only, which is what lets a caller compute
 * selectors and the post-delete selection BEFORE any removal changes the tree.
 */
export function planDeletion(
  rowIds: readonly string[],
  findNode: (rowId: string) => any,
): DeletionPlan {
  // Resolved once, in order, so identity comparisons below are against the same objects
  // the caller will act on.
  const nodes: any[] = [];
  const seen = new Set<any>();
  for (const rowId of rowIds) {
    const node = findNode(rowId);
    if (!node || seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
  }

  const entries: any[] = [];
  const childGroups: ChildGroup[] = [];
  const groupOf = new Map<any, ChildGroup>();
  for (const node of nodes) {
    if (hasSelectedAncestor(node, seen)) continue;
    if (node.isEntry) {
      entries.push(node);
      continue;
    }
    const entry = findOwningEntry(node);
    if (!entry) continue;
    let group = groupOf.get(entry);
    if (!group) {
      group = { entry, children: [] };
      groupOf.set(entry, group);
      childGroups.push(group);
    }
    group.children.push(node);
  }
  return { entries, childGroups };
}
