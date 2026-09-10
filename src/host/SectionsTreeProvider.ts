// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { svgIconFor } from './iconMap.js';
import { RelGraph, type GraphNode, type GraphSource } from './graphModel.js';
import { buildGraphSource, type RawFile } from './structuralIndex.js';
import { readProjectStore } from './projectStore.js';
import { encode, type HealthState } from './health.js';
import { isZipBytes } from './slddFormat.js';
import { isProjectFile, isSlddFile } from 'data-explorer-core';
import { toArrayBuffer } from '../common/bytes.js';
import { mapLimited, readForScan } from './scanRead.js';
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

  private async buildGraph(): Promise<RelGraph> {
    const uris = await vscode.workspace.findFiles(SUPPORTED_GLOB);
    this.uris = new Map();
    // A few files at a time, and nothing oversized — see scanRead. The tree only
    // wants each file's reference list, so a file it cannot read is still a node
    // here (it is in the folder, so it belongs in the tree); it just has no edges.
    const sources = await mapLimited(uris, async (uri): Promise<GraphSource> => {
      const uriString = uri.toString();
      this.uris.set(uriString, uri);
      const raw: RawFile = { uriString, path: uri.path };
      try {
        // A .prj is an empty marker: read its sibling resources/project/**
        // store into a project-root-relative relpath map instead of bytes.
        if (isProjectFile(uri.path)) {
          raw.projectFiles = await readProjectStore(uri);
          return buildGraphSource(raw);
        }
        const bytes = await readForScan(uri);
        if (bytes) {
          // JSON .sldd is passed as text so extractReferences works; others as
          // bytes. The ArrayBuffer copy is made only on the branch that needs one:
          // the text branch decodes the bytes it already has, and paying for a
          // full-size copy first made every textual dictionary cost twice its size.
          if (isSlddFile(uri.path)) {
            if (isZipBytes(bytes)) raw.bytes = toArrayBuffer(bytes);
            else raw.text = new TextDecoder().decode(bytes);
          } else {
            raw.bytes = toArrayBuffer(bytes);
          }
        }
      } catch {
        /* unreadable: node with no relationships */
      }
      return buildGraphSource(raw);
    });
    return new RelGraph(sources);
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
