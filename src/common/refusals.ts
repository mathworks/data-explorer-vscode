// Copyright 2026 The MathWorks, Inc.
// What a refused Add Child or Delete says where core gives no reason of its own, in one place: the
// context menu says it of the row it greys (webview/menuItems.ts), and every table editor's host
// says it of a gesture it refuses (host/refusal.ts), so the menu and the three editors say one
// thing. Core answers both only yes or no today (canAddChild, canRemoveChild, addChildTo,
// deleteNodeById, deleteNodesById).

export const TAKES_NO_CHILDREN = 'This item takes no children';
export const NOT_REMOVABLE = "This element can't be removed from its parent";
