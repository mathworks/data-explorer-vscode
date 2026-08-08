// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import MatlabVariableNode from '../data/MatlabVariableNode';
import { buildTypedNodeFromMcos } from '../data/mcosTypedNode';
import type BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import type { MatVariable } from '../data/MatlabVariableNode';
import { decodeMcosBlob } from '../../parser/McosParser';
import PropName from '../../prop/PropName';

export default class MatNode extends ContainerNode {
  header: string;
  dirty: boolean;
  _anonymousElements: MatVariable[];

  constructor(name: string) {
    super(name, null);
    this.header = '';
    this.dirty = false;
    this._anonymousElements = [];
  }

  get displayName(): string {
    return this.name;
  }

  get readOnly(): boolean {
    return true;
  }

  get icon(): string {
    return 'matlabWorkspaceFile';
  }

  get NumberOfEntries(): number {
    return this.children.length;
  }

  getProperties(): PropClass[] {
    return [PropName];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName] }];
  }

  getSection(): null {
    return null;
  }

  execAddEntry(_className?: string, entryName?: string): { node: BaseNode; undo: () => void; redo: () => void } {
    const name = entryName || this._uniqueName('var');
    const node = MatlabVariableNode.createDefault(name, this);
    this.addChild(node);
    this.dirty = true;
    return {
      node,
      undo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
      redo: () => {
        this.addChild(node);
        this.dirty = true;
      },
    };
  }

  _uniqueName(baseName: string): string {
    const names = new Set(this.children.map((c) => c.name));
    if (!names.has(baseName)) {
      return baseName;
    }
    let i = 1;
    while (names.has(baseName + i)) {
      i++;
    }
    return baseName + i;
  }

  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    const index = this.children.indexOf(node);
    if (index < 0) {
      return null;
    }
    this.removeChild(node);
    this.dirty = true;
    return {
      undo: () => {
        this.addChild(node, index);
        this.dirty = true;
      },
      redo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
    };
  }

  getVariables(): MatVariable[] {
    const variables: MatVariable[] = [];
    for (const child of this.children) {
      // Typed Simulink nodes (ParameterNode, SignalNode) have no `_var` — they
      // come from the read-only MCOS path and are never serialized back.
      const v = (child as unknown as { _var?: MatVariable })._var;
      if (v) {
        variables.push(v);
      }
    }
    for (const anon of this._anonymousElements) {
      variables.push(anon);
    }
    return variables;
  }

  static fromParsed(parsed: { header: string; variables: MatVariable[] }, filename: string): MatNode {
    const node = new MatNode(filename);
    node.header = parsed.header;

    // Decode MCOS objects if present
    const opaqueVars = parsed.variables.filter((v) => v.isOpaque && v.name);
    const anonElement = parsed.variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
    let mcosData: Map<string, { value: unknown; properties: Record<string, unknown>; dimensions: number[] }> | null =
      null;
    if (opaqueVars.length > 0 && anonElement?._rawBytes) {
      mcosData = decodeMcosBlob(
        anonElement._rawBytes,
        opaqueVars.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
      );
    }

    for (const variable of parsed.variables) {
      if ((variable as unknown as { _anonymous?: boolean })._anonymous) {
        node._anonymousElements.push(variable);
        continue;
      }
      if (variable.isOpaque) {
        // Unify on CLASS: any opaque Simulink object whose class the data model
        // knows becomes the SAME typed node the SLDD path builds. When the MCOS
        // decoder resolved the object's properties, they populate the node with
        // real values (SLDD-shaped); otherwise it is an empty shell. The class
        // comes from the variable's own metadata, so this works even for objects
        // the decoder could not resolve.
        const decodedProps = mcosData?.get(variable.name)?.properties;
        const typed = buildTypedNodeFromMcos(variable.className, variable.name, node, decodedProps);
        if (typed) {
          node.addChild(typed);
          continue;
        }
        // No typed node for this class: opaque node, enriched when decoded.
        const decoded = mcosData?.get(variable.name);
        if (decoded) {
          node.addChild(MatlabVariableNode.createFromMcosDecoded(variable, decoded, node));
          continue;
        }
      }
      const child = MatlabVariableNode.parseMatVariable(variable, variable.name, node);
      node.addChild(child);
    }

    return node;
  }
}
