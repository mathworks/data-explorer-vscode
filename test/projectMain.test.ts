// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The project page's webview entry, driven for real. view's tests cover WHAT the page says, how
// <dex-project-page> keeps its filters and answers its links' keys (its projectPageElement and
// projectPageStyle tests); this covers what the entry adds around the element — the injected
// stylesheet, the payload it hands the element, the error banner, and the postMessage boundary
// the hyperlinks go through (a component row's `preferProject` is msp.test.ts's). It imports the
// SHIPPING module rather than reconstructing its listeners: a rewritten copy is one rule on two
// paths, and it goes on passing after the real one changes.
//
// The page is in the element's shadow root, and the element draws after an update, so every
// query goes through `shadow()` and every step that changes the page awaits `drawn()`.
//
// Importable with one stub, `acquireVsCodeApi` as a global, because the module calls it
// at top level. Imported once in beforeAll — not a choice, since a module body runs once
// per test FILE and this one wires a window listener and creates its own DOM.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { ProjectPage } from 'data-explorer-core';
import { PROJECT_PAGE_CSS } from 'data-explorer-view/project-page';

const posted: Array<{ type: string; [k: string]: unknown }> = [];

/** What the module body itself posted, snapshotted before any test clears the log. */
let atLoad: Array<{ type: string; [k: string]: unknown }> = [];

/** The elements the module body put in the document, in the order it put them there. */
const added: Element[] = [];

function page(over: Partial<ProjectPage> = {}): ProjectPage {
  return {
    name: 'Monophonic',
    format: 'fixedPathV2',
    formatLabel: 'multiple XML files',
    memberCount: 12,
    labelledCount: 3,
    startup: [],
    shutdown: [],
    shortcuts: [],
    pathFolders: [],
    locations: [],
    categories: [],
    references: [],
    warnings: [],
    ...over,
  };
}

// Enough shortcuts to earn a filter box, with one whose name and path both hold 'gain'.
const SHORTCUTS = [
  { name: 'Open gain model', file: 'models/gain.slx', group: '' },
  ...Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, file: `s${i}.m`, group: '' })),
];

const ROOT = '/work/Monophonic';

function send(msg: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
}

const element = () =>
  document.querySelector('dex-project-page') as HTMLElement & { updateComplete: Promise<boolean>; payload: unknown };
const shadow = () => element().shadowRoot as ShadowRoot;
/** Once the element has drawn what the last step changed. */
const drawn = async (): Promise<void> => void (await element().updateComplete);

async function setProject(over: Partial<ProjectPage> = {}, root = ROOT, warnings?: unknown): Promise<void> {
  send({ type: 'setProject', page: page(over), root, warnings });
  await drawn();
}

const pageEl = () => shadow().querySelector('.dex-page') as HTMLElement;
const errorEl = () => document.getElementById('dex-error') as HTMLElement;
const link = (path: string) => shadow().querySelector(`[data-open="${path}"]`) as HTMLElement;

async function click(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await drawn();
}

describe('the project page webview', () => {
  // Its own timeout: a cold import of the whole project-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as { type: string }),
    });
    const take = (records: MutationRecord[]) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) added.push(n);
    };
    const observer = new MutationObserver(take);
    observer.observe(document, { childList: true, subtree: true });
    await import('../src/webview/project-main.js');
    take(observer.takeRecords());
    observer.disconnect();
    atLoad = [...posted];
  }, 60_000);

  beforeEach(async () => {
    await setProject({ shortcuts: SHORTCUTS });
    posted.length = 0;
  });

  it('builds its own DOM, so neither shell has markup to get wrong', () => {
    // Both shells (src/host/webviewHtml.ts and the vite dev shell project.html) are
    // empty on purpose — the split test/webviewOverlays.test.ts exists to catch for the
    // table's banner strip cannot happen if there is nothing to copy. The banner comes
    // before the page, as it always did.
    expect(pageEl()).not.toBeNull();
    expect(errorEl()).not.toBeNull();
    expect(errorEl().nextElementSibling).toBe(element());
  });

  it('injects its stylesheet before painting, so nothing flashes unstyled', () => {
    // view's stylesheet, whole, for the DOCUMENT's half of it (the html and body rules, which a
    // shadow root cannot reach). What it says is view's (projectPageStyle.test.ts).
    const style = [...document.head.querySelectorAll('style')].find((s) => s.textContent === PROJECT_PAGE_CSS);
    expect(style, "a <style> in the head holds view's PROJECT_PAGE_CSS").toBeDefined();
    // In the document before the page is.
    expect(added.indexOf(style!)).toBeGreaterThanOrEqual(0);
    expect(added.indexOf(style!)).toBeLessThan(added.indexOf(element()));
  });

  it('says ready as its first and only word, so the host knows to send the project', () => {
    // Last statement of the module body, i.e. after the listeners are wired: a payload
    // that arrived before them would paint nothing.
    expect(atLoad).toEqual([{ type: 'ready' }]);
  });

  it('hands the page the project it is given: the page, its root, its warnings and its msp', async () => {
    // What the element draws from it is view's (projectPageElement.test.ts › renders the project
    // it is given). The warnings and the msp are passed through as the host sent them: a page
    // that drops either loses its warning banner, or every MSP fact and the component rows' Open.
    const warnings = { headline: 'Part of the project could not be read.', details: ['resources/project/x.xml'] };
    const msp = { role: 'model', dictionaries: [], evidence: ['msp_config.json'] };
    send({ type: 'setProject', page: page({ shortcuts: SHORTCUTS }), root: ROOT, warnings, msp });
    await drawn();
    expect(element().payload).toEqual({ page: page({ shortcuts: SHORTCUTS }), root: ROOT, warnings, msp });
    expect(pageEl().innerHTML).toContain(ROOT);
  });
});

describe('clicking a hyperlink', () => {
  beforeEach(async () => {
    await setProject({ shortcuts: SHORTCUTS });
    posted.length = 0;
  });

  it('asks the host to open the path, not the text on screen', async () => {
    await click(link('models/gain.slx'));
    expect(posted).toEqual([{ type: 'openFile', path: 'models/gain.slx' }]);
  });
});

describe('an error from the host', () => {
  beforeEach(async () => {
    await setProject({ shortcuts: SHORTCUTS });
    posted.length = 0;
  });

  it('is shown', () => {
    send({ type: 'error', message: 'Could not read the project.' });
    expect(errorEl().style.display).toBe('block');
    expect(errorEl().textContent).toBe('Could not read the project.');
  });

  it('is cleared by the next project that does arrive', async () => {
    send({ type: 'error', message: 'Could not read the project.' });
    await setProject({ shortcuts: SHORTCUTS });
    expect(errorEl().style.display).toBe('none');
  });
});
