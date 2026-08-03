// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropType from '../../prop/PropType';
import PropLocation from '../../prop/PropLocation';
import PropLabels from '../../prop/PropLabels';

export interface ProjectItemOpts {
    itemType: string;
    location: string;
    labels?: string[];
    icon?: string;
}

export default class ProjectItemNode extends BaseNode {
    projectItemType: string;
    location: string;
    labels: string[];
    _icon?: string;

    constructor(name: string, parent: BaseNode | null, opts: ProjectItemOpts) {
        super(name, parent);
        this.projectItemType = opts.itemType;
        this.location = opts.location;
        this.labels = opts.labels || [];
        this._icon = opts.icon;
    }

    get isEntry(): boolean {
        return true;
    }

    get icon(): string {
        if (this._icon) {
            return this._icon;
        }
        const type = this.projectItemType;
        if (type === 'Folder') {
            return 'databaseFolder';
        }
        if (type === 'Path Folder') {
            return 'link_database';
        }
        if (type === 'Label') {
            return 'wsDefault';
        }
        if (type === 'Reference') {
            return 'modelReference';
        }
        // File: pick by extension.
        const lower = this.name.toLowerCase();
        if (lower.endsWith('.slx') || lower.endsWith('.mdl')) {
            return 'simulinkModel_FT';
        }
        if (lower.endsWith('.sldd')) {
            return 'simulinkDataDictionary_FT';
        }
        if (lower.endsWith('.mat')) {
            return 'matlabWorkspaceFile';
        }
        return 'wsDefault';
    }

    get displayName(): string {
        return this.name;
    }

    get displayValue(): string {
        return this.location;
    }

    get dataType(): string {
        return this.projectItemType;
    }

    get nameEditable(): boolean {
        return false;
    }

    get valueEditable(): boolean {
        return false;
    }

    getProperties(): PropClass[] {
        return [PropName, PropType, PropLocation, PropLabels];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropType, PropLocation, PropLabels] },
        ];
    }
}
