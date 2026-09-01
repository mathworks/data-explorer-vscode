// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The modal shown when the host rejects a cell edit (`validationError` in
// table-main.ts): it names the entered value, the value that was restored, and
// optionally offers Revert. Because it is an aria-modal alertdialog painted over
// a blocking backdrop, the user MUST always be able to get out of it by keyboard
// — an unclosable dialog wedges the whole editor tab.
import { describe, it, expect, afterEach } from 'vitest';
import { DexErrorDialog } from '../src/webview/components/dex-error-dialog.js';

let dialog: DexErrorDialog | null = null;

// show() focuses a button from a microtask after the first render, so tests must
// let both the Lit update and that continuation settle.
async function makeDialog(opts: Parameters<DexErrorDialog['show']>[0] = {}): Promise<DexErrorDialog> {
  dialog = new DexErrorDialog();
  document.body.appendChild(dialog);
  dialog.show(opts);
  await dialog.updateComplete;
  await Promise.resolve();
  return dialog;
}

function buttons(el: DexErrorDialog): HTMLButtonElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button'));
}

function buttonNamed(el: DexErrorDialog, label: string): HTMLButtonElement {
  return buttons(el).find((b) => b.textContent === label)!;
}

function focusedButton(el: DexErrorDialog): string | undefined {
  return (el.shadowRoot!.activeElement as HTMLElement | null)?.textContent ?? undefined;
}

function key(k: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

function text(el: DexErrorDialog, sel: string): string | undefined {
  return el.shadowRoot!.querySelector(sel)?.textContent ?? undefined;
}

afterEach(() => {
  // hide() detaches the document-level key listener show() installed; skipping it
  // would leak a live Tab/Escape handler into the next test.
  dialog?.hide();
  dialog?.remove();
  dialog = null;
});

describe('what the dialog tells the user', () => {
  it('shows the reason, the rejected value and the restored value', async () => {
    // These three facts are the whole point: what went wrong, what the user
    // typed, and what the cell now holds.
    const el = await makeDialog({
      title: 'Invalid Value',
      reason: 'DataType must be a built-in type.',
      invalidValue: 'int9',
      validValue: 'int8',
    });
    expect(text(el, '.title')).toBe('Invalid Value');
    expect(text(el, '.message')).toBe('DataType must be a built-in type.');
    const values = Array.from(el.shadowRoot!.querySelectorAll('.value')).map((v) => v.textContent);
    expect(values).toEqual(['int9', 'int8']);
  });

  it('falls back to a generic title and reason when the host supplies neither', async () => {
    // A rejected edit with no message must still explain itself, not show a
    // blank modal.
    const el = await makeDialog({});
    expect(text(el, '.title')).toBe('Invalid Value');
    expect(text(el, '.message')).toBe('The entered value is not valid.');
  });

  it('omits the values block entirely when there are no values to show', async () => {
    const el = await makeDialog({ reason: 'Cannot save while parsing.' });
    expect(el.shadowRoot!.querySelector('.values')).toBeNull();
    expect(el.shadowRoot!.querySelector('.detail')).toBeNull();
  });

  it('shows only the entered value when there is no previous value', async () => {
    // Editing a cell that was empty has nothing to restore.
    const el = await makeDialog({ invalidValue: 'oops' });
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Entered: oops']);
  });

  it('shows only the previous value when the rejected edit was empty', async () => {
    // Clearing a required cell submits ''. The values block still has something
    // worth showing — what the cell was put back to — and rendering the Entered
    // row for an empty string would just read "Entered:" with nothing after it.
    const el = await makeDialog({ validValue: 'int8' });
    const rows = Array.from(el.shadowRoot!.querySelectorAll('.row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Previous: int8']);
  });

  it('renders the optional detail block (e.g. an underlying parser message)', async () => {
    const el = await makeDialog({ reason: 'Bad value', detail: 'at line 12, column 4' });
    expect(text(el, '.detail')).toBe('at line 12, column 4');
  });

  it('announces itself as a modal alert dialog', async () => {
    // Without these roles a screen reader never tells the user their edit was
    // rejected — the modal is purely visual.
    const el = await makeDialog({ reason: 'x' });
    const d = el.shadowRoot!.querySelector('.dialog')!;
    expect(d.getAttribute('role')).toBe('alertdialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
  });

  it('renders nothing at all while closed', async () => {
    const el = await makeDialog({ reason: 'x' });
    el.hide();
    await el.updateComplete;
    expect(el.hasAttribute('open')).toBe(false);
    expect(el.shadowRoot!.querySelector('.dialog')).toBeNull();
  });

  it('renders host strings as text, not markup', async () => {
    // reason/detail/values can quote content straight out of the opened file, so
    // they must never be able to inject nodes into the dialog.
    const el = await makeDialog({
      reason: '<b>bold</b>',
      detail: '<script>alert(1)</script>',
      invalidValue: '<img src=x onerror=alert(1)>',
    });
    expect(el.shadowRoot!.querySelectorAll('.message b').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.detail script').length).toBe(0);
    expect(el.shadowRoot!.querySelectorAll('.value img').length).toBe(0);
    expect(text(el, '.message')).toBe('<b>bold</b>');
  });

  it('reusing the dialog replaces the previous error instead of merging with it', async () => {
    // table-main.ts holds one long-lived instance, so a second rejection must
    // not leave the first error's values on screen.
    const el = await makeDialog({ reason: 'first', invalidValue: 'a', validValue: 'b', detail: 'd' });
    el.hide();
    el.show({ reason: 'second' });
    await el.updateComplete;
    expect(text(el, '.message')).toBe('second');
    expect(el.shadowRoot!.querySelector('.values')).toBeNull();
    expect(el.shadowRoot!.querySelector('.detail')).toBeNull();
  });
});

describe('dismissing the dialog', () => {
  it('OK closes it', async () => {
    const el = await makeDialog({ reason: 'x' });
    buttonNamed(el, 'OK').click();
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('Escape closes it', async () => {
    const el = await makeDialog({ reason: 'x' });
    key('Escape');
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('Escape closes it even when focus has left the dialog', async () => {
    // Regression: the Escape handler was bound only on the inner .dialog node,
    // so if anything moved focus out (a webview refocus, a click on the
    // backdrop) Escape stopped working and the blocking overlay could not be
    // dismissed by keyboard at all.
    const el = await makeDialog({ reason: 'x' });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    key('Escape');
    expect(el.hasAttribute('open')).toBe(false);
    outside.remove();
  });

  it('clicking the backdrop closes it', async () => {
    const el = await makeDialog({ reason: 'x' });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('clicking inside the dialog does not close it', async () => {
    // Selecting the offending value to copy it must not dismiss the message.
    const el = await makeDialog({ reason: 'x', invalidValue: 'int9' });
    el.shadowRoot!.querySelector('.value')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(el.hasAttribute('open')).toBe(true);
  });

  it('a click that merely bubbles up to the host does not close it', async () => {
    // Content clicks are kept in by two independent guards: .dialog stops
    // propagation (covered above) and the host handler dismisses only when the
    // host — the backdrop itself — is the target. This covers the second one, so
    // that adding a slot or dropping the inner stopPropagation cannot silently
    // turn every click on the message into a dismissal.
    const el = await makeDialog({ reason: 'x' });
    const child = document.createElement('span');
    el.appendChild(child);
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.hasAttribute('open')).toBe(true);
    child.remove();
  });

  it('leaves keys other than Escape and Tab alone', async () => {
    // The key handler is bound on the document in CAPTURE while the dialog is
    // open, so it sees every keystroke in the webview before anything else does.
    // Anything it does not own must pass straight through — swallowing Ctrl/Cmd+C
    // would stop the user copying the value the dialog is complaining about.
    const el = await makeDialog({ reason: 'x', invalidValue: 'int9' });
    for (const init of [{ key: 'c', ctrlKey: true }, { key: 'c', metaKey: true }, { key: 'ArrowDown' }, { key: 'Enter' }]) {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(el.hasAttribute('open')).toBe(true);
    }
  });

  it('ignores Escape once already closed', async () => {
    const el = await makeDialog({ reason: 'x' });
    el.hide();
    expect(() => key('Escape')).not.toThrow();
    expect(el.hasAttribute('open')).toBe(false);
  });
});

describe('the Revert action', () => {
  it('is absent unless the host asks for it', async () => {
    const el = await makeDialog({ reason: 'x' });
    expect(buttons(el).map((b) => b.textContent)).toEqual(['OK']);
  });

  it('dispatches dex-revert across the shadow boundary, then closes', async () => {
    // The host listens on the element for this event to roll the edit back; if
    // it did not escape the shadow root the button would do nothing.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    const seen: string[] = [];
    document.addEventListener('dex-revert', () => seen.push('revert'));
    buttonNamed(el, 'Revert').click();
    expect(seen).toEqual(['revert']);
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('OK does not fire dex-revert', async () => {
    // OK means "I've read this"; only Revert may discard the user's edit.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    const seen: string[] = [];
    el.addEventListener('dex-revert', () => seen.push('revert'));
    buttonNamed(el, 'OK').click();
    expect(seen).toEqual([]);
  });
});

describe('keyboard focus', () => {
  it('focuses OK on open, never the destructive Revert button', async () => {
    // Regression: show() focused the FIRST button in the shadow root, which is
    // Revert whenever showRevert is set. A reflex Enter on an autofocused
    // Revert silently discarded the edit the user had just typed.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    expect(focusedButton(el)).toBe('OK');
  });

  it('focuses OK on open when it is the only button', async () => {
    const el = await makeDialog({ reason: 'x' });
    expect(focusedButton(el)).toBe('OK');
  });

  it('Tab cycles within the dialog instead of escaping behind the backdrop', async () => {
    // Regression: nothing trapped Tab, so despite aria-modal the user tabbed
    // straight into the table underneath — visible through the overlay but not
    // clickable, with no way back to the dialog's own buttons.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    key('Tab');
    expect(focusedButton(el)).toBe('Revert');
    key('Tab');
    expect(focusedButton(el)).toBe('OK');
  });

  it('Shift+Tab cycles backwards within the dialog', async () => {
    const el = await makeDialog({ reason: 'x', showRevert: true });
    key('Tab', { shiftKey: true });
    expect(focusedButton(el)).toBe('Revert');
  });

  it('Tab pulls focus back in after it has been dropped inside the dialog', async () => {
    // Clicking the message text (which deliberately does NOT dismiss) leaves the
    // dialog open with nothing focused inside it. Tab must then land on a button
    // rather than doing nothing — with no focus to advance from, "nowhere" is
    // exactly the state a keyboard user has to escape.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    (el.shadowRoot!.activeElement as HTMLElement).blur();
    expect(focusedButton(el)).toBeUndefined();
    key('Tab');
    expect(focusedButton(el)).toBe('Revert');
  });

  it('Tab is a no-op in the gap between show() and the first render', async () => {
    // show() flips _open and installs the document key listener SYNCHRONOUSLY,
    // but Lit renders the buttons on a microtask. A Tab that arrives in that gap
    // finds an empty shadow root; it must return rather than index into nothing.
    // Reachable in practice because show() runs from a host message while the
    // user may already be holding Tab.
    dialog = new DexErrorDialog();
    document.body.appendChild(dialog);
    dialog.show({ reason: 'x' });
    expect(dialog.shadowRoot!.querySelectorAll('button').length).toBe(0);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    expect(() => document.dispatchEvent(ev)).not.toThrow();
    // Not swallowed: there is nothing in the dialog to trap focus on yet.
    expect(ev.defaultPrevented).toBe(false);
    await dialog.updateComplete;
    await Promise.resolve();
    expect(focusedButton(dialog)).toBe('OK');
  });

  it('returns focus to the cell the user was editing when it closes', async () => {
    // The dialog interrupts an edit; on dismissal the user must land back where
    // they were rather than at the top of the table.
    const cell = document.createElement('input');
    document.body.appendChild(cell);
    const el = await makeDialog({ reason: 'x', returnFocusTo: cell });
    el.hide();
    expect(document.activeElement).toBe(cell);
    cell.remove();
  });

  it('captures the focused element itself when the host names no return target', async () => {
    const cell = document.createElement('input');
    document.body.appendChild(cell);
    cell.focus();
    const el = await makeDialog({ reason: 'x' });
    el.hide();
    expect(document.activeElement).toBe(cell);
    cell.remove();
  });

  it('captures the focused element from inside another component shadow root', async () => {
    // The edit that triggered the error lives in the tree table's shadow DOM, so
    // document.activeElement is the table host, not the input. Without piercing
    // the shadow root focus would return to the whole table and the user would
    // lose their place in it.
    const wrapper = document.createElement('div');
    wrapper.attachShadow({ mode: 'open' });
    const inner = document.createElement('input');
    wrapper.shadowRoot!.appendChild(inner);
    document.body.appendChild(wrapper);
    inner.focus();
    const el = await makeDialog({ reason: 'x' });
    el.hide();
    expect(wrapper.shadowRoot!.activeElement).toBe(inner);
    wrapper.remove();
  });

  it('does not throw when the return target was removed while the dialog was up', async () => {
    // A host-pushed setRows re-renders the table, so the original cell element
    // can be gone by the time the user dismisses the dialog.
    const cell = document.createElement('input');
    document.body.appendChild(cell);
    const el = await makeDialog({ reason: 'x', returnFocusTo: cell });
    cell.remove();
    expect(() => el.hide()).not.toThrow();
    expect(el.hasAttribute('open')).toBe(false);
  });

  it('stops trapping Tab once closed', async () => {
    // A closed dialog that still swallowed Tab would break navigation in the
    // table for the rest of the session.
    const el = await makeDialog({ reason: 'x', showRevert: true });
    el.hide();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
