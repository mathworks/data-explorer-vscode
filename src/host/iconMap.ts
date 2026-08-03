// Copyright 2026 The MathWorks, Inc.
import * as vscode from 'vscode';

// Map dex internal icon ids to the closest VS Code built-in ThemeIcon.
// Unknown ids fall back to a generic symbol.
const MAP: Record<string, string> = {
  databaseFolderDesign: 'database',
  databaseFolderArchitecture: 'database',
  databaseFolderConfiguration: 'gear',
  databaseFolder: 'database',
  wsDefault: 'symbol-variable',
  wsParameters: 'symbol-parameter',
  wsSignal: 'pulse',
  wsBus: 'symbol-structure',
  wsNumeric: 'symbol-number',
  wsValue: 'symbol-constant',
  wsEnum: 'symbol-enum',
  wsAlias: 'symbol-reference',
  simulink_database: 'database',
};

export function themeIconFor(dexIconId: string | undefined): vscode.ThemeIcon {
  const id = dexIconId ? MAP[dexIconId] : undefined;
  return new vscode.ThemeIcon(id ?? 'symbol-field');
}

// Resolve a dex icon id to the actual SVG shipped in `media/icons`, matching the
// icons the data explorer project renders. Falls back to a generic type icon
// when the id is missing.
export function svgIconFor(
  extensionUri: vscode.Uri,
  dexIconId: string | undefined,
): vscode.Uri {
  const id = dexIconId || 'typeGeneric';
  return vscode.Uri.joinPath(extensionUri, 'media', 'icons', `${id}.svg`);
}
