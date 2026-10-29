// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The project page's webview entry, driven for real. view's tests cover WHAT the page says and
// how <dex-project-page> keeps its filters; this covers what the entry adds around the element —
// the injected stylesheet, the error banner, and the postMessage boundary the hyperlinks go
// through — and the page's behaviour as this webview shows it. It imports the SHIPPING module
// rather than reconstructing its listeners: a rewritten copy is one rule on two paths, and it
// goes on passing after the real one changes.
//
// The page is in the element's shadow root, and the element draws after an update, so every
// query goes through `shadow()` and every step that changes the page awaits `drawn()`.
//
// Importable with one stub, `acquireVsCodeApi` as a global, because the module calls it
// at top level. Imported once in beforeAll — not a choice, since a module body runs once
// per test FILE and this one wires a window listener and creates its own DOM.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { ProjectPage } from 'data-explorer-core';
import { ROW_CAP } from 'data-explorer-view/project-page';

const posted: Array<{ type: string; [k: string]: unknown }> = [];

/** What the module body itself posted, snapshotted before any test clears the log. */
let atLoad: Array<{ type: string; [k: string]: unknown }> = [];

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

const element = () => document.querySelector('dex-project-page') as HTMLElement & { updateComplete: Promise<boolean> };
const shadow = () => element().shadowRoot as ShadowRoot;
/** Once the element has drawn what the last step changed. */
const drawn = async (): Promise<void> => void (await element().updateComplete);

async function setProject(over: Partial<ProjectPage> = {}, root = ROOT, warnings?: unknown): Promise<void> {
  send({ type: 'setProject', page: page(over), root, warnings });
  await drawn();
}

const pageEl = () => shadow().querySelector('.dex-page') as HTMLElement;
const errorEl = () => document.getElementById('dex-error') as HTMLElement;
const filter = () => shadow().querySelector('input.filter[data-section="shortcuts"]') as HTMLInputElement;
const link = (path: string) => shadow().querySelector(`[data-open="${path}"]`) as HTMLElement;

async function click(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await drawn();
}

/** Types into a section's filter box the way a keystroke does: value, then `input`. */
async function type(input: HTMLInputElement, value: string, caret = value.length): Promise<void> {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await drawn();
}

describe('the project page webview', () => {
  // Its own timeout: a cold import of the whole project-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as { type: string }),
    });
    await import('../src/webview/project-main.js');
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
    const css = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('');
    expect(css).toContain('.dex-page');
    // The override that lets this view scroll: the shared stylesheet locks the viewport
    // for the full-bleed table views.
    expect(css).toContain('overflow: visible');
  });

  it('says ready as its first and only word, so the host knows to send the project', () => {
    // Last statement of the module body, i.e. after the listeners are wired: a payload
    // that arrived before them would paint nothing.
    expect(atLoad).toEqual([{ type: 'ready' }]);
  });

  it('renders the project it is given', () => {
    expect(pageEl().innerHTML).toContain('Monophonic');
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

  it('still sends the whole path when the click lands on a highlighted part of it', async () => {
    // As soon as a filter matches inside a link its text is wrapped in <mark>, and that
    // <mark> is what a click on the highlighted characters targets. Reading the target's
    // own dataset would post nothing at all.
    await type(filter(), 'gain');
    const mark = pageEl().querySelector('a.link mark') as HTMLElement;
    expect(mark).not.toBeNull();
    posted.length = 0;
    await click(mark);
    expect(posted).toEqual([{ type: 'openFile', path: 'models/gain.slx' }]);
  });

  it('answers Enter and Space, which an <a> without href does not', () => {
    for (const key of ['Enter', ' ']) {
      posted.length = 0;
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      link('models/gain.slx').dispatchEvent(event);
      expect(posted, key).toEqual([{ type: 'openFile', path: 'models/gain.slx' }]);
      // Space scrolls the document by default, which is not what pressing it on a
      // focused control means.
      expect(event.defaultPrevented, key).toBe(true);
    }
  });

  it('ignores a key that is not an activation', () => {
    link('models/gain.slx').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(posted).toEqual([]);
  });

  it('asks for nothing when the click misses every link', async () => {
    await click(pageEl().querySelector('.section') as Element);
    expect(posted).toEqual([]);
  });

  it('opens a location and a reference the same way', async () => {
    await setProject({
      locations: [{ key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'work/cache' }],
      references: [{ name: 'Lib', path: '../Lib/Lib.prj' }],
    });
    posted.length = 0;
    await click(link('work/cache'));
    await click(link('../Lib/Lib.prj'));
    expect(posted).toEqual([
      { type: 'openFile', path: 'work/cache' },
      { type: 'openFile', path: '../Lib/Lib.prj' },
    ]);
  });
});

describe('filtering a section', () => {
  beforeEach(async () => {
    await setProject({ shortcuts: SHORTCUTS });
    posted.length = 0;
  });

  it('narrows the rows without asking the host for anything', async () => {
    await type(filter(), 'gain');
    expect(pageEl().innerHTML).toContain('gain.slx');
    expect(pageEl().innerHTML).not.toContain('s3.m');
    expect(posted).toEqual([]);
  });

  it('keeps the focus and the caret across the repaint it causes', async () => {
    // The repaint replaces the input element, so both have to be restored by hand.
    // Focus alone left the caret at 0, which typed a query backwards. (The document's own
    // activeElement is the element; what has the keyboard inside it is the shadow root's.)
    await type(filter(), 'gain', 2);
    expect(document.activeElement).toBe(element());
    expect(shadow().activeElement).toBe(filter());
    expect(filter().selectionStart).toBe(2);
    expect(filter().value).toBe('gain');
  });

  it('expands a capped section when asked, and stays expanded', async () => {
    await setProject({ pathFolders: Array.from({ length: ROW_CAP + 1 }, (_, i) => `f${i}`) });
    const rows = () => pageEl().querySelectorAll('.row.single').length;
    expect(rows()).toBe(ROW_CAP);
    await click(pageEl().querySelector('[data-expand="path"]') as Element);
    expect(rows()).toBe(ROW_CAP + 1);
    expect(posted).toEqual([]);
  });
});

describe('a repaint of the project already on screen', () => {
  beforeEach(async () => {
    await setProject({ shortcuts: SHORTCUTS });
    posted.length = 0;
  });

  it('keeps the filter a user typed', async () => {
    // The page repaints when the store changes on disk. A user who has narrowed a
    // section while working is not asking for that to be undone because something saved.
    await type(filter(), 'gain');
    await setProject({ shortcuts: SHORTCUTS });
    expect(filter().value).toBe('gain');
  });

  it('starts clean when a different project arrives in the panel', async () => {
    await type(filter(), 'gain');
    await setProject({ shortcuts: SHORTCUTS }, '/work/Other');
    expect(filter().value).toBe('');
    expect(pageEl().innerHTML).toContain('/work/Other');
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
