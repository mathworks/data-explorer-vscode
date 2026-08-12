// Copyright 2026 The MathWorks, Inc.
// Tier-1 orchestration: turn raw workspace files into GraphSource records for
// the relationship graph. Dispatches by extension. vscode-free (callers read
// files and pass bytes/text in).
import type { GraphSource, SourceType } from './graphModel.js';
import { extractReferences } from './slddRefs.js';
import { extractSlxStructure } from './slxStructure.js';
import { isZipBytes } from './slddFormat.js';
import { parseBinarySldd } from '../dex/datamodel/parser/BinarySlddParser.js';
import { parseProject } from '../dex/datamodel/parser/ProjectParser.js';
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
  if (path.endsWith('.slx')) return 'model';
  if (path.endsWith('.mat')) return 'mat';
  if (path.endsWith('.prj')) return 'project';
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
        if (isZipBytes(new Uint8Array(file.bytes))) {
          // Compressed SLDD: parseBinarySldd currently yields empty references.
          // Extract via the same JSON shape for forward-compatibility.
          const content = parseBinarySldd(file.bytes) as any;
          const refs =
            content?.__MW_TEXT_PARTS__?.['__MW_TEXT_PART__/data/chunk0']?.__MW_TEXT_content?.[
              'Dictionary References'
            ] ?? [];
          const names: string[] = Array.isArray(refs)
            ? refs.map((r: any) => (typeof r === 'string' ? r : r?.file)).filter(Boolean)
            : [];
          return { ...base, slddRefs: names };
        }
        // Fallback: treat bytes as UTF-8 JSON text.
        return { ...base, slddRefs: extractReferences(new TextDecoder().decode(file.bytes)) };
      }
    }
    // mat and everything else: node with no outbound relationships.
    return base;
  } catch {
    return base;
  }
}
