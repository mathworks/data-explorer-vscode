// Copyright 2026 The MathWorks, Inc.
import { matrixPayload, type MatrixPayload } from './matrixPayload.js';

export interface PIPropertyRow {
  name: string;
  value: string;
  editable: boolean;
  type: 'text' | 'link';
  linkTarget?: string;
  // Present only on a Value row whose value is a griddable matrix. Same payload
  // and same builder the table rows use, so the PI cannot disagree with the table
  // about what is griddable.
  matrix?: MatrixPayload;
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
      const row: PIPropertyRow = {
        name: propDef.displayName || propDef.name,
        value: String(obj[propDef.name] ?? ''),
        editable: false, // read-only V1
        type: link ? 'link' : 'text',
        linkTarget: link || undefined,
      };
      // The Variable Editor affordance, on the Value property only: it is the one
      // property whose value can be a matrix. `node` is passed, NOT its Value
      // child — matrixPayload's own matrixForRow does that resolution, and doing
      // it here would title the popover `Value` where the table says
      // `ParamMat.Value`.
      if (propDef.name === 'Value') {
        const matrix = matrixPayload(node);
        if (matrix) {
          row.matrix = matrix;
        }
      }
      properties.push(row);
    }
    out.push({ title: groupDef.displayName || groupDef.name, properties });
  }
  return out;
}
