// Copyright 2026 The MathWorks, Inc.

export interface PIPropertyRow {
  name: string;
  value: string;
  editable: boolean;
  type: 'text' | 'link';
  linkTarget?: string;
}

export interface PIPropertyGroup {
  title: string;
  properties: PIPropertyRow[];
}

// Replicates the vendored two-step transform (PIController.convertToPIObject +
// LitRenderer.setPIContent). graphture/usedBy extras are intentionally omitted.
export function buildPropertyGroups(node: any): PIPropertyGroup[] {
  if (!node || typeof node.toPIObject !== 'function') return [];
  const raw = node.toPIObject();
  if (!raw || !raw.propertySheet) return [];
  const obj = raw.objects && raw.objects[0] ? raw.objects[0] : {};
  const out: PIPropertyGroup[] = [];
  for (const groupDef of raw.propertySheet.groups ?? []) {
    const properties: PIPropertyRow[] = [];
    for (const item of groupDef.items ?? []) {
      if (item.type !== 'property') continue;
      const propDef = (raw.propertySheet.properties ?? []).find(
        (p: any) => p.name === item.name,
      );
      if (!propDef) continue;
      const link = (propDef as any).link; // usually undefined for textual sldd
      properties.push({
        name: propDef.displayName || propDef.name,
        value: String(obj[propDef.name] ?? ''),
        editable: false, // read-only V1
        type: link ? 'link' : 'text',
        linkTarget: link || undefined,
      });
    }
    out.push({ title: groupDef.displayName || groupDef.name, properties });
  }
  return out;
}
