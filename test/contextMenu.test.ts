// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The right-click menu over a table row. The host builds the item list
// (menuItems.ts) and this component owns showing it, keyboard navigation, and
// relaying the chosen action back as a `dex-action` event carrying the item id
// — table-main.ts turns that id straight into a host message, so a wrong or
// missing id silently performs the wrong edit (or none).
import { describe, it, expect, afterEach } from 'vitest';
import { DexContextMenu, type ContextMenuItem } from '../src/webview/components/dex-context-menu.js';

// show() defers listener wiring + position clamping to a rAF, so every test has
// to let one frame pass before the menu is really interactive.
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

let menu: DexContextMenu | null = null;

function makeMenu(items: ContextMenuItem[], x = 10, y = 10): Promise<DexContextMenu> {
  menu = new DexContextMenu();
  document.body.appendChild(menu);
  menu.show(x, y, items);
  return frame().then(() => menu!.updateComplete).then(() => menu!);
}

// Every action the user takes arrives as a `dex-action`; collect the ids.
function recordActions(el: DexContextMenu): string[] {
  const ids: string[] = [];
  el.addEventListener('dex-action', (e) => ids.push((e as CustomEvent).detail.actionId));
  return ids;
}

function key(k: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

function itemEls(el: DexContextMenu): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>('.item'));
}

// The label of whichever item currently holds real DOM focus.
function focusedLabel(el: DexContextMenu): string | undefined {
  const active = el.shadowRoot!.activeElement as HTMLElement | null;
  return active?.querySelector('.item-label')?.textContent ?? undefined;
}

// The component's stylesheet as text. Some of what this redesign is are DECLARATIONS, and
// happy-dom has no layout engine — a measured width here would be 0 whatever the CSS says,
// so these are read rather than rendered. A test that admits what it checks beats one that
// measures nothing and looks like it does.
const CSS = DexContextMenu.styles.map((s) => (s as unknown as { cssText: string }).cssText).join('\n');
function ruleFor(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `the stylesheet still has a ${selector} rule`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf('}', at));
}

const ITEMS: ContextMenuItem[] = [
  { id: 'cut', label: 'Cut', icon: 'cut', shortcut: 'Cmd+X' },
  { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Cmd+C' },
  { id: 'sep1', label: '', separator: true },
  { id: 'paste', label: 'Paste', icon: 'paste', disabled: true },
  { id: 'delete', label: 'Delete', icon: 'delete' },
];

afterEach(() => {
  // close() must run before removal or the document-level listeners installed by
  // show() outlive the element and leak into the next test.
  menu?.close();
  menu?.remove();
  menu = null;
});

describe('showing and dismissing the menu', () => {
  it('renders one row per item plus separators, and reports itself open', async () => {
    const el = await makeMenu(ITEMS);
    expect(el.hasAttribute('open')).toBe(true);
    expect(itemEls(el).map((i) => i.querySelector('.item-label')!.textContent)).toEqual([
      'Cut', 'Copy', 'Paste', 'Delete',
    ]);
    expect(el.shadowRoot!.querySelectorAll('.separator').length).toBe(1);
  });

  it('Escape dismisses the menu', async () => {
    const el = await makeMenu(ITEMS);
    key('Escape');
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('a mousedown outside dismisses the menu', async () => {
    const el = await makeMenu(ITEMS);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('a mousedown ON the menu does not dismiss it', async () => {
    // Pressing on an item is the start of choosing it; dismissing here would
    // make the menu impossible to click.
    const el = await makeMenu(ITEMS);
    itemEls(el)[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('a right-click elsewhere dismisses the menu', async () => {
    // The new right-click will open its own menu; the stale one must go.
    const el = await makeMenu(ITEMS);
    document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('a right-click ON the menu leaves it open', async () => {
    // Right-clicking inside an open menu is not a request for a second menu; the
    // dismiss-on-contextmenu handler is document-wide, so without the
    // composedPath check it would tear down the menu the user is pointing at.
    const el = await makeMenu(ITEMS);
    itemEls(el)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('scrolling the table dismisses the menu', async () => {
    // The menu is position:fixed; if it survived a scroll it would point at
    // whatever row happened to move under it.
    const el = await makeMenu(ITEMS);
    window.dispatchEvent(new Event('scroll'));
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('stops responding to keys once closed', async () => {
    // A closed menu that still answers Enter would fire an action the user
    // never saw a menu for.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    el.close();
    key('ArrowDown');
    key('Enter');
    expect(ids).toEqual([]);
  });

  it('reopening replaces the previous items rather than appending', async () => {
    const el = await makeMenu(ITEMS);
    el.show(5, 5, [{ id: 'undo', label: 'Undo' }]);
    await frame();
    await el.updateComplete;
    expect(itemEls(el).map((i) => i.textContent!.trim())).toEqual(['Undo']);
  });
});

describe('choosing an item', () => {
  it('a click dispatches dex-action with that item id and closes', async () => {
    // table-main.ts forwards detail.actionId verbatim as the host message type.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    itemEls(el)[1].click();
    expect(ids).toEqual(['copy']);
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('the event crosses the shadow boundary to reach the host listener', async () => {
    // table-main.ts listens on the element itself, so the event must be
    // composed + bubbling or the menu appears inert.
    const el = await makeMenu(ITEMS);
    const seen: string[] = [];
    document.addEventListener('dex-action', (e) => seen.push((e as CustomEvent).detail.actionId));
    itemEls(el)[0].click();
    expect(seen).toEqual(['cut']);
  });

  it('clicking a disabled item fires nothing and leaves the menu open', async () => {
    // Paste is disabled when the clipboard is empty; acting on it would ask the
    // host to paste nothing.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    itemEls(el)[2].click(); // Paste
    expect(ids).toEqual([]);
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('marks a disabled item disabled for assistive tech and drops it from the tab order', async () => {
    const el = await makeMenu(ITEMS);
    const paste = itemEls(el)[2];
    expect(paste.getAttribute('aria-disabled')).toBe('true');
    expect(paste.getAttribute('tabindex')).toBe('-1');
    const copy = itemEls(el)[1];
    expect(copy.getAttribute('aria-disabled')).toBe('false');
    expect(copy.getAttribute('tabindex')).toBe('0');
  });

  it('exposes menu/menuitem/separator roles', async () => {
    const el = await makeMenu(ITEMS);
    expect(el.shadowRoot!.querySelector('.menu')!.getAttribute('role')).toBe('menu');
    expect(itemEls(el)[0].getAttribute('role')).toBe('menuitem');
    expect(el.shadowRoot!.querySelector('.separator')!.getAttribute('role')).toBe('separator');
  });
});

describe('keyboard navigation', () => {
  it('ArrowDown enters the menu at the first item and moves real DOM focus there', async () => {
    // Tracking a highlight index without focusing the element leaves a screen
    // reader silent while the user arrows through the menu.
    const el = await makeMenu(ITEMS);
    key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Cut');
    expect(el.shadowRoot!.querySelectorAll('.item.focused').length).toBe(1);
  });

  it('ArrowDown lands ON a disabled item rather than stepping over it', async () => {
    // Paste (disabled) sits between Copy and Delete. Windows menus stop there too, and
    // it is the only way a disabled item announces itself, or shows the tooltip holding
    // the reason it is disabled — skipping it hid the action's existence from everyone
    // not using a mouse.
    const el = await makeMenu(ITEMS);
    key('ArrowDown'); // Cut
    key('ArrowDown'); // Copy
    key('ArrowDown'); // Paste, disabled
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Paste');
    key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Delete');
  });

  it('Enter on a disabled item fires nothing and leaves the menu open', async () => {
    // The other half of arrowing onto one: reachable, still not actionable.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    key('ArrowDown'); // Cut
    key('ArrowDown'); // Copy
    key('ArrowDown'); // Paste, disabled
    key('Enter');
    expect(ids).toEqual([]);
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('marks a focused disabled item so the highlight does not vanish over it', async () => {
    // A skipped item needed no state of its own. One the keyboard can rest on does, or
    // passing over it reads as the menu having stopped responding.
    const el = await makeMenu(ITEMS);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown'); // Paste, disabled
    await el.updateComplete;
    const focused = el.shadowRoot!.querySelectorAll('.item.focused');
    expect(focused.length).toBe(1);
    expect(focused[0].classList.contains('disabled')).toBe(true);

    // And it must be marked with the SAME ring the :focus-visible rule draws. That rule is
    // one attribute plus one pseudo-class; this selector is three classes, so it wins
    // wherever both apply — pick a different ring here and the one item that most needs a
    // visible focus indication is the only item that never shows one.
    expect(ruleFor('.item.disabled.focused')).toMatch(/box-shadow:\s*inset var\(--dex-focus-ring/);
  });

  it('ArrowDown wraps from the last item back to the first', async () => {
    // One press per action item — four of them, the disabled Paste included — and the
    // fifth comes back round. The separator is not one of them.
    const el = await makeMenu(ITEMS);
    for (let i = 0; i < 4; i++) key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el), 'four presses reach the last item').toBe('Delete');
    key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Cut');
  });

  it('ArrowUp from the unentered state selects the last item', async () => {
    const el = await makeMenu(ITEMS);
    key('ArrowUp');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Delete');
  });

  it('ArrowUp walks back through every item, disabled ones included', async () => {
    const el = await makeMenu(ITEMS);
    key('ArrowUp'); // Delete
    key('ArrowUp'); // Paste, disabled
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Paste');
    key('ArrowUp');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Copy');
  });

  it('ArrowUp from a disabled FIRST item wraps to the last', async () => {
    // Add Child is disabled on a leaf row, so the first entry is often the disabled one.
    // Arrowing up off the top must reach the bottom, not stall.
    const el = await makeMenu([
      { id: 'addChild', label: 'Add Child', disabled: true },
      { id: 'copy', label: 'Copy' },
      { id: 'delete', label: 'Delete' },
    ]);
    key('ArrowDown'); // Add Child, disabled — entered, not skipped
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Add Child');
    key('ArrowUp');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Delete');
  });

  it('Enter activates the focused item', async () => {
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    key('ArrowDown');
    key('ArrowDown'); // Copy
    key('Enter');
    expect(ids).toEqual(['copy']);
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('Enter before any arrow key does nothing', async () => {
    // Opening the menu must not arm a default action the user never chose.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    key('Enter');
    expect(ids).toEqual([]);
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('Enter does nothing when the focused index outlived a shorter item list', async () => {
    // show() swaps _items synchronously but Lit re-renders on a microtask, so for
    // one tick the OLD rows are still mounted with their old indices. A pointer
    // resting over the previous menu while the host reopens a shorter one (a
    // right-click on a different row) stamps an index the new list has no item
    // at; Enter must then do nothing rather than dereference past the end.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    el.show(5, 5, [{ id: 'undo', label: 'Undo' }]);
    itemEls(el)[3].dispatchEvent(new MouseEvent('mouseenter')); // stale row -> index 3
    key('Enter');
    expect(ids).toEqual([]);
    await el.updateComplete;
    expect(itemEls(el).map((i) => i.textContent!.trim())).toEqual(['Undo']);
  });

  it('hovering an item makes it the keyboard-focused one', async () => {
    // Mouse and keyboard share one highlight, so a subsequent Enter acts on the
    // item the user is actually pointing at.
    const el = await makeMenu(ITEMS);
    const ids = recordActions(el);
    itemEls(el)[3].dispatchEvent(new MouseEvent('mouseenter')); // Delete
    key('Enter');
    expect(ids).toEqual(['delete']);
  });

  it('an all-disabled menu is still walkable, and still fires nothing', async () => {
    // A menu where every action is unavailable used to refuse focus entirely, which
    // left a keyboard user no way to learn what the greyed-out items even were. It is
    // navigable now; what it must not do is act.
    const el = await makeMenu([
      { id: 'cut', label: 'Cut', disabled: true },
      { id: 'delete', label: 'Delete', disabled: true },
    ]);
    const ids = recordActions(el);
    key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Cut');
    key('Enter');
    key('ArrowDown');
    await el.updateComplete;
    expect(focusedLabel(el)).toBe('Delete');
    key('Enter');
    expect(ids).toEqual([]);
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('arrowing an empty menu does not throw', async () => {
    const el = await makeMenu([]);
    expect(() => { key('ArrowDown'); key('ArrowUp'); key('Enter'); }).not.toThrow();
    expect(itemEls(el).length).toBe(0);
  });

  it('Arrow keys are consumed so the table behind does not scroll too', async () => {
    const el = await makeMenu(ITEMS);
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(el.hasAttribute('open')).toBe(true);
  });
});

describe('positioning near the viewport edge', () => {
  // happy-dom has no layout engine, so a real menu measures 0x0. Stub the
  // measurement to a realistic size to exercise the clamping arithmetic.
  function withSize(el: DexContextMenu, w: number, h: number): void {
    const node = el.shadowRoot!.querySelector('.menu') as HTMLElement;
    node.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  it('places the menu at the click point when it fits', async () => {
    const el = await makeMenu(ITEMS, 120, 80);
    withSize(el, 200, 160);
    el.show(120, 80, ITEMS);
    await frame();
    expect(el.style.left).toBe('120px');
    expect(el.style.top).toBe('80px');
  });

  it('shifts left/up so a menu opened near the bottom-right stays on screen', async () => {
    // Right-clicking the last row of a full table must not push half the menu
    // off the viewport where its items are unreachable.
    const el = await makeMenu(ITEMS);
    withSize(el, 200, 160);
    el.show(window.innerWidth - 20, window.innerHeight - 20, ITEMS);
    await frame();
    expect(el.style.left).toBe(`${window.innerWidth - 200 - 8}px`);
    expect(el.style.top).toBe(`${window.innerHeight - 160 - 8}px`);
  });

  it('a menu closed before its first frame does not throw while positioning', async () => {
    // show() defers clamping to a rAF, but close() does not cancel that frame —
    // and a closed menu renders nothing, so there is no .menu left to measure.
    // Reachable whenever something dismisses the menu in the same tick it opened
    // (a synthesised right-click during a host-driven refresh).
    //
    // The deferred callback is captured rather than awaited: it runs inside a rAF,
    // where a throw surfaces as an unhandled rejection that would NOT fail this
    // test. Calling it directly is what makes the assertion real.
    const realRaf = globalThis.requestAnimationFrame;
    let deferred: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { deferred = cb; return 1; }) as typeof realRaf;
    try {
      menu = new DexContextMenu();
      document.body.appendChild(menu);
      menu.show(10, 10, ITEMS);
      menu.close();
      await menu.updateComplete;
      expect(menu.shadowRoot!.querySelector('.menu')).toBeNull();
      expect(deferred).toBeTypeOf('function');
      expect(() => deferred!(0)).not.toThrow();
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
    expect(menu!.hasAttribute('open')).toBe(false);
  });

  it('never positions the menu off the top-left edge', async () => {
    // A menu wider or taller than the viewport would otherwise clamp negative.
    const el = await makeMenu(ITEMS);
    withSize(el, window.innerWidth + 400, window.innerHeight + 400);
    el.show(50, 50, ITEMS);
    await frame();
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
  });
});

describe('item content', () => {
  it('renders the shortcut hint next to the label', async () => {
    const el = await makeMenu(ITEMS);
    const shortcuts = Array.from(el.shadowRoot!.querySelectorAll('.item-shortcut')).map((s) => s.textContent);
    expect(shortcuts).toEqual(['Cmd+X', 'Cmd+C']);
  });

  it('renders an icon for each known icon name', async () => {
    // menuItems.ts only emits these names; a typo would silently drop the glyph.
    const known = ['addChild', 'cut', 'copy', 'paste', 'delete', 'save', 'saveAs', 'close', 'locate'];
    const el = await makeMenu(known.map((icon) => ({ id: icon, label: icon, icon })));
    expect(el.shadowRoot!.querySelectorAll('.item-icon svg').length).toBe(known.length);
  });

  it('keeps the icon slot (labels stay aligned) for an unknown or absent icon', async () => {
    const el = await makeMenu([
      { id: 'a', label: 'No icon' },
      { id: 'b', label: 'Bad icon', icon: 'notAnIcon' },
    ]);
    expect(el.shadowRoot!.querySelectorAll('.item-icon').length).toBe(2);
    expect(el.shadowRoot!.querySelectorAll('.item-icon svg').length).toBe(0);
  });

  it('renders a hostile label as text, not markup', async () => {
    // Item labels can embed an entry name that came from the opened file.
    const el = await makeMenu([{ id: 'x', label: '<img src=x onerror=alert(1)>' }]);
    const label = el.shadowRoot!.querySelector('.item-label')!;
    expect(label.querySelectorAll('img').length).toBe(0);
    expect(label.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('puts a disabled item’s reason in its tooltip, and leaves the row alone', async () => {
    // The reason used to occupy the shortcut slot, which made the menu's WIDTH depend on
    // which items happened to be disabled: these sentences run to ~45 characters, so one
    // selection opened a 200px menu and the next a 500px one. As a tooltip it costs the
    // row nothing, and `title` on an element named by its content is read out as that
    // element's accessible description — so it reaches a screen reader too, which the
    // visible column never did, because a disabled item could not be focused at all.
    const el = await makeMenu([
      { id: 'paste', label: 'Paste', shortcut: 'Cmd+V', disabled: true, reason: 'Bus cannot be in Design Data' },
    ]);
    const item = itemEls(el)[0];
    expect(item.getAttribute('title')).toBe('Bus cannot be in Design Data');
    // The accelerator keeps its slot; nothing in the row grew.
    expect(el.shadowRoot!.querySelector('.item-shortcut')!.textContent).toBe('Cmd+V');
  });

  it('the reason displaces a title, because why beats what on an unusable item', async () => {
    // Both can be set at once: Cut names a long entry (title) and is refused for a
    // reason. One tooltip slot, and the reason is the sentence the user is asking for.
    const el = await makeMenu([
      { id: 'cut', label: 'Cut "SomeVeryLongEntryNam…"', title: 'SomeVeryLongEntryNameIndeed', disabled: true, reason: "\"Element\" can't be cut" },
    ]);
    expect(itemEls(el)[0].getAttribute('title')).toBe("\"Element\" can't be cut");
  });

  it('shows the full label as the tooltip when the item is usable', async () => {
    const el = await makeMenu([
      { id: 'copy', label: 'Copy "SomeVeryLongEntryNam…"', title: 'SomeVeryLongEntryNameIndeed' },
    ]);
    expect(itemEls(el)[0].getAttribute('title')).toBe('SomeVeryLongEntryNameIndeed');
  });

  it('ignores a reason left on an ENABLED item', async () => {
    // `disabled` is what selects between the two, so a stale reason cannot shadow the
    // label's own tooltip — nor appear on an item that works.
    const el = await makeMenu([
      { id: 'paste', label: 'Paste', shortcut: 'Cmd+V', reason: 'ignored', title: 'Paste' },
    ]);
    expect(itemEls(el)[0].getAttribute('title')).toBe('Paste');
  });

  it('renders a hostile reason as an attribute value, not markup', async () => {
    // A reason embeds an entry name and a section label, both from the opened file.
    const el = await makeMenu([
      { id: 'x', label: 'Paste', disabled: true, reason: '<img src=x onerror=alert(1)>' },
    ]);
    const item = itemEls(el)[0];
    expect(item.getAttribute('title')).toBe('<img src=x onerror=alert(1)>');
    expect(el.shadowRoot!.querySelectorAll('img').length).toBe(0);
  });

  it('sets no title at all when there is nothing to say', async () => {
    // An empty `title=""` is a tooltip that flashes blank on hover.
    const el = await makeMenu([{ id: 'undo', label: 'Undo', shortcut: 'Cmd+Z' }]);
    expect(itemEls(el)[0].hasAttribute('title')).toBe(false);
  });
});

// The reported defect was the menu's SHAPE: it resized with the selection, because the
// widest string in it was a ~45-character sentence that only some items carried. Moving
// that sentence to a tooltip is half the fix; the other half is these three declarations,
// which together bound the width whatever the labels say. They are asserted as CSS text,
// not as measured boxes — happy-dom has no layout engine, so a rendered width here would
// be 0 either way, and a test that measures nothing is worse than one that admits it.
describe('a width that does not follow the selection', () => {
  it('bounds the menu at both ends rather than fitting it to its content', () => {
    // An upper bound alone would let a section menu shrink to a tooltip; a lower bound
    // alone is what shipped, and is what stretched.
    const menuRule = ruleFor('.menu');
    expect(menuRule).toMatch(/min-width:\s*220px/);
    expect(menuRule).toMatch(/max-width:\s*320px/);
  });

  it('clips the label, and only the label', () => {
    // `min-width: 0` is load-bearing: a flex item defaults to `min-width: auto` and
    // refuses to shrink below its content, so the ellipsis never engages and the max-width
    // above is overrun instead of respected. All three declarations or none.
    const label = ruleFor('.item-label');
    expect(label).toMatch(/min-width:\s*0/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/white-space:\s*nowrap/);
  });

  it('never gives way on the accelerator', () => {
    // Four characters, unreadable clipped — the label absorbs the shortfall instead. The
    // old `max-width` here existed to cap the REASON text this slot used to hold; with
    // the reason gone it would only have invited the shortcut to wrap.
    const shortcut = ruleFor('.item-shortcut');
    expect(shortcut).toMatch(/flex-shrink:\s*0/);
    expect(shortcut).not.toMatch(/max-width/);
  });
});
