# Change Log

All notable changes to the Simulink Data Explorer extension. Versions follow the
`vX.Y.Z` tags in this repository; each tag builds the `.vsix` attached to its
GitHub Release.

Entries before this file existed were reconstructed from those release tags.

## [1.36.2] — 2026-10-09

An MCOS object saved inside a struct field or a cell element now opens as exactly what the same object is at top level, in a `.mat` file and in an `.slx` or `.mdl` model workspace alike. This covers a `Simulink.Parameter`, a `Simulink.Bus`, a `string`, and every class the extension already shows at top level. Before, such an object was a `<1x1 Simulink.Parameter>` or `<1x1 string>` leaf with no value and no properties. The object's data lives in the file's one shared MCOS store, and the reader looked that store up only for named top-level variables, by name, so a field or a cell element, which has no name of its own, was never decoded. Now every object at any depth carries its handle into the store and is decoded against it, just as a top-level one is, and its row is built by the same rule. A nested Parameter shows its Value and its property rows, a nested string shows its text, and a nested object array has its elements. Some things are unchanged on purpose. A cell's one-line value still spells each object `<1x1 Class>`, a struct's summary is still `<1x1 struct>`, a nested name still cannot be edited, and the file is still read-only. An object whose handle is damaged or names nothing stays the opaque leaf it was, and its neighbours are unaffected. This was checked against MATLAB on two new reference files. Each saves every nested object beside a top-level twin of equal value, built separately, because a `Simulink.Parameter` is a handle and a copy made by assignment would share the nested one's storage and prove nothing. All 24 pairs present identically: 22 in a `.mat` file and 2 in a model workspace. The change is `data-explorer-core` 1.36.0. This version also ships `strnum` 2.4.2, the number parser the dictionary XML reader uses.

## [1.36.1] — 2026-10-03

The filter popup a column header opens now shows which comparison it is about to write, in every theme. The seven operator buttons mark the chosen one by painting its background, and that background came from a colour name the themes do not define — so instead of the colour, each button painted the pale blue literal written beside the name as a fallback, in all four themes at once. On a dark theme that is a pale blue tile under near-white text, 1.22:1 against its own glyph; on High Contrast Black, 1.31:1. The one element in the popup that says whether Apply will write `contains` or `≥` was the one element a dark-theme user could not read, and nothing anywhere reported a problem, because a colour name nothing declares is not a missing colour but a silent one — every reader of it quietly takes its own fallback. All four themes now measure past 7:1. The value is not a new choice: the extension already defines the colour it uses for a selected surface, mapped onto the one VS Code paints selections with, and the literal that had been shipping was that same colour with one digit changed — a misspelled name rather than a design. The `writes:` line beside it, which shows the literal text to retype into the search box, was reading a font name that is also undefined and so ignored the font you actually type code in; it now follows `editor.fontFamily` like the rest of the extension's monospace. High-contrast forced-colors mode was never affected and still marks the chosen operator with a system-colour outline. The underlying mistake is now caught by a test rather than by a customer: every theme colour this popup asks for must be one the themes define, so a name invented by accident fails in the test suite instead of going quiet in a theme nobody opened.

## [1.36.0] — 2026-10-02

A file too large to show whole now lists every entry it has and loads a row's contents when that row is opened, where before it hung with no table and no message. Reported against an 8 MB `allMidi.mat` — a cell array of MIDI songs — which "keeps spinning" and never opens: it flattens to 2,016,325 nodes over 7 levels, a row was built for every one of them, and the resulting `setRows` payload was 704 MiB of JSON. V8 cannot produce a string that long (the limit is 536,870,888), so `JSON.stringify` threw inside VS Code's own `postMessage`, which is `async` and serializes the message itself — the throw therefore arrived as a rejected promise that the `try`/`catch` around the post could not see, nothing posted `setRows`, nothing posted an error, and the table's spinner ended on nothing else. Three layers, because there were three faults. The post is now awaited and a rejection becomes the error banner, so an undeliverable payload can never again be silent. A hard cap of 100,000 rows sits in front of the read-only row payload — not a tuning knob but what keeps the payload serializable at all, sized for the worst row shape rather than the measured 366 B, and taken as a PREFIX because every builder emits a parent before its children and a prefix is the only cut in which every surviving row's parent is also present; a sample would leave orphans the webview cannot place. The editable `.sldd` views get the guard but not the cap, since a structural edit computed against a truncated row set is worse than an honest banner. And then the cap alone, which is where this version's real work is: a prefix of a 2-million-row pre-order traversal is the first cell's descendants and nothing else, so ten of the eleven top-level variables were not on screen and no gesture could reach them — the file opened and was still unusable. The rule now is breadth over depth, for every data source and every entry type: stop expanding large entries, but list all entries, because a name present matters more than a value shown. The payload is planned by whole LEVELS of the tree, level by level while the next one fits, and the first level that does not is omitted entirely rather than half-delivered — which is what makes a deferred row mean exactly "has children, none of them here" and makes one fetch the whole answer for that row. The reported file now delivers 238 rows, levels 1 through 4 complete, and paints them in 7 ms. One plan spans every section rather than one plan per section, and that is the half the rule actually turns on: a per-section plan would also deliver whole levels and also defer honestly while spending the budget on the depth of section 1 and leaving section 9's entries unnamed, so a dictionary's References heading would read as empty on a file whose Design Data is deep. Opening a deferred row fetches it: the twisty is driven by the deferred mark as well as by delivered children — through one predicate read by the click, the Space key and `aria-expanded` alike, so a tree a mouse can open is one a keyboard can open — the click asks the host, the host answers from the same planner that built the payload, and the rows are merged under their parent instead of being routed through a fresh payload, which would re-derive the columns and close an open grid view. Pairing the two halves on one choice of planner is deliberate: a fetch answered by a different rule than the payload was built with is a row that opens onto the wrong thing, with no error anywhere. The answer carries a count of children that got no row at all, for the one loss a fetch can still inflict — a node with more direct children than a whole delivery holds, since a cell's children are built uncapped — and the table says that number in the banner strip, because the file's own banner was composed before the user opened anything and cannot. Entry-scoped repaints, which is how an edit writes back, take the same budget: a 1000x1000 double is 1,000,001 rows from a single name, enough to be the whole problem by itself. That banner is also now in the strip rather than in the document's normal flow ahead of a full-bleed `position:absolute` table, which had been painting over it — an error message that was in the DOM and on screen nowhere, leaving the panel reading "No data". Qualified against the reported file in a real browser over the shipped bundle: all eleven variables named, the banner legible in both themes, descending to a frontier row costing no round trip until the frontier itself, and opening a 1x19252 struct array four levels down posting one request, answering in 90 ms and landing its rows under the row that was clicked. Unchanged by any of this: parsing that file still costs about 2.3 GiB of extension-host heap, so a file several times larger exhausts the host before a single row is built — that is the MAT reader in `data-explorer-core`, and no amount of planning on this side recovers it.

## [1.35.0] — 2026-10-02

A project stored as a single `matlab.toml` now appears in the Simulink Data Explorer panel with the same hierarchy as the three XML formats, and its top node opens the project page — the fourth and last of `matlab.project.DefinitionFiles`. The reason it showed nothing before was not a reader that could not read it but a marker that was not there: `convertDefinitionFiles(root,"Toml")` deletes `resources/` and the `.prj` both, leaving one file at the project root that this extension was not registered for, so the folder held nothing it was ever asked to open. That marker is now found by NAME, the first one here that is not identified by an extension, and the distinction is the whole of why: `.toml` as an extension would make every `Cargo.toml`, `pyproject.toml` and `ruff.toml` in a workspace a MATLAB project — a wrong answer a user sees, as a tree row, an editor offer and a page declaring nothing. Carrying a bare filename turned the file glob into a flat brace union of whole patterns, since `**/*.{sldd,mat,prj,slx,mdl}` cannot hold one: the `*.` sits outside the braces. **Clicking `matlab.toml` in VS Code's Explorer still opens the plain text editor**, which is the point of the format — it exists to be hand-edited and read in diffs — so the page is a second editor entry at option priority rather than a pattern added to the existing one. Priority is a property of the entry and not of the glob, and that entry is the default for five formats, so the one-line version of this change would have either hijacked a text file or demoted `.sldd`, `.mat`, `.slx`, `.mdl` and `.prj` along with it. The page carries a `View as Text` button back, saving a hand edit repaints it, and the tree row re-badges as modified. A project of this format is named from the file's own `name`, falling back to the folder holding it rather than to the filename — every project in the format spells its definition `matlab.toml`, so a stem would title all of them "matlab", and the three host paths that reduce a marker to a name (the page, the tree's group label, and the name handed to the parser) now share one function so they cannot drift into one project under two names. What the page does NOT show is a member count or a label-coverage fraction, and it says why in a line where they were: this document records no file list, and every file under the project root is a member. MATLAB's own API answers 9 members for the test project — by asking the filesystem, since the document lists none — so a number here was implementable and was rejected deliberately: it would make the page's figures depend on disk state rather than on the document it is a view of, and `0` would be a false sentence rather than a missing one. Each label is drawn instead with the entries it declares, which is the inverted assignment only this format has — a label naming its files, where a store assigns labels per member file — as plain text and not links, because the format advertises glob patterns there and a pattern names no file a host can open. The counts are typed nullable all the way from the parser so that one reaching the markup cannot be silent, and that mattered at two of the three places that read one: the Labels header failed to compile, while the identity line's `memberCount + ' members'` swallowed a `null` into the word and had been rendering `null members`, and a label chip would have come out carrying the `.unused` class — the page asserting a project uses a label for nothing, the one thing a document with no member list cannot say. A `matlab.toml` that does not parse still produces a project node with a warning banner naming the line and column, rather than disappearing from the panel, which is how a damaged XML store already behaves. The parse is a real TOML parser (`smol-toml`, BSD-3-Clause, no dependencies) and not a hand-rolled subset, for the same reason the Explorer keeps the text editor: a file meant to be edited by hand arrives with comments, quoting variants, dotted keys and multi-line arrays, and a subset parser that mis-reads one of them draws a confidently wrong page. The same small project converted into all four formats is now asserted to parse to the same name, path folders, references, shortcuts, working folders and startup and shutdown run order — and to differ in exactly the places MATLAB itself makes it differ, which the conversion says out loud: it warns `MATLAB:Project:Issues:LabelDataLoss`, dropping every label's data string and the built-in read-only category outright, so a TOML project showing fewer labels than the same project in an XML layout is the format and not the reader.

## [1.34.0] — 2026-10-02

Three things a generated four-format project corpus found, all of them visible on the project page. A label the user added was drawn as one of MATLAB's built-ins: `ReadOnly` has a vocabulary per element — `READ_ONLY`/`WRITABLE` on a label, `1`/`0` on a category — and the old rule tested the attribute's presence rather than its value, so a real project's explicit `WRITABLE` read as read-only and the chip that marks a project's own labels went missing. Startup files were listed bottom-up: run order is a linked list through the store, and a freshly built project puts no `Extension` element on its first entry where an older one writes `Value="HEAD"`, so a walk that started only at the literal `HEAD` found no head at all and fell back to store order, which is the reverse. And the label catalog and the working-folder list came back in store order, which differs per definition-file layout, so the same project read two different ways depending on how it had been saved. The corpus behind all three is one small project converted into every `matlab.project.DefinitionFiles` format with MATLAB's own answers recorded beside it, which is what made the disagreements findable; the fourth format, `Toml`, still showed as unreadable at this version, and for the reason v1.33.0 named — the conversion deletes `resources/` and the `.prj` marker both.

## [1.33.0] — 2026-10-02

A project whose definition files are a single XML document opens and shows its content. `matlab.project.convertDefinitionFiles(root,"SingleFile")` replaces the whole `resources/project/` tree — 1,166 sidecar documents for the 372-member project this was reported against, 580 after a `MultiFile` conversion — with one 113,159-byte `Project.xml`, and after that the project read as empty: the page carried nothing but `No readable project entries were found under resources/project/, so this project reads as empty`. The store reader indexed a document only if its root element was `<Info>`, which every sidecar's is. A single-file store's one document is rooted at `<project MetadataType="monolithic">`, so the only document in the store was dropped before the layout was looked at, the index came out empty, and the branch for a store that holds nothing readable answered first — which is why the message blamed the folder for being empty rather than naming a format it could not read. That root is now recognized structurally, ahead of the declared `MetadataType`, because in this one layout the manifest IS the store and there is no separate document to ask; the document is then walked by a third layout behind the seam the other two already use, so the seven readers that turn entities into files, folders, labels, references, entry points, path folders and working folders are untouched and still do not know which layout answered them. Two things in that document are not what they look like, and each costs the project something if taken at face value: `<Info>` names both every entity's own definition and the entity type holding the project's name, separated by nothing but a `Location` attribute, so a walker that takes the first `<Info>` it finds reads the project as nameless; and an element carrying neither attributes nor children parses as the empty string rather than an object, which is exactly the shape of the bare `<DIR_SIGNIFIER/>` that is the only thing making a folder a folder. The same project converted to all three XML formats now parses to the same result — 372 files, 89 folders, 197 of them labelled, 88 path folders, 7 labels, 14 entry points in 2 groups, 3 working folders, the same startup and shutdown run order, and no warnings on any of the three — and that equality is what the new tests hold onto: one small project hand-authored in `fixedPathV2`, `distributed` and `monolithic` is asserted to parse to one and the same project, so a change that serves one layout at another's expense goes red. The fourth format, `DefinitionFiles.Toml`, is still not read, and now for a plainer reason than before: it removes `resources/` and the `.prj` marker outright and writes a root `matlab.toml`, so there is no file the extension is asked to open.

## [1.32.0] — 2026-10-01

The Variable Editor opens on a matrix of any size, including the 1000x1000 double whose dictionary only just became openable. v1.31.0 stopped an array past 10,000 elements from expanding into one table row per element, which is what made that file open at all — but the mini table was drawn from those element rows, so the entry that most wanted a grid was the one entry whose panel had nothing to fill it. The limit stays where it is: it answers a question about the table, where a million rows cannot be scrolled, and opening the panel is a separate gesture the user makes deliberately. So the two are separated. A row now carries only a description of its matrix — name, class, shape, and the node it came from, 485 bytes — and none of its cells. Clicking the glyph opens a titled panel immediately with a `Loading…` line and asks the host for that one node, which answers with every element's label and value read straight out of the value itself rather than off element nodes that no longer exist. Sorting, filtering, and repainting the table never carry the cells, so an entry nobody opens costs nothing; before this, every griddable entry's cells were stamped into its row and paid for again on every repaint. The grid's own limit is a million cells, independent of the table's. For the 1000x1000 entry the host produces all million in 460 milliseconds and 4 MB, the panel stays capped at 658x357 and scrolls, the first cell reads `matLarge(1,1)` and takes focus, and closing it gives back every byte. The grid builds only the cells near the scroll position, on both axes, and pads for the rest — the rule the main table has always used for its rows, now shared with the grid rather than copied into it — so that panel holds 504 cells and 5,028 elements instead of a million and 7.6 million: the webview's share of the open falls from 7.9 seconds to 63 milliseconds, the renderer holds 22 MB where it held 642, and a scroll settles in about 20 milliseconds rather than 94. Scrolling across sixteen of a thousand columns is only possible if a column's width is known before its content is, the padding beside the window being a count of columns times one width; so every column now takes the width of the matrix's widest cell, measured once and capped, as MATLAB's own Variable Editor lays a numeric grid out, and a cell too long for that is cut with an ellipsis and carries its full text on hover. The pinned row and column numbers are opaque, so the cells that scroll behind them are hidden rather than showing through: a sticky cell paints its own background and nothing is painted between it and what it covers, and these were painting black at 4%, which left the numbers of the row underneath drawn through the numbers labelling the column. That wash was the visible part of a larger mistake — the whole panel read a family of colour variables nothing declares, so every colour in it was the grey written beside the variable as a fallback, and in a dark theme the Variable Editor was a near-white box of near-black text floating over a dark editor. It now takes its surface from the colour VS Code paints a widget over the editor with, its ink and grid lines from the same tokens the main table uses, and the header from a mix of the two that is opaque by construction and darkens a light theme while lightening a dark one. A focused cell has a visible focus ring again — the outline named a variable holding a shadow rather than a colour, which made the declaration invalid and dropped it entirely, on the one surface here that can only be crossed by keyboard.

## [1.31.0] — 2026-10-01

A dictionary holding a very large matrix opens. One with a 1000x1000 double did not: the tab stayed blank for about two and a half minutes and then reported `Failed to parse <file>: Maximum call stack size exceeded`, naming the parse, which was the one stage that had worked — it took a second. What followed it did not. The data model built one row-bearing node per element, 1,000,001 of them for that single entry at about 690 MB, and derived each element's `name(r,c)` label by searching its parent for itself, which is a search per element and so grows with the square of the array: 1.5 µs at the first element, 325 µs at the millionth, around 161 seconds for the one entry. The table then flattened the result into 1,000,001 rows and passed them as individual arguments to a single call, which is where the engine's limit — between 100,000 and 125,000 arguments — produced the error text, in the last place able to report anything and the wrong place to name. An element's label is now read directly rather than searched for, and verified against the position it claims so that reordered rows stay labelled by where they are; rows are appended one at a time, as the name index beside them already was; and an array past 10,000 elements stops expanding into element rows, showing `<1000x1000 double>` in its Value cell and nothing beneath it. That last limit sits above the 4,096 the matrix grid draws at, so every matrix that could be gridded still has the per-element rows the grid is built from. Nothing about the value changes: it is held and saved in full, and the entry in question writes back byte-identical to the four megabytes of text the file itself holds for it. The file now opens in about 300 milliseconds, with 1,275 rows and a 0.6 MB table payload in place of 413 MB.

## [1.30.4] — 2026-10-01

A selected row reads as blue again on an ordinary light or dark theme, and a cell a row has no use for stays distinguishable on it. VS Code's new default themes redefine the colour a selected list row takes as a translucent neutral — "Light 2026" uses black at 14.5% — which is the same kind of darkening as the wash this table marks a not-applicable column with, three times its strength and in the same direction, so a normal cell on a selected row came out darker than a washed cell on an unselected one: the wash kept its step and lost its meaning. The surface now comes from the colour the theme selects text with in the editor itself, at half strength, together with the ink that colour is read with. Half rather than full because a selection colour has to be a mid-tone and the dim read-only text sits between it and the row ink; halving moves the row back toward its own background, which lightens a light theme and darkens a dark one, and read-only text on a selected row measures 4.6:1 or better on each of the four themes that name a selection colour of their own — the Modern and 2026 pairs. Both high-contrast themes keep the colour they had. Light+ and Light Visual Studio name none, so they take the pale blue every theme falls back to in place of the saturated one they were using, and their read-only text stays under that mark on a selected row as it already does at rest and hovered, those themes having left all of their text at a grey that reads 3.5:1

## [1.30.3] — 2026-10-01

A project page now escapes the counts it prints by the same rule as the names beside them. Three counts — a label's members, how many members carry a label at all, and the project's own member count — reached the markup by bare concatenation, looking exempt because each is typed `number`; but that type is a claim the parser makes, and the page reads it on the far side of a `postMessage` boundary where the payload is JSON and nothing re-checks the declaration. `memberCount` showed the split directly, escaped where the page writes its identity and raw in the Labels header: one field under two rules. Nothing renders differently for a real project, whose counts are computed by counting, and the page's content-security policy admits no inline script, so injected markup could not have run — what this closes is the gap in the escaping itself. The README is rewritten alongside it to say each thing about the extension once, having grown four layers that repeated one another: "no MATLAB or Simulink installation required" appeared five times and which files can be edited seven

## [1.30.2] — 2026-10-01

Searching a table now searches its entries and not the names of the sections they are filed under, so typing `data` in a dictionary lists the entries that hold the word rather than everything under Design Data and Architectural Data. A section heading had been an ordinary row to the search box, and because a match keeps everything beneath it, one hit on a heading's own name brought its whole section back and the search appeared to do nothing — worst for a search for an empty cell, since a heading's cells are all empty and `Unit=` therefore matched every heading and so the entire file. Headings still appear above the entries that matched, now without the highlight that claimed the heading itself was one of them

## [1.30.1] — 2026-10-01

A MATLAB or Simulink Project whose `resources/project` store keeps part of itself behind a symlink — a folder or a single document linked in from elsewhere, which is how a project shared across a team or assembled by a build often reaches disk — now opens complete. Before, everything behind such a link was skipped without a word: the page offered no warning and no empty section, just a smaller project that looked whole, and where the lost part was the label catalog the page went further and stated the opposite of the truth, filing a label the project does define under "Not in the label catalog". On a four-member test project with one store folder linked in, 15 of its 32 store documents were going unread

## [1.30.0] — 2026-09-30

A Managed Simulink Project's page now says what kind of project it is and names the two dictionaries the type keeps apart: `interface` for the types the project publishes to everything that references it, `private` for the values only it sees, each one a link to the dictionary it is and each with a sentence saying what it is for. A project that keeps no private values draws that half as absent rather than hiding it, the shared configuration set is named where there is one, and the projects it references are called components and open their own project page instead of revealing a folder. Clicking a project in the Simulink Data Explorer tree now opens its page too — the group header is the `.prj`, and it used to be the one row in the tree that did nothing when clicked

## [1.29.0] — 2026-09-30

A MATLAB Project opens as a page about the project instead of a table of four sections: what runs when it opens and closes, numbered in the order MATLAB runs them; its shortcuts under the groups it files them in; the MATLAB path; the folders it designates for simulation cache and generated code; its label catalog with how many members carry each label; and the projects it references. Every file it names is a hyperlink that opens that file — or reveals the folder, where the project named a folder — and a section long enough to need one has a search box

## [1.28.4] — 2026-09-30

Opening a data dictionary no longer warns that the System Composer interface dictionary part "holds nothing readable" when that part is simply empty, which is what MATLAB writes into any dictionary System Composer has touched; the file is complete, and the entry kinds shown without a catalog were measured to be the ones MATLAB reports without it too

## [1.28.3] — 2026-09-30

Every GitHub Release now carries a `SHA256SUMS` file beside the `.vsix`, so a download can be checked with `sha256sum -c SHA256SUMS` before it is installed

## [1.28.2] — 2026-09-30

Getting Started installs the extension from the Visual Studio Code Marketplace, in the Extensions view or from the command line; installing a downloaded `.vsix` by hand is still documented, as the optional path below it

## [1.28.1] — 2026-09-30

Every entry the `⊞ Add` gallery creates was compared against one MATLAB creates itself, in both dictionary formats, and four differences were closed: a variant configuration now lands in Design Data, where MATLAB keeps it and where MATLAB was refusing it before; a configuration reference is named the way MATLAB requires; and two classes whose state MATLAB stores as a single struct are written and read back intact in the compressed-binary format, so opening a dictionary and saving it no longer empties them

## [1.28.0] — 2026-09-29

The `⊞ Add` gallery is a sheet of frosted glass that lines its borders up with the filter bar's buttons, follows the tab as it resizes, and stops widening once every tile fits one row — and its tiles are narrower now, each one drawn at the toolstrip's 24px glyph with its label broken where the word ends rather than where the box ran out. It opens from the keyboard as well as the mouse, and a tile only carries a destination badge where its own label does not already say where the entry will land

## [1.27.0] — 2026-09-28

An editable dictionary has an `⊞ Add` button in its filter bar: 28 tiles, grouped the way the domain names them, each one creating an entry of a named class in a named section — and the new row opens its name ready to be typed over

## [1.26.0] — 2026-09-28

The Properties panel opens in the Secondary Side Bar, and the activity bar icon is a mono outline of the Simulink product icon — this release requires VS Code 1.106 or later

## [1.25.1] — 2026-09-25

A model, MAT-file or project tab now carries a padlock, because the whole file opens read-only

## [1.25.0] — 2026-09-25

Read-only table cells are readable in every theme, and a column that does not apply to a row says so on the cell's surface rather than by dimming its text further

## [1.24.8] — 2026-09-24

The extension now carries the official Simulink product icon

## [1.24.7] — 2026-09-22

One Data Explorer entry per dictionary in the editor type picker, and a dictionary opened in the wrong one lands in the view that fits its bytes

## [1.24.6] — 2026-09-22

A dictionary open in two tabs keeps its Modified marks when one tab closes

## [1.24.5] — 2026-09-19

Opening a JSON dictionary with the binary table editor no longer errors

## [1.24.4] — 2026-09-18

A struct's fields in a current-MATLAB .sldd

## [1.24.3] — 2026-09-18

An array inside a cell in a binary .sldd

## [1.24.2] — 2026-09-18

Read a string in a cell as a string in the binary dictionary

## [1.24.1] — 2026-09-18

The search box works on read-only views (.slx, .mdl, .mat, .prj)

## [1.24.0] — 2026-09-17

A filter condition that contains whitespace is now one condition

## [1.23.0] — 2026-09-16

Schema parity gaps from the MATLAB Data Explorer app

## [1.22.0] — 2026-09-16

Read each file once: a dictionary scanned once per version, a model's structure off a parse already held

## [1.21.0] — 2026-09-16

Parse a file once per content change, not once per consumer

## [1.20.1] — 2026-09-15

A Data Type link jumps to the definition, not to a same-named child row

## [1.20.0] — 2026-09-15

Data Type links to its type definition

## [1.19.1] — 2026-09-13

The same extension, with its rules where they can be reused

## [1.19.0] — 2026-09-13

A folder's indexes read only what they need

## [1.18.2] — 2026-09-11

Configurations refuses what it cannot hold

## [1.18.1] — 2026-09-11

A paste selects every entry it added

## [1.18.0] — 2026-09-11

Multi-select row actions

## [1.17.1] — 2026-09-10

Say how many entries each section holds

## [1.17.0] — 2026-09-10

Draw a link only where there is somewhere to go

## [1.16.0] — 2026-09-10

The Usage column now follows a mask. A `Gain = g1` inside a masked subsystem

## [1.15.2] — 2026-09-10

Keep the string class when a Simulink.Parameter Value is retyped

## [1.15.1] — 2026-09-10

No user-visible change. The two file-name reductions (refModelExt, projectNameOf)

## [1.15.0] — 2026-09-10

A shaped value inside a cell keeps its shape, a multi-row cell or string

## [1.14.1] — 2026-09-09

A table edit writes only the bytes it changes and repaints only the entry it touched; the copied row keeps its ring across the frozen Name column

## [1.13.1] — 2026-09-09

A rename carries the System Composer catalog; the cells the format cannot keep are refused

## [1.13.0] — 2026-09-09

Let a table edit repaint the entry it just wrote

## [1.12.1] — 2026-09-09

Keep the search bar still while the table is still loading

## [1.12.0] — 2026-09-09

Freeze the Name column, and scroll the table sideways under it

## [1.11.0] — 2026-09-09

Entry-scoped model updates and repaints

## [1.10.4] — 2026-09-08

Entry-scoped table repaint for binary .sldd edits

## [1.10.3] — 2026-09-08

Bounded workspace scans: opening a folder of large dictionaries no longer kills the extension host

## [1.10.2] — 2026-09-08

A block name's qualifier now truncates before the name does. In a Name column

## [1.10.1] — 2026-09-08

Two Usage-column fixes

## [1.10.0] — 2026-09-08

Every block is searchable, and each one is somewhere

## [1.9.2] — 2026-09-08

A block is its SID: nameless blocks render <SID: n>, same-named blocks stay separate

## [1.9.1] — 2026-09-08

A shadowed dictionary entry no longer shows a Usage link

## [1.9.0] — 2026-09-08

One answer for the Usage column

## [1.8.3] — 2026-09-06

An object array reads as the class it is an array of

## [1.8.2] — 2026-09-06

Objects carry the object icon, and the tree's icons ship in the VSIX

## [1.8.1] — 2026-09-05

A file that opens short says so

## [1.8.0] — 2026-09-04

.mdl model support

## [1.7.0] — 2026-09-04

Variable Editor: open a matrix value as a floating grid with a (:,:,k) page selector

## [1.6.5] — 2026-09-02

Pick up data-explorer-core 0.1.7: an array's element rows now carry the

## [1.6.4] — 2026-09-02

Fix the table not tracking its panel width after a column resize. Column

## [1.6.3] — 2026-09-02

Bump the data-explorer-core pin to v0.1.5 and fix the defects found

## [1.6.2] — 2026-08-31

Maintenance release.

## [1.6.1] — 2026-08-31

- Delete the src/dex tree; tests now import data-explorer-core only

## [1.6.0] — 2026-08-31

Adopt data-explorer-core package + native webview UI

## [1.5.10] — 2026-08-19

- Remove Marketplace auto-publish from release workflow

## [1.5.9] — 2026-08-19

- Expand object arrays across all formats; fix nested-array truncation
- Fix singleFileUsage integration test for empty workspace source label

## [1.5.8] — 2026-08-19

- Broaden block-param capture (issue #9) + Usage display cleanups; bump to 1.5.8
- Resolve intra-model Usage for single-file (no-folder) opens

## [1.5.7] — 2026-08-19

- Schema-driven PI layout: common 'General' group across all node types

## [1.5.6] — 2026-08-14

- Publish to VS Code Marketplace on release
- Add Ctrl+F shortcut to focus the table search bar

## [1.5.5] — 2026-08-14

Fix scroll-to-selected on large virtualized tables; center the selected row when scrolling it into view.

## [1.5.4] — 2026-08-14

Expand custom MATLAB class objects; class property names read-only (issue #3)

## [1.5.3] — 2026-08-14

Expand custom MATLAB class objects in the tree (issue #3)

## [1.5.2] — 2026-08-14

- Fix Dependabot devDependency vulnerabilities

## [1.5.1] — 2026-08-14

- Add systematic MATLAB fidelity docs, hardening, and round-trip tests
- Mirror MATLAB element property behavior for Element-level nodes
- Mirror MATLAB setPropValue constraints for editable value/codegen props

## [1.5.0] — 2026-08-12

Constant node for Architectural Data

## [1.4.1] — 2026-08-12

- Docs: describe .sldd as editable regardless of format; bump to 1.4.1
- Move binary-sldd design spec and plan to local-only docs/deep-work

## [1.4.0] — 2026-08-12

Editable compressed-binary .sldd

## [1.3.1] — 2026-08-12

- Refactor: extract shared common/ modules, reduce duplication
- Remove internal deep-work doc from the public tree

## [1.3.0] — 2026-08-11

- Cover structuralIndex .prj branch and error path
- Add integration test for the lazy-cut single-undo contract
- Add cut/paste end-to-end tests (lazy-cut composition)

## [1.2.13] — 2026-08-11

- Fix CI: repoint arch-paste tests to a committed fixture
- Fix copy/paste + Kind for arch data; add keyboard shortcuts; bump to 1.2.13

## [1.2.12] — 2026-08-11

- Generate a fresh uuid when pasting an entry; bump to 1.2.12

## [1.2.11] — 2026-08-11

- Add Child on a ServiceInterface creates a FunctionElement; bump to 1.2.11

## [1.2.10] — 2026-08-11

- Fix Add Child/Remove Child correctness for text sldd; bump to 1.2.10

## [1.2.9] — 2026-08-10

- Drop the Jump-to-Reference Navigation section from README; bump to 1.2.9

## [1.2.8] — 2026-08-10

- Improve README for the Marketplace listing; bump to 1.2.8

## [1.2.7] — 2026-08-10

- Add Marketplace keywords and Data Science category; bump to 1.2.7

## [1.2.6] — 2026-08-10

- Rename extension id to simulink-data-explorer; bump to 1.2.6

## [1.2.5] — 2026-08-10

- Open Model Reference / External Data links on click; bump to 1.2.5

## [1.2.4] — 2026-08-10

- Add loading spinner; route >512MB JSON .sldd to text editor; bump to 1.2.4

## [1.2.3] — 2026-08-10

- Rename customer-visible "Simulink Project" to "MATLAB Project"; bump to 1.2.3

## [1.2.2] — 2026-08-10

- Add Marketplace icon; shorten displayName; bump to 1.2.2

## [1.2.1] — 2026-08-10

- Route oversized JSON .sldd to read-only view; refresh on save

## [1.2.0] — 2026-08-10

Release v1.2.0: format-independent element-name coloring

## [1.1.2] — 2026-08-07

- docs: add install instructions to README Getting Started
- docs: remove Release Notes section from README

## [1.1.1] — 2026-08-07

Maintenance release.

## [1.1.0] — 2026-08-07

Maintenance release.

## [1.0.3] — 2026-08-07

- Route Simulink.VariantConfigurations to VariantConfiguration; empty ConfigSet Value
- Empty non-editable Value for value-less object nodes; close column menu on blur
- Separate Class/Kind/Data Type; add column customization menu

## [1.0.2] — 2026-08-06

- test(integration): fix viewAsText active-editor race
- Refine Architectural Data presentation; release v1.0.2

## [1.0.1] — 2026-08-03

Maintenance release.
