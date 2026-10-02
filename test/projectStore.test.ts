// Copyright 2026 The MathWorks, Inc.
//
// One function, four project formats, ONE shape out — and the branch that decides which of
// the two things on disk to read.
//
// `readProjectStore` is the whole of what this host knows about where a project's definition
// lives. Until R2026b that was a single rule (walk `resources/project/` beside the `.prj`),
// and `matlab.project.DefinitionFiles.Toml` makes it two: that format puts the entire
// definition in one `matlab.toml` at the project root and DELETES both `resources/` and the
// `.prj` marker, so there is no store to walk at all. Both answers are a relpath -> text map
// because the map is the interface `parseProject` dispatches on — it runs the TOML reader when
// it finds a `matlab.toml` entry among the keys — which is why the key is as much the contract
// here as the content is, and why the last test below hands the real map to the real parser
// rather than trusting that the key "looks right".
//
// Over a REAL directory tree in a temp dir, with `vscode.workspace.fs` stubbed onto `node:fs`,
// for the reason the repo's other project-store test gives from the other side: what is being
// checked is a walk of a filesystem and a read of a file, and a hand-written map of what the
// walk "would have" returned asserts against this test's own idea of the layout. What the stub
// deliberately does NOT model is the one thing a stub cannot — `FileType` as a BITMASK over
// symlinks, which is why test-integration/suite/projectStoreSymlink.test.ts exists and runs
// inside a real VS Code.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { parseProject, projectFallbackName, TOML_PROJECT_FILE } from 'data-explorer-core';

// The `vscode` surface readProjectStore actually uses, over `node:fs`. `joinPath` normalises,
// which matters: the function reaches the project root as `joinPath(marker, '..')`.
vi.mock('vscode', () => {
  const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
  return {
    FileType,
    Uri: {
      joinPath: (base: { path: string }, ...segments: string[]) => ({
        path: posix.join(base.path, ...segments),
      }),
    },
    workspace: {
      fs: {
        readFile: async (uri: { path: string }) => new Uint8Array(readFileSync(uri.path)),
        readDirectory: async (uri: { path: string }) =>
          readdirSync(uri.path, { withFileTypes: true }).map((e) => [
            e.name,
            e.isDirectory() ? FileType.Directory : FileType.File,
          ]),
      },
    },
  };
});

const { readProjectStore } = await import('../src/host/projectStore.js');

/** A marker path as the host sees one: a uri-ish object carrying only `.path`. */
const marker = (path: string) => ({ path }) as never;

let tmpRoot: string;

// <tmp>/XmlProj/                       the long-standing format: marker + store
//   XmlProj.prj
//   resources/project/root/pointer.xml
//   resources/project/Root.XML          upper-cased, deliberately (see the test)
//   resources/project/notes.txt         not a store document
// <tmp>/TomlProj/                      R2026b: ONE file, no marker, no resources/
//   matlab.toml
// <tmp>/HalfConverted/                 both, which is a conversion left unfinished
//   HalfConverted.prj
//   matlab.toml
//   resources/project/root/pointer.xml
// <tmp>/ShoutingProj/MATLAB.TOML       the name as a case-insensitive filesystem may spell it
const TOML_TEXT = [
  '# A definition that records no name, which is the case the fallback exists for.',
  'folders = ["src"]',
  '',
  '[project]',
  'description = "read by the TOML reader, not by ProjectParser"',
  '',
].join('\n');

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'dex-projectstore-unit-'));

  const xml = join(tmpRoot, 'XmlProj');
  mkdirSync(join(xml, 'resources', 'project', 'root'), { recursive: true });
  writeFileSync(join(xml, 'XmlProj.prj'), 'PK');
  writeFileSync(join(xml, 'resources', 'project', 'root', 'pointer.xml'), '<pointer/>');
  writeFileSync(join(xml, 'resources', 'project', 'Root.XML'), '<shouted/>');
  writeFileSync(join(xml, 'resources', 'project', 'notes.txt'), 'not a store document');

  const toml = join(tmpRoot, 'TomlProj');
  mkdirSync(toml, { recursive: true });
  writeFileSync(join(toml, TOML_PROJECT_FILE), TOML_TEXT);

  const half = join(tmpRoot, 'HalfConverted');
  mkdirSync(join(half, 'resources', 'project', 'root'), { recursive: true });
  writeFileSync(join(half, 'HalfConverted.prj'), 'PK');
  writeFileSync(join(half, TOML_PROJECT_FILE), TOML_TEXT);
  writeFileSync(join(half, 'resources', 'project', 'root', 'pointer.xml'), '<pointer/>');

  const shouting = join(tmpRoot, 'ShoutingProj');
  mkdirSync(shouting, { recursive: true });
  writeFileSync(join(shouting, 'MATLAB.TOML'), TOML_TEXT);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('a .prj reads its resources/project store, exactly as before', () => {
  it('keys every store document by its POSIX path relative to the project ROOT', async () => {
    const files = await readProjectStore(marker(join(tmpRoot, 'XmlProj', 'XmlProj.prj')));
    // The keys are what ProjectParser matches on — it only reads entries under
    // "resources/project/" — so they are the contract, not an implementation detail.
    expect(Object.keys(files).sort()).toEqual([
      'resources/project/Root.XML',
      'resources/project/root/pointer.xml',
    ]);
    expect(files['resources/project/root/pointer.xml']).toBe('<pointer/>');
  });

  it('reads an upper-cased store document and skips a non-document', async () => {
    const files = await readProjectStore(marker(join(tmpRoot, 'XmlProj', 'XmlProj.prj')));
    // `.XML` because these names come off a case-insensitive filesystem; `notes.txt` because
    // `.xml` is a part name inside the store, not everything that can sit in the folder.
    expect(files['resources/project/Root.XML']).toBe('<shouted/>');
    expect(Object.keys(files)).not.toContain('resources/project/notes.txt');
  });

  it('answers an empty map for a store that is not there, rather than throwing', async () => {
    // Normal, not exceptional: `parseProject` turns an empty map into an empty project that
    // says so in its warnings, which is what puts an unreachable store on the page instead of
    // behind a throw.
    const files = await readProjectStore(marker(join(tmpRoot, 'Nowhere', 'Nowhere.prj')));
    expect(files).toEqual({});
  });
});

describe('a matlab.toml IS the definition', () => {
  it('returns exactly one entry, keyed by the name core dispatches on', async () => {
    const files = await readProjectStore(
      marker(join(tmpRoot, 'TomlProj', TOML_PROJECT_FILE)),
    );
    expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
    expect(files[TOML_PROJECT_FILE]).toBe(TOML_TEXT);
  });

  it('walks no store, since the format deletes the one a .prj has', async () => {
    // The discrimination that matters: the branch is taken on the MARKER's name, not on
    // whether a store happens to be reachable. Read through the `matlab.toml` of a root that
    // ALSO still has a `resources/project/` tree — a conversion left unfinished — and the
    // store is absent from the answer, so the TOML reader is what core will run.
    const files = await readProjectStore(
      marker(join(tmpRoot, 'HalfConverted', TOML_PROJECT_FILE)),
    );
    expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
  });

  it('keys by the constant even when the filesystem spells the name differently', async () => {
    // `MATLAB.TOML` is the same file on macOS and Windows, and the kind test that admitted it
    // is case-insensitive for that reason. Core matches the entry by basename, so either
    // spelling would be read — but the map a host hands over should carry the one spelling
    // both repos use, not whatever case the disk had.
    const files = await readProjectStore(marker(join(tmpRoot, 'ShoutingProj', 'MATLAB.TOML')));
    expect(Object.keys(files)).toEqual([TOML_PROJECT_FILE]);
  });

  it('answers an empty map for a marker that is gone', async () => {
    // The window between a glob and a read is real — a `findFiles` result can be deleted
    // before the tree gets to it — and the answer is the same empty map a missing store gives.
    const files = await readProjectStore(marker(join(tmpRoot, 'Nowhere', TOML_PROJECT_FILE)));
    expect(files).toEqual({});
  });
});

// The seam, and the reason this test file is in THIS repo rather than in core: the key is
// chosen here and dispatched on there, and nothing inside either repo can see both halves.
// Core's own tests cover the TOML reader over its text; what is pinned here is that the map
// this host builds is a map that reaches that reader at all.
describe('the map reaches core’s TOML reader', () => {
  it('parses as the TOML format, named after the project FOLDER', async () => {
    const path = join(tmpRoot, 'TomlProj', TOML_PROJECT_FILE);
    const parsed = parseProject(await readProjectStore(marker(path)), projectFallbackName(path));
    expect(parsed.format).toBe('toml');
    // The definition above records no name, so the fallback is what titles the page — and for
    // this format the fallback is the parent folder, because the file is called `matlab.toml`
    // in every project that has one.
    expect(parsed.name).toBe('TomlProj');
  });

  it('parses the half-converted root’s .prj through ProjectParser, not the TOML reader', async () => {
    // The same root, read through the other marker: the store map carries no `matlab.toml`
    // key, so core walks the XML layout. This is what "the .prj branch is bit-for-bit what it
    // was" means in terms core can be asked about.
    const path = join(tmpRoot, 'HalfConverted', 'HalfConverted.prj');
    const files = await readProjectStore(marker(path));
    expect(Object.keys(files)).toEqual(['resources/project/root/pointer.xml']);
    expect(files[TOML_PROJECT_FILE]).toBeUndefined();
    expect(parseProject(files, projectFallbackName(path)).format).not.toBe('toml');
  });
});
