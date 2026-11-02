// Copyright 2026 The MathWorks, Inc.
//
// Where this extension's webviews tell dex-icon its icons are. The widget itself (the file it
// points at, its size, what it hides from assistive tech, its aliases, and drawing nothing for no
// id) is view's, and view proves it (test/dexIcon.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('rendering an icon', () => {
  it('takes its base from every webview entry, set before the entry defines a widget', () => {
    // Without it dex-icon falls back to the package's own icons/ folder, found from its
    // module's URL — which, bundled into dist/webview/assets/, names a folder outside the
    // extension, so the CSP blocks it and every row loses its icon. The project page
    // draws no icon and has no dex-icon to configure.
    for (const entry of ['table-main.ts', 'pi-main.ts']) {
      const code = readFileSync(join(process.cwd(), 'src', 'webview', entry), 'utf8');
      const set = code.indexOf("setIconBase('./icons/');");
      expect(set, `${entry} never sets the icon base`).toBeGreaterThan(-1);
      expect(set, `${entry} defines a widget before it sets the icon base`).toBeLessThan(code.search(/^define\w+\(\);$/m));
    }
    const project = readFileSync(join(process.cwd(), 'src', 'webview', 'project-main.ts'), 'utf8');
    expect(project).toMatch(/from 'data-explorer-view\/project-page'/);
    expect(project).not.toMatch(/from 'data-explorer-view\/(?!project-page'|model')/);
  });
});
