// Copyright 2026 The MathWorks, Inc.
// The markup of a project's main page — src/webview/projectPage.ts, which is a pure
// function of (payload, filter state), so this drives the SHIPPING renderer against a
// string with no DOM at all. project-main.ts — the DOM, the events and the postMessage
// boundary — is driven for real in projectMain.test.ts.
//
// The page model itself (`buildProjectPage`) is core's and is tested there. What is
// asserted here is only what this repo decides: which facts become links, which section
// gets a filter box, and that a store written by someone else cannot inject markup.
import { describe, it, expect } from 'vitest';
import type { ProjectPage } from 'data-explorer-core';
import type { WarningBanner } from '../src/host/parseWarnings.js';
import {
  FILTER_THRESHOLD,
  ROW_CAP,
  esc,
  filterTerms,
  highlight,
  renderProjectPage,
} from '../src/webview/projectPage.js';
import type { PageState } from '../src/webview/projectPage.js';

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

const ROOT = '/work/Monophonic';

function render(over: Partial<ProjectPage> = {}, state: PageState = {}, warnings?: WarningBanner) {
  return renderProjectPage({ page: page(over), root: ROOT, warnings }, state);
}

/** The body of one list section, by its id. Sections do not nest, so this is exact. */
function section(html: string, id: string): string {
  const m = new RegExp(`<section class="section" id="sec-${id}">([\\s\\S]*?)</section>`).exec(html);
  expect(m, `no section #sec-${id}`).not.toBeNull();
  return m![1];
}

/** The Runs card, which has no id because it is not filterable. */
function runsCard(html: string): string {
  return /<div class="runs">([\s\S]*?)<\/div><\/section>/.exec(html)![1];
}

const occurrences = (s: string, needle: string) => s.split(needle).length - 1;

/** Every path the page offers to open, in document order. */
const openTargets = (html: string) => [...html.matchAll(/data-open="([^"]*)"/g)].map((m) => m[1]);

const shortcut = (name: string, file: string, group = '') => ({ name, file, group });

describe('the project page identity block', () => {
  it('names the project and says where it is', () => {
    // `root` is the one fact the store does not hold: it records nothing absolute so a
    // project stays portable, so only the host can say where this copy lives.
    const html = render();
    expect(html).toContain('<h1>Monophonic</h1>');
    expect(html).toContain('<div class="root">/work/Monophonic</div>');
  });

  it('summarizes the project in the words MATLAB uses', () => {
    // formatLabel, not `format`: 'fixedPathV2' is not spelled anywhere in MATLAB's UI.
    const html = render({ memberCount: 12, pathFolders: ['', 'src'] });
    expect(html).toContain('MATLAB Project');
    expect(html).toContain('multiple XML files');
    expect(html).toContain('12 members');
    expect(html).toContain('2 path folders');
  });

  it('counts one member and one path folder in the singular', () => {
    const html = render({ memberCount: 1, pathFolders: [''] });
    expect(html).toContain('1 member<');
    expect(html).toContain('1 path folder<');
  });
});

describe('what runs automatically', () => {
  const hooks = {
    startup: [
      { name: 'zstart', file: 'work/zstart.m' },
      { name: 'ainit', file: 'work/ainit.m' },
    ],
    shutdown: [{ name: 'bye', file: 'work/bye.m' }],
  };

  it('keeps the store run order even when it is backwards alphabetically', () => {
    // MATLAB runs these top-down in the order its `*Prev` chain gives, so sorting them
    // for tidiness would misreport what happens when the project opens.
    const card = runsCard(render(hooks));
    expect(card.indexOf('zstart.m')).toBeLessThan(card.indexOf('ainit.m'));
  });

  it('numbers the files, and says they run top-down', () => {
    const html = render(hooks);
    expect(html).toContain('runs top-down');
    expect(runsCard(html)).toContain('<span class="ord">1</span>');
    expect(runsCard(html)).toContain('<span class="ord">2</span>');
  });

  it('reserves the ordinal column on the rows it does not number', () => {
    // One shutdown file against two startup files: without the empty ordinal its path
    // would sit a column to the left of the numbered ones.
    expect(runsCard(render(hooks))).toContain('<span class="ord"></span>');
  });

  it('numbers nothing when no hook has more than one file', () => {
    const html = render({ startup: [{ name: 'init', file: 'init.m' }] });
    expect(html).not.toContain('runs top-down');
    expect(html).not.toContain('class="ord"');
  });

  it('says so when a hook has no files', () => {
    const card = runsCard(render({ startup: [{ name: 'init', file: 'init.m' }] }));
    expect(card).toContain('On open');
    expect(card).toContain('— none —');
  });
});

describe('what the page offers to open', () => {
  it('links a shortcut, a location and a reference by their own paths', () => {
    const html = render({
      shortcuts: [shortcut('Open model', 'models/mono.slx')],
      locations: [{ key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'work/cache' }],
      references: [{ name: 'Lib', path: '../Lib/Lib.prj' }],
    });
    expect(openTargets(html)).toEqual(['models/mono.slx', 'work/cache', '../Lib/Lib.prj']);
  });

  it('does not link a path folder', () => {
    // 88 of them in a real project, every one already a node in the Explorer, and a
    // folder cannot be opened as an editor at all.
    const body = section(render({ pathFolders: ['src', 'work'] }), 'path');
    expect(body).not.toContain('data-open');
    expect(body).toContain('src');
  });

  it('calls the project root by name rather than showing an empty row', () => {
    expect(section(render({ pathFolders: [''] }), 'path')).toContain('(project root)');
  });

  it('says whether a location opens or reveals, by MATLAB’s own key naming', () => {
    // Two different host actions behind rows that look identical, so the tooltip is the
    // only thing that can distinguish them.
    const html = render({
      locations: [
        { key: 'DependencyCacheFile', label: 'Dependency cache', ref: 'work/deps.mat' },
        { key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'work/cache' },
      ],
    });
    expect(html).toContain('title="Opens work/deps.mat"');
    expect(html).toContain('title="Reveals work/cache in the Explorer"');
  });

  it('offers no link for a reference the store gave no path for', () => {
    // The reference's id is a UUID. Linking it would offer to open a path that cannot
    // exist, so such a reference is shown by name alone — see core's ProjectPage.ts.
    const html = render({ references: [{ name: 'Lib', path: '' }] });
    expect(html).toContain('Lib');
    expect(openTargets(html)).toEqual([]);
    expect(section(html, 'references')).toContain('—');
  });

  it('links every path in the model, and nothing that is only displayed', () => {
    // `data-open` is the only thing the click handler reads, so a display string that
    // leaked into it would open a file that does not exist.
    const model = {
      startup: [{ name: 'init', file: 'work/init.m' }],
      shortcuts: [shortcut('Open model', 'models/mono.slx', 'Models')],
      pathFolders: ['src'],
      locations: [{ key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'work/cache' }],
      references: [{ name: 'Lib', path: '../Lib/Lib.prj' }],
    };
    const paths = ['work/init.m', 'models/mono.slx', 'work/cache', '../Lib/Lib.prj'];
    expect(openTargets(render(model)).sort()).toEqual([...paths].sort());
  });
});

describe('a section’s filter box', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => shortcut(`s${i}`, `s${i}.m`));

  it('appears only once a section is long enough to need one', () => {
    expect(render({ shortcuts: many(FILTER_THRESHOLD) })).not.toContain('input class="filter"');
    expect(render({ shortcuts: many(FILTER_THRESHOLD + 1) })).toContain('input class="filter"');
  });

  it('stays while a query narrows the list below the threshold', () => {
    // A box that vanished the moment the query matched few enough rows would disappear
    // from under the cursor that was typing into it.
    const html = render({ shortcuts: many(FILTER_THRESHOLD + 1) }, { shortcuts: { query: 's1.m', expanded: false } });
    expect(html).toContain('input class="filter"');
    expect(html).toContain('value="s1.m"');
  });

  it('counts the matches out of the whole section', () => {
    const html = render({ shortcuts: many(10) }, { shortcuts: { query: 's1', expanded: false } });
    // s1 alone of s0..s9.
    expect(section(html, 'shortcuts')).toContain('1 of 10');
  });

  it('matches every term, anywhere, ignoring case', () => {
    const html = render(
      { shortcuts: [shortcut('Open the Model', 'models/mono.slx'), shortcut('Run tests', 'tests/run.m')] },
      { shortcuts: { query: 'MONO model', expanded: false } },
    );
    const body = section(html, 'shortcuts');
    expect(body).toContain('mono.slx');
    expect(body).not.toContain('run.m');
  });

  it('marks the matched text', () => {
    const html = render(
      { shortcuts: [shortcut('Open model', 'models/mono.slx')] },
      { shortcuts: { query: 'mono', expanded: false } },
    );
    expect(html).toContain('<mark>mono</mark>');
  });

  it('says when nothing matched, quoting what was typed', () => {
    const html = render({ shortcuts: many(10) }, { shortcuts: { query: 'nothing', expanded: false } });
    expect(section(html, 'shortcuts')).toContain('No match for “nothing”');
  });

  it('searches the rows the cap is hiding, not just the visible ones', () => {
    // Otherwise a filter reports matches out of the wrong denominator: the row after
    // the cap is in the section and a user searching for it expects to find it.
    const items = many(ROW_CAP + 5);
    const html = render({ shortcuts: items }, { shortcuts: { query: `s${ROW_CAP + 4}.m`, expanded: false } });
    const body = section(html, 'shortcuts');
    expect(body).toContain(`s${ROW_CAP + 4}.m`);
    expect(body).toContain(`1 of ${ROW_CAP + 5}`);
  });
});

describe('a section longer than the row cap', () => {
  const folders = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);

  it('shows the cap and offers the rest', () => {
    const html = render({ pathFolders: folders(ROW_CAP + 1) });
    const body = section(html, 'path');
    expect(occurrences(body, 'class="row single"')).toBe(ROW_CAP);
    expect(body).toContain(`data-expand="path">Show all ${ROW_CAP + 1}`);
  });

  it('shows everything once expanded, and stops offering', () => {
    const body = section(
      render({ pathFolders: folders(ROW_CAP + 1) }, { path: { query: '', expanded: true } }),
      'path',
    );
    expect(occurrences(body, 'class="row single"')).toBe(ROW_CAP + 1);
    expect(body).not.toContain('data-expand');
  });

  it('lifts the cap while a query is active', () => {
    const body = section(
      render({ pathFolders: folders(ROW_CAP + 5) }, { path: { query: 'f', expanded: false } }),
      'path',
    );
    expect(occurrences(body, 'class="row single"')).toBe(ROW_CAP + 5);
    expect(body).not.toContain('data-expand');
  });

  it('offers nothing when the section fits', () => {
    expect(section(render({ pathFolders: folders(ROW_CAP) }), 'path')).not.toContain('data-expand');
  });
});

describe('grouped shortcuts', () => {
  it('heads each group once even when the store interleaves them', () => {
    // The reason this is bucketed rather than "emit a heading whenever the group
    // changes": core keeps the STORE's order within the grouped shortcuts, so two of
    // one group can arrive either side of a third from another.
    const body = section(
      render({
        shortcuts: [
          shortcut('a', 'a.m', 'Models'),
          shortcut('b', 'b.m', 'Utilities'),
          shortcut('c', 'c.m', 'Models'),
        ],
      }),
      'shortcuts',
    );
    expect(occurrences(body, '>Models<')).toBe(1);
    expect(occurrences(body, '>Utilities<')).toBe(1);
    // …and the two Models shortcuts end up together under it.
    expect(body.indexOf('c.m')).toBeLessThan(body.indexOf('b.m'));
  });

  it('heads nothing when no shortcut has a group', () => {
    const body = section(render({ shortcuts: [shortcut('a', 'a.m')] }), 'shortcuts');
    expect(body).not.toContain('group-label');
  });
});

describe('the labels section', () => {
  const label = (over: Partial<ProjectPage['categories'][0]['labels'][0]> = {}) => ({
    id: 'L1',
    name: 'Design',
    count: 3,
    custom: false,
    ...over,
  });

  it('reports how much of the project is labelled', () => {
    const html = render({
      labelledCount: 3,
      memberCount: 12,
      categories: [{ name: 'Classification', labels: [label()] }],
    });
    expect(html).toContain('3 of 12 members labelled');
  });

  it('shows a used label with its count and dims an unused one', () => {
    const html = render({
      categories: [{ name: 'Classification', labels: [label(), label({ id: 'L2', name: 'Other', count: 0 })] }],
    });
    expect(html).toContain('<span class="n">3</span>');
    expect(html).toContain('class="chip unused"');
  });

  it('marks a label this project added', () => {
    const html = render({
      categories: [{ name: 'Mine', labels: [label({ custom: true })] }],
    });
    expect(html).toContain('class="chip custom"');
    expect(html).toContain('title="Added by this project"');
  });

  it('names the category holding labels the catalog does not define', () => {
    const html = render({ categories: [{ name: '', labels: [label({ name: 'a1b2' })] }] });
    expect(html).toContain('Not in the label catalog');
  });

  it('says so, and counts nothing, when the project defines no labels', () => {
    const html = render({ categories: [] });
    expect(html).toContain('This project defines no labels.');
    expect(html).not.toContain('members labelled');
  });
});

describe('an empty section', () => {
  it('says what is missing rather than disappearing', () => {
    // A section that vanished would leave a user unable to tell "this project defines no
    // shortcuts" from "this page failed to render them".
    const html = render();
    expect(html).toContain('This project defines no shortcuts.');
    expect(html).toContain('No folders are added to the MATLAB path.');
    expect(html).toContain('Defaults — cache, code generation and startup all use the project root.');
    expect(html).toContain('This project references no other projects.');
  });

  it('shows no count and no filter box', () => {
    const body = section(render(), 'shortcuts');
    expect(body).not.toContain('class="count"');
    expect(body).not.toContain('class="filter"');
  });
});

describe('what the parse could not read', () => {
  const banner: WarningBanner = {
    headline: '1 document did not read whole.',
    details: ['resources/project/Labels.xml could not be parsed'],
  };

  it('is the first thing on the page', () => {
    // A flowing document, so the banner pushes the project's name down by existing —
    // unlike the table views', which is absolutely positioned over a full-bleed table.
    const html = render({}, {}, banner);
    expect(html.indexOf('class="warning"')).toBeLessThan(html.indexOf('class="identity"'));
    expect(html).toContain('1 document did not read whole.');
    expect(html).toContain('<li>resources/project/Labels.xml could not be parsed</li>');
  });

  it('is absent after a clean read', () => {
    expect(render()).not.toContain('class="warning"');
  });

  it('keeps the headline when there are no details', () => {
    const html = render({}, {}, { headline: 'Something was lost.', details: [] });
    expect(html).toContain('Something was lost.');
    expect(html).not.toContain('<ul>');
  });
});

describe('a store written by someone else cannot inject markup', () => {
  // Every string on this page comes from XML on disk, which nothing validated: the
  // parser reads the store by convention and has no schema to reject a name by.
  it('escapes a project name', () => {
    const html = render({ name: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a quote inside a path, so the attribute cannot be closed', () => {
    const html = render({ shortcuts: [shortcut('odd', 'a"onmouseover="x') ] });
    expect(html).toContain('data-open="a&quot;onmouseover=&quot;x"');
    expect(openTargets(html)).toEqual(['a&quot;onmouseover=&quot;x']);
  });

  it('escapes a label, a group and a location name too', () => {
    const html = render({
      shortcuts: [shortcut('<b>s</b>', 's.m', '<i>g</i>')],
      locations: [{ key: 'K', label: '<u>k</u>', ref: 'r' }],
      categories: [{ name: '<em>c</em>', labels: [{ id: 'i', name: '<s>l</s>', count: 1, custom: false }] }],
    });
    for (const tag of ['<b>', '<i>', '<u>', '<em>', '<s>']) {
      expect(html, `unescaped ${tag}`).not.toContain(tag);
    }
  });

  it('escapes what it highlights, including around the mark', () => {
    expect(highlight('<b>x</b>', ['b'])).toBe('&lt;<mark>b</mark>&gt;x&lt;/<mark>b</mark>&gt;');
  });

  it('escapes the query it quotes back in a no-match message', () => {
    const html = render(
      { shortcuts: Array.from({ length: 10 }, (_, i) => shortcut(`s${i}`, `s${i}.m`)) },
      { shortcuts: { query: '<img src=x>', expanded: false } },
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  // The counts are the page's only non-string fields, and that is exactly why they got
  // missed: `number` reads as self-evidently safe, so all three went into the markup by
  // bare concatenation while every string beside them was escaped. But the type is a
  // claim core's parser makes, not a check this page performs — the payload arrives over
  // postMessage as JSON, where nothing enforces the declaration. One rule for the whole
  // payload, not one rule per field type. (Found by CodeQL js/xss, 2026-10-01: these
  // three were the only unsanitized flows it could reach from the message handler.)
  const HOSTILE = '<img src=x>' as unknown as number;

  it('escapes a label count', () => {
    const html = render({
      categories: [{ name: 'c', labels: [{ id: 'i', name: 'l', count: HOSTILE, custom: false }] }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('escapes the labelled-of-members count', () => {
    const html = render({
      labelledCount: HOSTILE,
      categories: [{ name: 'c', labels: [{ id: 'i', name: 'l', count: 1, custom: false }] }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('escapes the member count', () => {
    const html = render({
      memberCount: HOSTILE,
      categories: [{ name: 'c', labels: [{ id: 'i', name: 'l', count: 1, custom: false }] }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('esc', () => {
  it('escapes the four characters that matter in attribute and text position', () => {
    expect(esc('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e');
  });

  it('leaves a single quote alone, because every attribute here is double-quoted', () => {
    expect(esc("it's")).toBe("it's");
  });
});

describe('filterTerms', () => {
  it('lower-cases and splits on any run of whitespace', () => {
    expect(filterTerms('  Foo\tBAR   baz ')).toEqual(['foo', 'bar', 'baz']);
  });

  it('is empty for an empty or blank query, so nothing is filtered', () => {
    expect(filterTerms('')).toEqual([]);
    expect(filterTerms('   ')).toEqual([]);
  });
});

describe('highlight', () => {
  it('marks every occurrence of every term', () => {
    expect(highlight('ab ab', ['ab'])).toBe('<mark>ab</mark> <mark>ab</mark>');
    expect(highlight('ab cd', ['ab', 'cd'])).toBe('<mark>ab</mark> <mark>cd</mark>');
  });

  it('matches without regard to case but marks the original text', () => {
    expect(highlight('Mono.slx', ['mono'])).toBe('<mark>Mono</mark>.slx');
  });

  it('merges two terms that overlap in one word into a single mark', () => {
    // Nested or interleaved marks are broken markup, and 'sup' + 'upp' is something a
    // user types by accident while narrowing a query.
    expect(highlight('support', ['sup', 'upp'])).toBe('<mark>supp</mark>ort');
  });

  it('merges adjacent hits rather than emitting two marks', () => {
    expect(highlight('abcd', ['ab', 'cd'])).toBe('<mark>abcd</mark>');
  });

  it('returns the escaped text when there is nothing to mark', () => {
    expect(highlight('a<b', [])).toBe('a&lt;b');
    expect(highlight('a<b', ['zzz'])).toBe('a&lt;b');
  });
});
