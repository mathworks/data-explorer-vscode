// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { renderProjectWebview, renderTableWebview } from './webviewHtml.js';
import { getModelForBinaryTab, invalidate } from './SlddModel.js';
import { forgetChangedSource, parsedModelForTab } from './sourceReads.js';
import { buildRows, COLUMNS, COLUMN_LABELS, COLUMN_GROUPS } from './rowBuilder.js';
import { buildMatRows } from './matRowBuilder.js';
import { readProjectStore } from './projectStore.js';
import { isEditableJsonSlddBytes, exceedsTextSyncLimit, exceedsStringDecodeLimit, isZipBytes } from './slddFormat.js';
import { annotateDataRows, annotateModelRows } from './usageGraph.js';
import { sourceWarnings, warningBanner } from './parseWarnings.js';
import { capRows, rowCapBanner } from './rowCap.js';
import { postOrReport } from './postPayload.js';
import { wireNavigateSelect, drainNavigateSelect } from './navigate.js';
import { answerMatrixRequest } from './matrixRequest.js';
import { basename, projectPathSegments } from '../common/pathUtil.js';
import { toArrayBuffer } from '../common/bytes.js';
import { seededRead } from './seededRead.js';
import { detectMsp, MSP_CONFIG } from './mspProject.js';
import {
  buildProjectPage,
  isMatFile,
  isModelFile,
  isProjectFile,
  isSlddFile,
  isTomlProjectFile,
  parseProject,
  projectFallbackName,
} from 'data-explorer-core';
import type { ProjectToHostMessage, TableToHostMessage } from '../common/protocol.js';

// viewType of the editable text-backed table (SlddTextEditorProvider). Declared
// here as a constant to avoid importing the provider (which would be circular).
const TABLE_VIEW_TYPE = 'dataExplorer.tableView';
const BINARY_SLDD_VIEW_TYPE = 'dataExplorer.binarySlddView';

/**
 * The folder a project's paths are relative to: the one holding the marker — the `.prj`, or
 * the `matlab.toml`, which MATLAB writes at that same root.
 *
 * Every path in a project store is spelled relative to this and nothing else — that
 * is what lets a project be moved or cloned — so it is the only base a link on the
 * page can be resolved against.
 */
function projectRootOf(prjUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(prjUri, '..');
}

/**
 * Answer a link on the project page: open the file, or reveal the folder.
 *
 * Which of the two is decided HERE, from the filesystem, and not by the page: the
 * store does not record it (a shortcut can target a folder, and a designated
 * location usually does), and a folder cannot be opened as an editor at all.
 *
 * A target that does not exist is a normal outcome, not an error — a project names
 * its Simulink cache folder long before a build creates it, and a path folder can
 * outlive the folder itself — so it is reported as a message naming the path rather
 * than swallowed or thrown.
 */
async function openProjectPath(
  rootUri: vscode.Uri,
  relPath: string,
  preferProject = false,
): Promise<void> {
  const target = vscode.Uri.joinPath(rootUri, ...projectPathSegments(relPath));
  let type: vscode.FileType;
  try {
    type = (await vscode.workspace.fs.stat(target)).type;
  } catch {
    void vscode.window.showWarningMessage(
      `This project refers to ${relPath}, which is not there.`,
    );
    return;
  }
  // A bitmask, not an enum value: a symlinked folder is Directory|SymbolicLink, and
  // an equality check reads it as a file and then fails to open it.
  if (type & vscode.FileType.Directory) {
    // A referenced project is recorded as its FOLDER, so the row that says "this is a
    // component of mine" would answer a click by revealing a folder — one click short of
    // the page that says what that component publishes. Only when the row asked for it,
    // and only when the folder holds exactly one project: two is ambiguous and zero is
    // not a project at all, and both fall through to the reveal below.
    if (preferProject) {
      const prj = await soleProjectFile(target);
      if (prj) {
        await openProjectMarker(prj);
        return;
      }
    }
    // `revealInExplorer` only reveals what the Explorer is showing, so a project
    // opened as a lone file — outside every workspace folder — would answer the
    // click with nothing at all. Hand those to the OS file manager instead, which is
    // the only view of such a folder there is.
    const inWorkspace = vscode.workspace.getWorkspaceFolder(target) !== undefined;
    await vscode.commands.executeCommand(inWorkspace ? 'revealInExplorer' : 'revealFileInOS', target);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', target);
}

/**
 * Open a project marker on its PAGE, whichever of the two markers it is.
 *
 * `vscode.open` is enough for a `.prj` — this webview is that extension's default editor — and
 * is deliberately NOT enough for a `matlab.toml`, whose entry is `priority: "option"` so that
 * an Explorer click keeps opening the text editor (see `projectViewType`). An explicit
 * `openWith` is how that entry is reached, and it has to be reached here: the row this answers
 * says "this project is a component of mine", and a click that landed on a page for one format
 * and on raw TOML for another would make the component view depend on how its author chose to
 * store it.
 */
async function openProjectMarker(marker: vscode.Uri): Promise<void> {
  if (isTomlProjectFile(marker.path)) {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      marker,
      BinaryEditorProvider.projectViewType,
    );
    return;
  }
  await vscode.commands.executeCommand('vscode.open', marker);
}

/**
 * The one project marker in a folder, or undefined when there is not exactly one.
 *
 * Either marker counts, because `isProjectFile` is name-aware: a folder holding a `matlab.toml`
 * is as much one project as a folder holding a `<name>.prj`. Nothing here reads the marker's
 * BYTES — the filter is a name test and the answer is a URI — so a TOML project passing through
 * is not a zip read of a text file waiting to happen.
 */
async function soleProjectFile(folder: vscode.Uri): Promise<vscode.Uri | undefined> {
  let entries: Array<[string, vscode.FileType]>;
  try {
    entries = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return undefined;
  }
  const prjs = entries.filter(([n, t]) => !(t & vscode.FileType.Directory) && isProjectFile(n));
  return prjs.length === 1 ? vscode.Uri.joinPath(folder, prjs[0][0]) : undefined;
}

/**
 * A text file beside the `.prj`, or undefined when it is not there.
 *
 * Absence is the normal answer — only a Managed Simulink Project has an
 * `msp_config.json` — so it is not reported, logged or retried.
 */
async function readTextIfPresent(
  rootUri: vscode.Uri,
  relPath: string,
): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootUri, relPath));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

// Custom document. Read-only for all binary formats (.slx, .mat, .prj, zipped
// .sldd). There is NO in-memory working-copy string: the file on disk is the
// single source of truth, and this document only tracks its URI.
class BinaryDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {}
}

// Single byte-backed READ-ONLY custom editor for the binary formats (.slx,
// .mat, .prj, zipped .sldd). Byte-backed so it can open binary (zip) .sldd —
// which VS Code refuses to open as a text document because of NUL bytes.
// Editable JSON .sldd is handled by SlddTextEditorProvider; binary/zip .sldd is
// routed here via an explicit openWith redirect in extension.ts.
export class BinaryEditorProvider implements vscode.CustomReadonlyEditorProvider<BinaryDocument> {
  public static readonly viewType = 'dataExplorer.binaryView';

  /**
   * The SAME provider under a second view type, for the project format that must not be
   * auto-selected: `matlab.toml`.
   *
   * Clicking a `matlab.toml` in the Explorer has to open the plain text editor — it is the one
   * project format a user edits by hand, and taking that away would be a regression dressed as
   * a feature. A `customEditors` priority is per ENTRY, so the obvious edit — adding
   * `matlab.toml` to `dataExplorer.binaryView`'s selector — is exactly the wrong one: that
   * entry is `priority: "default"`, and the click would land on this webview. A second entry at
   * `priority: "option"` is never auto-selected and is still reachable by an explicit
   * `vscode.openWith`, which is how the tree row opens the page (see bestViewType).
   *
   * A second VIEW TYPE, not a second provider: same instance, same document class, same page,
   * same selection/navigate wiring, registered twice in extension.ts. The view type here is a
   * routing label VS Code needs and nothing else — what the tab renders is still decided from
   * the NAME, in getHtml, which is why a `.prj` and a `matlab.toml` opening under two different
   * view types draw the identical page.
   */
  public static readonly projectViewType = 'dataExplorer.projectView';

  // Relay selection to the Property Inspector (wired in extension.ts).
  public onSelect?: (uriString: string, rowIds: string[]) => void;

  // Handle a Usage-column link click: open the referenced file and select the
  // target row there (wired in extension.ts to the shared navigate handler).
  public onNavigate?: (target: string) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<BinaryDocument> {
    return new BinaryDocument(uri);
  }

  async resolveCustomEditor(
    document: BinaryDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };

    const uriString = document.uri.toString();
    const name = basename(document.uri.path) || 'document';

    // A read-only banner shown above the table. Set only for the surprising case:
    // a JSON .sldd that WOULD be editable but is over VS Code's TextDocument sync
    // limit (see below). Binary/zip .sldd — expected read-only — leave this unset
    // so no banner appears. Passed to the webview in the setRows payload.
    let notice: string | undefined;

    // The bytes the classification below reads, kept ONLY for a file that stays in this
    // view and spent on its first post — see the byte source further down. Left undefined
    // for every other format, none of which reads anything here.
    let seed: ArrayBuffer | undefined;

    // This byte-backed editor is the DEFAULT for *.sldd because it can open any
    // bytes (binary/zip .sldd fail to load as a TextDocument, so the text-backed
    // tableView can't be the default). But editable JSON .sldd should open in the
    // editable tableView. When one lands here (e.g. an Explorer double-click),
    // redirect it: reopen with tableView and close this binary tab. Binary/zip
    // .sldd and .slx/.mat/.prj fall through and render read-only as normal.
    if (isSlddFile(name)) {
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        // A JSON .sldd larger than V8's string limit (~512 MB) can't be decoded
        // into a string at all — so neither the editable table nor the read-only
        // table can parse it, and it would open as a silent empty table. Hand
        // such a file to VS Code's built-in text editor (it streams large files
        // without materializing one giant string). A zip .sldd this large still
        // falls through to the read-only binary view — it parses the archive
        // without decoding the whole thing to a string.
        if (exceedsStringDecodeLimit(bytes) && !isZipBytes(bytes)) {
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          webviewPanel.dispose();
          return;
        }
        // Editable JSON .sldd redirects to the text-backed table view — BUT only
        // when VS Code can actually mirror it as a TextDocument. Over the sync
        // limit, the tableView provider can't resolve (the ext host throws
        // "Unable to retrieve document from URI"), so keep such files here and
        // render them read-only. See exceedsTextSyncLimit in slddFormat.ts.
        if (isEditableJsonSlddBytes(bytes) && !exceedsTextSyncLimit(bytes)) {
          // Carry the incoming tab's preview state through the redirect: an
          // Explorer single-click opens this binary tab as a PREVIEW tab, and the
          // table it redirects to should stay a preview tab too (not pin). VS
          // Code's `vscode.openWith` hardcodes `pinned: true` and ignores a lone
          // `preview: true` (microsoft/vscode#235535), so pass an explicit
          // `pinned` to override it — `pinned` isn't on the public options type
          // but is forwarded to the internal IEditorOptions.
          const preview = this.isPanelPreview(document.uri);
          await vscode.commands.executeCommand('vscode.openWith', document.uri, TABLE_VIEW_TYPE, {
            preview,
            pinned: !preview,
          });
          // Dispose THIS panel specifically (not closeActiveEditor, which is
          // racy) so only the redundant binary tab goes away.
          webviewPanel.dispose();
          return;
        }
        // A compressed-binary (zip/OPC) .sldd is now editable in its own writable
        // custom editor — redirect there, mirroring the editable-JSON redirect.
        // A too-large-to-decode zip stays here (read-only) via the guard above.
        if (isZipBytes(bytes) && !exceedsStringDecodeLimit(bytes)) {
          const preview = this.isPanelPreview(document.uri);
          await vscode.commands.executeCommand('vscode.openWith', document.uri, BINARY_SLDD_VIEW_TYPE, {
            preview,
            pinned: !preview,
          });
          webviewPanel.dispose();
          return;
        }
        // A JSON .sldd that stayed here (not redirected) did so ONLY because it's
        // over the sync limit — otherwise it would be editable. That's surprising
        // (a JSON dictionary the user expects to edit), so explain the read-only
        // downgrade. Binary/zip .sldd skips this (isEditableJsonSlddBytes false).
        if (isEditableJsonSlddBytes(bytes)) {
          const mb = Math.round(bytes.byteLength / (1024 * 1024));
          notice =
            `Read-only: this dictionary is ${mb} MB, above VS Code's 50 MB editing limit. ` +
            `To edit the JSON directly, use "Reopen Editor With… → Text Editor"; ` +
            `this view refreshes when you save.`;
        }
        // Every redirect above has returned, so reaching here means this file is STAYING —
        // and the bytes just read to prove that are the same bytes the first post needs.
        // Converted at the seam rather than inside the reader so it happens once:
        // `toArrayBuffer` copies, and this is the size class where a copy is felt.
        seed = toArrayBuffer(bytes);
      } catch {
        // Unreadable → fall through and let the read-only render report the error.
      }
      // Binary/zip .sldd renders read-only here (editable JSON was redirected and
      // disposed above). Give its tab the same 'table' icon the editable-JSON .sldd
      // tab uses (SlddTextEditorProvider), so both .sldd forms look consistent.
      webviewPanel.iconPath = new vscode.ThemeIcon('table');
    } else {
      // Every other format this editor owns — .slx, .mdl, .mat, .prj — is read-only
      // with no editable counterpart to switch to, and nothing in the table says so:
      // VS Code has no read-only affordance of its own (a read-only editor renders
      // exactly like a writable one), and the banner is reserved for the SURPRISING
      // read-only, above. So the tab carries it, quietly and for the whole session: a
      // padlock in place of the file glyph. .sldd keeps 'table' above — both of its
      // forms are dictionaries, and its editable views use that same icon, so here the
      // icon answers "which format is this" rather than "can I edit it".
      //
      // A custom editor's iconPath only reaches the tab on VS Code >= 1.106
      // (microsoft/vscode#105028); older hosts ignore it and show the file glyph, which
      // is what these tabs show today.
      webviewPanel.iconPath = new vscode.ThemeIcon('lock');
    }

    // Source bytes for the file, read from disk (read-only view) — except for the first ask
    // of a `.sldd` that stayed here, which is handed the read the classification above
    // already made instead of making the same read again. That handoff is worth having
    // exactly where it is least affordable: a file only stays in this view because it is too
    // large for the editable routes.
    //
    // The one thing given up: seeded bytes are microseconds older than a fresh read would
    // be. A write that lands in that window is the write the disk watcher below already
    // exists for — it drops the shared cache (`forgetChangedSource`) and reposts, and the
    // seed is gone by then, so the newer bytes are what the user ends up looking at.
    const byteSource = seededRead(seed, async () =>
      toArrayBuffer(await vscode.workspace.fs.readFile(document.uri)),
    );

    // Read/parse the file host-side and push rows to the webview. On failure,
    // drop the cached model and post a banner.
    const post = async () => {
      try {
        if (isProjectFile(name)) {
          // The .prj is an empty marker; the project structure lives in the
          // sibling resources/project/** store, read into a project-root-
          // relative POSIX relpath map for the parser. A `matlab.toml` IS the
          // definition and arrives as a one-entry map — projectStore.ts owns that
          // split, so nothing here reads differently for the two.
          //
          // A PAGE, not a table — see core's ProjectPage.ts. Straight from
          // `parseProject` rather than through the node tree the other formats build:
          // what the page shows is the parse itself (run order, groups, label
          // coverage), and a tree of rows is a shape none of that survives.
          //
          // `projectFallbackName` of the PATH, not a reduction of the name: every
          // project in the TOML format spells its definition file identically, so
          // stripping an extension would title all of them "matlab" (or, with
          // `projectNameOf`, leave the page headed "matlab.toml"). The parent folder is
          // what MATLAB calls a project it was handed the root of, and core publishes
          // the rule so this page and the tree's project row agree on one string.
          const files = await readProjectStore(document.uri);
          const parsed = parseProject(files, projectFallbackName(document.uri.path));
          const root = projectRootOf(document.uri);
          webview.postMessage({
            type: 'setProject',
            page: buildProjectPage(parsed),
            root: root.fsPath,
            // Undefined for every project that is not a Managed Simulink Project, which
            // leaves the page byte-identical to what it rendered before this existed.
            msp: detectMsp(parsed, await readTextIfPresent(root, MSP_CONFIG)),
            // A project is the format this matters most for: its store is read by
            // convention with no schema, so a document that did not survive its trip
            // costs whatever entity it described and leaves a page that looks whole.
            warnings: warningBanner(parsed.warnings),
          });
          return;
        }

        // Re-register from disk. The file doesn't change here, but invalidate is
        // harmless and keeps the cache honest against external edits.
        //
        // Deliberately NOT reaching into the shared source cache: what this drops is the
        // node this module holds for the URI, so the tree is rebuilt from the file as it is
        // now. The shared cache's entries are keyed by the file's content VERSION, so a
        // repost is exactly the case where dropping them would be wrong — an unchanged file
        // would be re-read and re-parsed every time the table repainted, which is the whole
        // cost this shares. The write that a version key CANNOT see is handled where it is
        // known about, on the watcher below.
        invalidate(uriString);

        // Which route this format's tree comes from is decided in SlddModel — a model through
        // the shared parse, everything else through its bytes — so that the decision is unit
        // testable and this module keeps only the vscode plumbing. Both sources are thunks:
        // the read the branch does not take never happens.
        const node = await getModelForBinaryTab(uriString, name, {
          parsed: () => parsedModelForTab(document.uri),
          bytes: byteSource.read,
        });
        // Capped BEFORE the payload is built, and before the Usage column is filled:
        // the rows past the cap are not going to be shown, so annotating them is work
        // spent on nothing. The cap is what keeps the message serializable at all —
        // see rowCap.ts for the file that proved it necessary.
        const capped = capRows(isMatFile(name) ? buildMatRows(node) : buildRows(node));
        const rows = capped.rows;
        // Fill the Usage column from the shared workspace usage graph (lazy +
        // cached). A model (.slx/.mdl) resolves its blocks' params to source files
        // and its workspace vars to the blocks that use them; a .mat/.sldd data
        // view resolves its variables to the blocks that use them.
        if (isModelFile(name)) {
          await annotateModelRows(uriString, rows).catch(() => false);
        } else if (isMatFile(name) || isSlddFile(name)) {
          await annotateDataRows(uriString, rows).catch(() => false);
        }
        const delivered = await postOrReport(
          webview,
          {
            type: 'setRows',
            docUri: uriString,
            rows,
            columns: COLUMNS,
            columnLabels: COLUMN_LABELS,
            columnGroups: COLUMN_GROUPS,
            editable: false,
            notice,
            // Independent of `notice`: that one explains why this view is read-only,
            // this one says the file is not all here. A large JSON dictionary that also
            // read short shows both, which is why they are two fields and not one
            // string — see renderBanners in the webview.
            //
            // Through rowCapBanner, so a table that stops short says where it stopped
            // in the same strip that reports what the parse could not read.
            warnings: rowCapBanner(capped, warningBanner(sourceWarnings(node))),
          },
          name,
        );
        // Only when the rows it selects into actually arrived. A held selection
        // drained against a view showing the error banner is a selection aimed at
        // rows that are not there, and it would be dropped silently rather than wait
        // for the retry that a repost brings.
        if (delivered) drainNavigateSelect(webview, uriString);
      } catch (err) {
        invalidate(uriString);
        webview.postMessage({
          type: 'error',
          message: `Failed to parse ${name}: ${(err as Error).message}`,
        });
      } finally {
        // The handoff is over after ONE attempt, taken or not. Both halves matter: an
        // attempt that threw — or a `.prj`, which returns above without asking for bytes —
        // must not leave a seed behind for a repost to serve, since a repost is triggered by
        // the file having changed; and a dictionary big enough to land in this view is too
        // big to keep a second copy of alive for the life of the tab.
        byteSource.drop();
      }
    };

    // Register listeners BEFORE assigning webview.html, so a fast-booting
    // webview cannot post 'ready' before we are subscribed to receive it.
    const sub = webview.onDidReceiveMessage((msg: TableToHostMessage | ProjectToHostMessage) => {
      if (msg?.type === 'ready') {
        void post();
      } else if (msg?.type === 'openFile') {
        // Only the project page sends this, and only the host can answer it: the path
        // is project-root-relative, and the page has no idea where that root is.
        if (typeof msg.path === 'string' && msg.path.length > 0) {
          void openProjectPath(projectRootOf(document.uri), msg.path, msg.preferProject === true);
        }
      } else if (msg?.type === 'select') {
        // Relay the selection to the Property Inspector via the wired callback.
        this.onSelect?.(uriString, Array.isArray(msg.rowIds) ? msg.rowIds : []);
      } else if (msg?.type === 'navigate') {
        if (typeof msg.target === 'string') this.onNavigate?.(msg.target);
      } else if (msg?.type === 'requestMatrix') {
        // A Variable Editor panel is opening: send its cells. One shared answer for
        // all four webview hosts — see matrixRequest.ts. Read-only is no reason to
        // skip it; this is the viewer where most matrices are actually looked at.
        answerMatrixRequest(webview, uriString, msg.nodeId);
      }
    });

    const navSub = wireNavigateSelect(webview, uriString);

    // Live-sync when the file on disk changes: covers external edits AND edits
    // made in the plain-text view once saved. We watch the DISK, not the
    // TextDocument, on purpose: a JSON .sldd routed here is over VS Code's 50 MB
    // sync limit, so the ext host holds no mirror of it and
    // onDidChangeTextDocument NEVER fires for it (the same limit that forced the
    // read-only downgrade — see slddFormat.ts). A FileSystemWatcher observes the
    // disk directly, independent of document syncing, so it fires on save at any
    // size. Because this view always reads bytes from disk, unsaved edits can't
    // be reflected anyway — refresh-on-save is the achievable contract, and the
    // banner tells the user so.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), name),
    );
    const onDiskChange = () => {
      // The shared cache is dropped for this file HERE and nowhere else on this path. Its
      // entries are keyed by `mtime:size`, and this is the one event that knows better than
      // that key: a write can preserve both — `tar -xp` or `unzip -o` restoring a
      // same-revision file keeps its recorded mtime and its size, and a mount with 1-2 s
      // mtime granularity cannot separate two equal-size writes in one tick — and then the
      // repost below would re-derive the table from the parse of the OLD bytes, leaving the
      // user with a file that changed, an editor that visibly refreshed, and every row stale
      // for the life of the window. A watcher event is evidence of a change no `stat` carries,
      // so it is the one place allowed to spend a re-read (see sourceCache.forgetSource, and
      // note that putting this inside `invalidate` would apply it to every repost too).
      forgetChangedSource(document.uri);
      invalidate(uriString);
      void post();
    };
    const changeSub = watcher.onDidChange(onDiskChange);
    const createSub = watcher.onDidCreate(onDiskChange);

    webview.html = this.getHtml(webview, distRoot, name);
    webviewPanel.onDidDispose(() => {
      sub.dispose();
      watcher.dispose();
      changeSub.dispose();
      createSub.dispose();
      navSub.dispose();
    });
  }

  // Whether the currently-open binary tab for `uri` is a preview tab. Used to
  // carry preview state through the redirect to the table view. Custom-editor
  // tab inputs expose { uri, viewType }; match this provider's own tab. Defaults
  // to true (Explorer's default) if the tab can't be located.
  private isPanelPreview(uri: vscode.Uri): boolean {
    const tab = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => {
        const input = t.input as { uri?: vscode.Uri; viewType?: string } | undefined;
        return input?.viewType === BinaryEditorProvider.viewType &&
          input?.uri?.toString() === uri.toString();
      });
    return tab?.isPreview ?? true;
  }

  private getHtml(webview: vscode.Webview, distRoot: vscode.Uri, name: string): string {
    // The only format this editor owns that is not a table. Decided from the NAME
    // rather than from a second viewType, because nothing else about the tab differs
    // — same document, same read-only custom editor, same activation — and a
    // viewType per body would put a `package.json` contribution and an openWith
    // redirect in the way of a different <script src>.
    return isProjectFile(name)
      ? renderProjectWebview(webview, distRoot)
      : renderTableWebview(webview, distRoot);
  }
}
