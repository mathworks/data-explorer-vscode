// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { svgIconFor } from './iconMap.js';
import { RelGraph, type GraphNode } from './graphModel.js';
import { graphSourcesOf, type GraphReader } from './structuralIndex.js';
import { readProjectStore } from './projectStore.js';
import { encode, type HealthState } from './health.js';
import { readerFor, sourceCache, sourceFilesOf } from './sourceReads.js';
import { SUPPORTED_GLOB } from '../common/fileTypes.js';

// The Data Explorer tree is a cross-format relationship graph (model->model,
// model->sldd/mat, sldd->sldd), rendered as an expansion tree. Structural
// (relationship-only) parsing builds it; entries are parsed lazily on open.

export type SlddTreeNode = GraphNode;

const ICON_BY_KIND: Record<string, string> = {
  model: 'simulink',
  sldd: 'simulink_database',
  mat: 'matlabWorkspaceFile',
  // `project` is a safety-net fallback: .prj sources become group headers (see
  // the el.kind === 'group' branch), not file nodes, so this is not hit today.
  project: 'simulink_project',
  group: 'link_database',
};

export class SectionsTreeProvider implements vscode.TreeDataProvider<SlddTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SlddTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graph: Promise<RelGraph> | null = null;
  private uris = new Map<string, vscode.Uri>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Re-render the rows from the graph this provider already has.
   *
   * For what changes about a row without changing the folder — today that is the modified
   * badge, which `getTreeItem` reads off the live TextDocument. The graph is built from the
   * files ON DISK (readForScan, never a buffer), so an unsaved edit cannot move an edge in it:
   * dropping it here would re-read every file in the folder to rebuild the graph it had, which
   * on a folder of real dictionaries is ~5.7 s per keystroke.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Re-read the folder, for the events that change it: create, delete, save, folder added. */
  rebuild(): void {
    this.graph = null;
    this.refresh();
  }

  getTreeItem(el: SlddTreeNode): vscode.TreeItem {
    if (el.kind === 'missing') {
      const item = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.description = 'unresolved reference';
      item.tooltip = `Referenced file "${el.label}" was not found in the workspace.`;
      item.contextValue = 'slddMissing';
      return item;
    }

    if (el.kind === 'group') {
      // Synthetic containers: External Data (link icon), and the top-level
      // project/folder groups. All are expandable, not openable.
      const collapsible = el.hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(el.label, collapsible);
      let icon: string;
      let contextValue: string;
      switch (el.groupKind) {
        case 'project':
          icon = 'simulink_project';
          contextValue = 'dexProjectGroup';
          break;
        case 'folder':
          icon = 'simulink_folder';
          contextValue = 'dexFolderGroup';
          break;
        default:
          icon = ICON_BY_KIND.group;
          contextValue = 'slddGroup';
          break;
      }
      item.iconPath = svgIconFor(this.extensionUri, icon);
      item.contextValue = contextValue;
      return item;
    }

    const collapsible =
      el.cycle || !el.hasChildren
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(el.label, collapsible);
    item.iconPath = svgIconFor(this.extensionUri, ICON_BY_KIND[el.kind] ?? 'typeGeneric');
    item.contextValue = 'slddFile';
    const uri = el.uriString ? this.uris.get(el.uriString) : undefined;
    item.command = { command: 'dataExplorer.openFile', title: 'Open in Data Explorer', arguments: [uri] };

    // Health decoration: encode the row's state into the resourceUri query so the
    // HealthDecorationProvider can badge/color it. A healthy row keeps its plain
    // file URI (no decoration). The query makes each state a distinct decoration
    // key, so a file's clean canonical row and its cycle-repeat row differ.
    if (uri) {
      const health = this.healthOf(el, uri);
      item.resourceUri = health ? uri.with({ query: encode(health) }) : uri;
    }
    if (el.cycle) {
      item.description = '↻ circular reference';
      item.tooltip = `"${el.label}" is part of a circular reference chain; expand it from its top-level occurrence.`;
    }
    return item;
  }

  async getChildren(el?: SlddTreeNode): Promise<SlddTreeNode[]> {
    const graph = await this.ensureGraph();
    return el ? graph.children(el) : graph.roots();
  }

  private ensureGraph(): Promise<RelGraph> {
    if (!this.graph) this.graph = this.buildGraph();
    return this.graph;
  }

  /**
   * Read the folder — through the SHARED source cache, so this pass and the usage plan's and
   * the name index's are one pass over the same artifacts.
   *
   * This used to read every file in the folder itself, every build: `readForScan` per file,
   * then a per-format extraction, then discard the bytes. The usage plan then did the same
   * again for the same folder, and `rebuild()` fires on every save — so saving one 27 KB
   * dictionary re-read every model and every dictionary beside it, twice. Nothing about the
   * tree's answer changes here (structuralIndex.ts shapes it either way); what changes is that
   * the reads are version-keyed and shared, so a build after a save reads the saved file and
   * `stat`s the rest.
   */
  private async buildGraph(): Promise<RelGraph> {
    const uris = await vscode.workspace.findFiles(SUPPORTED_GLOB);
    // uriString -> Uri, for the rows: a node carries the string and `getTreeItem` needs the
    // Uri to open, decorate and badge with. Rebuilt with the graph, so a file that has left
    // the folder leaves this map too.
    this.uris = new Map(uris.map((uri) => [uri.toString(), uri]));
    return new RelGraph(await graphSourcesOf(sourceCache, this.reader(uris), sourceFilesOf(uris)));
  }

  /**
   * The cache's own scan reader — same cap, same `mtime:size` version, so every file it reads
   * is one every other consumer gets for free — plus the project store, which the cache
   * deliberately does not hold (see structuralIndex.GraphReader).
   */
  private reader(uris: readonly vscode.Uri[]): GraphReader {
    const byUri = new Map(uris.map((u) => [u.toString(), u]));
    return {
      ...readerFor(uris),
      projectStore: async (file) => {
        const uri = byUri.get(file.uriString);
        // A .prj is an empty marker: its structure is the sibling resources/project/** tree,
        // read into a project-root-relative relpath map instead of bytes.
        return uri ? readProjectStore(uri) : null;
      },
    };
  }

  // The single most-severe health state for a real-file row, or null if healthy.
  // Precedence: cycle > modified. `missing` is a distinct node kind and is not
  // handled here (it has no real file URI).
  private healthOf(el: SlddTreeNode, uri: vscode.Uri | undefined): HealthState | null {
    if (el.cycle) return 'cycle';
    if (uri) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (doc?.isDirty) return 'modified';
    }
    return null;
  }
}
