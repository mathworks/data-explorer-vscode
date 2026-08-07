// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import SectionNode from './SectionNode';
import { getSectionKey as _getSectionKey } from '../../SectionConstants';
import type DataNode from '../DataNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropRelease from '../../prop/PropRelease';
import PropFileFormat from '../../prop/PropFileFormat';
import PropNumberOfEntries from '../../prop/PropNumberOfEntries';

const SECTION_DEFS = [
    { key: 'design', label: 'Design Data', icon: 'databaseFolderDesign' },
    { key: 'arch', label: 'Architectural Data', icon: 'databaseFolderArchitecture' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'other', label: 'Other Data', icon: 'databaseFolder' }
];

// The systemcomposer interface dictionary classifies architectural entries
// (which are stored as ordinary Simulink objects) into interface/type kinds.
// Captured at parse time so the rest of the model can distinguish, e.g., a
// StructType from a DataInterface (both are Simulink.Bus).
export interface SystemComposerCatalog {
    // Interface name -> systemcomposer type, from the PortInterfaceCatalog
    // (e.g. CompositeDataInterface, CompositePhysicalInterface, ServiceInterface,
    // ValueTypeInterface).
    interfaces: Record<string, string>;
    // Modeled data type name -> systemcomposer type, from the TypeCatalog
    // (e.g. StructDataType, NumericType, EnumDataType, AliasType).
    modeledDataTypes: Record<string, string>;
}

// Maps a systemcomposer type string to the semantic classification token that
// drives the entry's Kind. The token is derived from the type, not the entry
// name (which is user-chosen), so it stays correct regardless of the name.
const SC_TYPE_TO_CLASSIFICATION: Record<string, string> = {
    'systemcomposer.architecture.model.interface.CompositeDataInterface': 'DataInterface',
    'systemcomposer.architecture.model.interface.CompositePhysicalInterface': 'PhysicalInterface',
    'systemcomposer.architecture.model.swarch.ServiceInterface': 'ServiceInterface',
    'systemcomposer.architecture.model.interface.ValueTypeInterface': 'ValueType',
    'systemcomposer.property.StructDataType': 'StructType',
    'systemcomposer.property.NumericType': 'NumericType',
    'systemcomposer.property.EnumDataType': 'EnumType',
    'systemcomposer.property.AliasType': 'AliasType',
};

// Resolve the classification token (e.g. 'DataInterface', 'StructType') for an
// entry name, or null if the catalog doesn't classify it. Interfaces are checked
// before modeled data types.
export function classificationOf(catalog: SystemComposerCatalog | null | undefined, entryName: string): string | null {
    if (!catalog) {
        return null;
    }
    const scType = catalog.interfaces[entryName] || catalog.modeledDataTypes[entryName];
    return (scType && SC_TYPE_TO_CLASSIFICATION[scType]) || null;
}

export default class SlddNode extends ContainerNode {
    coreProperties: Record<string, unknown> | null;
    dictionaryReferences: unknown[];
    allowAccessBWS: boolean;
    dirty: boolean;
    sourceFormat: string;
    rawXml: string | null;
    _zipMetadata: Record<string, unknown> | null;
    _dataSourceAttrs: Record<string, string> | null;
    systemComposer: SystemComposerCatalog | null;

    constructor(name: string) {
        super(name, null);
        this.coreProperties = null;
        this.dictionaryReferences = [];
        this.allowAccessBWS = false;
        this.dirty = false;
        this.sourceFormat = 'json';
        this.rawXml = null;
        this._zipMetadata = null;
        this._dataSourceAttrs = null;
        this.systemComposer = null;

        SECTION_DEFS.forEach((def) => {
            this.addChild(new SectionNode(def.key, this, def.label, def.icon));
        });
    }

    get displayName(): string {
        return this.dirty ? this.name + ' *' : this.name;
    }

    get icon(): string {
        return this.sourceFormat === 'xml' ? 'simulink_server' : 'simulink_database';
    }

    get FileFormat(): string {
        return this.sourceFormat === 'xml' ? 'compressed-binary' : 'uncompressed-text';
    }

    get Release(): string {
        return (this.coreProperties && this.coreProperties.release as string) || '';
    }

    get NumberOfEntries(): number {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }

    getProperties(): PropClass[] {
        return [PropName, PropRelease, PropFileFormat, PropNumberOfEntries];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropRelease, PropFileFormat, PropNumberOfEntries] }
        ];
    }

    getSection(key: string): SectionNode | null {
        return (this.children.find((c) => c.name === key) as SectionNode) || null;
    }

    addEntry(className: string, entryName: string, sectionKey: string): DataNode | null {
        const section = this.getSection(sectionKey);
        if (!section) {
            return null;
        }
        return section.addEntry(className, entryName);
    }

    static parse(json: Record<string, unknown>, filename: string): SlddNode {
        const node = new SlddNode(filename);
        node.coreProperties = (json.__MW_TEXT_COREPROPERTIES__ as Record<string, unknown>) || null;

        if (json.__rawXml) {
            node.sourceFormat = 'xml';
            node.rawXml = json.__rawXml as string;
            node._zipMetadata = (json.__zipMetadata as Record<string, unknown>) || null;
            node._dataSourceAttrs = (json.__dataSourceAttrs as Record<string, string>) || null;
        }

        const parts = json.__MW_TEXT_PARTS__ as Record<string, unknown>;
        const chunk = parts && (parts['__MW_TEXT_PART__/data/chunk0'] as Record<string, unknown>);
        const content = chunk && (chunk.__MW_TEXT_content as Record<string, unknown>);

        // Parse the systemcomposer catalog first so entry parsing can use it to
        // classify architectural entries (e.g. StructType vs DataInterface).
        node.systemComposer = SlddNode._parseSystemComposer(parts);

        if (content) {
            node.dictionaryReferences = (content['Dictionary References'] as unknown[]) || [];
            node.allowAccessBWS = (content.AllowAccessBWS as boolean) || false;

            const entries = (content.entries as Record<string, unknown>[]) || [];
            entries.forEach((entry) => {
                const sectionKey = SlddNode.getSectionKey(entry);
                const section = node.getSection(sectionKey);
                if (section) {
                    section.parseEntry(entry, node.systemComposer);
                }
            });
        }

        return node;
    }

    // Extract the interface and modeled-data-type classifications from the
    // systemcomposer interface dictionary part, if present.
    static _parseSystemComposer(parts: Record<string, unknown> | null): SystemComposerCatalog | null {
        const part = parts && (parts['__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary'] as Record<string, unknown>);
        const content = part && (part.__MW_TEXT_content as Record<string, unknown>);
        const entries = content && (content.entries as Record<string, unknown>[]);
        if (!entries) {
            return null;
        }

        const interfaces: Record<string, string> = {};
        const modeledDataTypes: Record<string, string> = {};

        const readName = (item: Record<string, unknown>): string => {
            const c = (item.content as Record<string, unknown>) || {};
            return (c.p_Name as string) || '';
        };

        entries.forEach((entry) => {
            const entryContent = (entry.content as Record<string, unknown>) || {};

            // PortInterfaceCatalog: named interfaces (data/physical/service/value).
            const catalog = entryContent.p_PortInterfaceCatalog as Record<string, unknown> | undefined;
            const catalogContent = catalog && (catalog.content as Record<string, unknown>);
            const ifaceList = catalogContent && (catalogContent.p_Interfaces as Record<string, unknown>[]);
            if (ifaceList) {
                ifaceList.forEach((iface) => {
                    const name = readName(iface);
                    if (name) {
                        interfaces[name] = (iface.type as string) || '';
                    }
                });
            }

            // TypeCatalog: modeled data types (struct/numeric/enum/alias).
            const modeled = entryContent.p_ModeledDataTypes as Record<string, unknown>[] | undefined;
            if (modeled) {
                modeled.forEach((dt) => {
                    const name = readName(dt);
                    if (name) {
                        modeledDataTypes[name] = (dt.type as string) || '';
                    }
                });
            }
        });

        return { interfaces, modeledDataTypes };
    }

    static getSectionKey(entry: Record<string, unknown>): string {
        const meta = (entry.metadata as Record<string, unknown>) || {};
        return _getSectionKey(meta);
    }

    serialize(): unknown {
        // Binary format handled by BinarySlddSerializer (called externally)
        return this.serializeJson();
    }

    serializeJson(): Record<string, unknown> {
        const entries: unknown[] = [];
        this.children.forEach((section) => {
            section.children.forEach((entryNode) => {
                entries.push((entryNode as DataNode).serialize());
            });
        });

        return {
            __MW_TEXT_COREPROPERTIES__: this.coreProperties,
            __MW_TEXT_PARTS__: {
                '__MW_TEXT_PART__/data/chunk0': {
                    __MW_TEXT_content: {
                        entries,
                        'Dictionary References': this.dictionaryReferences,
                        AllowAccessBWS: this.allowAccessBWS
                    }
                }
            }
        };
    }
}
