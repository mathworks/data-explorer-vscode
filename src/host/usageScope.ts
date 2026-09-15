// Copyright 2026 The MathWorks, Inc.
// Which files can affect ONE file's Usage column.
//
// A Usage answer is inherently cross-file — a block parameter's name resolves mask →
// model workspace → linked dictionaries → MAT-files, first hit wins — so a tab cannot
// answer for itself. But it does not need the folder either: only a model can ORIGINATE a
// usage edge, and a model resolves through its OWN chain, so the files that can change one
// dictionary's answer are the models whose chain reaches it, plus those models' chains.
// Everything else in the folder is unrelated, and parsing it is what made opening a 27 KB
// dictionary cost as much as the largest model beside it.
//
// This module is the arithmetic only: it is handed the cheap Tier-1 relationships (see
// usageSources.ts, which extracts them with `scanModelStructure` rather than a full parse)
// and returns which uris to summarise. vscode-free, so the reasoning below is unit-tested
// directly.
//
// The set must give the same answers as the whole folder, which is a stronger requirement
// than being small, and constrains it in two ways that are easy to miss:
//
//   - it carries every file in a needed model's chain, not just the file being opened.
//     Core moves a usage DOWN the resolution order when the file that shadowed it is
//     absent (pinned in core's usageIndex.test.ts), so leaving a shadowing dictionary out
//     would credit an entry the block does not actually read.
//   - it is computed over refBasenames and keeps EVERY file having one. Core keys
//     `slddByName` by refBasename and the last assignment wins, so a set holding one of
//     two same-named dictionaries picks a different collision winner than the folder does.
//     Over-inclusion here is deliberate; the files it adds are the cheap ones.
import { refBasename } from './slddRefs.js';

/** What a source resolves names through — a model, or a data file that can be resolved to. */
export type ChainKind = 'model' | 'sldd' | 'mat';

/**
 * One file's Tier-1 relationships: what it resolves names through, refBasename'd.
 *
 * `chain` is in RESOLUTION order for a model — its linked dictionary first, then its
 * external data sources — matching core's `ModelSummary.slddRefs`. For a `.sldd` it is that
 * dictionary's own references. For a `.mat` it is empty and must stay empty: core's
 * `DataSummary.slddRefs` is empty for a MAT-file, which inherits nothing, so a chase out of
 * one here would reach files core's resolver never would.
 *
 * The entries are reference names as the FILE recorded them, and are matched
 * case-insensitively here (`refBasename`) — `EXTRADICT.SLDD` is a real link to
 * `extradict.sldd`, and core matches it the same way, as the file systems these live on do.
 * A caller that has already normalised them loses nothing: refBasename is idempotent.
 */
export interface ChainSource {
  uriString: string;
  path: string;
  kind: ChainKind;
  chain: string[];
}

/**
 * Every refBasename `source` can resolve a name through, transitively.
 *
 * Follows ALL same-basename candidates rather than the one that would win the collision:
 * this decides which files to READ, and reading a file the resolver then ignores costs a
 * cheap scan, while missing one costs a wrong answer.
 *
 * Cycle-safe through `seen` — a dictionary hierarchy can be cyclic, and the tree reports
 * that as a health state rather than refusing the folder.
 */
function chainClosure(source: ChainSource, byBase: Map<string, ChainSource[]>): Set<string> {
  const seen = new Set<string>();
  const queue = source.chain.map(refBasename);
  while (queue.length > 0) {
    const base = queue.shift() as string;
    if (seen.has(base)) continue;
    seen.add(base);
    for (const next of byBase.get(base) ?? []) {
      // Only a dictionary inherits. A `.mat` is a leaf and a model is not resolved THROUGH
      // — a model reference is not a data-source link, and following one would credit a
      // parent model with its child's usages.
      if (next.kind === 'sldd') queue.push(...next.chain.map(refBasename));
    }
  }
  return seen;
}

/**
 * The uris to summarise before answering Usage for the file at `openedUriString`, in the
 * order `sources` were given — which is folder order, and load-bearing twice: it decides
 * which file wins a basename collision, and the blocks in a Usage cell are listed in the
 * order their models were summarised.
 *
 * A uri not among `sources` returns all of them. That is the untitled or unreadable
 * document, where there is no chain to scope by and narrowing would be a guess.
 */
export function usageScope(openedUriString: string, sources: readonly ChainSource[]): string[] {
  const opened = sources.find((s) => s.uriString === openedUriString);
  if (!opened) return sources.map((s) => s.uriString);

  const byBase = new Map<string, ChainSource[]>();
  for (const s of sources) {
    const base = refBasename(s.path);
    const list = byBase.get(base) ?? [];
    list.push(s);
    byBase.set(base, list);
  }

  // Computed once per model: the reachability test below asks every model for its closure,
  // and a deep chain shared by many models would otherwise be walked once per model.
  const closures = new Map<ChainSource, Set<string>>();
  const closureOf = (s: ChainSource): Set<string> => {
    let c = closures.get(s);
    if (!c) {
      c = chainClosure(s, byBase);
      closures.set(s, c);
    }
    return c;
  };

  // Opening a MODEL needs no other model. Its Usage is its own blocks' origins and its own
  // workspace variables' users, and a workspace variable resolves only for the model that
  // owns it — so no foreign block can key a usage to this model's srcId. This is the case
  // that stops depending on folder size altogether.
  const openedBase = refBasename(opened.path);
  const models =
    opened.kind === 'model'
      ? [opened]
      : sources.filter((s) => s.kind === 'model' && closureOf(s).has(openedBase));

  const bases = new Set<string>();
  for (const m of models) {
    for (const base of closureOf(m)) bases.add(base);
  }

  const keep = new Set(models.map((m) => m.uriString));
  // The opened file itself, even when no model reaches it: "no usages" is an answer, and
  // giving it requires being in the index. A set that dropped it would answer emptily for
  // the different reason that the index never heard of the file.
  keep.add(opened.uriString);
  for (const s of sources) {
    if (s.kind !== 'model' && bases.has(refBasename(s.path))) keep.add(s.uriString);
  }

  return sources.filter((s) => keep.has(s.uriString)).map((s) => s.uriString);
}
