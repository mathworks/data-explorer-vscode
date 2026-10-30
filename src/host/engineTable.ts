// Copyright 2026 The MathWorks, Inc.
//
// One panel's end of a table of one of view's editing engines (data-explorer-view/host): what the
// table says, posted to the panel's webview as this extension's editors have always posted it.
//
// A whole paint goes out as the editors' own `post()` sends one:
//  - its rows (`setRows`), through postOrReport, so that rows that cannot be delivered say "Failed to
//    show …" in their place;
//  - then what follows the rows (the drop rules, the clipboard, the clip mark: the engine's
//    trailer, which waits for `opened(view)`; trailerAfterDelivery): once that post has settled,
//    where the editor awaited it (the MAT-file editor, `awaitRows`), or at once, in the same run,
//    where it did not (the compressed dictionary editor);
//  - then whatever the host runs after a paint (`afterPaint`: the Usage link's selection to drain).
// Everything else the engine says, while a paint's rows are on their way or not, is posted at once,
// in the order it was said: a gesture's rows during that await go out ahead of the trailer, as they
// did. Each message is spelled as the editors spelled it, keys in their order; a `setRows` as the
// editor's own literal spelled it (`setRows`: the MAT-file editor's carries `notice`, `add` and
// `warnings` even when they are undefined).
import type { EditableTableSource, TableChange, TableView } from 'data-explorer-view/model';
import { postOrReport } from 'data-explorer-view/host';

/** The one method of a webview this needs: vscode-free, so the relay is measured and tested in vitest. */
export interface TablePanel {
  postMessage(message: unknown): PromiseLike<boolean>;
}

/** A table of an engine whose host delivers its paints (an engine's `view()`, trailerAfterDelivery). */
export type DeliveredTable = EditableTableSource & { repaintAll(): Promise<void>; opened(view?: TableView): void };

export interface EngineTableOptions {
  /** The file's name, which a paint that cannot be delivered names. */
  name: string;
  /**
   * Whether what follows a paint's rows waits for their post to settle (the MAT-file editor's
   * `post()` awaited it), or goes out at once, in the same run (the compressed dictionary
   * editor's did not; its `ready` was answered in the run that asked, by a repaint, and so is it
   * here). Default: true.
   */
  awaitRows?: boolean;
  /** A whole paint's rows, as the editor's own `setRows` literal spelled them. Default: the MAT-file editor's. */
  setRows?(view: TableView): Record<string, unknown>;
  /** Called with each whole paint's view, before its rows are posted (the lock on a read-only tab). */
  onRows?(view: TableView): void;
  /** Called after each whole paint's trailer is posted. */
  afterPaint?(): void;
}

/**
 * The panel's end of `table`, until `dispose()`. `ready()` answers the webview's `ready`, and
 * `children()` its fetch of the rows under a row.
 */
export function engineTable(
  table: DeliveredTable,
  webview: TablePanel,
  options: EngineTableOptions,
): { ready(): void; children(nodeId: string): void; dispose(): void } {
  let closed = false;
  const { name } = options;

  const matRows = (view: TableView) => ({
    type: 'setRows',
    docUri: view.docUri,
    rows: view.rows,
    columns: view.columns,
    columnLabels: view.columnLabels,
    columnGroups: view.columnGroups,
    editable: view.editable,
    notice: view.notice,
    add: view.add,
    warnings: view.warnings,
  });

  const setRows = options.setRows ?? matRows;

  // What follows a paint's rows: its own trailer, then the host's after-paint work.
  const delivered = (view: TableView): void => {
    if (closed) return;
    table.opened(view);
    options.afterPaint?.();
  };

  // A whole paint: its rows, and what follows them once they are delivered (or reported), or at once.
  const paint = async (view: TableView): Promise<void> => {
    options.onRows?.(view);
    const rows = postOrReport(webview, setRows(view), name);
    if (options.awaitRows === false) return delivered(view);
    await rows;
    delivered(view);
  };

  const post = (message: unknown): void => void webview.postMessage(message);

  const unsubscribe = table.subscribe((change: TableChange) => {
    if (closed) return;
    switch (change.kind) {
      case 'replaceAll':
        return void paint(change.view);
      case 'updateEntry':
        return post({ type: 'updateEntryRows', entryRowId: change.entryRowId, rows: change.rows });
      case 'insertEntry':
        return post({
          type: 'insertEntryRows',
          sectionRowId: change.sectionRowId,
          ...(change.beforeRowId === undefined ? {} : { beforeRowId: change.beforeRowId }),
          rows: change.rows,
        });
      case 'error':
        return post({ type: 'error', message: change.message });
      case 'sectionRules':
        return post({ type: 'sectionRules', docUri: change.docUri, rules: change.rules });
      case 'clipboard':
        return post({ type: 'clipboardState', ...change.state });
      case 'drag':
        return post({ type: 'dragState', descriptor: change.descriptor });
      case 'select':
        return post({ type: 'selectRows', rowIds: change.rowIds });
      case 'beginRename':
        return post({ type: 'beginRename', rowId: change.rowId });
      case 'invalid':
        return post({ type: 'validationError', reason: change.reason, invalidValue: change.invalidValue, previousValue: change.previousValue });
      case 'refused':
        return post({ type: 'refused', title: change.title, reason: change.reason });
      case 'editText':
        return post({ type: 'editText', rowId: change.rowId, text: change.text, ...(change.reason === undefined ? {} : { reason: change.reason }) });
    }
  });

  return {
    ready() {
      // In the run that asked: the engine's repaint says its rows at once, and they are posted as
      // every repaint's are.
      if (options.awaitRows === false) return void table.repaintAll();
      table.open().then(
        (view) => (closed ? undefined : paint(view)),
        // A table closed while it was asked has nowhere to say it (SourceClosed).
        (err) => {
          if (closed || (err as { name?: unknown } | null)?.name === 'SourceClosed') return;
          post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        },
      );
    },
    // As the editors answered a fetch (childRequest.ts): through postOrReport, so rows that cannot
    // be delivered say "Failed to show …" rather than leave the twisty waiting.
    children(nodeId) {
      void table.children(nodeId).then((rows) => (closed ? undefined : postOrReport(webview, { type: 'childRows', ...rows }, name)));
    },
    dispose() {
      closed = true;
      unsubscribe();
    },
  };
}
