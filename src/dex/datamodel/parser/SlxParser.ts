// Copyright 2026 The MathWorks, Inc.

import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { parseMxArray } from './MxArrayParser';
import type { MatVariable } from './MatParser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

export interface BlockParamUsage {
  blockName: string;
  blockType: string;
  paramProperty: string;
  paramValue: string;
}

export interface ParsedSlx {
  name: string;
  release: string;
  creator: string;
  lastModified: string;
  uuid: string;
  dataDictionary: string | null;
  modelReferences: { blockPath: string; modelName: string }[];
  externalDataSources: string[];
  configSets: { name: string; active: boolean; data: unknown }[];
  workspace: MatVariable[] & { _trailingElements: Uint8Array[] };
  blockParamUsages: BlockParamUsage[];
  rawContents: Record<string, string>;
  zipEntries: Record<string, Uint8Array>;
}

function decodeText(buf: Uint8Array): string {
  return new TextDecoder().decode(buf);
}

function parseJSON(buf: Uint8Array): unknown {
  return JSON.parse(decodeText(buf));
}

function parseXml(buf: Uint8Array): unknown {
  return xmlParser.parse(decodeText(buf));
}

function extractConfigSets(
  entries: Record<string, Uint8Array>,
  configSetInfo: { PartName: string; ConfigSetName: string; Active: boolean }[],
): { name: string; active: boolean; data: unknown }[] {
  const configs: { name: string; active: boolean; data: unknown }[] = [];
  for (const info of configSetInfo) {
    const partPath = info.PartName.replace(/^\//, '');
    const buf = entries[partPath];
    if (buf) {
      const json = parseJSON(buf);
      configs.push({
        name: info.ConfigSetName,
        active: !!info.Active,
        data: json,
      });
    }
  }
  return configs;
}

function extractExternalDataSources(doc: unknown): string[] {
  const sources: string[] = [];
  const brokerSources = findAll(doc, 'ExplicitExternalBrokerSources');
  for (const el of brokerSources) {
    const pathVal = findText(el, 'fullPathToSource');
    if (pathVal) {
      sources.push(pathVal);
    }
  }
  return sources;
}

function findAll(obj: unknown, tagName: string): unknown[] {
  const results: unknown[] = [];
  if (!obj || typeof obj !== 'object') {
    return results;
  }
  for (const key of Object.keys(obj as object)) {
    if (key === tagName) {
      const val = (obj as Record<string, unknown>)[key];
      if (Array.isArray(val)) {
        results.push(...val);
      } else {
        results.push(val);
      }
    } else if (typeof (obj as Record<string, unknown>)[key] === 'object') {
      results.push(...findAll((obj as Record<string, unknown>)[key], tagName));
    }
  }
  return results;
}

function findText(obj: unknown, tagName: string): string | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  for (const key of Object.keys(obj as object)) {
    if (key === tagName) {
      const val = (obj as Record<string, unknown>)[key];
      if (typeof val === 'string') {
        return val;
      }
      if (val && (val as Record<string, unknown>)['#text']) {
        return (val as Record<string, unknown>)['#text'] as string;
      }
      return String(val);
    }
    if (typeof (obj as Record<string, unknown>)[key] === 'object') {
      const found = findText((obj as Record<string, unknown>)[key], tagName);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

const NUMERIC_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PARAM_PROPS = new Set([
  'Gain',
  'Value',
  'Bias',
  'UpperLimit',
  'LowerLimit',
  'Threshold',
  'InitialCondition',
  'SampleTime',
  'Amplitude',
  'Frequency',
  'FinalValue',
  'InitialOutput',
  'AfterFinalValue',
]);

function extractBlockParamUsages(entries: Record<string, Uint8Array>): BlockParamUsage[] {
  const usages: BlockParamUsage[] = [];
  for (const key in entries) {
    if (!key.startsWith('simulink/systems/') || !key.endsWith('.xml')) continue;
    const doc = parseXml(entries[key]);
    const blocks = findAll(doc, 'Block');
    for (const block of blocks) {
      const b = block as Record<string, unknown>;
      const blockName = (b['@_Name'] as string) || '';
      const blockType = (b['@_BlockType'] as string) || '';
      const props = b['P'];
      if (!props) continue;
      const propList = Array.isArray(props) ? props : [props];
      for (const p of propList) {
        const pObj = p as Record<string, unknown>;
        const propName = pObj['@_Name'] as string;
        if (!propName || !PARAM_PROPS.has(propName)) continue;
        const val = (pObj['#text'] as string) || '';
        if (!val || NUMERIC_RE.test(val)) continue;
        if (val === 'inf' || val === '-inf' || val === 'nan') continue;
        if (val === 'on' || val === 'off') continue;
        usages.push({ blockName, blockType, paramProperty: propName, paramValue: val });
      }
    }
  }
  return usages;
}

function extractModelReferences(
  graphicalInterface: Record<string, unknown> | null,
): { blockPath: string; modelName: string }[] {
  if (!graphicalInterface || !graphicalInterface.ModelReferences) {
    return [];
  }
  return (graphicalInterface.ModelReferences as { BlockPath: string; ModelName: string }[]).map(function (ref) {
    return { blockPath: ref.BlockPath, modelName: ref.ModelName };
  });
}

export function parseSlx(buffer: ArrayBuffer, filename: string): ParsedSlx {
  const entries = unzipSync(new Uint8Array(buffer));

  // Core metadata
  let release = '';
  let creator = '';
  let lastModified = '';
  if (entries['metadata/coreProperties.xml']) {
    const doc = parseXml(entries['metadata/coreProperties.xml']);
    release = findText(doc, 'cp:version') || findText(doc, 'version') || '';
    creator = findText(doc, 'dc:creator') || findText(doc, 'creator') || '';
    lastModified = findText(doc, 'dcterms:modified') || findText(doc, 'modified') || '';
  }

  // Block diagram (linked dictionary, UUID, model-workspace data source)
  let dataDictionary: string | null = null;
  let uuid = '';
  let workspaceMatFile: string | null = null;
  if (entries['simulink/blockDiagram.json']) {
    const bd = parseJSON(entries['simulink/blockDiagram.json']) as Record<string, unknown>;
    const diagram = (bd.BlockDiagram as Record<string, unknown>) || bd;
    dataDictionary = (diagram.DataDictionary as string) || null;
    uuid = (diagram.ModelUUID as string) || '';
    // Model workspace sourced from a MAT file (model -> mat relationship). MATLAB
    // records this here, NOT in ExternalDataSourceSettings.xml.
    const ws = diagram.ModelWorkspace as Record<string, unknown> | undefined;
    if (ws && ws.WSDataSource === 'MAT-File' && typeof ws.WSSourceFileName === 'string') {
      workspaceMatFile = ws.WSSourceFileName;
    }
  }

  // Config sets
  let configSets: { name: string; active: boolean; data: unknown }[] = [];
  if (entries['simulink/configSetInfo.json']) {
    const info = parseJSON(entries['simulink/configSetInfo.json']) as Record<string, unknown>;
    configSets = extractConfigSets(
      entries,
      (info.ConfigSetInfo as { PartName: string; ConfigSetName: string; Active: boolean }[]) || [],
    );
  }

  // Graphical interface (model references)
  let modelReferences: { blockPath: string; modelName: string }[] = [];
  if (entries['simulink/graphicalInterface.json']) {
    const gi = parseJSON(entries['simulink/graphicalInterface.json']) as Record<string, unknown>;
    modelReferences = extractModelReferences(gi);
  }

  // External data sources (.mat files)
  let externalDataSources: string[] = [];
  if (entries['simulink/ExternalDataSourceSettings.xml']) {
    const doc = parseXml(entries['simulink/ExternalDataSourceSettings.xml']);
    externalDataSources = extractExternalDataSources(doc);
  }
  // Model-workspace MAT source (from blockDiagram.json) is also external data.
  if (workspaceMatFile && !externalDataSources.includes(workspaceMatFile)) {
    externalDataSources.push(workspaceMatFile);
  }

  // Model workspace (binary mxarray)
  let workspace: MatVariable[] & { _trailingElements: Uint8Array[] } = [] as unknown as MatVariable[] & {
    _trailingElements: Uint8Array[];
  };
  (workspace as unknown as { _trailingElements: Uint8Array[] })._trailingElements = [];
  if (entries['simulink/modelWorkspace.mxarray']) {
    workspace = parseMxArray(entries['simulink/modelWorkspace.mxarray'].buffer);
  }

  // Block parameter usages (which blocks reference which params by name)
  const blockParamUsages = extractBlockParamUsages(entries);

  const rawContents: Record<string, string> = {};
  for (const key in entries) {
    if (key.endsWith('.xml') || key.endsWith('.json')) {
      rawContents[key] = decodeText(entries[key]);
    }
  }

  return {
    name: filename,
    release,
    creator,
    lastModified,
    uuid,
    dataDictionary,
    modelReferences,
    externalDataSources,
    configSets,
    workspace,
    blockParamUsages,
    rawContents,
    zipEntries: entries,
  };
}
