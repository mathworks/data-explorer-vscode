// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// <dex-icon> is the one place the webview turns a node's iconId into a visible
// image. The host ships an iconId per row (RowData.Name.iconId) and dex-tree-table
// binds it; this component maps the id onto a file under the icon base the webview
// entries set (`./icons/`, the icons copy:icons ships) and renders an <img>.
// The alias table exists because the data model names kinds ('struct', 'bus') while
// the shipped assets use MathWorks icon names ('typeStruct').
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DexIcon, defineIcon, setIconBase } from 'data-explorer-view/icon';
import { shippedIcon } from './tools/shippedIcons.js';

// As table-main and pi-main do, before any icon renders.
setIconBase('./icons/');
defineIcon();

let icon: DexIcon | null = null;

async function makeIcon(iconId: string, size?: number): Promise<DexIcon> {
  icon = new DexIcon();
  document.body.appendChild(icon);
  icon.iconId = iconId;
  if (size !== undefined) icon.size = size;
  await icon.updateComplete;
  return icon;
}

function img(el: DexIcon): HTMLImageElement | null {
  return el.shadowRoot!.querySelector('img');
}

function src(el: DexIcon): string {
  return img(el)!.getAttribute('src')!;
}

// The shipped asset the rendered src names, or undefined.
function assetFor(el: DexIcon): string | undefined {
  return shippedIcon(src(el).replace(/^.*\/icons\//, '').replace(/\.svg$/, ''));
}

afterEach(() => {
  icon?.remove();
  icon = null;
});

describe('rendering an icon', () => {
  it('renders an <img> pointing at the matching file under icons/', async () => {
    const el = await makeIcon('blocks');
    expect(src(el)).toBe('./icons/blocks.svg');
  });

  it('resolves the src relative to the webview base so the CSP allows it', async () => {
    // The webview is served from a vscode-resource base (<base href> = dist/webview); a
    // src that resolved anywhere else would point outside localResourceRoots and be
    // blocked, showing a broken image on every row.
    const el = await makeIcon('blocks');
    expect(src(el).endsWith('icons/blocks.svg')).toBe(true);
    expect(new URL(src(el), 'https://host/ext/dist/webview/').href).toBe('https://host/ext/dist/webview/icons/blocks.svg');
  });

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

  it('sizes the image on both axes so rows do not shift while icons load', async () => {
    const el = await makeIcon('blocks', 24);
    expect(img(el)!.getAttribute('width')).toBe('24');
    expect(img(el)!.getAttribute('height')).toBe('24');
  });

  it('defaults to the 16px tree/table row size', async () => {
    const el = await makeIcon('blocks');
    expect(img(el)!.getAttribute('width')).toBe('16');
  });

  it('hides the image from assistive tech because the row name carries the meaning', async () => {
    // The icon duplicates information already in the Name cell; announcing it
    // would make a screen reader read every row twice.
    const el = await makeIcon('blocks');
    expect(img(el)!.getAttribute('alt')).toBe('');
    expect(img(el)!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('aliasing a data-model kind onto a shipped asset', () => {
  // The alias table is a compatibility layer, not a live path: every node class in
  // data-explorer-core returns an asset name directly from its `icon` getter
  // (verified by walking every fixture — none of the keys below is ever emitted).
  // It is kept for ids arriving from outside that set, so what these cases pin is
  // that each mapping names an asset that EXISTS. A mapping to a missing file can
  // only ever render a broken image, and nothing else in the suite would catch it.
  const ALIASES: [string, string][] = [
    ['struct', 'typeStruct'],
    ['cell', 'wsBrackets'],
    ['string', 'wsString'],
    ['parameter', 'wsParameters'],
    ['bus', 'typeBus'],
    ['enum', 'typeEnum'],
    ['signal', 'typeSignal'],
    ['alias', 'typeAlias'],
    ['numeric', 'typeNumeric'],
    ['structElement', 'typeStructElement'],
    ['signalObject', 'typeSignal'],
    ['connectionBus', 'typeBus'],
    ['numericType', 'typeNumeric'],
    ['aliasType', 'typeAlias'],
    ['valueType', 'typeStruct'],
    ['variant', 'wsVariant'],
    ['configSet', 'settings'],
    ['matlabVariable', 'wsParameters'],
    ['matlabStruct', 'typeStruct'],
  ];

  it.each(ALIASES)('maps the %s kind onto %s.svg', async (kind, asset) => {
    const el = await makeIcon(kind);
    expect(src(el)).toBe(`./icons/${asset}.svg`);
  });

  it('every alias resolves to an asset that actually ships', async () => {
    // An alias pointing at a missing file renders as a broken image in the
    // webview, which is easy to miss by eye — unlike a tree icon, there is no
    // generic fallback here.
    for (const [kind] of ALIASES) {
      const el = await makeIcon(kind);
      expect(assetFor(el), `alias ${kind} -> missing ${src(el)}`).toBeDefined();
      el.remove();
    }
  });

  it('passes an unaliased id straight through as the file name', async () => {
    // Most ids the host sends are already asset names (SectionNode.iconId,
    // ModelNode SECTION_DEFS); aliasing must not rewrite them.
    const el = await makeIcon('databaseFolderDesign');
    expect(src(el)).toBe('./icons/databaseFolderDesign.svg');
    expect(assetFor(el)).toBeDefined();
  });
});

describe('no icon to show', () => {
  it('renders nothing at all when the row carries no iconId', async () => {
    // A row whose Name has no iconId (dex-tree-table guards with `iconId ? …`) and
    // the cross-tab drag tooltip both leave this empty. Emitting an <img src=".svg">
    // would fire a failing request and show a broken-image glyph in the row.
    const el = await makeIcon('');
    expect(img(el)).toBeNull();
    expect(el.shadowRoot!.textContent!.trim()).toBe('');
  });

  it('renders nothing before any iconId is assigned', async () => {
    // The default: the element is constructed and rendered once before the host's
    // row data arrives.
    icon = new DexIcon();
    document.body.appendChild(icon);
    await icon.updateComplete;
    expect(img(icon)).toBeNull();
  });

  it('removes the image when the id is cleared', async () => {
    // The drop tooltip reuses one element across drags and clears _dragIconId at
    // the end; a stale icon would linger next to the next drag's label.
    const el = await makeIcon('blocks');
    expect(img(el)).not.toBeNull();
    el.iconId = '';
    await el.updateComplete;
    expect(img(el)).toBeNull();
  });

  it('shows the image again when a new id arrives after an empty one', async () => {
    const el = await makeIcon('');
    el.iconId = 'typeBus';
    await el.updateComplete;
    expect(src(el)).toBe('./icons/typeBus.svg');
  });
});
