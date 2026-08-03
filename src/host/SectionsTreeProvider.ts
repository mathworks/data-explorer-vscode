// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';
import { svgIconFor } from './iconMap.js';
import { RelGraph, type GraphNode, type GraphSource } from './graphModel.js';
import { buildGraphSource, type RawFile } from './structuralIndex.js';
import { readProjectStore } from './projectStore.js';
import { encode, type HealthState } from './health.js';
import { isZipBytes } from './slddFormat.js';

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

  refresh(): void {
    this.graph = null;
    this._onDidChangeTreeData.fire(undefined);
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
    const uris = await vscode.workspace.findFiles('**/*.{sldd,mat,slx,prj}');
    this.uris = new Map();
    const sources = await Promise.all(
      uris.map(async (uri): Promise<GraphSource> => {
        const uriString = uri.toString();
        this.uris.set(uriString, uri);
        const raw: RawFile = { uriString, path: uri.path };
        try {
          // A .prj is an empty marker: read its sibling resources/project/**
          // store into a project-root-relative relpath map instead of bytes.
          if (uri.path.endsWith('.prj')) {
            raw.projectFiles = await readProjectStore(uri);
            return buildGraphSource(raw);
          }
          const bytes = await vscode.workspace.fs.readFile(uri);
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          // JSON .sldd is passed as text so extractReferences works; others as bytes.
          if (uri.path.endsWith('.sldd')) {
            if (isZipBytes(bytes)) raw.bytes = ab;
            else raw.text = new TextDecoder().decode(bytes);
          } else {
            raw.bytes = ab;
          }
        } catch {
          /* unreadable: node with no relationships */
        }
        return buildGraphSource(raw);
      }),
    );
    const graph = new RelGraph(sources);
    return graph;
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
