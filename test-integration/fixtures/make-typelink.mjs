// Copyright 2026 The MathWorks, Inc.
// Generates typelink/typelink.sldd and typelink/typelink_binary.sldd.
// Run: node test-integration/fixtures/make-typelink.mjs
//
// Four entries, the smallest dictionary that can answer the one question this fixture
// exists for: does a Data Type link built by core resolve back to the document the host
// opened? A type to link TO, a parameter that names it, and a parameter naming a built-in
// so the negative case is in the same file as the positive one.
//
// Written in BOTH .sldd spellings from one list of entries, because the host registers them
// under two different srcIds — the JSON one under the document uri, the zip one under
// `binedit:` + the uri, so its editable model cannot collide with the read-only viewer's.
// A link out of the second therefore names something that is not a uri, and reading it back
// as one is exactly what broke: the click opened an empty `binedit:`-scheme tab. Rendering
// both from the same entries is what makes the pair a parity test rather than two fixtures
// that can drift.
//
// Deliberately OUTSIDE fixtures/workspace: adding an entry to workspace/params.sldd would
// change a file several other suites assert against, and its whole point there is to hold
// one of every class with nothing referring to anything.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const dir = fileURLToPath(new URL('./typelink/', import.meta.url));
mkdirSync(dir, { recursive: true });

const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LASTMOD = '20260914T000000.000000';

// name, the class of the object the entry holds, and its properties.
const ENTRIES = [
  ['MyAlias', 'Simulink.AliasType', { BaseType: 'uint8', DataScope: 'Auto', Description: '', HeaderFile: '' }],
  // Names MyAlias, so its Data Type must come out as a link to it.
  ['Kp', 'Simulink.Parameter', { DataType: 'MyAlias', Value: 1, Complexity: 'real', Description: '' }],
  // Names a built-in, so its Data Type must stay plain text.
  ['Gain', 'Simulink.Parameter', { DataType: 'double', Value: 2, Complexity: 'real', Description: '' }],
  // Names a parameter rather than a type: class-gated, so also plain text.
  ['Borrowed', 'Simulink.Parameter', { DataType: 'Kp', Value: 3, Complexity: 'real', Description: '' }],
];

// --- typelink.sldd: the JSON (text) format, what SlddTextEditorProvider opens ---
const jsonEntries = ENTRIES.map(([name, arrayClass, properties], i) => ({
  name,
  metadata: {
    uuid: uuid(i + 1),
    namespace: NS_DESIGN,
    lastmod: LASTMOD,
    modifiedby: 'make-typelink',
    isderived: '0',
  },
  value: {
    _array_class: arrayClass,
    _dimensions: [1, 1],
    _elements: [{ _id: String(i + 1), _properties: properties }],
    _mw_element_type: 'MATLABArray',
  },
}));

writeFileSync(
  dir + 'typelink.sldd',
  JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries: jsonEntries } } },
    },
    null,
    2,
  ) + '\n',
);

// --- typelink_binary.sldd: the compressed-binary (zip) format, what
// BinarySlddEditorProvider opens ---
//
// The member layout and the <P>/<Element> shape follow test/fixtures/object_props_binary.sldd,
// which was written by MATLAB. Two members is all core's reader needs; the OPC parts a real
// file carries (`[Content_Types].xml`, the coreProperties siblings) are pass-through metadata
// this fixture has no claim about.
const prop = (name, v) =>
  typeof v === 'number'
    ? `<P Name="${name}" Class="double">${v.toFixed(1)}</P>`
    : `<P Name="${name}" Class="char">${v}</P>`;

const binEntry = ([name, objClass, properties], i) =>
  `<Object Class="DD.ENTRY">` +
  `<P Name="Name" Class="char">${name}</P>` +
  `<P Name="UUID" Class="char">${uuid(i + 1)}</P>` +
  `<P Name="Namespace" Class="char">${NS_DESIGN}</P>` +
  `<P Name="LastMod" Class="char">${LASTMOD}</P>` +
  `<P Name="LastModBy" Class="char">make-typelink</P>` +
  `<P Name="IsDerived" Class="char">0</P>` +
  `<P Name="Value">` +
  `<Element Class="${objClass}">` +
  Object.entries(properties)
    .map(([k, v]) => prop(k, v))
    .join('') +
  `</Element>` +
  `</P>` +
  `</Object>`;

const binXml =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">` +
  ENTRIES.map(binEntry).join('') +
  `</DataSource>`;

writeFileSync(
  dir + 'typelink_binary.sldd',
  zipSync({
    'data/chunk0.xml': strToU8(binXml),
    'metadata/mwcoreProperties.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><mwcoreProperties><matlabRelease>R2026b</matlabRelease></mwcoreProperties>`,
    ),
  }),
);

console.log(`wrote typelink/typelink.sldd and typelink/typelink_binary.sldd with ${ENTRIES.length} entries each`);
