# Change Log

All notable changes to the Simulink Data Explorer extension.

## [Unreleased]

- You can now add variables, strings and Simulink objects to MAT-files from the Add gallery.
- Bus elements in MAT-files can be added and removed.

## [1.43.0] — 2026-10-21

- MAT-files can now be edited and saved.
- Simulink.Parameter and Simulink.Signal properties stored inside a dictionary value can now be edited.
- `.mdl` files saved in MATLAB's new text format now open.
- Bug fixes.

## [1.42.0] — 2026-10-19

- Values typed into the table are read more like MATLAB reads them.
- A Simulink.Parameter's Dimensions and Complexity now follow its Value after every edit.
- Simulink.VariantBank properties from older dictionaries can be viewed and edited.
- More damaged or hand-edited files open with a warning instead of failing.
- Bug fixes.

## [1.41.0] — 2026-10-18

- Saving a binary dictionary now changes only the entries you edited.
- Simulink.VariantBank and Simulink.VariantBankCoderInfo properties can be edited in the table.
- Very large `.mat` files open faster.
- Bug fixes.

## [1.40.0] — 2026-10-17

- Values from `.mat` files and model workspaces match MATLAB more closely.
- A Signal's Complexity and Dimensions Mode, and a Parameter's or Signal's Alignment, can be edited.
- mpt.Parameter and mpt.Signal entries can be pasted and dropped.
- Files with more than 100,000 entries now show every entry.
- The Usage column updates when models in the workspace change.
- Bug fixes.

## [1.39.0] — 2026-10-16

- Renaming a service interface's function keeps System Composer's function list in step.

## [1.38.0] — 2026-10-16

- Enumerations, function handles and text with line breaks or tabs now show correctly.
- Edits that MATLAB would refuse are refused in the table.
- Bug fixes.

## [1.37.0] — 2026-10-15

- A binary dictionary reloads when another program changes it, and asks before overwriting.
- A Simulink.Parameter refuses the values MATLAB refuses.
- The Value and Class columns read like MATLAB's Workspace browser.
- Bug fixes.

## [1.36.11] — 2026-10-14

Bug fixes.

## [1.36.10] — 2026-10-13

Bug fixes.

## [1.36.9] — 2026-10-13

- Numbers typed into integer values are converted as MATLAB converts them.
- More ways of typing complex numbers are accepted.
- Bug fixes.

## [1.36.8] — 2026-10-12

Bug fixes.

## [1.36.7] — 2026-10-12

Bug fixes.

## [1.36.6] — 2026-10-12

Bug fixes and performance improvements.

## [1.36.5] — 2026-10-11

- Sparse arrays of any size open instantly.
- Bug fixes.

## [1.36.4] — 2026-10-10

- Values that a binary dictionary stores encoded now show and save correctly.
- Bug fixes.

## [1.36.3] — 2026-10-09

- Complex values inside objects now show correctly.
- Bug fixes.

## [1.36.2] — 2026-10-09

- Objects inside structs and cells now show in full in `.mat` files and model workspaces.

## [1.36.1] — 2026-10-03

Bug fixes.

## [1.36.0] — 2026-10-02

- Very large files open, and load a row's contents when you expand it.

## [1.35.0] — 2026-10-02

- Projects stored as a single `matlab.toml` file are supported.

## [1.34.0] — 2026-10-02

Bug fixes.

## [1.33.0] — 2026-10-02

- Projects whose definition is a single XML file are supported.

## [1.32.0] — 2026-10-01

- The Variable Editor opens on matrices of any size, and follows your color theme.

## [1.31.0] — 2026-10-01

- Dictionaries holding very large matrices open.

## [1.30.4] — 2026-10-01

Bug fixes.

## [1.30.3] — 2026-10-01

Bug fixes.

## [1.30.2] — 2026-10-01

- Search no longer matches section headings.

## [1.30.1] — 2026-10-01

Bug fixes.

## [1.30.0] — 2026-09-30

- The project page shows Managed Simulink Project details.

## [1.29.0] — 2026-09-30

- MATLAB Projects open as a project page.

## [1.28.4] — 2026-09-30

Bug fixes.

## [1.28.3] — 2026-09-30

- Each GitHub Release includes a `SHA256SUMS` file.

## [1.28.2] — 2026-09-30

- Getting Started installs the extension from the Marketplace.

## [1.28.1] — 2026-09-30

- Entries created from the Add gallery now match the ones MATLAB creates.

## [1.28.0] — 2026-09-29

- A redesigned Add gallery that can be used from the keyboard.

## [1.27.0] — 2026-09-28

- A new Add button creates dictionary entries from a gallery of classes.

## [1.26.0] — 2026-09-28

- The Properties panel opens in the Secondary Side Bar.
- New activity bar icon.
- Requires VS Code 1.106 or later.

## [1.25.1] — 2026-09-25

- Read-only files show a padlock on their tab.

## [1.25.0] — 2026-09-25

- Read-only cells are easier to read in every theme.

## [1.24.8] — 2026-09-24

- New Simulink product icon.

## [1.24.7] — 2026-09-22

Bug fixes.

## [1.24.6] — 2026-09-22

Bug fixes.

## [1.24.5] — 2026-09-19

Bug fixes.

## [1.24.4] — 2026-09-18

Bug fixes.

## [1.24.3] — 2026-09-18

Bug fixes.

## [1.24.2] — 2026-09-18

Bug fixes.

## [1.24.1] — 2026-09-18

- Search works in read-only views (`.slx`, `.mdl`, `.mat`, `.prj`).

## [1.24.0] — 2026-09-17

Bug fixes.

## [1.23.0] — 2026-09-16

- Columns and properties match the MATLAB Data Explorer app more closely.

## [1.22.0] — 2026-09-16

Performance improvements.

## [1.21.0] — 2026-09-16

Performance improvements.

## [1.20.1] — 2026-09-15

Bug fixes.

## [1.20.0] — 2026-09-15

- A Data Type cell links to its type definition.

## [1.19.1] — 2026-09-13

Maintenance release.

## [1.19.0] — 2026-09-13

Performance improvements.

## [1.18.2] — 2026-09-11

Bug fixes.

## [1.18.1] — 2026-09-11

Bug fixes.

## [1.18.0] — 2026-09-11

- Row actions apply to several selected rows at once.

## [1.17.1] — 2026-09-10

- Section headings show how many entries they hold.

## [1.17.0] — 2026-09-10

Bug fixes.

## [1.16.0] — 2026-09-10

- The Usage column follows variables into masked subsystems.

## [1.15.2] — 2026-09-10

Bug fixes.

## [1.15.1] — 2026-09-10

Maintenance release.

## [1.15.0] — 2026-09-10

Bug fixes.

## [1.14.1] — 2026-09-09

Performance improvements.

## [1.13.1] — 2026-09-09

Bug fixes.

## [1.13.0] — 2026-09-09

Performance improvements.

## [1.12.1] — 2026-09-09

Bug fixes.

## [1.12.0] — 2026-09-09

- The Name column stays in place while the table scrolls sideways.

## [1.11.0] — 2026-09-09

Performance improvements.

## [1.10.4] — 2026-09-08

Performance improvements.

## [1.10.3] — 2026-09-08

Bug fixes and performance improvements.

## [1.10.2] — 2026-09-08

Bug fixes.

## [1.10.1] — 2026-09-08

Bug fixes.

## [1.10.0] — 2026-09-08

- Every block can be found by search.

## [1.9.2] — 2026-09-08

Bug fixes.

## [1.9.1] — 2026-09-08

Bug fixes.

## [1.9.0] — 2026-09-08

Bug fixes.

## [1.8.3] — 2026-09-06

Bug fixes.

## [1.8.2] — 2026-09-06

- New icons for objects.

## [1.8.1] — 2026-09-05

Bug fixes.

## [1.8.0] — 2026-09-04

- Support for `.mdl` models.

## [1.7.0] — 2026-09-04

- Variable Editor: view a matrix as a grid, one page at a time.

## [1.6.5] — 2026-09-02

Bug fixes.

## [1.6.4] — 2026-09-02

Bug fixes.

## [1.6.3] — 2026-09-02

Bug fixes.

## [1.6.2] — 2026-08-31

Maintenance release.

## [1.6.1] — 2026-08-31

Maintenance release.

## [1.6.0] — 2026-08-31

- A new table view.

## [1.5.10] — 2026-08-19

Maintenance release.

## [1.5.9] — 2026-08-19

Bug fixes.

## [1.5.8] — 2026-08-19

Bug fixes.

## [1.5.7] — 2026-08-19

- The Properties panel groups properties the same way for every kind of entry.

## [1.5.6] — 2026-08-14

- Ctrl+F focuses the table's search box.

## [1.5.5] — 2026-08-14

Bug fixes.

## [1.5.4] — 2026-08-14

Bug fixes.

## [1.5.3] — 2026-08-14

- Objects of custom MATLAB classes can be expanded.

## [1.5.2] — 2026-08-14

Maintenance release.

## [1.5.1] — 2026-08-14

Bug fixes.

## [1.5.0] — 2026-08-12

- Architectural Data shows Constant entries.

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

- Keyboard shortcuts for copy and paste.
- Bug fixes.

## [1.2.12] — 2026-08-11

Bug fixes.

## [1.2.11] — 2026-08-11

- Add Child on a service interface creates a function element.

## [1.2.10] — 2026-08-11

Bug fixes.

## [1.2.9] — 2026-08-10

Maintenance release.

## [1.2.8] — 2026-08-10

Maintenance release.

## [1.2.7] — 2026-08-10

Maintenance release.

## [1.2.6] — 2026-08-10

Maintenance release.

## [1.2.5] — 2026-08-10

- Model Reference and External Data links open on click.

## [1.2.4] — 2026-08-10

- A loading spinner shows while a file opens.
- Very large JSON dictionaries open in the text editor.

## [1.2.3] — 2026-08-10

- "Simulink Project" is now called "MATLAB Project".

## [1.2.2] — 2026-08-10

Maintenance release.

## [1.2.1] — 2026-08-10

Bug fixes.

## [1.2.0] — 2026-08-10

- Element names are colored the same way in every file format.

## [1.1.2] — 2026-08-07

Maintenance release.

## [1.1.1] — 2026-08-07

Maintenance release.

## [1.1.0] — 2026-08-07

Maintenance release.

## [1.0.3] — 2026-08-07

Bug fixes.

## [1.0.2] — 2026-08-06

Bug fixes.

## [1.0.1] — 2026-08-03

Maintenance release.
