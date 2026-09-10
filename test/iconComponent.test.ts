// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// <dex-icon> is the one place the webview turns a node's iconId into a visible
// image. The host ships an iconId per row (RowData.Name.iconId) and dex-tree-table
// binds it; this component maps the id onto a file under media/icons/ and renders
// an <img>. The alias table exists because the data model names kinds ('struct',
// 'bus') while the shipped assets use MathWorks icon names ('typeStruct').
import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DexIcon } from '../src/webview/components/dex-icon.js';

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

// The asset the rendered src actually resolves to on disk. Resolved from the
// vitest cwd (the repo root) because happy-dom replaces import.meta.url with a
// non-file URL.
function assetFor(el: DexIcon): string {
  const file = src(el).replace(/^.*\/icons\//, '');
  return resolve('media/icons', file);
}

afterEach(() => {
  icon?.remove();
  icon = null;
});

describe('rendering an icon', () => {
  it('renders an <img> pointing at the matching file under icons/', async () => {
    const el = await makeIcon('blocks');
    expect(src(el)).toBe('/icons/blocks.svg');
  });

  it('resolves the src relative to the webview base so the CSP allows it', async () => {
    // The webview is served from a vscode-resource base (vite `base: './'`); a src
    // that ignored BASE_URL would point outside localResourceRoots and be blocked,
    // showing a broken image on every row.
    const el = await makeIcon('blocks');
    expect(src(el).endsWith('icons/blocks.svg')).toBe(true);
    expect(src(el).startsWith('icons/blocks.svg')).toBe(false);
  });

  it('still resolves from the root when the bundler hands it an empty BASE_URL', async () => {
    // The base is read once per element, at construction, and pasted straight in
    // front of `icons/…`. An empty BASE_URL with no fallback would emit the
    // RELATIVE src `icons/blocks.svg`, which resolves against the webview's own
    // vscode-webview:// document URL rather than the resource root — outside
    // localResourceRoots, so the CSP blocks it and every row loses its icon.
    // Restored by hand rather than with unstubAllEnvs, which puts BASE_URL back
    // as '' and would leave every later case in this file measuring the fallback
    // instead of the real base.
    const real = import.meta.env.BASE_URL;
    vi.stubEnv('BASE_URL', '');
    try {
      const el = await makeIcon('blocks');
      expect(src(el)).toBe('/icons/blocks.svg');
    } finally {
      vi.stubEnv('BASE_URL', real);
    }
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
    expect(src(el)).toBe(`/icons/${asset}.svg`);
  });

  it('every alias resolves to an asset that actually ships', async () => {
    // An alias pointing at a missing file renders as a broken image in the
    // webview, which is easy to miss by eye — unlike a tree icon, there is no
    // generic fallback here.
    for (const [kind] of ALIASES) {
      const el = await makeIcon(kind);
      expect(existsSync(assetFor(el)), `alias ${kind} -> missing ${src(el)}`).toBe(true);
      el.remove();
    }
  });

  it('passes an unaliased id straight through as the file name', async () => {
    // Most ids the host sends are already asset names (SectionNode.iconId,
    // ModelNode SECTION_DEFS); aliasing must not rewrite them.
    const el = await makeIcon('databaseFolderDesign');
    expect(src(el)).toBe('/icons/databaseFolderDesign.svg');
    expect(existsSync(assetFor(el))).toBe(true);
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
    expect(src(el)).toBe('/icons/typeBus.svg');
  });
});
