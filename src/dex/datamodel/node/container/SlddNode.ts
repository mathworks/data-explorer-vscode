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

export default class SlddNode extends ContainerNode {
    coreProperties: Record<string, unknown> | null;
    dictionaryReferences: unknown[];
    allowAccessBWS: boolean;
    dirty: boolean;
    sourceFormat: string;
    rawXml: string | null;
    _zipMetadata: Record<string, unknown> | null;
    _dataSourceAttrs: Record<string, string> | null;

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

        if (content) {
            node.dictionaryReferences = (content['Dictionary References'] as unknown[]) || [];
            node.allowAccessBWS = (content.AllowAccessBWS as boolean) || false;

            const entries = (content.entries as Record<string, unknown>[]) || [];
            entries.forEach((entry) => {
                const sectionKey = SlddNode.getSectionKey(entry);
                const section = node.getSection(sectionKey);
                if (section) {
                    section.parseEntry(entry);
                }
            });
        }

        return node;
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
