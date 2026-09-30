// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Managed Simulink Project proof of concept, end to end on the two things this repo
// decides: which member is which half (src/host/mspProject.ts) and what the page says
// about it (src/webview/projectPage.ts).
//
// The store shapes asserted here were MEASURED against the toolkit's own Flight Control
// example, four generated projects:
//   - a `model` project labels `data/<Name>_Interface.sldd` and `data/<Name>_Private.sldd`
//   - a `common` project DEFINES both labels and attaches only the interface one, so the
//     role cannot be read from the catalog — only from attachment, or from the config
//   - msp_config.json is itself a project member, and is the only source of the shared
//     ConfigSet's name
//
// The last describe is the one that matters most: a project that is NOT an MSP must
// render exactly what it rendered before any of this existed.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { ParsedProject, ProjectPage } from 'data-explorer-core';
import { detectMsp } from '../src/host/mspProject.js';
import { renderProjectPage } from '../src/webview/projectPage.js';
import type { ProjectPagePayload } from '../src/webview/projectPage.js';

const IFACE = '110edaf7-5770-482c-b8a4-b92306ac967b';
const PRIV = '3ced2a68-a1a2-4ddd-bd2a-ae1836d724de';

function parsed(over: Partial<ParsedProject> = {}): ParsedProject {
  return {
    name: 'Controller',
    format: 'fixedPathV2',
    files: [],
    pathFolders: [],
    labels: [],
    references: [],
    entryPoints: [],
    entryPointGroups: [],
    workingFolders: [],
    warnings: [],
    ...over,
  };
}

/** A `model` project's store: both labels defined, both attached. */
function componentStore(): ParsedProject {
  return parsed({
    labels: [
      // The two built-ins that ship with every project are in here so the MSP category
      // is found by NAME rather than by being the only thing present.
      { id: 'design', category: 'Classification', name: 'Design', readOnly: true },
      { id: IFACE, category: 'MSP', name: 'InterfaceDictionary', readOnly: false },
      { id: PRIV, category: 'MSP', name: 'PrivateDictionary', readOnly: false },
    ],
    files: [
      { path: 'ControllerModel.slx', isFolder: false, labels: ['design'] },
      { path: 'data/Controller_Interface.sldd', isFolder: false, labels: ['design', IFACE] },
      { path: 'data/Controller_Private.sldd', isFolder: false, labels: ['design', PRIV] },
    ],
  });
}

/** A `common` project's store: both labels DEFINED, only the interface one attached. */
function commonStore(): ParsedProject {
  return parsed({
    name: 'PlatformTypes',
    labels: [
      { id: IFACE, category: 'MSP', name: 'InterfaceDictionary', readOnly: false },
      { id: PRIV, category: 'MSP', name: 'PrivateDictionary', readOnly: false },
    ],
    files: [
      { path: 'PlatformLib.slx', isFolder: false, labels: ['design'] },
      { path: 'data/PlatformTypes_Interface.sldd', isFolder: false, labels: ['design', IFACE] },
    ],
  });
}

const COMPONENT_CONFIG = JSON.stringify({
  version: '1.0',
  type: 'model',
  projectName: 'Controller',
  privateDictionary: 'data/Controller_Private.sldd',
  interfaceDictionary: 'data/Controller_Interface.sldd',
  dataFolder: 'data',
  sharedConfigSetName: 'Controller_Config',
});

const COMMON_CONFIG = JSON.stringify({
  version: '1.0',
  type: 'common',
  projectName: 'PlatformTypes',
  privateDictionary: '',
  interfaceDictionary: 'data/PlatformTypes_Interface.sldd',
  dataFolder: 'data',
});

describe('recognizing a Managed Simulink Project', () => {
  it('is nothing at all for an ordinary project', () => {
    expect(detectMsp(parsed())).toBeUndefined();
    expect(
      detectMsp(
        parsed({
          labels: [{ id: 'design', category: 'Classification', name: 'Design', readOnly: true }],
          files: [{ path: 'a.slx', isFolder: false, labels: ['design'] }],
        }),
      ),
    ).toBeUndefined();
  });

  it('reads both halves off the store labels, with no file read at all', () => {
    const msp = detectMsp(componentStore());
    expect(msp).toEqual({
      role: 'component',
      dictionaries: [
        { kind: 'interface', path: 'data/Controller_Interface.sldd' },
        { kind: 'private', path: 'data/Controller_Private.sldd' },
      ],
      evidence: ['MSP labels'],
    });
  });

  it('calls a project with no attached private dictionary a shared interface', () => {
    // The discriminator is ATTACHMENT, not definition: this store defines both labels.
    const msp = detectMsp(commonStore());
    expect(msp?.role).toBe('common');
    expect(msp?.dictionaries).toEqual([
      { kind: 'interface', path: 'data/PlatformTypes_Interface.sldd' },
    ]);
  });

  it('takes the role and the shared ConfigSet name from the config, where there is one', () => {
    const msp = detectMsp(componentStore(), COMPONENT_CONFIG);
    expect(msp?.role).toBe('component');
    expect(msp?.sharedConfigSetName).toBe('Controller_Config');
    expect(msp?.evidence).toEqual(['MSP labels', 'msp_config.json']);
  });

  it("believes the config's own word for the role over the store's shape", () => {
    // A `common` project whose private label is attached anyway: the config is the field
    // the toolkit's API sets and reads, so it decides.
    const store = commonStore();
    store.files.push({ path: 'data/Stray_Private.sldd', isFolder: false, labels: [PRIV] });
    expect(detectMsp(store, COMMON_CONFIG)?.role).toBe('common');
    expect(detectMsp(store)?.role).toBe('component');
  });

  it('still recognizes one when the labels were stripped out of the store', () => {
    const msp = detectMsp(parsed(), COMPONENT_CONFIG);
    expect(msp?.evidence).toEqual(['msp_config.json']);
    expect(msp?.dictionaries).toEqual([
      { kind: 'interface', path: 'data/Controller_Interface.sldd' },
      { kind: 'private', path: 'data/Controller_Private.sldd' },
    ]);
  });

  it('survives a config that is not JSON, or is JSON of the wrong shape', () => {
    // Someone else's file, hand-editable, and the labels can carry the page without it.
    expect(detectMsp(parsed(), '{ not json')).toBeUndefined();
    expect(detectMsp(parsed(), '[]')).toBeUndefined();
    expect(detectMsp(parsed(), 'null')).toBeUndefined();
    expect(detectMsp(componentStore(), '{ not json')?.evidence).toEqual(['MSP labels']);
  });

  it('never lets the config override a path a label proved is there', () => {
    // A label is attached to a member the parse actually saw; the config is a
    // declaration that can outlive the file it names.
    const stale = JSON.stringify({ type: 'model', interfaceDictionary: 'data/Old.sldd' });
    expect(detectMsp(componentStore(), stale)?.dictionaries[0].path).toBe(
      'data/Controller_Interface.sldd',
    );
  });
});

// --- the page -----------------------------------------------------------------

function projectPage(over: Partial<ProjectPage> = {}): ProjectPage {
  return {
    name: 'Controller',
    format: 'fixedPathV2',
    formatLabel: 'multiple XML files',
    memberCount: 14,
    labelledCount: 11,
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

function render(payload: Partial<ProjectPagePayload>): string {
  return renderProjectPage(
    { page: projectPage(payload.page), root: '/work/Controller', ...payload } as ProjectPagePayload,
    {},
  );
}

describe('what the page says about a Managed Simulink Project', () => {
  const msp = detectMsp(componentStore(), COMPONENT_CONFIG)!;

  it('names the two concepts on badges, and links the file each one is', () => {
    const html = render({ msp });
    expect(html).toContain('<span class="badge">interface</span>');
    expect(html).toContain('<span class="badge">private</span>');
    // The fact the Labels section could not give: which file. Both are real links.
    expect(html).toContain('data-open="data/Controller_Interface.sldd"');
    expect(html).toContain('data-open="data/Controller_Private.sldd"');
  });

  it('says what each half is FOR, because the badge alone teaches nobody the word', () => {
    const html = render({ msp });
    expect(html).toContain('The types this project publishes');
    expect(html).toContain('The values only this project sees');
  });

  it('puts the role in the identity line, right after what the project is', () => {
    const html = render({ msp });
    expect(html).toContain(
      'MATLAB Project<span class="dot">·</span>Managed Simulink Project' +
        '<span class="dot">·</span>component',
    );
  });

  it('draws the private half as absent rather than omitting it', () => {
    // A shared-interface project has one half. Seeing the empty slot is what says there
    // are two of them.
    const html = render({ msp: detectMsp(commonStore(), COMMON_CONFIG)! });
    expect(html).toContain('<span class="badge">private</span>');
    expect(html).toContain('— none —');
    expect(html).toContain('A shared-interface project keeps no private values.');
    expect(html).toContain('<span class="dot">·</span>shared interface');
  });

  it('shows the shared configuration set, which is an entry and not a file', () => {
    const html = render({ msp });
    expect(html).toContain('<span class="badge">config</span>');
    expect(html).toContain('Controller_Config');
    // Not a link: it lives inside the interface dictionary, and there is no path to open.
    expect(html).not.toContain('data-open="Controller_Config"');
  });

  it('says which detection route answered', () => {
    expect(render({ msp })).toContain('MSP labels + msp_config.json');
  });

  it('calls a referenced project a component, and opens its project rather than its folder', () => {
    const html = render({
      msp,
      page: projectPage({ references: [{ name: 'plant', path: '../plant' }] }),
    });
    expect(html).toContain('<h2>Components</h2>');
    expect(html).not.toContain('<h2>References</h2>');
    // The store records a FOLDER. data-prj is what turns the reveal into an open.
    expect(html).toContain('data-open="../plant" data-prj=""');
  });

  it('escapes a store someone else wrote', () => {
    const html = render({
      msp: {
        role: 'component',
        dictionaries: [{ kind: 'interface', path: 'data/<img src=x>.sldd' }],
        sharedConfigSetName: '<script>alert(1)</script>',
        evidence: ['<b>'],
      },
    });
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
  });
});

describe('a project that is not one', () => {
  it('renders exactly what it rendered before any of this existed', () => {
    const page = projectPage({ references: [{ name: 'LibProj', path: '../LibProj' }] });
    const before = renderProjectPage({ page, root: '/work/Controller' }, {});
    const withKey = renderProjectPage(
      { page, root: '/work/Controller', msp: undefined },
      {},
    );
    expect(withKey).toBe(before);
    expect(before).toContain('<h2>References</h2>');
    expect(before).not.toContain('sec-msp');
    expect(before).not.toContain('badge');
    expect(before).not.toContain('data-prj');
    // The identity line is the pre-MSP one, with nothing inserted into it.
    expect(before).toContain('MATLAB Project<span class="dot">·</span>multiple XML files');
  });
});

// --- the click ----------------------------------------------------------------

describe('clicking a component row', () => {
  const posted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
    });
    await import('../src/webview/project-main.js');
  });

  beforeEach(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'setProject',
          root: '/work/Composition',
          page: projectPage({
            references: [{ name: 'plant', path: '../plant' }],
            locations: [{ key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'work/cache' }],
          }),
          msp: detectMsp(componentStore(), COMPONENT_CONFIG),
        },
      }),
    );
    posted.length = 0;
  });

  function click(path: string): void {
    document
      .querySelector(`[data-open="${path}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  it('asks the host for the project in the folder, not for the folder', () => {
    click('../plant');
    expect(posted).toEqual([{ type: 'openFile', path: '../plant', preferProject: true }]);
  });

  it('leaves every other link posting exactly what it posted before', () => {
    // `preferProject` ABSENT, not false: this is the whole guarantee that the existing
    // rows were not touched.
    click('work/cache');
    expect(posted).toEqual([{ type: 'openFile', path: 'work/cache' }]);
  });
});
