// Copyright 2026 The MathWorks, Inc.
// @vitest-environment happy-dom
//
// The Managed Simulink Project proof of concept, on the one thing this repo still decides: what
// the project page's webview asks the host for when a component row is clicked. Which member is
// which half (detectMsp) and what the page says about it (projectPage.ts) are view's, and tested
// there (its test/msp.test.ts and test/mspLabelOwnKey.test.ts).
//
// The store shape below was MEASURED against the toolkit's own Flight Control example: a `model`
// project labels `data/<Name>_Interface.sldd` and `data/<Name>_Private.sldd`, and msp_config.json
// names both.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { ParsedProject, ProjectPage } from 'data-explorer-core';
import { detectMsp } from 'data-explorer-view/model';

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

const COMPONENT_CONFIG = JSON.stringify({
  version: '1.0',
  type: 'model',
  projectName: 'Controller',
  privateDictionary: 'data/Controller_Private.sldd',
  interfaceDictionary: 'data/Controller_Interface.sldd',
  dataFolder: 'data',
  sharedConfigSetName: 'Controller_Config',
});

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

describe('clicking a component row', () => {
  const posted: Array<Record<string, unknown>> = [];

  // Its own timeout: a cold import of the whole project-main webview is what a loaded machine stretches.
  beforeAll(async () => {
    (globalThis as any).acquireVsCodeApi = () => ({
      postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
    });
    await import('../src/webview/project-main.js');
  }, 60_000);

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
