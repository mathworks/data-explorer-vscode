// Copyright 2026 The MathWorks, Inc.
// Tier-1 orchestration: turn raw workspace files into GraphSource records for
// the relationship graph. Dispatches by extension. vscode-free (callers read
// files and pass bytes/text in).
import type { GraphSource, SourceType } from './graphModel.js';
import { extractReferences, normalizeRefNames } from './slddRefs.js';
import { extractSlxStructure } from './slxStructure.js';
import { readSlddContent } from './slddContent.js';
import {
  isJsonTextBytes,
  isMatFile,
  isModelFile,
  isProjectFile,
  parseProject,
  slddChunkContent,
} from 'data-explorer-core';
import { basename } from '../common/pathUtil.js';

export interface RawFile {
  uriString: string;
  path: string;
  bytes?: ArrayBuffer; // for binary formats
  text?: string;       // for JSON .sldd (already read as text)
  // For a .prj: the project's resources/project/**/*.xml text, keyed by relpath
  // (relative to the project root). The host reads these; the parser stays pure.
  projectFiles?: Record<string, string>;
}

function typeOf(path: string): SourceType {
  // Both model containers are the same SourceType: a `.mdl` is a Simulink model,
  // so it gets the model icon, the model row builder, and the model relationship
  // extraction — not the `.sldd` fallback this used to drop it into.
  if (isModelFile(path)) return 'model';
  if (isMatFile(path)) return 'mat';
  if (isProjectFile(path)) return 'project';
  return 'sldd';
}

function empty(uriString: string, path: string, type: SourceType): GraphSource {
  return { uriString, path, type, slddRefs: [], modelRefs: [], dataSources: [], dataDictionary: null };
}

export function buildGraphSource(file: RawFile): GraphSource {
  const type = typeOf(file.path);
  const base = empty(file.uriString, file.path, type);

  try {
    if (type === 'model' && file.bytes) {
      const s = extractSlxStructure(file.bytes, file.path);
      return { ...base, modelRefs: s.modelReferences, dataSources: s.externalDataSources, dataDictionary: s.dataDictionary };
    }
    if (type === 'project' && file.projectFiles) {
      const name = basename(file.path).replace(/\.prj$/i, '');
      const parsed = parseProject(file.projectFiles, name);
      // Member files (basenames) nest under the project; referenced projects too.
      const projectFiles = parsed.files.filter((f) => !f.isFolder).map((f) => basename(f.path));
      const projectRefs = parsed.references.map((r) => r.name ?? r.id).filter((n): n is string => !!n);
      return { ...base, projectFiles, projectRefs };
    }
    if (type === 'sldd') {
      if (file.text != null) {
        return { ...base, slddRefs: extractReferences(file.text) };
      }
      if (file.bytes) {
        // WHICH format these bytes are is core's question, asked with core's own sniff:
        // this used to test for the zip magic itself, which is the same rule written a
        // second time, and the two did not agree on a textual dictionary that leads
        // with a BOM. A textual one then takes the same cheap scan as the branch above
        // — same file, so same treatment, and the tree deliberately does not parse a
        // whole dictionary just to draw its reference edges.
        const u8 = new Uint8Array(file.bytes);
        if (isJsonTextBytes(u8)) {
          return { ...base, slddRefs: extractReferences(new TextDecoder().decode(u8)) };
        }
        // Compressed: no cheap path exists, so read it properly. The content object is
        // reached through core's accessor rather than by walking `__MW_TEXT_PARTS__`
        // here, and the reference list goes through the same normaliser as the text
        // path, since the object-vs-string spelling is the writer's choice and not the
        // format's.
        const content = slddChunkContent(readSlddContent(file.bytes));
        return { ...base, slddRefs: normalizeRefNames(content?.['Dictionary References']) };
      }
    }
    // mat and everything else: node with no outbound relationships.
    return base;
  } catch {
    return base;
  }
}
