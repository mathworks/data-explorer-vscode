// Copyright 2026 The MathWorks, Inc.
//
// The MSP label route looks a label's NAME up in a table of the two names it knows, and
// the name is the project store's own text. On a plain object, `toString`, `valueOf`,
// `constructor` and the rest of Object.prototype's members are answered by the prototype:
// `LABEL_KIND['toString']` was a function, which is truthy, so a label of that name was
// taken for one of the two halves and recorded against its id. Its files were then
// pushed as a dictionary of that "kind" and dropped by the interface-first ordering, so a
// well-formed store showed nothing. What it could do was overwrite: a label sharing an id
// with InterfaceDictionary or PrivateDictionary replaced that half's entry, and the half
// went missing from the page.
//
// No store MATLAB writes has two labels at one Location, but a monolithic store is one
// XML document a person or a tool can write, and core reads what it says. The stores
// here go through core's own parseProject, so every label and id below is read off the
// file's bytes.
import { describe, it, expect } from 'vitest';
import { parseProject } from 'data-explorer-core';
import { detectMsp } from '../src/host/mspProject.js';

const CATEGORY = 'c0ffee00-0000-4000-8000-000000000001';
const IFACE = '110edaf7-5770-482c-b8a4-b92306ac967b';
const PRIV = '3ced2a68-a1a2-4ddd-bd2a-ae1836d724de';

// Every name Object.prototype answers for on a plain object, `__proto__` included.
const INHERITED = [
  'toString', 'toLocaleString', 'valueOf', 'constructor', 'hasOwnProperty',
  'isPrototypeOf', 'propertyIsEnumerable', '__proto__',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
];

function monolithicStore(labels: Array<[string, string]>, files: Array<[string, string]>): string {
  const label = ([location, name]: [string, string]) =>
    `      <Label Location="${location}">\n        <Info Name="${name}" ReadOnly="WRITABLE"/>\n      </Label>`;
  const file = ([path, location]: [string, string]) =>
    `    <File Location="${path}">\n      <Info>\n        <Category UUID="${CATEGORY}">\n` +
    `          <Label UUID="${location}"/>\n        </Category>\n      </Info>\n    </File>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project MetadataType="monolithic">',
    '  <Categories Location="Root">',
    `    <Category Location="${CATEGORY}">`,
    '      <Info DataType="None" Name="MSP" ReadOnly="0" SingleValued="0"/>',
    ...labels.map(label),
    '    </Category>',
    '  </Categories>',
    '  <Files Location="Root">',
    ...files.map(file),
    '  </Files>',
    '</project>',
  ].join('\n');
}

function detect(labels: Array<[string, string]>, files: Array<[string, string]>) {
  const parsed = parseProject({ 'resources/project/Project.xml': monolithicStore(labels, files) }, 'Controller');
  expect(parsed.format).toBe('monolithic');
  return { parsed, msp: detectMsp(parsed) };
}

const FILES: Array<[string, string]> = [
  ['data/Controller_Interface.sldd', IFACE],
  ['data/Controller_Private.sldd', PRIV],
];
const HALVES = [
  { kind: 'interface', path: 'data/Controller_Interface.sldd' },
  { kind: 'private', path: 'data/Controller_Private.sldd' },
];

describe('an MSP label named after an Object.prototype member', () => {
  for (const name of INHERITED) {
    it(`is not a half of the project when it is named ${name}`, () => {
      // Its own id, and a member file carrying it: the label is attached, and only its
      // name says it is neither half.
      const { msp } = detect(
        [[IFACE, 'InterfaceDictionary'], [PRIV, 'PrivateDictionary'], ['0dd0dd0d-0000-4000-8000-000000000003', name]],
        [...FILES, ['data/Other.sldd', '0dd0dd0d-0000-4000-8000-000000000003']],
      );
      expect(msp?.dictionaries).toEqual(HALVES);
    });

    for (const [half, id] of [['InterfaceDictionary', IFACE], ['PrivateDictionary', PRIV]] as const) {
      it(`leaves ${half} detected when one named ${name} shares its Location`, () => {
        const other = half === 'InterfaceDictionary' ? ([PRIV, 'PrivateDictionary'] as [string, string]) : ([IFACE, 'InterfaceDictionary'] as [string, string]);
        const { parsed, msp } = detect([[id, half], [id, name], other], FILES);
        // The precondition: the store really does say two labels at one Location, so a
        // pass is not a parse that quietly kept one of them.
        expect(parsed.labels.filter((l) => l.id === id).map((l) => l.name).sort()).toEqual([half, name].sort());
        expect(msp?.dictionaries).toEqual(HALVES);
        expect(msp?.role).toBe('component');
      });
    }
  }
});
