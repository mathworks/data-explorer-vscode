// Copyright 2026 The MathWorks, Inc.
//
// The Property Inspector's page: what it shows, what it was sent, and when a node handed to it
// changes either. PropertiesViewProvider is the vscode half (the view, its html, its messages);
// this is everything it decides, vscode-free so that it is unit-tested (test/inspectorPage.test.ts).
//
// Three rules live here.
//
//  - Every `ready` is a page to fill. The view does not retain its context when hidden, so
//    hiding it and showing it again reloads its page, which starts empty and says `ready` again,
//    and a message posted to it while it was hidden never arrived. What the inspector shows is
//    therefore kept whether or not a page can take it, and sent on every `ready`, not only the
//    first. A disposed view takes it with it: a next view starts empty.
//
//  - A node is only sent when it changes what the page shows. Every editor asks the inspector to
//    show its node again whenever the document's tree changes (inspectorSelection.ts), which for
//    the JSON view is every keystroke in the text, and a `showProps` closes an open Variable
//    Editor (pi-main.ts: its rows are replaced). So an edit elsewhere in the document, which
//    leaves the node's rows as they were, must not reach the page.
//
//  - "What the page shows" is everything it was sent: the rows (`showProps`, compared as posted)
//    and, when a Variable Editor was opened on them, the cells it was sent for it (`matrixCells`).
//    The rows carry a matrix's shape and not its cells (matrixRequest.ts), and a 10x10 matrix's
//    row says `<10x10 double>` whatever is in it, so an edit of one cell behind an unchanged row
//    is seen only by comparing the cells. That costs what the panel's own fetch costs, and is
//    paid only while the page may still show those cells: from the answer to a fetch until the
//    next `showProps`, `empty` or page, each of which closes the panel.
import { buildPropertyGroups, type PIPropertyGroup } from './piBuilder.js';
import { matrixCellsMessage } from './matrixRequest.js';

export class InspectorPage {
  /** The current view's page has said `ready`, so a message posted now reaches it. */
  private ready = false;
  /** The rows the inspector shows, or null for the empty pane. */
  private groups: PIPropertyGroup[] | null = null;
  /** `groups` serialized, as they were posted: what the next node's rows are compared with. */
  private groupsSent: string | null = null;
  /** The cells the page's Variable Editor was sent for the rows on display, serialized. */
  private cellsSent: { nodeId: string; message: string } | null = null;

  /**
   * The node on display, kept for `requestMatrix` (its Value row may carry a MatrixDescriptor,
   * and the cells behind one are fetched when the panel opens: matrixRequest.ts) and for the
   * referrer of a link.
   *
   * Resolved from the node in hand rather than through SlddModel.findNode, which the three table
   * providers use: the inspector is handed a node and never learns which document it came from.
   * Matching on `id` is what makes that safe: a request for anything other than what is on
   * screen is refused, so this cannot answer about a node the user is not looking at.
   */
  node: any = null;
  /**
   * The document `node` came from, handed to onNavigate as a click's referrer: a bare file name
   * in a link resolves to the copy in that document's own project or folder.
   */
  from: string | undefined;

  /** `post` sends a message to the current view's page. */
  constructor(private readonly post: (message: unknown) => void) {}

  /** A view was resolved: its page is loading, and takes nothing until it says `ready`. */
  opened(): void {
    this.ready = false;
  }

  /**
   * The page said `ready`. It has just loaded, so it shows the empty pane (pi-main.ts says
   * `ready` after setEmpty) and no Variable Editor: there is something to send only when the
   * inspector holds a node.
   */
  loaded(): void {
    this.ready = true;
    this.cellsSent = null;
    if (this.groups) this.post({ type: 'showProps', groups: this.groups });
  }

  /** The view went, and with it what it showed and the node behind it. */
  closed(): void {
    this.ready = false;
    this.forget();
  }

  /** Show `node`, from the document `from`, unless the page already shows exactly that. */
  show(node: any, from?: string): void {
    const groups = buildPropertyGroups(node);
    const sent = JSON.stringify(groups);
    const unchanged = this.groups !== null && sent === this.groupsSent && !this.cellsChanged(node);
    // The new node either way: a matrix request and a link are answered from the tree as it is.
    this.node = node;
    this.from = from;
    this.groups = groups;
    if (unchanged) return;
    this.groupsSent = sent;
    this.cellsSent = null;
    if (this.ready) this.post({ type: 'showProps', groups });
  }

  clear(): void {
    this.forget();
    if (this.ready) this.post({ type: 'empty' });
  }

  /**
   * Answer a `requestMatrix` for the node on display. Always posts exactly one `matrixCells`,
   * with the id echoed, on the same terms as the table providers' shared `answerMatrixRequest`:
   * a panel that is open and waiting is worse off with silence than with a reason.
   */
  answerMatrix(nodeId: string): void {
    // Only the node on screen. The inspector's descriptor was built from `node` (piBuilder passes
    // the node, not its Value child), so an id that is not it is either stale (the selection
    // changed while the panel was opening) or not ours.
    const node = this.node && this.node.id === nodeId ? this.node : null;
    // The same envelope the three table providers send, from the same function: the inspector
    // resolves its node differently, and that is the ONLY difference.
    const message = matrixCellsMessage(nodeId, node);
    if (node) this.cellsSent = { nodeId, message: JSON.stringify(message) };
    this.post(message);
  }

  /** Whether `node`'s cells are not the ones the page's open Variable Editor was sent. */
  private cellsChanged(node: any): boolean {
    if (!this.cellsSent) return false;
    return JSON.stringify(matrixCellsMessage(this.cellsSent.nodeId, node)) !== this.cellsSent.message;
  }

  private forget(): void {
    this.groups = null;
    this.groupsSent = null;
    this.cellsSent = null;
    this.node = null;
    this.from = undefined;
  }
}
