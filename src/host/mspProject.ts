// Copyright 2026 The MathWorks, Inc.
//
// Recognize a Managed Simulink Project in a parsed MATLAB Project, and say which of its
// members is which half.
//
// PROOF OF CONCEPT — see ../common/msp.ts for what this is and why it is not in core.
//
// TWO ROUTES, on purpose, because they fail in opposite directions:
//
//   THE LABEL CATALOG is the toolkit's secondary data model: a custom category `MSP`
//   with labels `InterfaceDictionary` and `PrivateDictionary`, attached to the two
//   `.sldd` members. It needs no file read at all — `parseProject` already returns both
//   the catalog and each member's labels — and it answers the question a badge actually
//   asks, which is WHICH FILE plays which role. What it cannot do is survive a store
//   whose labels were removed by hand.
//
//   `msp_config.json` is the toolkit's PRIMARY data model, and it is a project member.
//   It states `type` outright ("model" | "common") and is the only source for the shared
//   ConfigSet's name. What it cannot do is prove the dictionaries are still there.
//
// So: labels decide the paths, the config decides the role where it is present, and
// either one alone is enough to call a project an MSP. Both agreeing is the normal case.
//
// Measured against the toolkit's own Flight Control example (four projects): the role
// canNOT be read from which labels are DEFINED — a `common` project defines both and
// attaches only `InterfaceDictionary`. Attachment is the signal, not definition.

import type { ParsedProject } from 'data-explorer-core';
import type { MspDictionary, MspProject, MspRole } from '../common/msp.js';

/** The label category the toolkit writes into the project store. */
const MSP_CATEGORY = 'MSP';

/** The two label names in that category, and the half each one marks. */
const LABEL_KIND: Record<string, MspDictionary['kind']> = {
  InterfaceDictionary: 'interface',
  PrivateDictionary: 'private',
};

/** The config file, at the project root. A member of the project, but an unlabelled one. */
export const MSP_CONFIG = 'msp_config.json';

/** The shape `msp_config.json` is read for. Every field optional: it is someone else's file. */
interface MspConfig {
  type?: unknown;
  privateDictionary?: unknown;
  interfaceDictionary?: unknown;
  sharedConfigSetName?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Parse `msp_config.json`, or answer undefined.
 *
 * Total by design: a hand-edited or half-written config is a normal thing to meet, and
 * the label route can still carry the page. Nothing here throws.
 */
function readConfig(text: string | undefined): MspConfig | undefined {
  if (!text) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as MspConfig)
    : undefined;
}

/** The dictionaries the store's own labels point at, interface first. */
function fromLabels(parsed: ParsedProject): MspDictionary[] {
  const kindById = new Map<string, MspDictionary['kind']>();
  for (const label of parsed.labels) {
    if (label.category !== MSP_CATEGORY) {
      continue;
    }
    const kind = LABEL_KIND[label.name];
    if (kind) {
      kindById.set(label.id, kind);
    }
  }
  if (!kindById.size) {
    return [];
  }
  const out: MspDictionary[] = [];
  for (const file of parsed.files) {
    for (const id of file.labels) {
      const kind = kindById.get(id);
      // First member wins per half. Two files carrying one of these labels is a
      // malformed project, not a case to invent a presentation for.
      if (kind && !out.some((d) => d.kind === kind)) {
        out.push({ kind, path: file.path });
      }
    }
  }
  return order(out);
}

/** Interface first. */
function order(dicts: MspDictionary[]): MspDictionary[] {
  return [
    ...dicts.filter((d) => d.kind === 'interface'),
    ...dicts.filter((d) => d.kind === 'private'),
  ];
}

/**
 * Whether this parsed project is a Managed Simulink Project, and what it adds.
 *
 * `configText` is `msp_config.json`'s bytes as text when the file is there — the caller
 * reads it, because only the host can touch a filesystem — and undefined when it is not.
 */
export function detectMsp(parsed: ParsedProject, configText?: string): MspProject | undefined {
  const labelled = fromLabels(parsed);
  const config = readConfig(configText);
  if (!labelled.length && !config) {
    return undefined;
  }

  const evidence: string[] = [];
  if (labelled.length) {
    evidence.push('MSP labels');
  }
  if (config) {
    evidence.push(MSP_CONFIG);
  }

  // The config fills a half the labels did not name, and never overrides one they did:
  // a label is attached to a member that the parse actually saw, while the config is a
  // declaration that can outlive the file it names.
  const dictionaries = [...labelled];
  const fromConfig = (kind: MspDictionary['kind'], path: string): void => {
    if (path && !dictionaries.some((d) => d.kind === kind)) {
      dictionaries.push({ kind, path });
    }
  };
  if (config) {
    fromConfig('interface', str(config.interfaceDictionary));
    fromConfig('private', str(config.privateDictionary));
  }

  return {
    role: roleOf(config, dictionaries),
    dictionaries: order(dictionaries),
    ...(config && str(config.sharedConfigSetName)
      ? { sharedConfigSetName: str(config.sharedConfigSetName) }
      : {}),
    evidence,
  };
}

/**
 * Which role this project plays.
 *
 * The config's own word wins, because it is the field the toolkit's API sets and reads.
 * Without it, a private dictionary is what makes a project a component: `common`
 * projects are defined by having none (`"privateDictionary": ""`).
 */
function roleOf(config: MspConfig | undefined, dictionaries: MspDictionary[]): MspRole {
  const declared = config ? str(config.type).toLowerCase() : '';
  if (declared === 'common') {
    return 'common';
  }
  if (declared === 'model') {
    return 'component';
  }
  return dictionaries.some((d) => d.kind === 'private') ? 'component' : 'common';
}
