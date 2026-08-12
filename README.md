# Simulink Data Explorer Extension for Visual Studio Code

**Explore Simulink&reg; models, data dictionaries, and projects directly in Visual Studio Code — no MATLAB&reg; or Simulink installation required.** Simulink Data Explorer reads `.slx`, `.sldd`, `.mat`, and `.prj` files directly, so you can browse their contents and relationships anywhere VS Code runs.

It adds a native experience for Simulink file types — a **Simulink Data Explorer sidebar** that maps how your models, dictionaries, and projects relate, a **table editor** to browse the contents of each file, and a **Properties panel** to inspect the selected entry — without leaving your editor. `.sldd` data dictionaries are **editable** directly in the table; other formats open read-only.

![Simulink Data Explorer in action: the relationship-tree sidebar and the table editor browsing a model, data dictionary, and MAT-file](media/screenshots/demo.gif)

## Why Simulink Data Explorer?

- **Read Simulink files without MATLAB or Simulink** — inspect `.slx`, `.sldd`, `.mat`, and `.prj` files anywhere VS Code runs, including on machines and CI agents with no MATLAB install.
- **See how your project fits together** — a relationship tree maps every model, dictionary, and MAT-file and how they reference each other, with at-a-glance health badges for cycles, orphans, and missing references.
- **Click through references like hyperlinks** — jump from a model to the models, dictionaries, and MAT-files it depends on in one click.
- **Edit data dictionaries in place** — change values, add elements, and cut/copy/paste entries in a spreadsheet-style table, with undo/redo and save. Works for both textual (JSON) and compressed-binary `.sldd`.

## Features

### Navigate & understand your models

- **Relationship tree** — a dedicated activity-bar view that scans the workspace and renders how files relate: models referencing other models, models linked to data dictionaries (`.sldd`) and MAT-files (`.mat`), and dictionaries referencing other dictionaries. Entries expand lazily as you drill in.
- **Jump-to-reference links** — a model's Model References and External Data render as clickable links; selecting one opens the referenced model, dictionary, or MAT-file, resolved from your workspace.
- **Project & folder grouping** — the tree groups top-level entries by MATLAB Project (`.prj`) or by containing folder, so files with the same name in different folders stay distinct. References resolve within a group first.
- **Health decorations** — tree rows are badged for at-a-glance status: circular references, orphaned dictionaries/MAT-files (nothing links to them), unsaved modifications, and unresolved (missing) references.

### Browse & edit file contents

- **Table editor** — open a model, dictionary, MAT-file, or project in a spreadsheet-style, tree-structured table. Sections are always shown (e.g. a dictionary's Design Data, Architectural Data, Configurations, Other Data), even when empty.
- **Editing for `.sldd`** — edit a data dictionary directly in the table: change entry values and names, add child elements, and cut/copy/paste/delete entries via the right-click context menu, with **undo/redo, a dirty indicator, and save**. Both textual (JSON) and compressed-binary `.sldd` are editable; `.slx`, `.mat`, and `.prj` open read-only.
- **Live two-way sync (textual `.sldd`)** — because a textual (JSON) `.sldd` is backed by its JSON text document, edits in the table and edits in the JSON text editor update each other instantly, and there is a single shared undo history across both views.
- **Properties panel** — a selection-following webview that shows the full properties of the entry selected in the table. It lives in its own view container and can be docked in the secondary sidebar.
- **Search** — filter entries by name using the table's built-in filter bar as you type.

### Fits your editor

- **Dual view for textual `.sldd`** — because a textual `.sldd` is JSON, you can switch to Visual Studio Code's built-in JSON text editor at any time via **Reopen Editor With…**.
- **Theme-aware** — every pane follows your active Visual Studio Code color theme (light, dark, or high-contrast).

## Getting Started

1. Install the extension. Download the latest `.vsix` from the
   [Releases page](https://github.com/mathworks/data-explorer-vscode/releases),
   then install it either from the command line:

   ```sh
   code --install-extension simulink-data-explorer-<version>.vsix
   ```

   or from within VS Code via the Extensions view → **⋯** menu →
   **Install from VSIX…**.
2. Open a folder or workspace that contains Simulink files.
3. Click the **Simulink Data Explorer** icon in the activity bar to see the relationship tree.
4. Open any supported file (`.slx`, `.sldd`, `.mat`, `.prj`) — it opens in the Data Explorer table by default. Select a row to inspect it in the Properties panel.

For a textual `.sldd`, you can switch to the raw JSON via **View: Reopen Editor With… → Text Editor** (or right-click the editor tab → **Reopen Editor With…**).

## Supported Files

**Editable in the table:**

- **Simulink Data Dictionaries** — `.sldd` (both textual/JSON and compressed-binary): edit values and names, add children, and cut/copy/paste/delete entries, with undo/redo and save.

**Viewing (read-only):**

- **Simulink models** — `.slx`
- **MAT-files** — `.mat`
- **MATLAB Projects** — `.prj`

## Requirements

- Visual Studio Code 1.90.0 or later.

No MATLAB&reg; or Simulink installation is required to view or edit files — Simulink Data Explorer reads and writes the files directly.

## Known Limitations

- Editing is supported for **`.sldd`** data dictionaries. `.slx`, `.mat`, and `.prj` are read-only.
- Large textual (JSON) `.sldd` files are limited by size. Above **50 MB**, the file opens as a **read-only** table (VS Code cannot mirror a document that large for editing). Above **512 MB**, it cannot be rendered as a table at all and opens in VS Code's built-in **text editor** instead.
- Paste creates a new top-level entry in the target section; pasting as a child of a struct/bus is not yet supported.
- Reference resolution matches files by name (basename), preferring the referrer's own project or folder. Two `.prj` files in the same directory are not supported.
- `.m` files are not scanned, so a project whose members are only `.m` files appears as an empty group.

## Questions & Answers

**Do I need MATLAB or Simulink installed?**
No. Simulink Data Explorer reads (and, for `.sldd`, writes) the files directly, so it works anywhere VS Code runs — including machines and CI agents with no MATLAB or Simulink installation.

**Which file types can I open?**
`.slx` (Simulink models), `.sldd` (data dictionaries), `.mat` (MAT-files), and `.prj` (MATLAB Projects). `.sldd` files are editable; the rest open read-only.

**Can I edit files, or is this view-only?**
You can edit **`.sldd`** dictionaries directly in the table — values, names, child elements, and cut/copy/paste/delete — with undo/redo and save. This works for both textual (JSON) and compressed-binary `.sldd`. `.slx`, `.mat`, and `.prj` are read-only.

**A reference link doesn't open anything — why?**
Links resolve by file name against your open workspace. Make sure the referenced file is inside the folder or workspace you have open in VS Code; a reference to a file that isn't present shows as unresolved (and is badged in the relationship tree).

**How are references matched across folders?**
By basename, preferring the referrer's own MATLAB Project or containing folder first. If two files share a name in different folders, the one in the referrer's group wins.

**Why did my large `.sldd` open read-only, or as plain text?**
Above **50 MB**, a textual `.sldd` opens as a **read-only** table (VS Code cannot mirror a document that large for editing). Above **512 MB**, it opens in VS Code's built-in **text editor** instead of a table.

**Does editing in the table stay in sync with the JSON text editor?**
Yes. A textual `.sldd` is backed by its JSON document, so table edits and text-editor edits update each other instantly and share one undo history. You can switch views anytime via **Reopen Editor With…**.

**Is my theme respected?**
Yes — every pane follows your active VS Code color theme (light, dark, or high-contrast).

**How do I report a bug or request a feature?**
Please open an issue on the [GitHub repository](https://github.com/mathworks/data-explorer-vscode). If the extension is useful to you, a rating or review on the Marketplace helps others find it.

## License

Distributed under the BSD 3-Clause License. See [LICENSE](LICENSE) for details.

---

MATLAB and Simulink are registered trademarks of The MathWorks, Inc. See [www.mathworks.com/trademarks](https://www.mathworks.com/trademarks) for a list of additional trademarks. Other product or brand names may be trademarks or registered trademarks of their respective holders.

Copyright 2026 The MathWorks, Inc.
