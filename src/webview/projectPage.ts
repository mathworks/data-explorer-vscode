// Copyright 2026 The MathWorks, Inc.
//
// The markup of a project's main page, as a pure function of the payload plus the
// per-section filter state. No DOM, no postMessage, no vscode — project-main.ts owns
// all three, so everything about WHAT the page says is testable on a string.
//
// Why a page rather than a table: a `.prj` is a 150-byte marker file, MATLAB opens no
// document tab for one, and the folder tree a table would show is already in VS Code's
// Explorer. What is nowhere else is everything around the file list — which files run
// on open and close and in which order, the shortcuts and their groups, the MATLAB
// path, where cache and generated code go, which labels the project defines and how
// much of it they cover. See core's ProjectPage.ts.

import type { ProjectPage, ProjectPageLabel } from 'data-explorer-core';
import type { MspDictionary, MspProject } from '../common/msp.js';
import { MSP_ROLE_LABEL } from '../common/msp.js';
import type { WarningBanner } from '../host/parseWarnings.js';

/** A filter box appears above this many items. */
export const FILTER_THRESHOLD = 8;

/** Rows rendered before a "Show all" button takes over. */
export const ROW_CAP = 30;

/** What the project root is called in a list of path folders. */
const ROOT_LABEL = '(project root)';

/** Per-section UI state, owned by the caller so a repaint does not reset it. */
export interface SectionState {
  query: string;
  expanded: boolean;
}

/** Every section's state, keyed by section id. */
export type PageState = Record<string, SectionState>;

export function newSectionState(): SectionState {
  return { query: '', expanded: false };
}

/**
 * Everything that reaches the markup, escaped — the page's single rule.
 *
 * Numbers are accepted, not just strings, so a count is escaped by the same call as
 * the name beside it. Counts look exempt — a count is declared a number, and a number
 * cannot carry a `<` — but that type is a claim core's parser makes, and this
 * page sits on the far side of a postMessage boundary, where the payload is JSON and
 * nothing re-checks the declaration. While this took `string` only, a count could not
 * use it and was concatenated bare instead; `memberCount` then rendered escaped in the
 * identity block and raw in the Labels header, one field under two rules, and the
 * second was the wrong one (CodeQL js/xss, 2026-10-01).
 *
 * `null` is NOT in the parameter type and must not be added. `memberCount` and friends are
 * nullable for a format that records no member list, and this signature is what turns one
 * of them reaching the markup into a compile error at the call site instead of the word
 * 'null' on a customer's page — core's ProjectPage.memberCount relies on that by name.
 * Widening here, or defaulting the argument, moves the decision out of the renderer that
 * has to make it (see labelsSection).
 *
 * `'` is deliberately absent: every attribute written here is double-quoted, and the
 * test that pins that is the reminder to keep it so.
 */
export function esc(s: string | number): string {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * Split a filter query into terms.
 *
 * Bare terms only: whitespace-separated, case-insensitive substring, ANDed. This is
 * deliberately NOT the table's `rowFilter.ts` grammar, which is column-aware
 * (`Name:foo`, comparison operators) and needs each row to be a record of named
 * columns. A page section is not a table — Project Path rows have one field, Labels
 * are chips and are not filtered at all — so adopting that grammar would mean
 * inventing column names per section to expose a syntax nobody asked for. What IS
 * shared is the part a user actually types: several words, all of which must appear.
 */
export function filterTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesTerms(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((t) => lower.includes(t));
}

/**
 * Escaped `text` with every occurrence of every term wrapped in `<mark>`.
 *
 * Overlapping and adjacent hits are merged before wrapping. Two terms that overlap
 * in one word (`sup` and `upp` in "support") would otherwise emit nested or
 * interleaved marks, i.e. broken markup, from input the user typed by accident.
 */
export function highlight(text: string, terms: string[]): string {
  if (!terms.length) {
    return esc(text);
  }
  const lower = text.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i !== -1) {
      spans.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  if (!spans.length) {
    return esc(text);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [spans[0]];
  for (const s of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s[0] <= last[1]) {
      last[1] = Math.max(last[1], s[1]);
    } else {
      merged.push(s);
    }
  }
  let out = '';
  let at = 0;
  for (const [a, b] of merged) {
    out += esc(text.slice(at, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
    at = b;
  }
  return out + esc(text.slice(at));
}

/** One row of a list section. `search` is the text the filter matches against. */
interface Item {
  search: string;
  /** Group heading this row belongs under, '' for none. */
  group: string;
  html: (terms: string[]) => string;
}

/**
 * A link to something in the project.
 *
 * `data-open` carries the project-root-relative path, and is the ONLY thing the
 * click handler reads — the visible text may be filtered, highlighted or truncated,
 * so it is not a reliable source for the path. Every link is an `<a>` with no href:
 * a real href would navigate the webview away from itself, and there is nothing to
 * navigate to, since opening the file is a host action.
 */
function link(path: string, terms: string[], title: string, opts?: LinkOpts): string {
  return (
    '<a class="link" role="button" tabindex="0" data-open="' +
    esc(path) +
    '"' +
    (opts?.project ? ' data-prj=""' : '') +
    ' title="' +
    esc(title) +
    '">' +
    highlight(opts?.text ?? path, terms) +
    '</a>'
  );
}

/**
 * `project`: this path names a project folder and the click means "open the project in
 * it" — see `preferProject` in protocol.ts. `text`: show something other than the path.
 */
interface LinkOpts {
  project?: boolean;
  text?: string;
}

/**
 * A name/target row.
 *
 * The anchor is NESTED inside `.target` rather than carrying both classes: with both
 * on one element, `.row .target` (two classes) outspecifies `a.link` (one class plus
 * one element), so every link would render in the muted body colour — clickable rows
 * that do not look clickable.
 */
function nameTargetRow(
  name: string,
  target: string,
  terms: string[],
  title: string,
  opts?: LinkOpts,
): string {
  const cell = target
    ? '<span class="target">' + link(target, terms, title, opts) + '</span>'
    : '<span class="target muted">—</span>';
  return '<div class="row"><span class="name">' + highlight(name, terms) + '</span>' + cell + '</div>';
}

/**
 * One filterable list section.
 *
 * The filter box is a function of the UNFILTERED size, so it cannot vanish from
 * under the cursor the moment a query narrows the list below the threshold. The row
 * cap is lifted while a query is active, because a filter that searched only the
 * thirty visible rows would report matches out of the wrong denominator.
 */
function listSection(
  id: string,
  title: string,
  items: Item[],
  state: PageState,
  opts: { empty: string; grouped?: boolean },
): string {
  const st = state[id] ?? newSectionState();
  const terms = filterTerms(st.query);
  const kept = terms.length ? items.filter((it) => matchesTerms(it.search, terms)) : items;
  const capped = st.expanded || terms.length ? kept : kept.slice(0, ROW_CAP);

  let head = '<header><h2>' + esc(title) + '</h2>';
  if (items.length) {
    head +=
      '<span class="count">' +
      (terms.length ? kept.length + ' of ' + items.length : String(items.length)) +
      '</span>';
  }
  head += '<span class="spacer"></span>';
  if (items.length > FILTER_THRESHOLD) {
    head +=
      '<input class="filter" type="search" placeholder="Filter…" aria-label="Filter ' +
      esc(title) +
      '" data-section="' +
      esc(id) +
      '" value="' +
      esc(st.query) +
      '">';
  }
  head += '</header>';

  let body: string;
  if (!items.length) {
    body = '<div class="empty">' + esc(opts.empty) + '</div>';
  } else if (!kept.length) {
    body = '<div class="empty">No match for “' + esc(st.query) + '”</div>';
  } else if (opts.grouped) {
    // Bucketed rather than "emit a heading whenever the group changes": core puts
    // grouped shortcuts before ungrouped ones but keeps the STORE's order within
    // them, so two shortcuts of one group can arrive either side of a third from
    // another, and a run-based heading would then print that group twice.
    const buckets: Array<{ name: string; rows: Item[] }> = [];
    for (const it of capped) {
      let bucket = buckets.find((b) => b.name === it.group);
      if (!bucket) {
        buckets.push((bucket = { name: it.group, rows: [] }));
      }
      bucket.rows.push(it);
    }
    body = '';
    for (const b of buckets) {
      if (b.name) {
        body += '<div class="group-label">' + esc(b.name) + '</div>';
      }
      body += b.rows.map((it) => it.html(terms)).join('');
    }
  } else {
    body = capped.map((it) => it.html(terms)).join('');
  }
  if (!st.expanded && !terms.length && kept.length > ROW_CAP) {
    body += '<button class="more" data-expand="' + esc(id) + '">Show all ' + kept.length + '</button>';
  }
  return '<section class="section" id="sec-' + esc(id) + '">' + head + body + '</section>';
}

/**
 * The "Runs automatically" card.
 *
 * One row per file, and NOT a filterable list: a project registers a handful at most,
 * and the order is the point. Several files can be registered for either hook and
 * MATLAB runs them top-down, so they are numbered and listed in the order the store's
 * `*Prev` chain puts them in — never alphabetically.
 */
function runsSection(page: ProjectPage): string {
  // Reserve the ordinal column on EVERY row once anything in the card is numbered, so
  // a single-file hook's path still lines up with a numbered one's.
  const numbered = page.startup.length > 1 || page.shutdown.length > 1;
  const ord = (n: number): string =>
    numbered ? '<span class="ord">' + (n || '') + '</span>' : '';

  const rows = (label: string, entries: ProjectPage['startup']): string => {
    if (!entries.length) {
      return (
        '<div class="row"><span class="name">' +
        label +
        '</span><span class="target muted">' +
        ord(0) +
        '— none —</span></div>'
      );
    }
    return entries
      .map(
        (e, i) =>
          '<div class="row"><span class="name">' +
          (i === 0 ? label : '') +
          '</span><span class="target">' +
          ord(entries.length > 1 ? i + 1 : 0) +
          link(e.file, [], 'Opens ' + e.file) +
          '</span></div>',
      )
      .join('');
  };

  return (
    '<section class="section"><header><h2>Runs automatically</h2>' +
    (numbered ? '<span class="count">runs top-down</span>' : '') +
    '</header><div class="runs">' +
    rows('On open', page.startup) +
    rows('On close', page.shutdown) +
    '</div></section>'
  );
}

/**
 * Why there are no member figures on this page, said on the page.
 *
 * BOTH halves are load-bearing. "No file list" alone leaves a user to conclude the
 * project contains nothing — which is the same false sentence a `memberCount` of 0 would
 * have told them, just in words. The rule is the other half: the members are real, they
 * are simply the filesystem rather than a list in the document, so there is nothing here
 * to count. Said rather than left to silence because numbers that were on this page for
 * every other format and are absent for this one read as a rendering failure.
 */
const NO_MEMBER_LIST =
  'matlab.toml records no file list — every file under the project root is a member.';

/** Said in the header where the coverage fraction goes, when there is no fraction. */
const NOT_COUNTED = 'declared, not counted';

/**
 * One label as a counted chip — the shape every XML layout gets.
 *
 * `l.count` is read as a boolean here, which is exactly why this must not be reused for a
 * format that reports `null`: see labelDeclaredRow.
 */
function labelChip(l: ProjectPageLabel): string {
  return (
    '<span class="chip' +
    (l.count ? '' : ' unused') +
    (l.custom ? ' custom' : '') +
    '"' +
    (l.custom ? ' title="Added by this project"' : '') +
    '>' +
    esc(l.name) +
    (l.count ? '<span class="n">' + esc(l.count) + '</span>' : '') +
    '</span>'
  );
}

/**
 * One label as the entries it was declared against — all a page can say about a label's
 * reach when the format records no member list.
 *
 * WHY NOT A CHIP WITH THE COUNT LEFT OFF, which is the smaller edit and the wrong one.
 * A chip tests `l.count` for truthiness, and `null` is falsy, so every label here would
 * come out carrying `.unused` — the page asserting that this project uses the label for
 * nothing, which is the one thing a document with no member list cannot say. Nothing
 * catches it: the `.n` badge disappears by the same falsiness and looks deliberate, and
 * `esc(l.count)` sits in the truthy branch where it has already narrowed to `number`, so
 * the compiler is satisfied. The two cases say different things and so are drawn by
 * different code.
 *
 * `.row` > `.name` + `.target`, the same pair the Runs card uses, because this is the same
 * shape of fact: a name on the left, what it points at on the right.
 *
 * The entries are PLAIN TEXT and not links. The format advertises glob patterns here
 * (`src/**` and the like), a pattern names no file a host could open, and a link that
 * opened nothing for half the rows is worse than text for all of them.
 *
 * `custom` is deliberately not drawn either. Core reports `readOnly: false` for every
 * label this format can carry — it records no ownership, and MATLAB's own conversion into
 * it drops the built-in read-only category outright — so the dashed border would be on
 * every row and distinguish nothing.
 */
function labelDeclaredRow(l: ProjectPageLabel): string {
  const cell = l.declaredFiles.length
    ? // Joined on one line rather than one row per entry: a label declares a handful of
      // paths, and the fact being read here is "which label reaches what", not an order.
      '<span class="target">' + l.declaredFiles.map(esc).join(', ') + '</span>'
    : // A label declaring nothing still gets a row: the project wrote it down, and that
      // it was declared is the fact. Dropping the row would lose the only trace of it.
      '<span class="target muted">— none —</span>';
  return '<div class="row"><span class="name">' + esc(l.name) + '</span>' + cell + '</div>';
}

/**
 * The coverage figure, or the phrase that stands where it would have been.
 *
 * Both counts are tested, not just one. Core derives them from a single
 * `membersEnumerated`, so they are `null` together or not at all — but `esc` rejects a
 * `null` at the call site ON PURPOSE (core's ProjectPage.memberCount records why the field
 * is nullable rather than a -1 that would have type-checked and shipped), and proving it
 * here is the alternative to a `!` that would start printing 'null' the day something
 * upstream sets only one of the two.
 *
 * A phrase and not an empty corner, and above all not '0 of 0': there is something to say
 * where the fraction was — that what follows are declarations and not measurements — and
 * '0 of 0' would say instead that nothing in the project is labelled, about a project
 * whose labels name files right below it.
 */
function labelCoverage(page: ProjectPage): string {
  const { labelledCount: labelled, memberCount: members } = page;
  return labelled === null || members === null
    ? NOT_COUNTED
    : esc(labelled) + ' of ' + esc(members) + ' members labelled';
}

/**
 * The Labels section: chips per category, not a filterable list — or, for a format that
 * records no member list, each label with the entries it declares.
 *
 * `page.memberCount === null` IS the test for which of the two, here and in the identity
 * line, rather than a flag of our own on the payload. The page model already carries the
 * fact: core sets `memberCount`, `labelledCount` and every label `count` from one
 * `membersEnumerated`, so a second field would be a second thing to keep in step with it —
 * i.e. a way for this section and the identity line to end up disagreeing about one
 * project.
 */
function labelsSection(page: ProjectPage): string {
  const counted = page.memberCount !== null;
  // First, not a footnote: it answers the question the missing numbers raise, and it is
  // also the explanation for the member count missing from the identity line above —
  // which is why it is shown even when there are no labels to list under it.
  let body = counted ? '' : '<div class="empty">' + esc(NO_MEMBER_LIST) + '</div>';
  if (!page.categories.length) {
    body += '<div class="empty">This project defines no labels.</div>';
  } else {
    for (const c of page.categories) {
      // A category with no name holds labels no catalog defines — see core's
      // categoriesOf. Naming it here rather than in the model, since "Not in the
      // label catalog" is a sentence about the display and not about the store.
      body +=
        '<div class="group-label">' +
        esc(c.name || 'Not in the label catalog') +
        '</div>' +
        (counted
          ? '<div class="chips">' + c.labels.map(labelChip).join('') + '</div>'
          : c.labels.map(labelDeclaredRow).join(''));
    }
  }
  const total = page.categories.reduce((n, c) => n + c.labels.length, 0);
  return (
    '<section class="section"><header><h2>Labels</h2>' +
    (total ? '<span class="count">' + labelCoverage(page) + '</span>' : '') +
    '</header>' +
    body +
    '</section>'
  );
}

/**
 * What each half of the pair is for, in one line each.
 *
 * The sentences are the point of the whole block. A badge reading "interface" teaches
 * nothing to a user meeting the word for the first time, and this page is where they
 * meet it — the concept lives in a toolkit's API, not in anything MATLAB shows them.
 */
const MSP_DICTIONARY_NOTE: Record<MspDictionary['kind'], string> = {
  interface:
    'The types this project publishes — buses, alias and numeric types, enumerations. ' +
    'Every project that references this one chains this dictionary, so what is in here ' +
    'is what the rest of the composition can see.',
  private:
    'The values only this project sees: the design data its own models resolve against. ' +
    'No other project chains it.',
};

/** Said instead of the note when a half is absent. */
const MSP_NO_PRIVATE = 'A shared-interface project keeps no private values.';

/**
 * The Managed Simulink Project card — PROOF OF CONCEPT, see ../common/msp.ts.
 *
 * Rendered only when the payload carries `msp`, which is never for an ordinary MATLAB
 * Project. It goes directly under the identity block, above "Runs automatically",
 * because for a project that has one it is the most important fact on the page: which
 * of its members is the published half and which is the private one.
 *
 * WHY THIS IS NOT IN THE LABELS SECTION, where the same two facts technically already
 * appear. There they render as two counted chips — `InterfaceDictionary 1`,
 * `PrivateDictionary 1` — which name no file, open nothing, and sit among five built-in
 * labels that say nothing about this project. The fact is present and unusable.
 *
 * A BADGE, NOT AN ICON. The page has no icons at all today, and `media/icons/` ships
 * both `simulink_component.svg` and `serviceInterfaces.svg` — but every icon there
 * colours itself through `var(--mw-icon-*, <light fallback>)` tokens that nothing in
 * this extension defines, so they render white-filled in every theme, and an `<img>`
 * carries no forced-colours treatment at all. A word survives both, and reads in a
 * screen reader. Icons can be added later ON TOP of the word; they cannot replace it.
 */
function mspSection(msp: MspProject): string {
  const badge = (text: string): string => '<span class="badge">' + esc(text) + '</span>';

  const half = (kind: MspDictionary['kind']): string => {
    const dict = msp.dictionaries.find((d) => d.kind === kind);
    const cell = dict
      ? '<span class="target">' + link(dict.path, [], 'Opens ' + dict.path) + '</span>'
      : '<span class="target muted">— none —</span>';
    // Both halves are drawn even when one is missing: seeing that there ARE two halves,
    // and that this project has one of them, is what the word "interface" means here.
    return (
      '<div class="row"><span class="name">' +
      badge(kind) +
      '</span>' +
      cell +
      '</div><div class="note">' +
      esc(dict ? MSP_DICTIONARY_NOTE[kind] : MSP_NO_PRIVATE) +
      '</div>'
    );
  };

  let body = half('interface') + half('private');
  if (msp.sharedConfigSetName) {
    body +=
      '<div class="row"><span class="name">' +
      badge('config') +
      '</span><span class="target">' +
      esc(msp.sharedConfigSetName) +
      '</span></div><div class="note">' +
      'One configuration set, stored as an entry in the interface dictionary and shared ' +
      'by every model in this project.' +
      '</div>';
  }

  return (
    '<section class="section" id="sec-msp"><header><h2>Managed Simulink Project</h2>' +
    // Which detection route answered, verbatim. A proof of concept gets read from
    // screenshots, and the two routes disagree in ways worth seeing.
    '<span class="count">' +
    esc(msp.evidence.join(' + ')) +
    '</span></header><div class="msp">' +
    body +
    '</div></section>'
  );
}

/**
 * What the parse could not read, as the page's first block.
 *
 * Not the table views' banner strip: that one is absolutely positioned and the table
 * beneath it is offset by its measured height, because the table is full-bleed. This
 * view is a flowing document, so the banner is simply the first thing in it and
 * pushes the rest down by existing.
 *
 * Worth having on a project above all other formats: the store is read entirely by
 * convention with no schema, so a document that did not survive its trip costs
 * whatever entity it described and leaves a page that looks complete.
 */
function warningsBlock(banner: WarningBanner | undefined): string {
  if (!banner) {
    return '';
  }
  const details = banner.details.length
    ? '<ul>' + banner.details.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>'
    : '';
  return (
    '<div class="warning" role="status"><div class="headline">' +
    esc(banner.headline) +
    '</div>' +
    details +
    '</div>'
  );
}

/** Everything the host tells the page, i.e. `setProject` minus its `type`. */
export interface ProjectPagePayload {
  page: ProjectPage;
  /**
   * The project's folder, as a path to show under its name. Only the host knows it —
   * the store records nothing absolute, by design, so a project stays portable.
   */
  root: string;
  /**
   * What a Managed Simulink Project adds, absent for every project that is not one.
   * Every MSP-specific pixel on this page is behind a check on this key.
   */
  msp?: MspProject;
  /** What the parse could not read; absent after a clean read. */
  warnings?: WarningBanner;
}

/** The whole page. */
export function renderProjectPage(payload: ProjectPagePayload, state: PageState): string {
  const { page, root, msp } = payload;
  const meta = [
    'MATLAB Project',
    // Second, right after what it IS: an MSP is a MATLAB Project first, and the role is
    // the one word that says why this page looks different from the last one.
    ...(msp ? ['Managed Simulink Project', MSP_ROLE_LABEL[msp.role]] : []),
    page.formatLabel,
    // Dropped outright when the format records no member list — same test as
    // labelsSection, for the same reason. This one has to be written deliberately because
    // nothing else will: `null` in a `+` expression is swallowed into the string 'null'
    // and the compiler raises nothing, so this entry rendered 'null members' until the
    // branch existed, where the Labels header at least failed to compile. `?? 0` would
    // type-check too and be worse than the bad string: '0 members' is a sentence, and for
    // a format whose members are every file under the root it is a false one.
    ...(page.memberCount === null
      ? []
      : [page.memberCount + (page.memberCount === 1 ? ' member' : ' members')]),
    // The path folders ARE a list in the document in every format, so this figure is real
    // whatever the format and stays put beside the one that vanished.
    page.pathFolders.length + (page.pathFolders.length === 1 ? ' path folder' : ' path folders'),
  ];

  const parts: string[] = [];

  parts.push(warningsBlock(payload.warnings));

  parts.push(
    '<div class="identity"><h1>' +
      esc(page.name) +
      '</h1><div class="root">' +
      esc(root) +
      '</div><div class="meta">' +
      meta.map(esc).join('<span class="dot">·</span>') +
      '</div></div>',
  );

  if (msp) {
    parts.push(mspSection(msp));
  }

  parts.push(runsSection(page));

  parts.push(
    listSection(
      'shortcuts',
      'Shortcuts',
      page.shortcuts.map((s) => ({
        search: s.name + ' ' + s.file + ' ' + s.group,
        group: s.group,
        html: (terms) => nameTargetRow(s.name, s.file, terms, 'Opens ' + s.file),
      })),
      state,
      {
        grouped: page.shortcuts.some((s) => s.group),
        empty: 'This project defines no shortcuts.',
      },
    ),
  );

  parts.push(
    listSection(
      'path',
      'Project Path',
      page.pathFolders.map((f) => ({
        search: f || ROOT_LABEL,
        group: '',
        // Path folders are deliberately NOT links. There are 88 of them in a real
        // project, every one is already a node in the Explorer, and a folder cannot
        // be opened as an editor anyway — so 88 affordances would buy a reveal the
        // Explorer offers better.
        html: (terms) =>
          '<div class="row single"><span class="name">' +
          (f === '' ? '<span class="muted">' + ROOT_LABEL + '</span>' : highlight(f, terms)) +
          '</span></div>',
      })),
      state,
      { empty: 'No folders are added to the MATLAB path.' },
    ),
  );

  parts.push(
    listSection(
      'locations',
      'Locations',
      page.locations.map((w) => ({
        search: w.label + ' ' + w.ref,
        group: '',
        // Most of these name a FOLDER, which cannot be opened as an editor and is
        // revealed in the Explorer instead: two different host actions behind rows
        // that look the same, so the tooltip has to say which. MATLAB's own key
        // naming is what distinguishes them — DependencyCacheFile names a file, the
        // *Folder keys name folders — and the suffix generalizes to a key this
        // release has never seen. A wrong guess costs only the tooltip's wording:
        // the ACTION is chosen by the host after it stats the target.
        html: (terms) =>
          nameTargetRow(
            w.label,
            w.ref,
            terms,
            w.key.endsWith('File')
              ? 'Opens ' + w.ref
              : 'Reveals ' + w.ref + ' in the Explorer',
          ),
      })),
      state,
      {
        empty: 'Defaults — cache, code generation and startup all use the project root.',
      },
    ),
  );

  parts.push(labelsSection(page));

  // A referenced project IS a component, in the toolkit's own vocabulary: `msp.getStatus`
  // reports `components` as "table of referenced MSP projects", and referencing one chains
  // its interface dictionary into this project's. So for an MSP the section is renamed
  // rather than duplicated — the list is already exactly right, only the word was ours.
  parts.push(
    listSection(
      'references',
      msp ? 'Components' : 'References',
      page.references.map((r) => ({
        search: r.name + ' ' + r.path,
        group: '',
        html: (terms) =>
          nameTargetRow(
            r.name,
            r.path,
            terms,
            msp ? "Opens the component's own project page" : 'Opens the referenced project',
            msp ? { project: true } : undefined,
          ),
      })),
      state,
      {
        empty: msp
          ? 'This project references no components.'
          : 'This project references no other projects.',
      },
    ),
  );

  return parts.join('');
}
