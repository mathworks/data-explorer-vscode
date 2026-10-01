# Change Log

All notable changes to the Simulink Data Explorer extension. Versions follow the
`vX.Y.Z` tags in this repository; each tag builds the `.vsix` attached to its
GitHub Release.

Entries before this file existed were reconstructed from those release tags.

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
