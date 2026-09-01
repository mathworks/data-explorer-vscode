// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Properties side panel. The host builds grouped name/value rows from the
// selected node (piBuilder.ts) and pushes them in as `groups`; this component
// renders them and reports back two things the host acts on: an edited value
// (`dex-property-changed`) and a clicked cross-reference (`dex-pi-navigate`).
import { describe, it, expect, afterEach } from 'vitest';
import { DexPropertyInspector, type PropertyGroup } from '../src/webview/components/dex-property-inspector.js';

let pi: DexPropertyInspector | null = null;

async function makeInspector(groups: PropertyGroup[]): Promise<DexPropertyInspector> {
  pi = new DexPropertyInspector();
  document.body.appendChild(pi);
  pi.groups = groups;
  await pi.updateComplete;
  return pi;
}

// Re-push groups the way the host does on every selection change.
async function setGroups(el: DexPropertyInspector, groups: PropertyGroup[]): Promise<void> {
  el.groups = groups;
  await el.updateComplete;
}

function rowTexts(el: DexPropertyInspector): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.prop-row')).map((r) =>
    r.textContent!.replace(/\s+/g, ' ').trim(),
  );
}

function groupTitles(el: DexPropertyInspector): string[] {
  return Array.from(el.shadowRoot!.querySelectorAll('.group-header')).map((h) => h.textContent!);
}

const GROUPS: PropertyGroup[] = [
  {
    title: 'Simulink.Parameter',
    properties: [
      { name: 'Value', value: '42', type: 'text' },
      { name: 'DataType', value: 'int8', type: 'text' },
    ],
  },
  {
    title: 'Usage',
    properties: [{ name: 'controller.slx', value: 'Model', type: 'link', linkTarget: 'slx:controller' }],
  },
];

afterEach(() => {
  pi?.remove();
  pi = null;
});

describe('rendering the selected node', () => {
  it('renders each group with its properties in host order', async () => {
    // The host's grouping is the user's mental model of the object; reordering
    // or dropping a group misrepresents the node.
    const el = await makeInspector(GROUPS);
    expect(groupTitles(el)).toEqual(['Simulink.Parameter', 'Usage']);
    expect(rowTexts(el)).toEqual(['Value 42', 'DataType int8', 'controller.slx Model']);
  });

  it('renders a read-only property as plain text, not an input', async () => {
    // piBuilder ships editable:false for every property today, so nothing in the
    // panel may look typeable.
    const el = await makeInspector([{ title: 'G', properties: [{ name: 'Value', value: '42' }] }]);
    expect(el.shadowRoot!.querySelector('input')).toBeNull();
    expect(el.shadowRoot!.querySelector('.prop-value')!.textContent).toBe('42');
  });

  it('exposes the full property name as a tooltip because the column ellipsizes', async () => {
    const el = await makeInspector([
      { title: 'G', properties: [{ name: 'CoderInfoStorageClassSpecification', value: 'Auto' }] },
    ]);
    expect(el.shadowRoot!.querySelector('.prop-name')!.getAttribute('title')).toBe(
      'CoderInfoStorageClassSpecification',
    );
  });

  it('renders an empty value without collapsing the row', async () => {
    // Unset properties are common (an empty Min/Max); the name must still show.
    const el = await makeInspector([{ title: 'G', properties: [{ name: 'Min', value: '' }] }]);
    expect(rowTexts(el)).toEqual(['Min']);
    expect(el.shadowRoot!.querySelector('.prop-name')!.textContent).toBe('Min');
  });
});

describe('empty and absent input', () => {
  it('renders an empty panel when nothing is selected', async () => {
    // pi-main.ts pushes [] and hides the element; the component must not throw
    // on the way there.
    const el = await makeInspector([]);
    expect(el.shadowRoot!.querySelector('.content')).not.toBeNull();
    expect(rowTexts(el)).toEqual([]);
  });

  it('renders a group that has no properties', async () => {
    // A node can expose a group the schema declares but populates with nothing.
    const el = await makeInspector([{ title: 'Code Generation', properties: [] }]);
    expect(groupTitles(el)).toEqual(['Code Generation']);
    expect(rowTexts(el)).toEqual([]);
  });

  it('clears the previous node when the selection changes to an empty one', async () => {
    // Stale properties left over from the previously selected entry would
    // describe the wrong object.
    const el = await makeInspector(GROUPS);
    await setGroups(el, []);
    expect(rowTexts(el)).toEqual([]);
    expect(groupTitles(el)).toEqual([]);
  });

  it('replaces rather than appends when the selection changes', async () => {
    const el = await makeInspector(GROUPS);
    await setGroups(el, [{ title: 'Simulink.Signal', properties: [{ name: 'Unit', value: 'm/s' }] }]);
    expect(groupTitles(el)).toEqual(['Simulink.Signal']);
    expect(rowTexts(el)).toEqual(['Unit m/s']);
  });
});

describe('cross-reference links', () => {
  it('clicking a link asks the host to navigate to its target', async () => {
    // The target lives in another file/webview, so navigation is host-mediated;
    // detail.sourceId is what the host resolves.
    const el = await makeInspector(GROUPS);
    const seen: unknown[] = [];
    el.addEventListener('dex-pi-navigate', (e) => seen.push((e as CustomEvent).detail));
    (el.shadowRoot!.querySelector('.prop-link') as HTMLElement).click();
    expect(seen).toEqual([{ sourceId: 'slx:controller' }]);
  });

  it('the navigate event escapes the shadow root to reach the host', async () => {
    const el = await makeInspector(GROUPS);
    const seen: unknown[] = [];
    document.addEventListener('dex-pi-navigate', (e) => seen.push((e as CustomEvent).detail));
    (el.shadowRoot!.querySelector('.prop-link') as HTMLElement).click();
    expect(seen).toEqual([{ sourceId: 'slx:controller' }]);
  });

  it('falls back to the property name when the host supplied no linkTarget', async () => {
    // piBuilder leaves linkTarget undefined for a link whose target is its own
    // name; sending an empty id would make the click a silent no-op.
    const el = await makeInspector([
      { title: 'G', properties: [{ name: 'controller.slx', value: 'Model', type: 'link' }] },
    ]);
    const seen: unknown[] = [];
    el.addEventListener('dex-pi-navigate', (e) => seen.push((e as CustomEvent).detail));
    (el.shadowRoot!.querySelector('.prop-link') as HTMLElement).click();
    expect(seen).toEqual([{ sourceId: 'controller.slx' }]);
  });

  it('puts the single clickable anchor on the referenced object name', async () => {
    // For a Usage row the NAME is the referenced object (piBuilder puts the link
    // on it) and the value is a muted descriptor, so exactly one anchor exists
    // and it must be the name.
    const el = await makeInspector(GROUPS);
    expect(el.shadowRoot!.querySelectorAll('.prop-link').length).toBe(1);
    expect(el.shadowRoot!.querySelector('.prop-name .prop-link')!.textContent).toBe('controller.slx');
    const linkRow = el.shadowRoot!.querySelector('.prop-name .prop-link')!.closest('.prop-row')!;
    expect(linkRow.querySelector('.prop-value')!.classList.contains('prop-status')).toBe(true);
  });

  it('suppresses the anchor default so the webview does not navigate away', async () => {
    // These are href="#" anchors: letting the click through would scroll or
    // reload the webview instead of selecting the target row.
    const el = await makeInspector(GROUPS);
    const link = el.shadowRoot!.querySelector('.prop-link') as HTMLElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not turn a plain text property into a link', async () => {
    const el = await makeInspector([{ title: 'G', properties: [{ name: 'Value', value: '42' }] }]);
    expect(el.shadowRoot!.querySelectorAll('.prop-link').length).toBe(0);
  });

  it('never renders a link value as an input, even without a linkTarget', async () => {
    // A link row takes a separate template from the value-cell renderer, so the
    // editable/link precedence lives in exactly one place. If a link ever leaked
    // into the value cell the user would get a text box over a cross-reference.
    const el = await makeInspector([
      { title: 'G', properties: [{ name: 'a.slx', value: 'Model', type: 'link', editable: true }] },
    ]);
    expect(el.shadowRoot!.querySelector('input')).toBeNull();
    // The anchor is the name; the value stays a muted status string.
    expect(el.shadowRoot!.querySelector('.prop-name .prop-link')!.textContent).toBe('a.slx');
    expect(el.shadowRoot!.querySelector('.prop-value')!.textContent).toBe('Model');
  });

  it('omits the name tooltip on a link row, whose name is already the anchor text', async () => {
    // The ellipsizing title= belongs to the plain-name template; a link row shows
    // its name as clickable text instead, so it must not also carry the attribute.
    const el = await makeInspector(GROUPS);
    const linkName = el.shadowRoot!.querySelector('.prop-name .prop-link')!.closest('.prop-name')!;
    expect(linkName.hasAttribute('title')).toBe(false);
  });

  it('routes each link to its own target when several are listed', async () => {
    // A Usage group lists every referencing file; clicking the second must not
    // navigate to the first (a stale closure over the wrong row).
    const el = await makeInspector([
      {
        title: 'Usage',
        properties: [
          { name: 'a.slx', value: 'Model', type: 'link', linkTarget: 'slx:a' },
          { name: 'b.slx', value: 'Model', type: 'link', linkTarget: 'slx:b' },
        ],
      },
    ]);
    const seen: unknown[] = [];
    el.addEventListener('dex-pi-navigate', (e) => seen.push((e as CustomEvent).detail));
    const links = el.shadowRoot!.querySelectorAll<HTMLElement>('.prop-link');
    links[1].click();
    links[0].click();
    expect(seen).toEqual([{ sourceId: 'slx:b' }, { sourceId: 'slx:a' }]);
  });

  it('mixes link and text rows within one group in host order', async () => {
    // piBuilder can emit both kinds in the same group; the two templates must not
    // reorder or drop rows relative to each other.
    const el = await makeInspector([
      {
        title: 'G',
        properties: [
          { name: 'Value', value: '42' },
          { name: 'a.slx', value: 'Model', type: 'link', linkTarget: 'slx:a' },
          { name: 'DataType', value: 'int8' },
        ],
      },
    ]);
    expect(rowTexts(el)).toEqual(['Value 42', 'a.slx Model', 'DataType int8']);
    expect(el.shadowRoot!.querySelectorAll('.prop-link').length).toBe(1);
  });
});

describe('editing a property', () => {
  const EDITABLE: PropertyGroup[] = [
    { title: 'G', properties: [{ name: 'Value', value: '42', editable: true }] },
  ];

  it('renders an input seeded with the current value', async () => {
    const el = await makeInspector(EDITABLE);
    expect((el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement).value).toBe('42');
  });

  it('committing an edit reports the new AND old value to the host', async () => {
    // The host needs the old value to validate the change and to roll it back if
    // the write is rejected; losing it would make a bad edit unrecoverable.
    const el = await makeInspector(EDITABLE);
    const seen: unknown[] = [];
    el.addEventListener('dex-property-changed', (e) => seen.push((e as CustomEvent).detail));
    const input = el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement;
    input.value = '99';
    input.dispatchEvent(new Event('change'));
    expect(seen).toEqual([{ propName: 'Value', newValue: '99', oldValue: '42' }]);
  });

  it('the change event escapes the shadow root to reach the host', async () => {
    const el = await makeInspector(EDITABLE);
    const seen: unknown[] = [];
    document.addEventListener('dex-property-changed', (e) => seen.push((e as CustomEvent).detail));
    const input = el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('change'));
    expect(seen).toEqual([{ propName: 'Value', newValue: '7', oldValue: '42' }]);
  });

  it('reports an emptied field as an empty string rather than skipping it', async () => {
    // Clearing a property is a real edit (unset the value); dropping it would
    // leave the panel disagreeing with the file.
    const el = await makeInspector(EDITABLE);
    const seen: unknown[] = [];
    el.addEventListener('dex-property-changed', (e) => seen.push((e as CustomEvent).detail));
    const input = el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(seen).toEqual([{ propName: 'Value', newValue: '', oldValue: '42' }]);
  });

  it('snaps the field back when the host re-pushes the unchanged value', async () => {
    // A rejected edit: the host re-sends the original groups. Without live() Lit
    // would consider the value prop unchanged and leave the user's invalid text
    // sitting in the box as though it had been accepted.
    const el = await makeInspector(EDITABLE);
    const input = el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement;
    input.value = 'bogus';
    input.dispatchEvent(new Event('change'));
    await setGroups(el, [{ title: 'G', properties: [{ name: 'Value', value: '42', editable: true }] }]);
    expect((el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement).value).toBe('42');
  });

  it('shows an accepted new value after the host confirms it', async () => {
    const el = await makeInspector(EDITABLE);
    await setGroups(el, [{ title: 'G', properties: [{ name: 'Value', value: '99', editable: true }] }]);
    expect((el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement).value).toBe('99');
  });

  it('prefers the link rendering when a property is both a link and editable', async () => {
    // A cross-reference is not user-typeable; offering an input would invite an
    // edit the host cannot apply.
    const el = await makeInspector([
      { title: 'G', properties: [{ name: 'a.slx', value: 'Model', type: 'link', editable: true }] },
    ]);
    expect(el.shadowRoot!.querySelector('input')).toBeNull();
    expect(el.shadowRoot!.querySelector('.prop-link')).not.toBeNull();
  });
});

describe('host-supplied strings are never markup', () => {
  it('renders hostile group titles, names and values as text', async () => {
    // Every string here originates in the opened .sldd/.slx, i.e. untrusted
    // file content rendered inside the webview.
    const el = await makeInspector([
      {
        title: '<h1>title</h1>',
        properties: [
          { name: '<i>name</i>', value: '<img src=x onerror=alert(1)>' },
          { name: '<svg onload=alert(1)>', value: 'ref', type: 'link' },
        ],
      },
    ]);
    expect(el.shadowRoot!.querySelectorAll('.group-header h1').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.prop-name i').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.prop-value img').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.prop-name svg').length).toBe(0);
    expect(groupTitles(el)).toEqual(['<h1>title</h1>']);
  });

  it('renders a hostile value into an editable input as its value, not markup', async () => {
    const el = await makeInspector([
      { title: 'G', properties: [{ name: 'V', value: '"><img src=x>', editable: true }] },
    ]);
    const input = el.shadowRoot!.querySelector('input.prop-input') as HTMLInputElement;
    expect(input.value).toBe('"><img src=x>');
    expect(el.shadowRoot!.querySelectorAll('img').length).toBe(0);
  });
});
