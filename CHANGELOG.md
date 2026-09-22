# Change Log

All notable changes to the Simulink Data Explorer extension. Versions follow the
`vX.Y.Z` tags in this repository; each tag builds the `.vsix` attached to its
GitHub Release.

Entries before this file existed were reconstructed from those release tags.

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
