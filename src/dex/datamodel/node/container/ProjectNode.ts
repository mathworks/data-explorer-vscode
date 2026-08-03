// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode';
import type { TableColumnConfig } from '../ContainerNode';
import ProjectSectionNode from './ProjectSectionNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import type { ParsedProject } from '../../parser/ProjectParser';

const SECTION_DEFS = [
  { key: 'files', label: 'Project Files', icon: 'databaseFolder' },
  { key: 'path', label: 'Project Path', icon: 'link_database' },
  { key: 'labels', label: 'Labels', icon: 'databaseFolder' },
  { key: 'references', label: 'References', icon: 'modelReference' },
];

export default class ProjectNode extends ContainerNode {
  constructor(name: string) {
    super(name, null);
    SECTION_DEFS.forEach((def) => {
      this.addChild(new ProjectSectionNode(def.key, this, def.label, def.icon));
    });
  }

  get tableColumnConfig(): TableColumnConfig {
    return { columns: ['Name', 'Type', 'Location', 'Labels'] };
  }

  get displayName(): string {
    return this.name;
  }

  get readOnly(): boolean {
    return true;
  }

  get icon(): string {
    // A dedicated project icon ships in media/icons/simulink_project.svg.
    return 'simulink_project';
  }

  get NumberOfEntries(): number {
    let count = 0;
    this.children.forEach((section) => {
      count += section.children.length;
    });
    return count;
  }

  getProperties(): PropClass[] {
    return [PropName];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName] }];
  }

  getSection(key: string): ProjectSectionNode | null {
    return (this.children.find((c) => c.name === key) as ProjectSectionNode) || null;
  }

  static fromParsed(parsed: ParsedProject, filename: string): ProjectNode {
    const node = new ProjectNode(filename);

    // Resolve per-file label ids (e.g. a GUID) to their display names via the
    // label catalog, so the table shows "Reviewed" rather than the raw UUID.
    const labelName = new Map<string, string>();
    for (const label of parsed.labels) {
      if (label.id) {
        labelName.set(label.id, label.name);
      }
    }

    const filesSection = node.getSection('files')!;
    for (const file of parsed.files) {
      const resolved = {
        ...file,
        labels: file.labels.map((id) => labelName.get(id) ?? id),
      };
      filesSection.addFileEntry(resolved);
    }

    const pathSection = node.getSection('path')!;
    for (const folder of parsed.pathFolders) {
      pathSection.addPathEntry(folder);
    }

    const labelsSection = node.getSection('labels')!;
    for (const label of parsed.labels) {
      labelsSection.addLabelEntry(label);
    }

    const refsSection = node.getSection('references')!;
    for (const ref of parsed.references) {
      refsSection.addReferenceEntry(ref);
    }

    return node;
  }
}
