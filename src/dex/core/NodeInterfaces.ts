// Copyright 2026 The MathWorks, Inc.

/**
 * Structural interfaces for data model nodes used by the core layer.
 *
 * These are duck-typed — any object matching the shape satisfies the interface.
 * The actual BaseNode/ContainerNode/DataNode classes do NOT need explicit
 * `implements` declarations; TypeScript structural typing handles it.
 *
 * NOTE: We use `import type` from datamodel for shared type definitions
 * (PropClass, etc.). This is safe — type-only imports are erased at compile
 * time and do not create runtime circular dependencies.
 */

import type { PropClass, PropInfo, RowData, PIGroupDef, PIObject } from '../datamodel/node/BaseNode.js';

export type { PropClass, PropInfo, RowData, PIGroupDef };
export type { PIObject as NodePIObject };

/** Minimal interface any node exposes to the core layer */
export interface INode {
    name: string;
    parent: INode | null;
    children: INode[];
    readonly id: string;
    readonly icon: string;
    readonly className: string;
    readonly kind: string;
    readonly dataType: string;
    readonly displayValue: string;
    readonly displayName: string;
    readonly disabled: boolean;
    readonly nameEditable: boolean;
    readonly valueEditable: boolean;
    readonly isEntry?: boolean;
    readonly isContainer?: boolean;

    status?: string;

    flatten(): INode[];
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    toPIObject(): PIObject | null;
    serialize(): unknown;
    getPropInfo(PropClassRef: PropClass): PropInfo;

    setProperty?(propName: string, value: unknown): unknown;
    addChild(child: INode, index?: number): INode;
    removeChild(child: INode): void;

    canAddChild?(): boolean;
    execAddChild?(): unknown;
    execRemoveChild?(child?: INode): unknown;

    /** For clipboard: serialize value for class key detection */
    serializeValue?(): unknown;
    /** For XML-based sources: serialize to XML */
    serializeXml?(tagName: string, attrs: Record<string, string>, indent: number): string;

    /** Raw bytes for MAT variable display */
    _rawBytes?: Uint8Array;
    /** Internal display name override */
    _displayName?: string;
    /** Kind tag for array/cell/string children */
    _kind?: string;
    /** Dimensions for indexed children */
    _dims?: number[];

    /** Discriminant — only IAllNode has this */
    __isAllNode?: never;
}

/** Container node — sections, source roots */
export interface IContainerNode extends INode {
    readonly isContainer: boolean;
    children: INode[];

    getSection?(key: string): IContainerNode | null;
    getAllowedTypes?(): string[];
    execAddEntry?(className: string, entryName?: string): { node: INode; undo: () => void; redo: () => void } | null;
    execRemoveEntry?(node: INode): { undo: () => void; redo: () => void } | null;

    /** For paste support */
    _uniqueName?(baseName: string): string;
    parseEntry?(rawEntry: Record<string, unknown>): INode | null;

    /** Section-specific */
    label?: string;

    /** Source-level properties (optional, not all containers have these) */
    dirty?: boolean;
    readOnly?: boolean;
    meta?: SourceMeta;
    NumberOfEntries?: number;
    dictionaryReferences?: unknown[];
    dataDictionary?: string | null;
    allowAccessBWS?: boolean;
    coreProperties?: Record<string, unknown> | null;
    header?: string;
    rawContents?: Record<string, string> | null;
    release?: string;
    uuid?: string;
    sourceFormat?: string;

    /** Properties exposed on the PI panel */
    Release?: string;
    FileFormat?: string;
}

/** The root source node — a top-level loaded file */
export interface ISourceNode extends IContainerNode {
    dirty: boolean;
    meta?: SourceMeta;
    getSection(key: string): IContainerNode | null;
}

/** Source metadata attached to root source nodes */
export interface SourceMeta {
    path: string;
    lastModified: number | null;
    size: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileHandle: any | null;
}

/** The synthetic __all__ node used for graph view */
export interface IAllNode {
    __isAllNode: true;
    isContainer: true;
    name: string;
    displayName: string;
    icon: string;
    parent: null;
    id: string;
}
