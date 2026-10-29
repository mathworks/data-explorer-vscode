// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import type { SourceFile } from 'data-explorer-core';
import { encode, FolderHierarchy, type GraphReader, type HierarchyItem } from 'data-explorer-view/model';
import { svgIconFor } from './iconMap.js';
import { readProjectStore } from './projectStore.js';
import { readerFor, sourceCache, sourceFilesOf } from './sourceReads.js';
import { SUPPORTED_GLOB } from '../common/fileTypes.js';

// The Data Explorer tree is a cross-format relationship graph (model->model,
// model->sldd/mat, sldd->sldd), rendered as an expansion tree. Structural
// (relationship-only) parsing builds it; entries are parsed lazily on open.
//
// The graph, its rows and the rule a reference resolves by are view's `FolderHierarchy`, which
// draws a folder the way this tree always has (the hierarchy.json goldens are its spec). What is
// left here is VS Code's half: the folder as `findFiles` lists it, the reads through the window's
// shared source cache, and each row as a `TreeItem` — its Uri, its open command, its decoration
// query and its `contextValue`.

export type SlddTreeNode = HierarchyItem;

export class SectionsTreeProvider implements vscode.TreeDataProvider<SlddTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlddTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly hierarchy: FolderHierarchy;
  private uris = new Map<string, vscode.Uri>();
  // The Uris of each listing, by the listing `FolderHierarchy` hands back to `reader`: a build
  // reads through the Uris its own `findFiles` returned, whatever a later listing has put in
  // `uris` meanwhile.
  private readonly listed = new WeakMap<readonly SourceFile[], readonly vscode.Uri[]>();

  constructor(private readonly extensionUri: vscode.Uri) {
    this.hierarchy = new FolderHierarchy({
      files: { list: () => this.listFolder() },
      reader: (files) =>
        this.reader(this.listed.get(files) ?? files.flatMap((f) => this.uris.get(f.uriString) ?? [])),
      cache: sourceCache,
      isDirty: (uriString) =>
        !!vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriString)?.isDirty,
    });
    this.hierarchy.subscribe(() => this._onDidChangeTreeData.fire(undefined));
  }

  /**
   * Re-render the rows from the graph this provider already has.
   *
   * For what changes about a row without changing the folder — today that is the modified
   * badge, which a row reads off the live TextDocument. The graph is built from the
   * files ON DISK (readForScan, never a buffer), so an unsaved edit cannot move an edge in it:
   * dropping it here would re-read every file in the folder to rebuild the graph it had, which
   * on a folder of real dictionaries is ~5.7 s per keystroke.
   */
  refresh(): void {
    this.hierarchy.refresh();
  }

  /** Re-read the folder, for the events that change it: create, delete, save, folder added. */
  rebuild(): void {
    this.hierarchy.rebuild();
  }

  getTreeItem(el: SlddTreeNode): vscode.TreeItem {
    const collapsible =
      el.collapsible === 'collapsed'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    if (el.kind === 'missing') {
      const item = new vscode.TreeItem(el.label, collapsible);
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.description = el.description;
      item.tooltip = el.tooltip;
      item.contextValue = 'slddMissing';
      return item;
    }

    if (el.kind === 'group') {
      // Synthetic containers: External Data (link icon), and the top-level
      // project/folder groups. Expandable; and a PROJECT group is ALSO openable —
      // see the `case 'project'` arm.
      const item = new vscode.TreeItem(el.label, collapsible);
      let contextValue: string;
      switch (el.groupKind) {
        case 'project': {
          contextValue = 'dexProjectGroup';
          // A project group header IS a file — the `.prj`, whose uri is the row's `id` — so it
          // opens like any other row: to the project page. It used to open nothing, which made
          // the one row that names the project the only unclickable thing in the tree. Resolved
          // through `this.uris` exactly like a file row, so a header left over from an earlier
          // graph (its `.prj` since gone from the folder) offers no open rather than an open of
          // a file that is not there.
          //
          // The row keeps its twisty: VS Code runs the command AND toggles expansion for a
          // collapsible item that has one, which is the behaviour wanted here — the members
          // and the page are two views of the same project, not a choice between them.
          const prj = el.id ? this.uris.get(el.id) : undefined;
          if (prj) {
            item.command = {
              command: 'dataExplorer.openFile',
              title: 'Open in Data Explorer',
              arguments: [prj],
            };
            item.tooltip = el.tooltip;
          }
          break;
        }
        case 'folder':
          contextValue = 'dexFolderGroup';
          break;
        default:
          contextValue = 'slddGroup';
          break;
      }
      item.iconPath = svgIconFor(this.extensionUri, el.icon);
      item.contextValue = contextValue;
      return item;
    }

    const item = new vscode.TreeItem(el.label, collapsible);
    item.iconPath = svgIconFor(this.extensionUri, el.icon);
    item.contextValue = 'slddFile';
    const uri = el.id ? this.uris.get(el.id) : undefined;
    item.command = { command: 'dataExplorer.openFile', title: 'Open in Data Explorer', arguments: [uri] };

    // Health decoration: encode the row's state into the resourceUri query so the
    // HealthDecorationProvider can badge/color it. A healthy row keeps its plain
    // file URI (no decoration). The query makes each state a distinct decoration
    // key, so a file's clean canonical row and its cycle-repeat row differ.
    if (uri) {
      item.resourceUri = el.health ? uri.with({ query: encode(el.health) }) : uri;
    }
    if (el.description !== undefined) item.description = el.description;
    if (el.tooltip !== undefined) item.tooltip = el.tooltip;
    return item;
  }

  getChildren(el?: SlddTreeNode): Promise<SlddTreeNode[]> {
    return el ? this.hierarchy.children(el) : this.hierarchy.roots();
  }

  /**
   * The file a bare name means when `referrerUri` names it, by the rule this tree draws
   * with: the copy in the referrer's own project or folder, else the first workspace match.
   * A link click resolves through this (navigate.ts), so the file it opens is the one shown
   * under the referrer here.
   */
  resolveReference(ref: string, referrerUri: string): Promise<string | undefined> {
    return this.hierarchy.resolveReference(ref, referrerUri);
  }

  /**
   * The folder, as `findFiles` lists it, in the order it lists it: that order decides which of
   * two same-named files a reference resolves to.
   *
   * Read through the SHARED source cache (`FolderHierarchy`'s `cache`), so this pass and the
   * usage plan's and the name index's are one pass over the same artifacts, and a build after a
   * save reads the saved file and `stat`s the rest.
   */
  private async listFolder(): Promise<readonly SourceFile[]> {
    const uris = await vscode.workspace.findFiles(SUPPORTED_GLOB);
    // uriString -> Uri, for the rows: a row carries the string and `getTreeItem` needs the
    // Uri to open, decorate and badge with. Rebuilt with the graph, so a file that has left
    // the folder leaves this map too.
    this.uris = new Map(uris.map((uri) => [uri.toString(), uri]));
    const files = sourceFilesOf(uris);
    this.listed.set(files, uris);
    return files;
  }

  /**
   * The cache's own scan reader — same cap, same `mtime:size` version, so every file it reads
   * is one every other consumer gets for free — plus the project store, which the cache
   * deliberately does not hold (see view's `GraphReader`).
   */
  private reader(uris: readonly vscode.Uri[]): GraphReader {
    const byUri = new Map(uris.map((u) => [u.toString(), u]));
    return {
      ...readerFor(uris),
      projectStore: async (file) => {
        const uri = byUri.get(file.uriString);
        // A .prj is an empty marker: its structure is the sibling resources/project/** tree,
        // read into a project-root-relative relpath map instead of bytes. A `matlab.toml` IS
        // the structure and arrives as a one-entry map of the same shape — projectStore.ts
        // owns that split, so the tree reads one kind of answer for all four formats.
        return uri ? readProjectStore(uri) : null;
      },
    };
  }
}
