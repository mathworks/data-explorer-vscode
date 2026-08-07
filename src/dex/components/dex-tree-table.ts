// Copyright 2026 The MathWorks, Inc.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { highContrastStyles } from '../styles/high-contrast.styles.js';
import './dex-icon.js';

export interface TreeTableRow {
  ID: string;
  parent: string | null;
  Name: { label: string; iconId?: string; editable?: boolean; clipboardMode?: string };
  Value:
    | { text: string; editable?: boolean; clipboardMode?: string; linkTarget?: string; editor?: string; options?: string[] }
    | string;
  _valueEditable?: boolean;
  DataType: { text: string; clipboardMode?: string; linkTarget?: string } | string;
  Class?: { text: string; clipboardMode?: string } | string;
  Kind?: { text: string; clipboardMode?: string } | string;
  Description: { text: string; clipboardMode?: string } | string;
  Status: { text: string; clipboardMode?: string } | string;
  UsedBy?: { text: string; linkTarget?: string } | { links: { text: string; linkTarget: string }[] } | string;
}

export interface EditCompletedDetail {
  rowId: string;
  columnId: string;
  oldValue: string;
  newValue: string;
}

interface SortEntry {
  column: string;
  direction: 'asc' | 'desc';
}

const DEFAULT_ROW_HEIGHT = 26;
const BUFFER_ROWS = 10;

const DEFAULT_WIDTHS: Record<string, number> = {
  Name: 25,
  Value: 20,
  Class: 16,
  Kind: 14,
  DataType: 18,
  Description: 15,
  UsedBy: 12,
  Status: 10,
};

const COLUMN_LABELS: Record<string, string> = {
  Name: 'Name',
  Value: 'Value',
  Class: 'Class',
  Kind: 'Kind',
  DataType: 'Data Type',
  Description: 'Description',
  UsedBy: 'Used By',
  Status: 'Status',
};

// The default column order and visibility. Class and Kind are supplementary
// classifications, so they ship hidden; the user can enable them via the column
// menu (and Reset restores this arrangement).
const DEFAULT_COLUMN_ORDER = ['Name', 'Value', 'DataType', 'UsedBy', 'Status', 'Kind', 'Class', 'Description'];
const DEFAULT_HIDDEN_COLUMNS = ['Kind', 'Class'];

@customElement('dex-tree-table')
export class DexTreeTable extends LitElement {
  static override styles = [
    highContrastStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        font-family: var(--dex-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: 13px;
      }

      .filter-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-bottom: 1px solid var(--dex-border-color-light, #e0e0e0);
        background: var(--dex-bg-secondary, #f8f8f8);
        flex: 0 0 auto;
      }

      .columns-button {
        flex: 0 0 auto;
        height: 24px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 0 8px;
        border: 1px solid var(--dex-border-color, #d0d0d0);
        border-radius: 3px;
        background: var(--dex-bg-primary, #fff);
        color: var(--dex-color-text, inherit);
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        white-space: nowrap;
        outline: none;
      }

      .columns-button:hover {
        background: var(--dex-bg-hover, #e8e8e8);
      }

      .columns-button:focus-visible {
        border-color: var(--dex-color-accent, #0078d4);
      }

      .filter-input {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
        height: 24px;
        padding: 2px 8px;
        border: 1px solid var(--dex-border-color, #d0d0d0);
        border-radius: 3px;
        font-size: 12px;
        font-family: inherit;
        box-sizing: border-box;
        outline: none;
      }

      .filter-input:focus {
        border-color: var(--dex-color-accent, #0078d4);
      }

      .table-container {
        flex: 1 1 0;
        overflow: auto;
        min-height: 0;
        position: relative;
        outline: none;
      }

      .virtual-spacer {
        width: 100%;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--dex-bg-secondary, #f8f8f8);
      }

      .rows-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        position: absolute;
        left: 0;
        z-index: 1;
      }

      thead {
        position: sticky;
        top: 0;
        z-index: 2;
      }

      th {
        background: var(--dex-bg-tertiary, #f0f0f0);
        border-bottom: 1px solid var(--dex-border-color, #d0d0d0);
        border-right: 1px solid var(--dex-border-color-light, #e0e0e0);
        padding: 4px 8px;
        text-align: left;
        font-weight: 600;
        font-size: 12px;
        user-select: none;
        height: var(--dex-row-height, 28px);
        box-sizing: border-box;
        position: relative;
      }

      th:last-child {
        border-right: none;
      }

      .th-content {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow: hidden;
      }

      .th-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .sort-indicator {
        flex-shrink: 0;
        font-size: 10px;
        color: var(--dex-color-text-secondary, #555);
      }

      .resize-handle {
        position: absolute;
        top: 0;
        right: 0;
        width: 5px;
        height: 100%;
        cursor: col-resize;
        z-index: 3;
      }

      .resize-handle:hover,
      .resize-handle.active {
        background: var(--dex-color-accent, #0078d4);
        opacity: 0.4;
      }

      th.drag-over-left {
        box-shadow: inset 3px 0 0 0 var(--dex-color-accent, #0078d4);
      }

      th.drag-over-right {
        box-shadow: inset -3px 0 0 0 var(--dex-color-accent, #0078d4);
      }

      .column-menu {
        position: fixed;
        z-index: 1000;
        background: var(--dex-bg-primary, #fff);
        border: 1px solid var(--dex-border-color, #d0d0d0);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        padding: 4px 0;
        min-width: 200px;
      }

      .column-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px 4px 6px;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }

      .column-menu-item:hover {
        background: var(--dex-bg-hover, #e8e8e8);
      }

      .column-menu-item.disabled {
        opacity: 0.5;
        cursor: default;
      }

      .column-menu-item input[type='checkbox'] {
        margin: 0;
      }

      /* Left-side drag handle (industry-standard six-dot grip) signals the row is
         reorderable; the whole row is draggable, but the handle shows grab intent. */
      .column-menu-item .col-grip {
        flex: 0 0 auto;
        width: 12px;
        text-align: center;
        color: var(--dex-color-text-muted, #999);
        cursor: grab;
        user-select: none;
        line-height: 1;
      }

      .column-menu-item:not(.disabled):hover .col-grip {
        color: var(--dex-color-text, #444);
      }

      .column-menu-item.disabled .col-grip {
        visibility: hidden;
      }

      .column-menu-item .col-label {
        flex: 1 1 auto;
      }

      .column-menu-separator {
        height: 1px;
        margin: 4px 0;
        background: var(--dex-border-color-light, #e0e0e0);
      }

      .column-menu-reset {
        display: block;
        width: calc(100% - 16px);
        margin: 0 8px 2px;
        padding: 4px 8px;
        border: none;
        border-radius: 3px;
        background: transparent;
        color: var(--dex-color-accent, #0078d4);
        font-size: 12px;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        outline: none;
      }

      .column-menu-reset:hover {
        background: var(--dex-bg-hover, #e8e8e8);
      }

      .column-menu-item.drag-over-top {
        box-shadow: inset 0 2px 0 0 var(--dex-color-accent, #0078d4);
      }

      .column-menu-item.drag-over-bottom {
        box-shadow: inset 0 -2px 0 0 var(--dex-color-accent, #0078d4);
      }

      .column-menu-item.dragging {
        opacity: 0.5;
      }

      tr.data-row {
        height: var(--dex-row-height, 28px);
        border-bottom: 1px solid var(--dex-border-color-light, #e0e0e0);
      }

      tr.data-row:hover {
        background: var(--dex-bg-hover, #e8e8e8);
      }

      tr.data-row.selected {
        background: var(--dex-color-accent-bg, #cde4f7);
      }

      tr.data-row.cut {
        opacity: 0.5;
      }

      tr.data-row.copied {
        outline: 1.5px dashed var(--dex-color-accent, #0078d4);
        outline-offset: -1.5px;
      }

      @keyframes copy-flash {
        0% {
          background: rgba(255, 255, 255, 0.9);
        }
        100% {
          background: transparent;
        }
      }

      tr.data-row.copy-flash {
        animation: copy-flash 0.35s ease-out;
      }

      tr.data-row.drag-source {
        opacity: 0.4;
      }

      tr.data-row.drop-target-above {
        box-shadow: inset 0 2px 0 0 var(--dex-color-accent, #0078d4);
      }

      tr.data-row.drop-target-on {
        box-shadow: inset 0 0 0 2px var(--dex-color-accent, #0078d4);
        border-radius: 2px;
      }

      td {
        padding: 3px 8px;
        border-right: 1px solid var(--dex-border-color-light, #e0e0e0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        height: var(--dex-row-height, 28px);
        box-sizing: border-box;
      }

      td:last-child {
        border-right: none;
      }

      /* The Data Type column is rendered in italics. */
      td.col-DataType {
        font-style: italic;
      }

      :host([table-style='light']) td {
        border-right: none;
      }

      :host([table-style='light']) tr.data-row {
        border-bottom: 1px solid var(--dex-border-color-ultralight, rgba(0, 0, 0, 0.05));
      }

      :host([table-style='light']) th {
        border-right: none;
      }

      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--dex-color-text-secondary, #888);
        font-size: 13px;
        font-style: italic;
      }

      td.focused {
        box-shadow: inset 0 0 0 1px var(--dex-color-accent, #0078d4);
      }

      .name-cell {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .name-cell .toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        font-size: 9px;
        color: var(--dex-color-text-secondary, #555);
        cursor: pointer;
        flex-shrink: 0;
      }

      .name-cell .toggle.empty {
        visibility: hidden;
      }

      .name-cell .indent {
        flex-shrink: 0;
      }

      .name-cell .label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .name-cell .label.readonly {
        color: var(--dex-color-text-muted, #666);
      }

      /* Class and Kind are computed, non-editable classifications; gray them so
         the user reads them as read-only rather than editable cell values. */
      .readonly-cell {
        color: var(--dex-color-text-muted, #666);
      }

      /* Section header rows are intentionally understated: muted gray, italic
         Name, and no vertical cell borders so the row reads as one continuous
         strip rather than a set of columns. */
      tr.section-row .name-cell .label {
        font-style: italic;
        color: var(--dex-color-text-muted, #666);
      }

      tr.section-row td {
        border-right: none;
      }

      .value-object {
        color: var(--dex-color-text-muted, #767676);
        font-style: italic;
      }

      .value-link {
        color: var(--dex-color-accent, #0078d4);
        text-decoration: none;
        cursor: pointer;
      }

      .value-link:hover {
        text-decoration: underline;
      }

      .param-property {
        color: var(--dex-text-muted, #888);
      }

      .param-source {
        color: var(--dex-text-muted, #888);
        font-style: italic;
        font-size: 0.9em;
      }

      .status-modified {
        color: #b45309;
        font-weight: 500;
      }

      .edit-input {
        width: 100%;
        border: 1px solid var(--dex-color-accent, #0078d4);
        border-radius: 2px;
        padding: 1px 4px;
        font-size: 12px;
        font-family: inherit;
        box-sizing: border-box;
        outline: none;
      }

      .name-icon {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
      }

      mark {
        background: #fff3a8;
        color: #5a4000;
        border-radius: 2px;
        padding: 0 1px;
      }
    `,
  ];

  @property({ type: Array }) rows: TreeTableRow[] = [];
  @property({ type: Array }) selectedRowIds: string[] = [];
  @property({ type: Number }) rowHeight = DEFAULT_ROW_HEIGHT;
  @property({ type: String, reflect: true, attribute: 'table-style' }) tableStyle: 'normal' | 'light' = 'normal';
  @property({ type: Object }) columnLabels: Record<string, string> | null = null;
  @property({ type: Array }) columns: string[] | null = null;

  get selectedRowId(): string {
    return this.selectedRowIds[this.selectedRowIds.length - 1] || '';
  }
  set selectedRowId(id: string) {
    this.selectedRowIds = id ? [id] : [];
  }

  @state() private _expandedIds: Set<string> = new Set();
  @state() private _filterText = '';
  @state() private _editingCell: {
    rowId: string;
    columnId: string;
    value: string;
    editor?: string;
    options?: string[];
  } | null = null;
  @state() private _scrollTop = 0;
  @state() private _viewportHeight = 400;
  @state() private _focusedCol = 0;
  @state() private _lastClickedId: string | null = null;
  @state() private _focusedRowId: string | null = null;
  @state() private _dragSourceId: string | null = null;
  @state() private _dropTargetId: string | null = null;
  @state() private _dropPosition: 'above' | 'on' | null = null;

  @state() private _columnWidths: Map<string, number> = new Map();
  @state() private _columnOrder: string[] = [...DEFAULT_COLUMN_ORDER];
  @state() private _hiddenColumns: Set<string> = new Set(DEFAULT_HIDDEN_COLUMNS);
  @state() private _sortState: SortEntry[] = [];
  @state() private _columnMenuOpen = false;
  @state() private _columnMenuX = 0;
  @state() private _columnMenuY = 0;
  @state() private _menuDragCol: string | null = null;
  @state() private _menuDragOverCol: string | null = null;
  @state() private _menuDragOverSide: 'top' | 'bottom' | null = null;

  private _resizingCol: string | null = null;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;
  private _resizeNextCol: string | null = null;
  private _resizeNextStartWidth = 0;
  // A resize ends on mouseup, but the browser then fires a `click` on the <th>,
  // which would trigger sorting. `_resizingCol` is already cleared by then, so
  // this flag carries the "just resized" signal to the click handler to swallow
  // that one click.
  private _suppressNextHeaderClick = false;

  private _dragColId: string | null = null;
  private _dragOverColId: string | null = null;
  private _dragOverSide: 'left' | 'right' | null = null;

  @query('.filter-input') private _filterInput!: HTMLInputElement;
  @query('.table-container') private _container!: HTMLElement;

  private get _rowH(): number {
    const v = getComputedStyle(this).getPropertyValue('--dex-row-height');
    return v ? parseInt(v, 10) : this.rowHeight;
  }

  private _visibleRowsCache: TreeTableRow[] | null = null;
  private _depthCache: Map<string, number> = new Map();
  private _childrenCache: Set<string> = new Set();
  private _lastRowsRef: TreeTableRow[] | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._loadPersistedState();
    this._boundOnDocClick = this._onDocumentClick.bind(this);
    document.addEventListener('click', this._boundOnDocClick);
    // Close the column menu when the webview loses focus (e.g. switching editor
    // tabs), so a fixed-position dropdown doesn't linger over an inactive view.
    this._boundOnWindowBlur = this._onWindowBlur.bind(this);
    window.addEventListener('blur', this._boundOnWindowBlur);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._boundOnDocClick) {
      document.removeEventListener('click', this._boundOnDocClick);
    }
    if (this._boundOnWindowBlur) {
      window.removeEventListener('blur', this._boundOnWindowBlur);
    }
  }

  private _boundOnDocClick: ((e: Event) => void) | null = null;
  private _boundOnWindowBlur: (() => void) | null = null;

  private _onWindowBlur(): void {
    if (this._columnMenuOpen) {
      this._columnMenuOpen = false;
    }
  }

  private _onDocumentClick(e: Event): void {
    if (this._columnMenuOpen) {
      const path = e.composedPath();
      const menu = this.shadowRoot?.querySelector('.column-menu');
      if (menu && !path.includes(menu)) {
        this._columnMenuOpen = false;
      }
    }
  }

  private _loadPersistedState(): void {
    try {
      const orderJson = localStorage.getItem('dex-column-order');
      if (orderJson) {
        const arr = JSON.parse(orderJson) as string[];
        if (Array.isArray(arr) && arr.length > 0) {
          this._columnOrder = arr;
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const hiddenJson = localStorage.getItem('dex-hidden-columns');
      if (hiddenJson) {
        const arr = JSON.parse(hiddenJson) as string[];
        if (Array.isArray(arr)) {
          this._hiddenColumns = new Set(arr.filter((c) => c !== 'Name'));
        }
      }
    } catch {
      /* ignore */
    }
  }

  private _persistOrder(): void {
    localStorage.setItem('dex-column-order', JSON.stringify(this._columnOrder));
  }

  private _persistHidden(): void {
    localStorage.setItem('dex-hidden-columns', JSON.stringify([...this._hiddenColumns]));
  }

  // The set of columns this document supports. When the host provides `columns`
  // that is authoritative; otherwise fall back to the built-in default order.
  private get _availableColumns(): string[] {
    return this.columns || [...Object.keys(DEFAULT_WIDTHS)];
  }

  // The user's preferred order restricted to the available columns, appending any
  // available column the saved order doesn't mention (e.g. a newly added column).
  private get _orderedColumns(): string[] {
    const available = this._availableColumns;
    const availableSet = new Set(available);
    const ordered = this._columnOrder.filter((c) => availableSet.has(c));
    for (const c of available) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }

  private get _visibleColumns(): string[] {
    return this._orderedColumns.filter((c) => !this._hiddenColumns.has(c));
  }

  private _getColWidth(col: string, visibleCount: number): string {
    if (this._columnWidths.has(col)) {
      return `${this._columnWidths.get(col)}px`;
    }
    return `${100 / visibleCount}%`;
  }

  private _getTableWidth(visibleCols: string[]): string {
    const allPixel = visibleCols.every((c) => this._columnWidths.has(c));
    if (!allPixel) return 'width: 100%;';
    const total = visibleCols.reduce((sum, c) => sum + (this._columnWidths.get(c) || 0), 0);
    return `width: ${total}px;`;
  }

  // --- Column Resizing ---

  private _onResizeMouseDown(col: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this._resizingCol = col;
    this._resizeStartX = e.clientX;

    const visibleCols = this._visibleColumns;
    const colIdx = visibleCols.indexOf(col);
    this._resizeNextCol = colIdx < visibleCols.length - 1 ? visibleCols[colIdx + 1] : null;

    // Snapshot all visible columns to pixel widths so table-layout:fixed
    // sizes each column absolutely, preventing redistribution during drag.
    const headerRow = (e.target as HTMLElement).closest('tr');
    if (headerRow) {
      const ths = headerRow.querySelectorAll('th');
      const updated = new Map(this._columnWidths);
      ths.forEach((th, i) => {
        if (i < visibleCols.length) {
          updated.set(visibleCols[i], th.offsetWidth);
        }
      });
      this._columnWidths = updated;
      this._resizeStartWidth = updated.get(col) || 100;
      this._resizeNextStartWidth = this._resizeNextCol ? updated.get(this._resizeNextCol) || 100 : 0;
    } else {
      const th = (e.target as HTMLElement).parentElement;
      if (th) {
        this._resizeStartWidth = th.offsetWidth;
      }
      this._resizeNextStartWidth = 0;
    }

    const onMove = (me: MouseEvent) => {
      if (!this._resizingCol) return;
      const delta = me.clientX - this._resizeStartX;
      const maxDelta = this._resizeNextCol ? this._resizeNextStartWidth - 40 : Infinity;
      const clampedDelta = Math.min(Math.max(-this._resizeStartWidth + 40, delta), maxDelta);
      const updated = new Map(this._columnWidths);
      updated.set(this._resizingCol, this._resizeStartWidth + clampedDelta);
      if (this._resizeNextCol) {
        updated.set(this._resizeNextCol, this._resizeNextStartWidth - clampedDelta);
      }
      this._columnWidths = updated;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this._resizingCol = null;
      this._resizeNextCol = null;
      // Swallow the click the browser fires on the <th> right after this
      // mouseup, so ending a resize doesn't also toggle the column sort. The
      // trailing click dispatches synchronously before this timeout, so the
      // timeout only clears the flag if no click follows (e.g. mouseup landed
      // outside the header) — preventing a stuck flag from eating a later sort.
      this._suppressNextHeaderClick = true;
      setTimeout(() => {
        this._suppressNextHeaderClick = false;
      }, 0);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private _onResizeDblClick(col: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const updated = new Map(this._columnWidths);
    updated.delete(col);
    this._columnWidths = updated;
  }

  // --- Column Reordering ---

  private _onHeaderDragStart(col: string, e: DragEvent): void {
    if (this._resizingCol) {
      e.preventDefault();
      return;
    }
    this._dragColId = col;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', col);
    }
  }

  private _onHeaderDragOver(col: string, e: DragEvent): void {
    if (!this._dragColId || this._dragColId === col) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const th = e.currentTarget as HTMLElement;
    const rect = th.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    this._dragOverColId = col;
    this._dragOverSide = e.clientX < midX ? 'left' : 'right';
    this.requestUpdate();
  }

  private _onHeaderDragLeave(_e: DragEvent): void {
    this._dragOverColId = null;
    this._dragOverSide = null;
    this.requestUpdate();
  }

  private _onHeaderDrop(col: string, e: DragEvent): void {
    e.preventDefault();
    if (!this._dragColId || this._dragColId === col) {
      this._dragColId = null;
      this._dragOverColId = null;
      this._dragOverSide = null;
      return;
    }

    const order = [...this._columnOrder];
    const fromIdx = order.indexOf(this._dragColId);
    if (fromIdx < 0) return;

    order.splice(fromIdx, 1);
    let toIdx = order.indexOf(col);
    if (this._dragOverSide === 'right') {
      toIdx += 1;
    }
    order.splice(toIdx, 0, this._dragColId);

    this._columnOrder = order;
    this._dragColId = null;
    this._dragOverColId = null;
    this._dragOverSide = null;
    this._persistOrder();
  }

  private _onHeaderDragEnd(_e: DragEvent): void {
    this._dragColId = null;
    this._dragOverColId = null;
    this._dragOverSide = null;
    this.requestUpdate();
  }

  // --- Column Customization Menu ---

  // Toggle the column-customization dropdown, anchored under the button.
  private _onColumnsButtonClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (this._columnMenuOpen) {
      this._columnMenuOpen = false;
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    // Right-anchor the menu to the button (it grows leftward), so a button near
    // the right edge doesn't push the dropdown off-screen and truncate labels.
    this._columnMenuX = Math.max(0, window.innerWidth - rect.right);
    this._columnMenuY = rect.bottom + 2;
    this._columnMenuOpen = true;
  }

  private _toggleColumnVisibility(col: string): void {
    if (col === 'Name') return;
    const updated = new Set(this._hiddenColumns);
    if (updated.has(col)) {
      updated.delete(col);
    } else {
      updated.add(col);
    }
    this._hiddenColumns = updated;
    this._persistHidden();
  }

  // Restore the default column order and visibility, discarding any customization.
  private _resetColumns(e: Event): void {
    e.stopPropagation();
    this._columnOrder = [...DEFAULT_COLUMN_ORDER];
    this._hiddenColumns = new Set(DEFAULT_HIDDEN_COLUMNS);
    this._persistOrder();
    this._persistHidden();
  }

  // --- Column reordering from the menu list ---

  private _onMenuDragStart(col: string, e: DragEvent): void {
    if (col === 'Name') {
      e.preventDefault();
      return;
    }
    this._menuDragCol = col;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', col);
    }
  }

  private _onMenuDragOver(col: string, e: DragEvent): void {
    if (!this._menuDragCol || col === 'Name') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const item = e.currentTarget as HTMLElement;
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    this._menuDragOverCol = col;
    this._menuDragOverSide = e.clientY < midY ? 'top' : 'bottom';
  }

  private _onMenuDragLeave(): void {
    this._menuDragOverCol = null;
    this._menuDragOverSide = null;
  }

  private _onMenuDrop(col: string, e: DragEvent): void {
    e.preventDefault();
    const dragged = this._menuDragCol;
    this._menuDragCol = null;
    this._menuDragOverCol = null;
    const side = this._menuDragOverSide;
    this._menuDragOverSide = null;
    // Name is pinned first and can neither move nor be displaced.
    if (!dragged || dragged === col || dragged === 'Name' || col === 'Name') return;

    const order = [...this._orderedColumns];
    const fromIdx = order.indexOf(dragged);
    if (fromIdx < 0) return;
    order.splice(fromIdx, 1);
    let toIdx = order.indexOf(col);
    if (side === 'bottom') toIdx += 1;
    order.splice(toIdx, 0, dragged);

    this._columnOrder = order;
    this._persistOrder();
  }

  private _onMenuDragEnd(): void {
    this._menuDragCol = null;
    this._menuDragOverCol = null;
    this._menuDragOverSide = null;
  }

  // --- Sorting ---

  private _onHeaderClick(col: string, e: MouseEvent): void {
    if (this._resizingCol) return;
    // A resize just ended: this is the trailing click from that drag, not an
    // intent to sort. Consume the flag and bail.
    if (this._suppressNextHeaderClick) {
      this._suppressNextHeaderClick = false;
      return;
    }

    if (e.shiftKey) {
      const existing = this._sortState.findIndex((s) => s.column === col);
      const updated = [...this._sortState];
      if (existing >= 0) {
        const current = updated[existing];
        if (current.direction === 'asc') {
          updated[existing] = { column: col, direction: 'desc' };
        } else {
          updated.splice(existing, 1);
        }
      } else {
        updated.push({ column: col, direction: 'asc' });
      }
      this._sortState = updated;
    } else {
      const existing = this._sortState.length === 1 ? this._sortState[0] : null;
      if (existing && existing.column === col) {
        if (existing.direction === 'asc') {
          this._sortState = [{ column: col, direction: 'desc' }];
        } else {
          this._sortState = [];
        }
      } else {
        this._sortState = [{ column: col, direction: 'asc' }];
      }
    }
    this._visibleRowsCache = null;
  }

  private _getAriaSortValue(col: string): 'ascending' | 'descending' | 'none' {
    const entry = this._sortState.find((s) => s.column === col);
    if (!entry) return 'none';
    return entry.direction === 'asc' ? 'ascending' : 'descending';
  }

  private _getSortIndicator(col: string): unknown {
    const entry = this._sortState.find((s) => s.column === col);
    if (!entry) return nothing;
    return html`<span class="sort-indicator">${entry.direction === 'asc' ? '▲' : '▼'}</span>`;
  }

  // Sort a group of sibling rows in place. Sorting must never cross
  // parent/child boundaries, so this is applied per-level in
  // _flattenToVisible rather than to the flattened tree — otherwise a child
  // could sort above its own parent and the hierarchy would break.
  private _sortSiblings(siblings: TreeTableRow[]): void {
    if (this._sortState.length === 0) return;

    siblings.sort((a, b) => {
      for (const { column, direction } of this._sortState) {
        const aVal = this._getCellSortText(a, column);
        const bVal = this._getCellSortText(b, column);
        const cmp = aVal.localeCompare(bVal);
        if (cmp !== 0) {
          return direction === 'asc' ? cmp : -cmp;
        }
      }
      return 0;
    });
  }

  private _getCellText(row: TreeTableRow, col: string): string {
    switch (col) {
      case 'Name':
        return row.Name?.label || '';
      case 'Value':
        return typeof row.Value === 'object' ? row.Value.text : String(row.Value || '');
      case 'DataType':
        if (typeof row.DataType === 'object' && 'paramLinks' in (row.DataType as any))
          return (row.DataType as any).paramLinks
            .map((p: any) => `${p.property}=${p.paramName}(${p.source})`)
            .join(', ');
        if (typeof row.DataType === 'object' && 'links' in (row.DataType as any))
          return (row.DataType as any).links.map((l: any) => l.text).join(', ');
        return typeof row.DataType === 'object' ? (row.DataType as any).text : String(row.DataType || '');
      case 'Class':
        return typeof row.Class === 'object' ? row.Class.text : String(row.Class || '');
      case 'Kind':
        return typeof row.Kind === 'object' ? row.Kind.text : String(row.Kind || '');
      case 'Description':
        return typeof row.Description === 'object' ? row.Description.text : String(row.Description || '');
      case 'Status':
        return typeof row.Status === 'object' ? row.Status.text : String(row.Status || '');
      case 'UsedBy':
        if (!row.UsedBy) return '';
        if (typeof row.UsedBy === 'string') return row.UsedBy;
        if ('paramLinks' in (row.UsedBy as any))
          return (row.UsedBy as any).paramLinks.map((p: any) => `${p.property}=${p.paramName}(${p.source})`).join(', ');
        if ('blockLinks' in (row.UsedBy as any))
          return (row.UsedBy as any).blockLinks.map((b: any) => `${b.blockName}(${b.modelName})`).join(', ');
        if ('links' in row.UsedBy) return row.UsedBy.links.map((l) => l.text).join(', ');
        return (row.UsedBy as any).text;
      default:
        return '';
    }
  }

  private _getCellSortText(row: TreeTableRow, col: string): string {
    return this._getCellText(row, col).toLowerCase();
  }

  override firstUpdated(): void {
    if (this._container) {
      this._viewportHeight = this._container.clientHeight;
    }
  }

  private _lastStartIdx = -1;

  private _onScroll(): void {
    if (!this._container) return;
    const scrollTop = this._container.scrollTop;
    const headerHeight = this._rowH;
    const adjustedScroll = Math.max(0, scrollTop - headerHeight);
    const newStartIdx = Math.max(0, Math.floor(adjustedScroll / this._rowH) - BUFFER_ROWS);

    if (newStartIdx === this._lastStartIdx) {
      const rowsTable = this.shadowRoot?.querySelector('.rows-table') as HTMLElement;
      if (rowsTable) {
        const offsetTop = this._lastStartIdx * this._rowH + headerHeight;
        rowsTable.style.top = offsetTop + 'px';
      }
      return;
    }
    this._scrollTop = scrollTop;
  }

  private _invalidateCache(): void {
    this._visibleRowsCache = null;
    this._depthCache.clear();
    this._childrenCache.clear();
  }

  private _buildCaches(): void {
    if (this._lastRowsRef !== this.rows) {
      this._lastRowsRef = this.rows;
      this._depthCache.clear();
      this._childrenCache.clear();

      const rowById = new Map<string, TreeTableRow>();
      for (const r of this.rows) {
        rowById.set(r.ID, r);
        if (r.parent !== null) {
          this._childrenCache.add(r.parent);
        }
      }

      for (const r of this.rows) {
        let depth = 0;
        let pid = r.parent;
        while (pid && rowById.has(pid)) {
          depth++;
          pid = rowById.get(pid)!.parent;
        }
        this._depthCache.set(r.ID, depth);
      }
    }
  }

  private _getVisibleRows(): TreeTableRow[] {
    if (this._visibleRowsCache) return this._visibleRowsCache;
    let rows = this.rows;
    if (this._filterText) {
      rows = this._filterRows(rows, this._filterText);
    }
    const visible = this._flattenToVisible(rows);
    this._visibleRowsCache = visible;
    return visible;
  }

  private _parseFilterExpression(text: string): Array<(row: TreeTableRow) => boolean> {
    const predicates: Array<(row: TreeTableRow) => boolean> = [];
    const tokens = text.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

    // An unqualified term matches against every visible column, so the search
    // stays in sync with whatever columns the user actually sees (Class, Kind,
    // etc.) instead of a hardcoded subset.
    const searchColumns = this._visibleColumns;
    const makeGenericPredicate = (term: string): ((row: TreeTableRow) => boolean) => {
      const lower = term.toLowerCase();
      return (row) => searchColumns.some((col) => this._getCellText(row, col).toLowerCase().includes(lower));
    };

    for (const token of tokens) {
      const colonIdx = token.indexOf(':');
      if (colonIdx > 0) {
        const prefix = token.slice(0, colonIdx).toLowerCase();
        const rawValue = token.slice(colonIdx + 1);

        if (prefix === 'name') {
          const term = rawValue.toLowerCase();
          predicates.push((row) => {
            return this._getCellText(row, 'Name').toLowerCase().includes(term);
          });
        } else if (prefix === 'type') {
          const term = rawValue.toLowerCase();
          predicates.push((row) => {
            return this._getCellText(row, 'DataType').toLowerCase().includes(term);
          });
        } else if (prefix === 'class') {
          const term = rawValue.toLowerCase();
          predicates.push((row) => {
            return this._getCellText(row, 'Class').toLowerCase().includes(term);
          });
        } else if (prefix === 'kind') {
          const term = rawValue.toLowerCase();
          predicates.push((row) => {
            return this._getCellText(row, 'Kind').toLowerCase().includes(term);
          });
        } else if (prefix === 'status') {
          const term = rawValue.toLowerCase();
          predicates.push((row) => {
            return this._getCellText(row, 'Status').toLowerCase().includes(term);
          });
        } else if (prefix === 'value') {
          if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
            const exact = rawValue.slice(1, -1);
            predicates.push((row) => {
              return this._getCellText(row, 'Value') === exact;
            });
          } else if (/^(>=|<=|>|<|=)/.test(rawValue)) {
            const opMatch = rawValue.match(/^(>=|<=|>|<|=)/);
            const op = opMatch![0];
            const numStr = rawValue.slice(op.length);
            const num = parseFloat(numStr);
            if (!isNaN(num)) {
              predicates.push((row) => {
                const val = this._getCellText(row, 'Value');
                const rowNum = parseFloat(val);
                if (isNaN(rowNum)) return false;
                switch (op) {
                  case '>':
                    return rowNum > num;
                  case '<':
                    return rowNum < num;
                  case '>=':
                    return rowNum >= num;
                  case '<=':
                    return rowNum <= num;
                  case '=':
                    return rowNum === num;
                  default:
                    return false;
                }
              });
            }
          } else {
            const term = rawValue.toLowerCase();
            predicates.push((row) => {
              return this._getCellText(row, 'Value').toLowerCase().includes(term);
            });
          }
        } else {
          predicates.push(makeGenericPredicate(token));
        }
      } else {
        predicates.push(makeGenericPredicate(token));
      }
    }

    return predicates;
  }

  private _filterRows(rows: TreeTableRow[], text: string): TreeTableRow[] {
    const predicates = this._parseFilterExpression(text);
    if (predicates.length === 0) return rows;

    const rowById = new Map<string, TreeTableRow>();
    for (const r of rows) rowById.set(r.ID, r);

    const hitSet = new Set<string>();
    for (const row of rows) {
      if (predicates.every((pred) => pred(row))) {
        hitSet.add(row.ID);
      }
    }

    const includeSet = new Set<string>();
    for (const row of rows) {
      if (hitSet.has(row.ID)) {
        includeSet.add(row.ID);
        let parentId = row.parent;
        while (parentId && rowById.has(parentId)) {
          includeSet.add(parentId);
          parentId = rowById.get(parentId)!.parent;
        }
      }
    }

    for (const row of rows) {
      if (includeSet.has(row.ID)) continue;
      let parentId = row.parent;
      while (parentId) {
        if (hitSet.has(parentId)) {
          includeSet.add(row.ID);
          let mid = row.parent;
          while (mid && mid !== parentId) {
            includeSet.add(mid);
            mid = rowById.get(mid)?.parent || null;
          }
          break;
        }
        parentId = rowById.get(parentId)?.parent || null;
      }
    }

    return rows.filter((r) => includeSet.has(r.ID));
  }

  private _flattenToVisible(rows: TreeTableRow[]): TreeTableRow[] {
    const topLevel: TreeTableRow[] = [];
    const childMap = new Map<string, TreeTableRow[]>();
    for (const r of rows) {
      if (r.parent === null) {
        topLevel.push(r);
      } else {
        let siblings = childMap.get(r.parent);
        if (!siblings) {
          siblings = [];
          childMap.set(r.parent, siblings);
        }
        siblings.push(r);
      }
    }

    // Sort each level independently so siblings reorder while every child
    // stays within its parent's subtree.
    this._sortSiblings(topLevel);
    for (const siblings of childMap.values()) {
      this._sortSiblings(siblings);
    }

    const result: TreeTableRow[] = [];
    const stack: TreeTableRow[] = [];
    for (let i = topLevel.length - 1; i >= 0; i--) {
      stack.push(topLevel[i]);
    }
    while (stack.length > 0) {
      const node = stack.pop()!;
      result.push(node);
      if (this._expandedIds.has(node.ID)) {
        const children = childMap.get(node.ID);
        if (children) {
          for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]);
          }
        }
      }
    }
    return result;
  }

  private _toggleExpand(rowId: string): void {
    const newSet = new Set(this._expandedIds);
    if (newSet.has(rowId)) {
      newSet.delete(rowId);
    } else {
      newSet.add(rowId);
    }
    this._expandedIds = newSet;
    this._visibleRowsCache = null;
  }

  private _expandAncestors(rowIds: string[]): void {
    const rowById = new Map<string, TreeTableRow>();
    for (const r of this.rows) rowById.set(r.ID, r);

    let changed = false;
    const newSet = new Set(this._expandedIds);
    for (const rowId of rowIds) {
      const row = rowById.get(rowId);
      if (!row) continue;
      let pid = row.parent;
      while (pid) {
        if (!newSet.has(pid)) {
          newSet.add(pid);
          changed = true;
        }
        const parentRow = rowById.get(pid);
        pid = parentRow?.parent || null;
      }
    }
    if (changed) {
      this._expandedIds = newSet;
      this._visibleRowsCache = null;
    }
  }

  private _onContainerContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  private _onRowContextMenu(rowId: string, e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!this.selectedRowIds.includes(rowId)) {
      this.selectedRowIds = [rowId];
      this._lastClickedId = rowId;
      this.dispatchEvent(
        new CustomEvent('dex-row-selected', {
          detail: { rowIds: this.selectedRowIds },
          bubbles: true,
          composed: true,
        }),
      );
    }
    const row = this._getVisibleRows().find((r) => r.ID === rowId);
    const graphTarget = row ? (row as any)._graphTarget : undefined;
    this.dispatchEvent(
      new CustomEvent('dex-table-context-menu', {
        detail: { x: e.clientX, y: e.clientY, rowId, graphTarget },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onCellClick(rowId: string, colIdx: number, e: MouseEvent): void {
    this._focusedCol = colIdx;
    this._onRowClick(rowId, e);
  }

  private _onRowClick(rowId: string, e?: MouseEvent): void {
    const ctrlKey = e ? e.ctrlKey || e.metaKey : false;
    const shiftKey = e ? e.shiftKey : false;

    if (ctrlKey) {
      const current = new Set(this.selectedRowIds);
      if (current.has(rowId)) {
        current.delete(rowId);
      } else {
        current.add(rowId);
      }
      this.selectedRowIds = [...current];
      this._lastClickedId = rowId;
    } else if (shiftKey && this._lastClickedId) {
      const visible = this._getVisibleRows();
      const lastIdx = visible.findIndex((r) => r.ID === this._lastClickedId);
      const curIdx = visible.findIndex((r) => r.ID === rowId);
      if (lastIdx >= 0 && curIdx >= 0) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        this.selectedRowIds = visible.slice(start, end + 1).map((r) => r.ID);
      }
    } else {
      this.selectedRowIds = [rowId];
      this._lastClickedId = rowId;
    }

    this.dispatchEvent(
      new CustomEvent('dex-row-selected', {
        detail: { rowIds: this.selectedRowIds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- Row Drag and Drop ---

  private _onRowDragStart(rowId: string, e: DragEvent): void {
    this._dragSourceId = rowId;
    const rowIds =
      this.selectedRowIds.length > 1 && this.selectedRowIds.includes(rowId) ? this.selectedRowIds : [rowId];

    const classNames: string[] = [];
    for (const id of rowIds) {
      const row = this.rows.find((r) => r.ID === id);
      if (row) {
        const dt = typeof row.DataType === 'object' ? row.DataType.text : String(row.DataType || '');
        if (dt) classNames.push(dt);
      }
    }

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/dex-rows', JSON.stringify({ rowIds, classNames }));
      this._setDragImage(e, rowId, rowIds.length);
    }
    this.dispatchEvent(
      new CustomEvent('dex-row-drag-start', {
        detail: { rowIds, classNames },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _setDragImage(e: DragEvent, rowId: string, count: number): void {
    const row = this.rows.find((r) => r.ID === rowId);
    if (!row || !e.dataTransfer) return;

    const ghost = document.createElement('div');
    ghost.style.cssText =
      'position:absolute;top:-1000px;left:-1000px;display:flex;align-items:center;gap:6px;padding:4px 10px;background:#fff;border:1px solid #d0d0d0;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15);white-space:nowrap;';
    const iconId = row.Name?.iconId;
    if (iconId) {
      const icon = document.createElement('dex-icon') as HTMLElement;
      (icon as unknown as { iconId: string }).iconId = iconId;
      (icon as unknown as { size: number }).size = 16;
      ghost.appendChild(icon);
    }
    const label = document.createElement('span');
    label.textContent = count > 1 ? `${row.Name?.label || rowId} (+${count - 1})` : row.Name?.label || rowId;
    ghost.appendChild(label);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }

  private _onRowDragEnd(_e: DragEvent): void {
    this._dragSourceId = null;
    this._dropTargetId = null;
    this._dropPosition = null;
  }

  private _onRowDragOver(rowId: string, e: DragEvent): void {
    if (rowId === this._dragSourceId) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    }
    this._dropTargetId = rowId;
    this._dropPosition = 'on';
  }

  private _onRowDragLeave(_e: DragEvent): void {
    this._dropTargetId = null;
    this._dropPosition = null;
  }

  private _onRowDrop(targetRowId: string, e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    const data = e.dataTransfer?.getData('application/dex-rows');
    if (!data) return;

    const { rowIds } = JSON.parse(data);
    const isCopy = e.ctrlKey || e.metaKey;

    this._dragSourceId = null;
    this._dropTargetId = null;
    this._dropPosition = null;

    this.dispatchEvent(
      new CustomEvent('dex-row-drop', {
        detail: {
          sourceRowIds: rowIds,
          targetRowId,
          mode: isCopy ? 'copy' : 'move',
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onCellDblClickIfEditable(row: TreeTableRow, columnId: string): void {
    if (columnId === 'Name') {
      const editable = row.Name?.editable ?? false;
      if (!editable) return;
      this._onCellDblClick(row.ID, 'Name', row.Name?.label || '');
    } else if (columnId === 'Value') {
      const val =
        typeof row.Value === 'object'
          ? row.Value
          : { text: String(row.Value || ''), editable: row._valueEditable ?? false };
      if (!val.editable) return;
      this._onCellDblClick(row.ID, 'Value', val.text || '', (val as { editor?: string }).editor, (val as { options?: string[] }).options);
    } else if (columnId === 'Description') {
      if (row._valueEditable === false) return;
      const val = typeof row.Description === 'object' ? row.Description.text : String(row.Description || '');
      this._onCellDblClick(row.ID, 'Description', val);
    }
  }

  private _onTableKeyDown(e: KeyboardEvent): void {
    if (this._editingCell) return;
    const visibleRows = this._getVisibleRows();
    if (visibleRows.length === 0) return;

    const visibleCols = this._visibleColumns;
    const focusId = this._focusedRowId || this.selectedRowId;
    const currentIdx = visibleRows.findIndex((r) => r.ID === focusId);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, visibleRows.length - 1);
        if (e.ctrlKey || e.metaKey) {
          this._extendSelection(visibleRows[nextIdx].ID, nextIdx);
        } else if (e.shiftKey && this._lastClickedId) {
          this._rangeSelect(visibleRows[nextIdx].ID, nextIdx, visibleRows);
        } else {
          this._selectAndScroll(visibleRows[nextIdx].ID, nextIdx);
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        if (e.ctrlKey || e.metaKey) {
          this._extendSelection(visibleRows[prevIdx].ID, prevIdx);
        } else if (e.shiftKey && this._lastClickedId) {
          this._rangeSelect(visibleRows[prevIdx].ID, prevIdx, visibleRows);
        } else {
          this._selectAndScroll(visibleRows[prevIdx].ID, prevIdx);
        }
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        this._focusedCol = Math.min(this._focusedCol + 1, visibleCols.length - 1);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        this._focusedCol = Math.max(this._focusedCol - 1, 0);
        break;
      }
      case ' ': {
        e.preventDefault();
        if (this.selectedRowId && this._childrenCache.has(this.selectedRowId)) {
          this._toggleExpand(this.selectedRowId);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (currentIdx < 0) break;
        const row = visibleRows[currentIdx];
        const colId = visibleCols[this._focusedCol];
        if (colId) {
          this._onCellDblClickIfEditable(row, colId);
        }
        break;
      }
      case 'a':
      case 'A': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this._selectAll();
        }
        break;
      }
    }
  }

  private _selectAll(): void {
    const visible = this._getVisibleRows();
    if (visible.length === 0) return;
    this.selectedRowIds = visible.map((r) => r.ID);
    this.dispatchEvent(
      new CustomEvent('dex-row-selected', {
        detail: { rowIds: this.selectedRowIds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _selectAndScroll(rowId: string, rowIdx: number): void {
    this._focusedRowId = null;
    this._onRowClick(rowId);
    this._scrollToRow(rowIdx);
  }

  private _extendSelection(rowId: string, rowIdx: number): void {
    const current = new Set(this.selectedRowIds);
    current.add(rowId);
    this.selectedRowIds = [...current];
    this._lastClickedId = rowId;
    this._focusedRowId = rowId;
    this._scrollToRow(rowIdx);
    this.dispatchEvent(
      new CustomEvent('dex-row-selected', {
        detail: { rowIds: this.selectedRowIds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _rangeSelect(rowId: string, _rowIdx: number, visibleRows: TreeTableRow[]): void {
    const anchorId = this._lastClickedId!;
    const anchorIdx = visibleRows.findIndex((r) => r.ID === anchorId);
    const curIdx = visibleRows.findIndex((r) => r.ID === rowId);
    if (anchorIdx >= 0 && curIdx >= 0) {
      const start = Math.min(anchorIdx, curIdx);
      const end = Math.max(anchorIdx, curIdx);
      this.selectedRowIds = visibleRows.slice(start, end + 1).map((r) => r.ID);
    }
    this._focusedRowId = rowId;
    this._scrollToRow(_rowIdx);
    this.dispatchEvent(
      new CustomEvent('dex-row-selected', {
        detail: { rowIds: this.selectedRowIds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _scrollToRow(rowIdx: number): void {
    const top = rowIdx * this._rowH;
    if (this._container) {
      const headerHeight = this._rowH;
      const scrollTop = this._container.scrollTop;
      const viewHeight = this._container.clientHeight;
      if (top < scrollTop - headerHeight) {
        this._container.scrollTop = top;
      } else if (top + this._rowH > scrollTop + viewHeight - headerHeight) {
        this._container.scrollTop = top + this._rowH - viewHeight + headerHeight;
      }
    }
  }

  private _onCellDblClick(
    rowId: string,
    columnId: string,
    currentValue: string,
    editor?: string,
    options?: string[],
  ): void {
    this._editingCell = { rowId, columnId, value: currentValue, editor, options };
    this.updateComplete.then(() => {
      const input = this.shadowRoot?.querySelector('.edit-input') as HTMLInputElement | HTMLSelectElement;
      if (input) {
        input.focus();
        // <select> has no text to select; only inputs/textareas support .select().
        if (typeof (input as HTMLInputElement).select === 'function') {
          (input as HTMLInputElement).select();
        }
      }
    });
  }

  private _onEditKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this._commitEdit();
      this._focusTable();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._editingCell = null;
      this._focusTable();
    }
  };

  private _focusTable(): void {
    this.updateComplete.then(() => {
      this._container?.focus();
    });
  }

  private _onEditBlur = (): void => {
    if (this._editingCell) {
      this._commitEdit();
    }
  };

  private _commitEdit(): void {
    if (!this._editingCell) return;
    const input = this.shadowRoot?.querySelector('.edit-input') as HTMLInputElement | HTMLSelectElement;
    if (!input) return;
    const newValue = input.value;
    const oldValue = this._editingCell.value;
    const { rowId, columnId } = this._editingCell;
    this._editingCell = null;

    if (newValue !== oldValue) {
      this.dispatchEvent(
        new CustomEvent<EditCompletedDetail>('dex-edit-completed', {
          detail: { rowId, columnId, oldValue, newValue },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _onFilterInput(e: Event): void {
    this._filterText = (e.target as HTMLInputElement).value.trim();
    this._visibleRowsCache = null;
  }

  private _onFilterKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this._filterText = '';
      this._filterInput.value = '';
      this._visibleRowsCache = null;
    }
  }

  private _onLinkClick(target: string, e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('dex-link-clicked', {
        detail: { target },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _highlight(text: string): unknown {
    if (!this._filterText || !text) return text;
    const lower = text.toLowerCase();
    const term = this._filterText.toLowerCase();
    const idx = lower.indexOf(term);
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + term.length);
    const after = text.slice(idx + term.length);
    return html`${before}<mark>${match}</mark>${after}`;
  }

  private _renderCellValue(row: TreeTableRow, columnId: string): unknown {
    const isEditing = this._editingCell?.rowId === row.ID && this._editingCell?.columnId === columnId;

    if (columnId === 'Name') {
      const hasChildren = this._childrenCache.has(row.ID);
      const expanded = this._expandedIds.has(row.ID);
      const depth = this._depthCache.get(row.ID) || 0;
      const editable = row.Name?.editable ?? false;
      const label = row.Name?.label || '';

      if (isEditing) {
        return html`
          <div class="name-cell">
            <span class="indent" style="width: ${depth * 16}px"></span>
            <span class="toggle empty"></span>
            <input class="edit-input" .value=${label} @keydown=${this._onEditKeyDown} @blur=${this._onEditBlur} />
          </div>
        `;
      }

      const iconId = row.Name?.iconId || '';
      return html`
        <div class="name-cell">
          <span class="indent" style="width: ${depth * 16}px"></span>
          <span
            class="toggle ${hasChildren ? '' : 'empty'}"
            @click=${(e: Event) => {
              e.stopPropagation();
              if (hasChildren) this._toggleExpand(row.ID);
            }}
          >
            ${hasChildren ? (expanded ? '▼' : '▶') : ''}
          </span>
          ${iconId ? html`<dex-icon class="name-icon" .iconId=${iconId} .size=${16}></dex-icon>` : ''}
          <span class="label ${editable ? '' : 'readonly'}">${this._highlight(label)}</span>
        </div>
      `;
    }

    if (columnId === 'Value') {
      const val =
        typeof row.Value === 'object'
          ? row.Value
          : { text: String(row.Value || ''), editable: row._valueEditable ?? false };
      const text = val.text || '';
      const linkTarget = (val as { linkTarget?: string }).linkTarget;

      if (isEditing) {
        if (this._editingCell?.editor === 'select') {
          const options = this._editingCell?.options || [];
          return html`<select
            class="edit-input"
            @keydown=${this._onEditKeyDown}
            @change=${this._onEditBlur}
            @blur=${this._onEditBlur}
          >
            ${options.map((opt) => html`<option .value=${opt} ?selected=${opt === text}>${opt}</option>`)}
          </select>`;
        }
        return html`<input
          class="edit-input"
          .value=${text}
          @keydown=${this._onEditKeyDown}
          @blur=${this._onEditBlur}
        />`;
      }

      if (linkTarget) {
        return html`<a class="value-link" href="#" @click=${(e: Event) => this._onLinkClick(linkTarget, e)}
          >${this._highlight(text)}</a
        >`;
      }

      const isObject = text.startsWith('<') && text.endsWith('>');
      return html`<span class="${isObject ? 'value-object' : ''}">${this._highlight(text)}</span>`;
    }

    if (columnId === 'DataType') {
      const val = typeof row.DataType === 'object' ? (row.DataType as any) : { text: String(row.DataType || '') };
      if ('paramLinks' in val) {
        return html`${val.paramLinks.map(
          (p: { property: string; paramName: string; source: string; linkTarget: string }, i: number) =>
            html`${i > 0 ? ', ' : ''}<span class="param-property">${p.property + '='}</span
              ><a class="value-link" href="#" @click=${(e: Event) => this._onLinkClick(p.linkTarget, e)}
                >${this._highlight(p.paramName)}</a
              ><span class="param-source">${'(' + p.source + ')'}</span>`,
        )}`;
      }
      if ('links' in val) {
        return html`${val.links.map(
          (link: { text: string; linkTarget: string }, i: number) =>
            html`${i > 0 ? ', ' : ''}<a
                class="value-link"
                href="#"
                @click=${(e: Event) => this._onLinkClick(link.linkTarget, e)}
                >${this._highlight(link.text)}</a
              >`,
        )}`;
      }
      const dtText = val.text || '';
      const dtLink = val.linkTarget;
      if (dtLink) {
        return html`<a class="value-link" href="#" @click=${(e: Event) => this._onLinkClick(dtLink, e)}
          >${this._highlight(dtText)}</a
        >`;
      }
      return html`<span>${this._highlight(dtText)}</span>`;
    }

    if (columnId === 'Class') {
      const val = typeof row.Class === 'object' ? row.Class.text : String(row.Class || '');
      return html`<span class="readonly-cell">${this._highlight(val)}</span>`;
    }

    if (columnId === 'Kind') {
      const val = typeof row.Kind === 'object' ? row.Kind.text : String(row.Kind || '');
      return html`<span class="readonly-cell">${this._highlight(val)}</span>`;
    }

    if (columnId === 'Description') {
      const val = typeof row.Description === 'object' ? row.Description.text : String(row.Description || '');
      if (isEditing) {
        return html`<input
          class="edit-input"
          .value=${val}
          @keydown=${this._onEditKeyDown}
          @blur=${this._onEditBlur}
        />`;
      }
      return html`<span>${this._highlight(val)}</span>`;
    }

    if (columnId === 'UsedBy') {
      if (!row.UsedBy) return html``;
      const val = typeof row.UsedBy === 'object' ? row.UsedBy : { text: String(row.UsedBy || '') };
      if ('paramLinks' in val) {
        return html`${(val as any).paramLinks.map(
          (p: { property: string; paramName: string; source: string; linkTarget: string }, i: number) =>
            html`${i > 0 ? ', ' : ''}<span class="param-property">${p.property + '='}</span
              ><a class="value-link" href="#" @click=${(e: Event) => this._onLinkClick(p.linkTarget, e)}
                >${this._highlight(p.paramName)}</a
              ><span class="param-source">${'(' + p.source + ')'}</span>`,
        )}`;
      }
      if ('blockLinks' in val) {
        return html`${(val as any).blockLinks.map(
          (b: { blockName: string; modelName: string; linkTarget: string }, i: number) =>
            html`${i > 0 ? ', ' : ''}<a
                class="value-link"
                href="#"
                @click=${(e: Event) => this._onLinkClick(b.linkTarget, e)}
                >${this._highlight(b.blockName)}</a
              ><span class="param-source">${'(' + b.modelName + ')'}</span>`,
        )}`;
      }
      if ('links' in val) {
        return html`${(val as any).links.map(
          (link: { text: string; linkTarget: string }, i: number) =>
            html`${i > 0 ? ', ' : ''}<a
                class="value-link"
                href="#"
                @click=${(e: Event) => this._onLinkClick(link.linkTarget, e)}
                >${this._highlight(link.text)}</a
              >`,
        )}`;
      }
      const text = (val as { text: string }).text || '';
      const linkTarget = (val as { linkTarget?: string }).linkTarget;
      if (linkTarget) {
        return html`<a class="value-link" href="#" @click=${(e: Event) => this._onLinkClick(linkTarget, e)}
          >${this._highlight(text)}</a
        >`;
      }
      return html`<span>${this._highlight(text)}</span>`;
    }

    if (columnId === 'Status') {
      const val = typeof row.Status === 'object' ? row.Status.text : String(row.Status || '');
      return html`<span class="${val ? 'status-modified' : ''}">${val}</span>`;
    }

    return html``;
  }

  override willUpdate(changedProps: Map<string, unknown>): void {
    if (changedProps.has('rows')) {
      this._invalidateCache();
      this._buildCaches();
    }
    if (changedProps.has('_expandedIds') || changedProps.has('_filterText') || changedProps.has('_sortState')) {
      this._visibleRowsCache = null;
    }
    if (changedProps.has('selectedRowIds') && this.selectedRowIds.length > 0) {
      this._expandAncestors(this.selectedRowIds);
      this._scrollToSelectedRow();
    }
  }

  private _scrollToSelectedRow(): void {
    this.updateComplete.then(() => {
      if (!this._container || !this.selectedRowId) return;
      const visible = this._getVisibleRows();
      const idx = visible.findIndex((r) => r.ID === this.selectedRowId);
      if (idx < 0) return;
      const top = idx * this._rowH;
      const headerHeight = this._rowH;
      const scrollTop = this._container.scrollTop;
      const viewHeight = this._container.clientHeight;
      if (top < scrollTop) {
        this._container.scrollTop = top;
      } else if (top + this._rowH > scrollTop + viewHeight - headerHeight) {
        this._container.scrollTop = top + this._rowH - viewHeight + headerHeight;
      }
    });
  }

  flashRow(rowId: string): void {
    this._pendingFlashId = rowId;
    this.requestUpdate();
  }

  private _pendingFlashId: string | null = null;

  override updated(changedProps: Map<string, unknown>): void {
    super.updated(changedProps);
    if (this._pendingFlashId) {
      const id = this._pendingFlashId;
      this._pendingFlashId = null;
      requestAnimationFrame(() => {
        const container = this.shadowRoot?.querySelector('.table-container');
        if (!container) return;
        const tr = container.querySelector(`tr[data-row-id="${id}"]`) as HTMLElement;
        if (!tr) return;
        tr.classList.add('copy-flash');
        tr.addEventListener('animationend', () => tr.classList.remove('copy-flash'), { once: true });
      });
    }
  }

  override render() {
    this._buildCaches();
    const allVisible = this._getVisibleRows();
    const totalRows = allVisible.length;
    const visibleCols = this._visibleColumns;

    if (this.rows.length === 0) {
      return html`
        <div class="filter-bar">
          <input
            type="search"
            class="filter-input"
            placeholder="Search"
            @input=${this._onFilterInput}
            @keydown=${this._onFilterKeyDown}
          />
          ${this._renderColumnsButton()}
        </div>
        <div class="empty-state">No data</div>
        ${this._renderColumnMenu()}
      `;
    }

    const totalHeight = totalRows * this._rowH;

    const headerHeight = this._rowH;
    const scrollTop = Math.max(0, this._scrollTop - headerHeight);
    const startIdx = Math.max(0, Math.floor(scrollTop / this._rowH) - BUFFER_ROWS);
    const visibleCount = Math.ceil(this._viewportHeight / this._rowH) + BUFFER_ROWS * 2;
    const endIdx = Math.min(totalRows, startIdx + visibleCount);
    const sliceRows = allVisible.slice(startIdx, endIdx);
    const offsetTop = startIdx * this._rowH + headerHeight;
    this._lastStartIdx = startIdx;

    return html`
      <div class="filter-bar">
        <input
          type="search"
          class="filter-input"
          placeholder="Search"
          @input=${this._onFilterInput}
          @keydown=${this._onFilterKeyDown}
        />
        ${this._renderColumnsButton()}
      </div>
      <div
        class="table-container"
        role="grid"
        aria-rowcount=${totalRows + 1}
        aria-colcount=${visibleCols.length}
        aria-label="Data entries"
        tabindex="0"
        @scroll=${this._onScroll}
        @keydown=${this._onTableKeyDown}
        @contextmenu=${this._onContainerContextMenu}
      >
        <div class="virtual-spacer" style="height: ${totalHeight + headerHeight}px;">
          <table style="${this._getTableWidth(visibleCols)}">
            <colgroup>
              ${visibleCols.map((col) => html`<col style="width: ${this._getColWidth(col, visibleCols.length)}" />`)}
            </colgroup>
            <thead>
              <tr role="row">
                ${visibleCols.map(
                  (col, ci) => html`
                    <th
                      role="columnheader"
                      aria-colindex=${ci + 1}
                      aria-sort=${this._getAriaSortValue(col)}
                      draggable="true"
                      class="${this._dragOverColId === col && this._dragOverSide === 'left'
                        ? 'drag-over-left'
                        : ''} ${this._dragOverColId === col && this._dragOverSide === 'right' ? 'drag-over-right' : ''}"
                      @click=${(e: MouseEvent) => this._onHeaderClick(col, e)}
                      @dragstart=${(e: DragEvent) => this._onHeaderDragStart(col, e)}
                      @dragover=${(e: DragEvent) => this._onHeaderDragOver(col, e)}
                      @dragleave=${(e: DragEvent) => this._onHeaderDragLeave(e)}
                      @drop=${(e: DragEvent) => this._onHeaderDrop(col, e)}
                      @dragend=${(e: DragEvent) => this._onHeaderDragEnd(e)}
                    >
                      <div class="th-content">
                        <span class="th-label">${this.columnLabels?.[col] || COLUMN_LABELS[col] || col}</span>
                        ${this._getSortIndicator(col)}
                      </div>
                      <div
                        class="resize-handle ${this._resizingCol === col ? 'active' : ''}"
                        @mousedown=${(e: MouseEvent) => this._onResizeMouseDown(col, e)}
                        @dblclick=${(e: MouseEvent) => this._onResizeDblClick(col, e)}
                      ></div>
                    </th>
                  `,
                )}
              </tr>
            </thead>
          </table>
          <table class="rows-table" style="top: ${offsetTop}px; ${this._getTableWidth(visibleCols)}">
            <colgroup>
              ${visibleCols.map((col) => html`<col style="width: ${this._getColWidth(col, visibleCols.length)}" />`)}
            </colgroup>
            <tbody>
              ${sliceRows.map((row, ri) => {
                const clipMode = row.Name?.clipboardMode;
                const isSelected = this.selectedRowIds.includes(row.ID);
                const isDragSource = this._dragSourceId === row.ID;
                const isDropTarget = this._dropTargetId === row.ID;
                const isSection = row.ID.indexOf('section:') === 0;
                return html`
                  <tr
                    role="row"
                    aria-rowindex=${startIdx + ri + 2}
                    aria-selected=${isSelected}
                    class="data-row ${isSection ? 'section-row' : ''} ${isSelected ? 'selected' : ''} ${clipMode === 'cut' ? 'cut' : ''} ${clipMode ===
                    'copy'
                      ? 'copied'
                      : ''} ${isDragSource ? 'drag-source' : ''} ${isDropTarget && this._dropPosition === 'on'
                      ? 'drop-target-on'
                      : ''} ${isDropTarget && this._dropPosition === 'above' ? 'drop-target-above' : ''}"
                    data-row-id="${row.ID}"
                    draggable="true"
                    @contextmenu=${(e: MouseEvent) => this._onRowContextMenu(row.ID, e)}
                    @dragstart=${(e: DragEvent) => this._onRowDragStart(row.ID, e)}
                    @dragend=${(e: DragEvent) => this._onRowDragEnd(e)}
                    @dragover=${(e: DragEvent) => this._onRowDragOver(row.ID, e)}
                    @dragleave=${(e: DragEvent) => this._onRowDragLeave(e)}
                    @drop=${(e: DragEvent) => this._onRowDrop(row.ID, e)}
                  >
                    ${visibleCols.map((col, ci) => {
                      const isFocused = this.selectedRowId === row.ID && this._focusedCol === ci;
                      return html`<td
                        role="gridcell"
                        aria-colindex=${ci + 1}
                        class="col-${col} ${isFocused ? 'focused' : ''}"
                        @click=${(e: MouseEvent) => this._onCellClick(row.ID, ci, e)}
                        @dblclick=${() => this._onCellDblClickIfEditable(row, col)}
                      >
                        ${this._renderCellValue(row, col)}
                      </td>`;
                    })}
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
      ${this._renderColumnMenu()}
    `;
  }

  private _renderColumnsButton() {
    return html`
      <button
        type="button"
        class="columns-button"
        title="Show, hide, and reorder columns"
        aria-haspopup="true"
        aria-expanded=${this._columnMenuOpen}
        @click=${(e: MouseEvent) => this._onColumnsButtonClick(e)}
      >
        Columns ▾
      </button>
    `;
  }

  private _renderColumnMenu() {
    if (!this._columnMenuOpen) return nothing;
    return html`
      <div class="column-menu" style="right: ${this._columnMenuX}px; top: ${this._columnMenuY}px;">
        ${this._orderedColumns.map((col) => {
          const isName = col === 'Name';
          const isVisible = !this._hiddenColumns.has(col);
          const overCls =
            this._menuDragOverCol === col
              ? this._menuDragOverSide === 'top'
                ? 'drag-over-top'
                : 'drag-over-bottom'
              : '';
          const draggingCls = this._menuDragCol === col ? 'dragging' : '';
          return html`
            <label
              class="column-menu-item ${isName ? 'disabled' : ''} ${overCls} ${draggingCls}"
              draggable=${isName ? 'false' : 'true'}
              @dragstart=${(e: DragEvent) => this._onMenuDragStart(col, e)}
              @dragover=${(e: DragEvent) => this._onMenuDragOver(col, e)}
              @dragleave=${() => this._onMenuDragLeave()}
              @drop=${(e: DragEvent) => this._onMenuDrop(col, e)}
              @dragend=${() => this._onMenuDragEnd()}
              @click=${(e: Event) => {
                e.stopPropagation();
                if (!isName) this._toggleColumnVisibility(col);
              }}
            >
              <span class="col-grip" title="Drag to reorder">⋮⋮</span>
              <input
                type="checkbox"
                .checked=${isVisible}
                .disabled=${isName}
                @click=${(e: Event) => e.stopPropagation()}
                @change=${(e: Event) => {
                  e.stopPropagation();
                  if (!isName) this._toggleColumnVisibility(col);
                }}
              />
              <span class="col-label">${this.columnLabels?.[col] || COLUMN_LABELS[col] || col}</span>
            </label>
          `;
        })}
        <div class="column-menu-separator"></div>
        <button type="button" class="column-menu-reset" @click=${(e: Event) => this._resetColumns(e)}>
          Reset to default
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dex-tree-table': DexTreeTable;
  }
}
