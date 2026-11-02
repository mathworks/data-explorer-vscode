// Copyright 2026 The MathWorks, Inc.
//
// The filter bar's chip wash, as this extension declares it.
//
// --dex-bg-badge was the filter bar's one undeclared read: the term chips painted
// `var(--dex-bg-badge, rgba(128, 128, 128, 0.18))` and nothing declared the name, so the
// fallback always won. The repair DECLARES it with that literal, so the chips render as
// before. A mid-grey at 18% alpha is self-neutral, and the chip-ink contrast measured in
// the browser on 2026-10-04 (11.47 / 8.16 / 17.92 / 14.88 :1 across Dark Modern, Light
// Modern, HC Black, HC White) was taken at exactly this value. A remap onto a VS Code colour
// (--vscode-badge-background is a SOLID colour) would change every chip and void those
// numbers, so vscode-theme.css's :root, which decides what VS Code paints, holds that value.
//
// The widgets' half (every token the column filter and the filter bar read is declared, the
// pressed operator and the mono line read the tokens they should, the chip reads
// --dex-bg-badge and theme.css declares it at that value) is view's, and view proves it
// (test/widgetStylesheets.test.ts, test/themeTokens.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments first: the prose in vscode-theme.css quotes token names verbatim to explain them.
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the filter bar chip wash is declared, at the value it was measured at', () => {
  const WASH = 'rgba(128, 128, 128, 0.18)';

  it(`vscode-theme.css declares --dex-bg-badge as ${WASH} on :root`, () => {
    const root = /:root\s*\{([^}]*)\}/.exec(read('../src/webview/vscode-theme.css'));
    expect(root, 'vscode-theme.css has no :root block').not.toBeNull();
    expect(root![1]).toContain(`--dex-bg-badge: ${WASH};`);
  });
});
