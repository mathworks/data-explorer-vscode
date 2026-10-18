// Copyright 2026 The MathWorks, Inc.
//
// The entries of a binary .sldd's data/chunk0.xml, found by reading its markup.
//
// For the binary save gate (BinarySlddEditorProvider.writeTo) and for cutting an entry's
// `<Object>` text out of a chunk for undo and redo. The gate compares a chunk with the chunk
// as last read or saved, entry by entry, and the maintainer's D12 addendum says how it may see
// them: with a structure-aware scan, never with core's reader, because a reader and a writer
// can lose the same thing and a re-read then shows nothing lost. So this reads the markup and
// nothing else, and core's reader never sees what it is handed.
//
// What it reads: comments and CDATA sections are skipped to their ends, a processing
// instruction to its first `?>`, each tag attribute by attribute with each value skipped to its
// closing quote, and every element is closed by name. An entry is an `<Object>` whose Class
// attribute is `DD.ENTRY`, directly inside the root, and its span runs from the `<` of its open
// tag to just past its close tag. Its name and UUID are the text of the entry's own
// `<P Name="Name">` and `<P Name="UUID">` children, as the bytes spell them.
//
// `clean` is false where the scan cannot vouch for what it read: a comment, CDATA section or
// processing instruction that is never closed, a DOCTYPE or any other `<!`, a `<` that starts
// no tag, an attribute that is not a name, `=` and a quoted value, a close tag that does not
// close the element open, or a document that is not one element. The entries before that point
// are still returned, but a caller that needs every entry must not use them.
//
// Linear in the length of the chunk: each step moves forward and none searches back.

/** One entry of a chunk, where its `<Object>…</Object>` sits in the text it was scanned from. */
export interface ChunkEntry {
  /** The `<` of its `<Object` open tag. */
  readonly start: number;
  /** Just past its `</Object>`. */
  readonly end: number;
  /** The text of its own `<P Name="Name">`, as the bytes spell it; null when it has none. */
  readonly name: string | null;
  /** The text of its own `<P Name="UUID">`, as the bytes spell it; null when it has none. */
  readonly uuid: string | null;
}

export interface ChunkEntries {
  readonly entries: ChunkEntry[];
  /** Whether the scan read the whole chunk; see the header. */
  readonly clean: boolean;
}

const LT = 0x3c; // <
const GT = 0x3e; // >
const SLASH = 0x2f; // /
const BANG = 0x21; // !
const QUESTION = 0x3f; // ?
const EQUALS = 0x3d; // =
const DQUOTE = 0x22; // "
const SQUOTE = 0x27; // '

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

// XML's name characters, closely enough for the tags MATLAB writes: anything that is not
// markup, a quote, `=` or whitespace. A name is never empty, and never starts with `-`, `.`
// or a digit.
function isNameChar(c: number): boolean {
  return (
    !Number.isNaN(c) &&
    !isSpace(c) &&
    c !== LT &&
    c !== GT &&
    c !== SLASH &&
    c !== EQUALS &&
    c !== DQUOTE &&
    c !== SQUOTE &&
    c !== BANG &&
    c !== QUESTION
  );
}

function isNameStart(c: number): boolean {
  return isNameChar(c) && c !== 0x2d && c !== 0x2e && !(c >= 0x30 && c <= 0x39);
}

/** Scan `xml` for its entries; see the header for what counts as one and what `clean` means. */
export function scanChunkEntries(xml: string): ChunkEntries {
  const entries: ChunkEntry[] = [];
  const open: string[] = [];
  const n = xml.length;
  let roots = 0;
  let pos = 0;
  // The entry being read: where it began, and its Name and UUID texts once they are read.
  let entryAt = -1;
  let entryName: string | null = null;
  let entryUuid: string | null = null;
  const unclean = (): ChunkEntries => ({ entries, clean: false });

  for (;;) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) break;
    const c = xml.charCodeAt(lt + 1);

    if (c === BANG) {
      const end = xml.startsWith('!--', lt + 1)
        ? xml.indexOf('-->', lt + 4)
        : xml.startsWith('![CDATA[', lt + 1)
          ? xml.indexOf(']]>', lt + 9)
          : -1;
      if (end < 0) return unclean();
      pos = end + 3;
      continue;
    }
    if (c === QUESTION) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) return unclean();
      pos = end + 2;
      continue;
    }
    if (c === SLASH) {
      let k = lt + 2;
      while (k < n && isNameChar(xml.charCodeAt(k))) k++;
      const name = xml.slice(lt + 2, k);
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      if (name === '' || xml.charCodeAt(k) !== GT || open.length === 0 || open[open.length - 1] !== name) {
        return unclean();
      }
      open.pop();
      if (open.length === 1 && entryAt >= 0) {
        entries.push({ start: entryAt, end: k + 1, name: entryName, uuid: entryUuid });
        entryAt = -1;
      }
      pos = k + 1;
      continue;
    }
    if (!isNameStart(c)) return unclean();

    // An open tag: its name, then name="value" pairs, each after whitespace, up to > or />.
    let k = lt + 2;
    while (k < n && isNameChar(xml.charCodeAt(k))) k++;
    const tag = xml.slice(lt + 1, k);
    let classAttr: string | null = null;
    let nameAttr: string | null = null;
    for (;;) {
      const gap = k;
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      const ch = xml.charCodeAt(k);
      if (ch === GT || ch === SLASH) break;
      if (k === gap || !isNameStart(ch)) return unclean();
      const attrAt = k;
      while (k < n && isNameChar(xml.charCodeAt(k))) k++;
      const attr = xml.slice(attrAt, k);
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      if (xml.charCodeAt(k) !== EQUALS) return unclean();
      k++;
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      const quote = xml.charCodeAt(k);
      if (quote !== DQUOTE && quote !== SQUOTE) return unclean();
      const close = xml.indexOf(quote === DQUOTE ? '"' : "'", k + 1);
      if (close < 0) return unclean();
      const value = xml.slice(k + 1, close);
      if (attr === 'Class') classAttr = value;
      else if (attr === 'Name') nameAttr = value;
      k = close + 1;
    }
    const selfClosed = xml.charCodeAt(k) === SLASH;
    if (selfClosed && xml.charCodeAt(k + 1) !== GT) return unclean();
    const openEnd = selfClosed ? k + 2 : k + 1;

    if (open.length === 0) {
      // A second root is not one document.
      if (++roots > 1) return unclean();
    } else if (open.length === 1 && tag === 'Object' && classAttr === 'DD.ENTRY') {
      if (selfClosed) {
        entries.push({ start: lt, end: openEnd, name: null, uuid: null });
      } else {
        entryAt = lt;
        entryName = null;
        entryUuid = null;
      }
    } else if (open.length === 2 && entryAt >= 0 && tag === 'P' && !selfClosed) {
      // One of the entry's own properties. Its text is what runs up to its close tag, when
      // nothing else is in it.
      if ((nameAttr === 'Name' && entryName === null) || (nameAttr === 'UUID' && entryUuid === null)) {
        const next = xml.indexOf('<', openEnd);
        if (next >= 0 && xml.startsWith('</P', next)) {
          const text = xml.slice(openEnd, next);
          if (nameAttr === 'Name') entryName = text;
          else entryUuid = text;
        }
      }
    }
    if (!selfClosed) open.push(tag);
    pos = openEnd;
  }
  return { entries, clean: roots === 1 && open.length === 0 };
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The text an entry's Name or UUID bytes spell, with XML's character references decoded. */
export function decodeXmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (all, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? all;
  });
}

/**
 * What an entry is known by across edits: its UUID, which a rename does not change, or its name
 * when it has none. The save gate pairs a chunk's entries with the last-saved chunk's by this,
 * and the edits record the entries they change by it.
 */
export function entryKey(name: string | null | undefined, uuid: string | null | undefined): string {
  return uuid ? 'uuid:' + uuid : 'name:' + (name ?? '');
}

/** An entry's key from the bytes, decoded so that it matches the model's spelling. */
export function chunkEntryKey(entry: ChunkEntry): string {
  return entryKey(entry.name === null ? null : decodeXmlText(entry.name), entry.uuid === null ? null : decodeXmlText(entry.uuid));
}
