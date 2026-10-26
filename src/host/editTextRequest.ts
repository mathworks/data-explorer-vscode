// Copyright 2026 The MathWorks, Inc.
// The answer to a table's `requestEditText`: the whole text of a Value the row shows as a summary
// for its size, which seeds the editor the user is opening (core's editText). The row carries only
// a marker that there is one (`_hasEditText`): the text can run to 200,000 characters, and a file
// of a thousand long values would send it a thousand times with every repaint. Null where there is
// none any more (the value changed under the request), with core's reason where it gives one
// (valueEditRefusal). Said alike by every editable table.
import { DataModel } from 'data-explorer-core';
import type { EditTextMessage } from '../common/protocol.js';

/**
 * Answer the request for `rowId`'s text through `post`. `findNode` resolves the row as the
 * provider's own edits do; `describe` spells a source id in core's reason as the file's name.
 */
export function answerEditTextRequest(
  post: (message: EditTextMessage) => unknown,
  findNode: (rowId: string) => any,
  rowId: string,
  describe: (text: string) => string,
): void {
  const node = findNode(rowId);
  const text = node ? DataModel.editText(node.id) : null;
  const reason = text === null && node ? DataModel.valueEditRefusal(node.id) : null;
  post({ type: 'editText', rowId, text, ...(reason ? { reason: describe(reason) } : {}) });
}
