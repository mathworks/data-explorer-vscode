// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import type { TableColumnConfig } from '../ContainerNode';
import ProjectItemNode from '../data/ProjectItemNode';
import type BaseNode from '../BaseNode';
import type { ProjectFile, ProjectLabel, ProjectReference } from '../../parser/ProjectParser';

export default class ProjectSectionNode extends ContainerNode {
    label: string;
    iconId: string;

    constructor(name: string, parent: BaseNode | null, label: string, iconId: string) {
        super(name, parent);
        this.label = label;
        this.iconId = iconId;
    }

    get icon(): string {
        return this.iconId;
    }

    get displayName(): string {
        return this.label;
    }

    get tableColumnConfig(): TableColumnConfig {
        return { columns: ['Name', 'Type', 'Location', 'Labels'] };
    }

    addFileEntry(file: ProjectFile): BaseNode {
        const name = file.path.split(/[/\\]/).pop() || file.path;
        const node = new ProjectItemNode(name, this, {
            itemType: file.isFolder ? 'Folder' : 'File',
            location: file.path,
            labels: file.labels,
        });
        this.addChild(node);
        return node;
    }

    addPathEntry(folder: string): BaseNode {
        const name = folder.split(/[/\\]/).filter((p) => p.length > 0).pop() || folder;
        const node = new ProjectItemNode(name, this, {
            itemType: 'Path Folder',
            location: folder,
        });
        this.addChild(node);
        return node;
    }

    addLabelEntry(label: ProjectLabel): BaseNode {
        const node = new ProjectItemNode(label.name, this, {
            itemType: 'Label',
            location: label.category,
        });
        this.addChild(node);
        return node;
    }

    addReferenceEntry(ref: ProjectReference): BaseNode {
        const node = new ProjectItemNode(ref.name ?? ref.id, this, {
            itemType: 'Reference',
            location: ref.id,
        });
        this.addChild(node);
        return node;
    }
}
