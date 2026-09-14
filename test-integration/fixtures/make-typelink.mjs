// Copyright 2026 The MathWorks, Inc.
// Generates typelink/typelink.sldd. Run: node test-integration/fixtures/make-typelink.mjs
//
// Four entries, the smallest dictionary that can answer the one question this fixture
// exists for: does a Data Type link built by core resolve back to the document the host
// opened? A type to link TO, a parameter that names it, and a parameter naming a built-in
// so the negative case is in the same file as the positive one.
//
// Deliberately OUTSIDE fixtures/workspace: adding an entry to workspace/params.sldd would
// change a file several other suites assert against, and its whole point there is to hold
// one of every class with nothing referring to anything.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('./typelink/', import.meta.url));
mkdirSync(dir, { recursive: true });

let n = 0;
const entry = (name, arrayClass, properties) => {
  n += 1;
  return {
    name,
    metadata: {
      uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
      lastmod: '20260914T000000.000000',
      modifiedby: 'make-typelink',
      isderived: '0',
    },
    value: {
      _array_class: arrayClass,
      _dimensions: [1, 1],
      _elements: [{ _id: String(n), _properties: properties }],
      _mw_element_type: 'MATLABArray',
    },
  };
};

const entries = [
  entry('MyAlias', 'Simulink.AliasType', { BaseType: 'uint8', DataScope: 'Auto', Description: '', HeaderFile: '' }),
  // Names MyAlias, so its Data Type must come out as a link to it.
  entry('Kp', 'Simulink.Parameter', { DataType: 'MyAlias', Value: 1, Complexity: 'real', Description: '' }),
  // Names a built-in, so its Data Type must stay plain text.
  entry('Gain', 'Simulink.Parameter', { DataType: 'double', Value: 2, Complexity: 'real', Description: '' }),
  // Names a parameter rather than a type: class-gated, so also plain text.
  entry('Borrowed', 'Simulink.Parameter', { DataType: 'Kp', Value: 3, Complexity: 'real', Description: '' }),
];

writeFileSync(
  dir + 'typelink.sldd',
  JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries } } },
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote typelink/typelink.sldd with ${entries.length} entries`);
