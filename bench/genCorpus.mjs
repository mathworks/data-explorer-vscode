// Copyright 2026 The MathWorks, Inc.
// Generates bench/corpus/ — the synthetic folder every scenario in
// bench/scenarios.bench.ts is measured over. Deterministic, offline, and
// regenerable: `node bench/genCorpus.mjs`.
//
// Why a generator and not committed fixtures: the point of the corpus is that ONE
// model is expensive enough for a duplicate parse to be visible in wall-clock time
// (120 000 blocks, ~11 MB of block XML), and an 11 MB binary has no business in git.
// The numbers in the spec's benchmark.md are only reproducible if the corpus is, so
// every value below is fixed — no randomness, no clock, no network.
//
// The SHAPE mirrors the four owners the shared-source-cache change is about:
//
//   large.slx          120 000 blocks, links shared.sldd, model-workspace bench.mat
//                      -> the file whose duplicate parse the change removes
//   big.sldd           ~20 MB of dictionary entries (BENCH_BIG_SLDD_MB), linked by
//                      bigmodel.slx -> the file that makes "read the whole folder
//                      twice" cost something. With only ~8 KB dictionaries a whole
//                      folder pass was 7 ms, so the corpus could not reproduce the
//                      case phase 4 is about; the real dictionaries behind that
//                      report are 47.8 MB and 138 MB, which this knob reaches.
//   chainBin.sldd      one hop of the chain in the COMPRESSED-BINARY (zip) format:
//                      chainA -> chainB -> chainBin -> chainC. Its
//                      DD.DICTIONARYREFERENCE element lives INSIDE the zip, so a
//                      tier that scraped references out of the bytes as text would
//                      see no edge here and answer that nothing reaches chainC.
//   small01..small20   300 blocks each. 01-10 link shared.sldd (so opening
//                      shared.sldd pulls eleven models into usage scope, including
//                      large.slx), 11-16 link their own dictN.sldd, 17-20 link
//                      chainA.sldd
//   chainA/B/C.sldd    a reference CHAIN, so usageScope has to walk more than one hop
//   orphan.sldd        linked by nothing — the control: it must pull NO model in
//   dict11..dict16     one private dictionary per model, so most of the folder is
//                      OUT of scope when shared.sldd is opened
//   bench.mat          a real Level-5 MAT-file (a scan tier reads it, so it cannot
//                      be a stub), referenced as large.slx's model workspace
//   BenchProj.prj      + resources/project/** — the .prj must be discovered by the
//                      tree's glob and ignored by the usage scope
//
// The .slx writer follows test-integration/fixtures/make-usageorder.mjs (the same
// `simulink/blockDiagram.json` + `simulink/systems/*.xml` package layout), and the
// MAT and compressed-binary-.sldd writers follow test/fixtures/make-fixtures.mjs
// (`bench.mat` from its Level-5 writer, `chainBin.sldd` from its `chain_top.sldd`).
// None of them is a new format reader — both were verified against core's parsers there, and the tail of this
// file re-verifies every generated file through core (parseModel / scanSldd /
// scanMat / parseProject) and FAILS if any of them parses to nothing. A corpus that
// silently parsed to empty would make every measurement in the harness meaningless
// while still looking fast.
import { zipSync, unzipSync, strToU8, zlibSync } from 'fflate';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const CORPUS = fileURLToPath(new URL('corpus/', import.meta.url));
const out = (name) => CORPUS + name;

// --- Corpus dimensions (the only knobs; change these and the numbers move) ----

const LARGE_BLOCKS = 120_000;
const LARGE_SYSTEMS = 40; // blocks split across this many `systems/*.xml` parts
const SMALL_MODELS = 20;
const SMALL_BLOCKS = 300;
const SHARED_ENTRIES = 400; // ~56 KB, the size of the real arch.sldd fixture
const PRIVATE_ENTRIES = 50;
const BIN_ENTRIES = 30; // chainBin.sldd — small: its job is the edge, not the bulk
/**
 * `big.sldd`'s target size in MB. The default is 20; the two real dictionaries behind
 * the 5.7 s report are 47.8 MB and 138 MB, so `BENCH_BIG_SLDD_MB=138 node
 * bench/genCorpus.mjs` reproduces the worst one. A size, not an entry count, because
 * what the folder passes cost is bytes read and JSON parsed.
 */
const BIG_MB = Number(process.env.BENCH_BIG_SLDD_MB ?? 20);
if (!Number.isFinite(BIG_MB) || BIG_MB <= 0) {
  console.error(`BENCH_BIG_SLDD_MB must be a positive number, got ${process.env.BENCH_BIG_SLDD_MB}`);
  process.exit(1);
}
const BIG_TARGET = Math.round(BIG_MB * 1024 * 1024);

const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>';
/** MATLAB's Design Data namespace uuid, as the checked-in fixtures spell it. */
const DESIGN_NS = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
/**
 * Every zip entry's stored timestamp, because fflate defaults it to `Date.now()` and
 * "deterministic" has to mean byte-identical, not merely same-sized: a corpus whose
 * files change every run cannot be diffed against the one a number was taken from.
 * Built from local parts rather than an ISO string so the DOS date fields (which
 * fflate reads off `getFullYear()` and friends) do not shift with the timezone, and
 * 1980 because that is the earliest a zip can spell.
 */
const ZIP_MTIME = new Date(1980, 0, 2, 0, 0, 0, 0);

rmSync(CORPUS, { recursive: true, force: true });
mkdirSync(CORPUS, { recursive: true });

// --- Dictionaries -------------------------------------------------------------

// The `__MW_TEXT_PARTS__` shape both .sldd formats deserialize to, written as JSON
// text — MATLAB's default dictionary format, and the one the editable table view
// opens. `refs` becomes the "Dictionary References" footer, which is what
// `scanSldd` reports as `slddRefs` and what `usageScope` walks.
function sldd(prefix, count, refs = []) {
  const entries = [];
  for (let i = 1; i <= count; i++) {
    entries.push({
      name: `${prefix}_${i}`,
      metadata: { uuid: `bench-uuid-${prefix}-${i}`, isderived: '0' },
      value: i,
    });
  }
  return JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: { entries, 'Dictionary References': refs, AllowAccessBWS: '0' },
        },
      },
    },
    null,
    '\t',
  );
}

writeFileSync(out('shared.sldd'), sldd('Shared', SHARED_ENTRIES));
// a -> b -> bin -> c. Three hops, so a scope that stops after one is visibly wrong,
// and the middle hop is a zip (see `binarySldd` below), so a scope that reads
// references as text is visibly wrong too.
writeFileSync(out('chainA.sldd'), sldd('ChainA', PRIVATE_ENTRIES, ['chainB.sldd']));
writeFileSync(out('chainB.sldd'), sldd('ChainB', PRIVATE_ENTRIES, ['chainBin.sldd']));
writeFileSync(out('chainC.sldd'), sldd('ChainC', PRIVATE_ENTRIES));
// Referenced by nothing. Opening it must summarise no model at all.
writeFileSync(out('orphan.sldd'), sldd('Orphan', PRIVATE_ENTRIES));

const privateDicts = [];
for (let i = 11; i <= 16; i++) {
  const name = `dict${i}.sldd`;
  writeFileSync(out(name), sldd(`Dict${i}`, PRIVATE_ENTRIES));
  privateDicts.push(name);
}

// --- chainBin.sldd: the compressed-binary format, mid-chain ---------------------
//
// The other .sldd format: a ZIP package whose `data/chunk0.xml` holds `DD.ENTRY` and
// `DD.DICTIONARYREFERENCE` objects. MATLAB writes this only when `dd.FileFormat` is
// set to 'compressed-binary' before `saveChanges`; the layout below is copied from
// test/fixtures/make-fixtures.mjs's `chain_top.sldd`, which was verified against a
// real one.
//
// It sits in the MIDDLE of the chain (chainB -> chainBin -> chainC) because that is
// where it can catch a wrong answer: its reference to chainC is inside the zip, so a
// cheap tier that scraped references out of the bytes as text would see chainB's
// chain end here, conclude that no model reaches chainC, and report chainC's entries
// as unused — a wrong answer, arrived at quickly, for the file the user is looking
// at. Scenario 10 in the harness is that scope, so the mistake shows up as a count.
function binarySldd(prefix, count, refs = []) {
  const objects = [];
  for (let i = 1; i <= count; i++) {
    objects.push(
      `<Object Class="DD.ENTRY">` +
        `<P Name="Name" Class="char">${prefix}_${i}</P>` +
        `<P Name="UUID" Class="char">bench-uuid-${prefix}-${i}</P>` +
        `<P Name="Namespace" Class="char">${DESIGN_NS}</P>` +
        `<P Name="IsDerived" Class="char">0</P>` +
        `<P Name="Value">` +
        `<Element Class="Simulink.Parameter">` +
        `<P Name="Value" Class="double">${i}.0</P>` +
        `<P Name="DataType" Class="char">double</P>` +
        `</Element>` +
        `</P>` +
        `</Object>`,
    );
  }
  for (const ref of refs) {
    objects.push(
      `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary">${ref}</P></Object>`,
    );
  }
  return zipSync(
    {
      'data/chunk0.xml': strToU8(
        `${XML_DECL}<DataSource FormatVersion="4" MinRelease="R2026b" Arch="maca64">` +
          `${objects.join('')}</DataSource>`,
      ),
      'metadata/mwcoreProperties.xml': strToU8(`<x><matlabRelease>R2026b</matlabRelease></x>`),
    },
    { mtime: ZIP_MTIME },
  );
}

writeFileSync(out('chainBin.sldd'), binarySldd('ChainBin', BIN_ENTRIES, ['chainC.sldd']));

// --- big.sldd: a dictionary big enough for a folder pass to cost something ------
//
// The tree and the usage cheap tier each read every .sldd in the folder, and with a
// folder of ~8 KB dictionaries that pass was 7 ms — so the first baseline could not
// reproduce the case phase 4 is about at all, and would have reported a fix for it as
// no change. Real dictionaries are the size of this one.
//
// Entry VALUES vary, because a dictionary of identical scalars is not what either the
// JSON parse or the row tree costs on a real file: the five shapes below are the ones
// the checked-in fixtures show MATLAB writing — a scalar, a vector, a `_type`/`_value`
// matrix, a `MATLABArray` struct, and a `Simulink.Parameter` object with its
// properties.
//
// Written a chunk at a time, and the loop is bounded by BYTES rather than by a count,
// so the size stays the knob and a 138 MB target does not have to fit in one string.
// The wrapper is stringified around a marker and split, so the outer JSON is still
// produced by `JSON.stringify` rather than by hand.
function bigValue(i) {
  const n = (k) => ((i % 97) + k) * 1.5;
  switch (i % 5) {
    case 0:
      return i * 0.5;
    case 1:
      return [n(1), n(2), n(3), n(4), n(5), n(6), n(7), n(8)];
    case 2:
      return {
        _type: 'double',
        _value:
          'Matrix(4,4)\n' +
          [0, 1, 2, 3].map((r) => `[${n(r)} ${n(r + 1)} ${n(r + 2)} ${n(r + 3)}]`).join('\n'),
      };
    case 3:
      return {
        _array_type: 'Struct',
        _dimensions: [1, 1],
        _elements: [
          { Gain: n(1), Offset: n(2), Limits: [n(3), n(4)], Notes: [`bench struct ${i}`] },
        ],
        _fields: ['Gain', 'Offset', 'Limits', 'Notes'],
        _mw_element_type: 'MATLABArray',
      };
    default:
      return {
        _array_class: 'Simulink.Parameter',
        _dimensions: [1, 1],
        _mw_element_type: 'MATLABArray',
        _elements: [
          {
            _properties: {
              Value: n(1),
              DataType: 'double',
              Complexity: 'real',
              Dimensions: [1, 1],
              DimensionsMode: 'auto',
              Min: [],
              Max: [],
              Unit: ['m/s^2'],
              DataScope: 'Auto',
              StorageClass: 'ExportedGlobal',
              Description: [`Bench parameter ${i}, generated by bench/genCorpus.mjs`],
            },
          },
        ],
      };
  }
}

const ENTRIES_MARK = '@@BENCH_ENTRIES@@';

/** Writes `name` until it is at least `targetBytes` long; returns the entry count. */
function writeBigSldd(name, prefix, targetBytes, refs = []) {
  const [head, tail] = JSON.stringify(
    {
      __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: ENTRIES_MARK,
            'Dictionary References': refs,
            AllowAccessBWS: '0',
          },
        },
      },
    },
    null,
    '\t',
  ).split(JSON.stringify(ENTRIES_MARK));

  // `entries` is nested four deep, so its elements indent by five tabs and its closing
  // bracket by four — which is what `JSON.stringify` would have emitted here.
  const ELEMENT = '\t'.repeat(5);
  const fd = openSync(out(name), 'w');
  // Buffered, because at BENCH_BIG_SLDD_MB=138 an entry-per-`writeSync` is ~290 000
  // syscalls. `text.length` counts characters, which is the byte count here because
  // everything written is ASCII — the entry names, the uuids, the numbers and the two
  // literal strings.
  const FLUSH_AT = 4 * 1024 * 1024;
  let pending = [];
  let pendingChars = 0;
  let size = 0;
  const flush = () => {
    if (pendingChars === 0) return;
    writeSync(fd, pending.join(''));
    pending = [];
    pendingChars = 0;
  };
  const put = (text) => {
    pending.push(text);
    pendingChars += text.length;
    size += text.length;
    if (pendingChars >= FLUSH_AT) flush();
  };
  put(`${head}[\n`);
  let count = 0;
  while (size < targetBytes) {
    count += 1;
    const entry = JSON.stringify(
      {
        name: `${prefix}_${count}`,
        metadata: {
          uuid: `bench-uuid-${prefix}-${count}`,
          namespace: DESIGN_NS,
          isderived: '0',
        },
        value: bigValue(count),
      },
      null,
      '\t',
    );
    put((count === 1 ? '' : ',\n') + ELEMENT + entry.split('\n').join(`\n${ELEMENT}`));
  }
  put(`\n${'\t'.repeat(4)}]${tail}`);
  flush();
  closeSync(fd);
  return count;
}

const BIG_ENTRIES = writeBigSldd('big.sldd', 'Big', BIG_TARGET);

// --- Models -------------------------------------------------------------------

// One `<Block>` per line, with a parameter whose value is an IDENTIFIER rather than
// a literal — `Gain`/`Value` are absent from SlxParser's NON_PARAM_PROPS, so each
// one becomes a recorded block-parameter usage that the full parse has to resolve.
// That is the work a duplicate `parseModel` does twice, so a corpus of literals
// would understate exactly the cost being measured.
function blockXml(index, entryName) {
  const prop = index % 2 === 0 ? 'Gain' : 'Value';
  const type = index % 2 === 0 ? 'Gain' : 'Constant';
  return (
    `<Block BlockType="${type}" Name="Blk${index}" SID="${index}">` +
    `<P Name="${prop}">${entryName}</P></Block>`
  );
}

/**
 * A model package: `blocks` blocks spread over `systems` parts, linked to the root
 * part by a SubSystem stub each — the R2020a+ layout core's parser walks
 * (`<System Ref="system_3"/>` inside a `<Block BlockType="SubSystem">`).
 *
 * `entryPrefix` names the dictionary entries the blocks reference, so the model's
 * usages actually resolve through the dictionary it links.
 */
function model({ uuid, dictionary, matFile, blocks, systems, entryPrefix, entryCount }) {
  const parts = {};
  const nameFor = (i) => `${entryPrefix}_${(i % entryCount) + 1}`;

  // Blocks are dealt out to the non-root parts; the root holds only the stubs, which
  // is the shape a model organised into subsystems has.
  const perPart = Math.ceil(blocks / systems);
  const stubs = [];
  let next = 1;
  for (let p = 0; p < systems; p++) {
    const chunk = [];
    for (let k = 0; k < perPart && next <= blocks; k++, next++) {
      chunk.push(blockXml(next, nameFor(next)));
    }
    if (chunk.length === 0) break;
    const ref = `system_${p + 1}`;
    parts[`simulink/systems/${ref}.xml`] = strToU8(`${XML_DECL}<System>${chunk.join('')}</System>`);
    stubs.push(
      `<Block BlockType="SubSystem" Name="Sub${p + 1}" SID="${100000 + p}">` +
        `<System Ref="${ref}"/></Block>`,
    );
  }
  parts['simulink/systems/system_root.xml'] = strToU8(
    `${XML_DECL}<System>${stubs.join('')}</System>`,
  );

  const diagram = {
    BlockDiagram: {
      DataDictionary: dictionary,
      ModelUUID: uuid,
      System: { Ref: 'system_root' },
      ...(matFile
        ? { ModelWorkspace: { WSDataSource: 'MAT-File', WSSourceFileName: matFile } }
        : {}),
    },
  };
  parts['simulink/blockDiagram.json'] = strToU8(JSON.stringify(diagram));
  parts['metadata/coreProperties.xml'] = strToU8(
    `${XML_DECL}<coreProperties><version>R2026b</version></coreProperties>`,
  );
  // No compression level tweak: `zipSync`'s default is what fflate writes elsewhere
  // in this repo. `mtime` IS pinned, so the corpus is byte-identical between runs.
  return { parts, bytes: zipSync(parts, { mtime: ZIP_MTIME }) };
}

const written = [];
function writeModel(name, built) {
  writeFileSync(out(name), built.bytes);
  written.push({ name, parts: Object.keys(built.parts) });
}

writeModel(
  'large.slx',
  model({
    uuid: 'bench-uuid-large',
    dictionary: 'shared.sldd',
    matFile: 'bench.mat',
    blocks: LARGE_BLOCKS,
    systems: LARGE_SYSTEMS,
    entryPrefix: 'Shared',
    entryCount: SHARED_ENTRIES,
  }),
);

for (let i = 1; i <= SMALL_MODELS; i++) {
  const n = String(i).padStart(2, '0');
  let dictionary = 'shared.sldd';
  let entryPrefix = 'Shared';
  let entryCount = SHARED_ENTRIES;
  if (i >= 11 && i <= 16) {
    dictionary = `dict${i}.sldd`;
    entryPrefix = `Dict${i}`;
    entryCount = PRIVATE_ENTRIES;
  } else if (i >= 17) {
    dictionary = 'chainA.sldd';
    entryPrefix = 'ChainC'; // resolves two hops down the chain
    entryCount = PRIVATE_ENTRIES;
  }
  writeModel(
    `small${n}.slx`,
    model({
      uuid: `bench-uuid-small${n}`,
      dictionary,
      blocks: SMALL_BLOCKS,
      systems: 3,
      entryPrefix,
      entryCount,
    }),
  );
}

// The one model that links big.sldd. Something has to: a dictionary no model reaches
// is out of every usage scope, so an unlinked big.sldd would only ever be a file the
// folder passes read — never one a Usage answer has to summarise models for.
writeModel(
  'bigmodel.slx',
  model({
    uuid: 'bench-uuid-bigmodel',
    dictionary: 'big.sldd',
    blocks: SMALL_BLOCKS,
    systems: 3,
    entryPrefix: 'Big',
    entryCount: Math.min(BIG_ENTRIES, SMALL_BLOCKS),
  }),
);

// --- bench.mat ----------------------------------------------------------------
//
// A Level-5 MAT-file, same writer as test/fixtures/make-fixtures.mjs: a 128-byte
// header then one miCOMPRESSED element per variable, which is what MATLAB's own
// `save` emits. Present because `scanMat` is a real tier in both the name index and
// the usage plan, and a stub file would exercise neither.

const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MX_DOUBLE_CLASS = 6;

const pad8 = (n) => (8 - (n % 8)) % 8;

function tagged(type, data, padding) {
  const buf = new Uint8Array(8 + data.length + padding);
  const view = new DataView(buf.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, data.length, true);
  buf.set(data, 8);
  return buf;
}

const subelement = (type, data) => tagged(type, data, pad8(data.length));
// NOT padded — readers advance by exactly 8 + byteCount over a compressed element.
const compressed = (data) => tagged(MI_COMPRESSED, data, 0);

const concat = (parts) => {
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.length;
  }
  return buf;
};

const int32s = (values) => {
  const buf = new Uint8Array(values.length * 4);
  const view = new DataView(buf.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v, true));
  return buf;
};

const float64s = (values) => {
  const buf = new Uint8Array(values.length * 8);
  const view = new DataView(buf.buffer);
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return buf;
};

function matrixElement(name, dimensions, values) {
  const flags = new Uint8Array(8);
  flags[0] = MX_DOUBLE_CLASS;
  return subelement(
    MI_MATRIX,
    concat([
      subelement(MI_UINT32, flags),
      subelement(MI_INT32, int32s(dimensions)),
      subelement(MI_INT8, new TextEncoder().encode(name)),
      subelement(MI_DOUBLE, float64s(values)),
    ]),
  );
}

function matFile(description, elements) {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 124);
  header.set(new TextEncoder().encode(description).slice(0, 116), 0);
  new DataView(header.buffer).setUint16(124, 0x0100, true);
  header[126] = 0x49; // 'I'
  header[127] = 0x4d; // 'M' — little-endian
  return concat([header, ...elements.map((el) => compressed(zlibSync(el)))]);
}

const MAT_VARS = 40;
writeFileSync(
  out('bench.mat'),
  matFile(
    'MATLAB 5.0 MAT-file, generated by bench/genCorpus.mjs',
    Array.from({ length: MAT_VARS }, (_unused, i) =>
      matrixElement(`Bp_${i + 1}`, [2, 3], [1, 4, 2, 5, 3, 6]),
    ),
  ),
);

// --- BenchProj.prj ------------------------------------------------------------
//
// A `.prj` is an empty marker; its structure lives in the sibling
// `resources/project/` store, which is where the host reads member files from (see
// src/host/projectStore.ts). The `<hash>p.xml` / `<hash>d.xml` pointer-and-def pair
// per entity, and the `<Info location="…" type="File"/>` shape, are copied from the
// real project artifacts under test/parity/artifacts/project — with the hashes
// spelled as readable words, since core's reader only uses them as directory names.
//
//   root/filesp.xml   type="Files"  -> the collection, whose entities live in files/
//   files/memberNp.xml type="File"  -> one member, named by `location`
//
// The `d.xml` halves are the defs; they hold labels, which this corpus has none of,
// but an entity with no def is not one core's `readDir` pairs up.

writeFileSync(
  out('BenchProj.prj'),
  `${XML_DECL}\n<MATLABProject xmlns="http://www.mathworks.com/MATLABProjectFile"/>`,
);
mkdirSync(out('resources/project/root'), { recursive: true });
mkdirSync(out('resources/project/files'), { recursive: true });
const store = (rel, xml) => writeFileSync(out(`resources/project/${rel}`), `${XML_DECL}\n${xml}`);
store('Project.xml', '<Info MetadataType="fixedPathV2"/>');
store('rootp.xml', '<Info/>');
store('root/filesp.xml', '<Info location="Files" type="Files"/>');
store('root/filesd.xml', '<Info/>');
store('root/namep.xml', '<Info location="ProjectData" type="Info"/>');
store('root/named.xml', '<Info Name="BenchProj"/>');
const PROJECT_MEMBERS = ['large.slx', 'shared.sldd', 'bench.mat'];
PROJECT_MEMBERS.forEach((member, i) => {
  store(`files/member${i}p.xml`, `<Info location="${member}" type="File"/>`);
  store(`files/member${i}d.xml`, '<Info/>');
});

// --- Verification -------------------------------------------------------------
//
// Every generated file goes through the parser the extension would use on it, and
// the result has to be non-empty. This is the assertion the whole harness rests on:
// a corpus that parsed to nothing would report beautiful timings for no work.

const core = await import('data-explorer-core');
const failures = [];
const check = (what, ok, detail) => {
  if (!ok) failures.push(`${what}: ${detail}`);
};

const bytesOf = (name) => {
  const buf = readFileSync(out(name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

// .slx: the zip must round-trip every part, the full parse must find every block,
// and the cheap structural scan must agree with it about the dictionary link.
for (const { name, parts } of written) {
  const back = unzipSync(new Uint8Array(readFileSync(out(name))));
  for (const key of parts) check(name, !!back[key], `lost part ${key}`);

  const ab = bytesOf(name);
  const parsed = core.parseModel(ab, name);
  const expected = name === 'large.slx' ? LARGE_BLOCKS : SMALL_BLOCKS;
  const usages = parsed.blockParamUsages?.length ?? 0;
  check(name, usages === expected, `${usages} block param usages, expected ${expected}`);

  const scanned = core.scanModelStructure(ab, name);
  check(
    name,
    scanned.dataDictionary === parsed.dataDictionary && !!scanned.dataDictionary,
    `structure scan says dictionary ${scanned.dataDictionary}, parse says ${parsed.dataDictionary}`,
  );

  // One file, so exactly one summary — and it must carry this model's usages, since
  // that is what the usage plan reads back out of it.
  const summary = core.summarizeFiles([{ srcId: name, filename: name, bytes: bytesOf(name) }]);
  const summarized = summary.models[0];
  check(
    name,
    summarized?.blockParams.length === expected,
    `summarizeFiles reported ${summarized?.blockParams.length} block params, expected ${expected}`,
  );
}

// .sldd: entries and the reference chain, through the scanner both the tree and the
// usage plan use.
const DICTS = [
  ['shared.sldd', SHARED_ENTRIES, []],
  ['big.sldd', BIG_ENTRIES, []],
  ['chainA.sldd', PRIVATE_ENTRIES, ['chainB.sldd']],
  ['chainB.sldd', PRIVATE_ENTRIES, ['chainBin.sldd']],
  ['chainBin.sldd', BIN_ENTRIES, ['chainC.sldd']],
  ['chainC.sldd', PRIVATE_ENTRIES, []],
  ['orphan.sldd', PRIVATE_ENTRIES, []],
  ...privateDicts.map((d) => [d, PRIVATE_ENTRIES, []]),
];
for (const [name, count, refs] of DICTS) {
  const scan = core.scanSldd(bytesOf(name));
  check(name, scan.names.length === count, `${scan.names.length} names, expected ${count}`);
  check(
    name,
    JSON.stringify(scan.refs) === JSON.stringify(refs),
    `refs ${JSON.stringify(scan.refs)}, expected ${JSON.stringify(refs)}`,
  );
}

// chainBin.sldd twice over, because the loop above would pass on a JSON file: it has
// to BE a zip, and its reference has to be read back OUT of that zip. Those two
// together are the only thing that makes it different from chainB.
const binBytes = readFileSync(out('chainBin.sldd'));
check(
  'chainBin.sldd',
  binBytes[0] === 0x50 && binBytes[1] === 0x4b,
  `not a zip — first bytes ${binBytes[0]?.toString(16)} ${binBytes[1]?.toString(16)}`,
);
const binRefs = core.scanSldd(bytesOf('chainBin.sldd')).refs;
check('chainBin.sldd', binRefs.length > 0, 'compressed dictionary read back with no references');

// The chain has to be walkable all the way THROUGH the zip, since that is what puts
// small17..small20 in chainC's usage scope. Checked here rather than left to the
// harness: if this edge breaks, every scope number downstream is quietly wrong.
const chainRefs = (name) => core.scanSldd(bytesOf(name)).refs;
const walked = ['chainA.sldd'];
for (let hop = 0; hop < 5 && chainRefs(walked[walked.length - 1]).length > 0; hop++) {
  walked.push(chainRefs(walked[walked.length - 1])[0]);
}
check(
  'chain',
  walked.join(' -> ') === 'chainA.sldd -> chainB.sldd -> chainBin.sldd -> chainC.sldd',
  `walks ${walked.join(' -> ')}`,
);

const matScan = core.scanMat(bytesOf('bench.mat'));
check('bench.mat', matScan.names.length === MAT_VARS, `${matScan.names.length} names, expected ${MAT_VARS}`);

// .prj: the store read the way src/host/projectStore.ts reads it — every *.xml under
// resources/project, keyed by project-root-relative POSIX relpath.
function readStore(relDir, into) {
  for (const entry of readdirSync(out(relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) readStore(rel, into);
    else if (entry.name.endsWith('.xml')) into[rel] = readFileSync(out(rel), 'utf8');
  }
  return into;
}
const project = core.parseProject(
  readStore('resources/project', {}),
  core.projectNameOf('BenchProj.prj'),
);
const members = project.files.filter((f) => !f.isFolder).length;
check('BenchProj.prj', members === PROJECT_MEMBERS.length, `${members} member files, expected ${PROJECT_MEMBERS.length}`);

if (failures.length > 0) {
  console.error('corpus verification FAILED:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}

const sizeMb = (name) => (statSync(out(name)).size / 1024 / 1024).toFixed(1);
console.log(
  `wrote ${written.length} models + ${DICTS.length} dictionaries + bench.mat + BenchProj.prj to bench/corpus/\n` +
    `  large.slx  ${LARGE_BLOCKS} blocks, ${sizeMb('large.slx')} MB\n` +
    `  big.sldd   ${BIG_ENTRIES} entries, ${sizeMb('big.sldd')} MB (BENCH_BIG_SLDD_MB=${BIG_MB})\n` +
    `  chainBin.sldd  compressed-binary, ${BIN_ENTRIES} entries, refs ${JSON.stringify(binRefs)}`,
);
