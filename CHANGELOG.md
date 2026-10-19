# Change Log

All notable changes to the Simulink Data Explorer extension. Versions follow the
`vX.Y.Z` tags in this repository; each tag builds the `.vsix` attached to its
GitHub Release.

Entries before this file existed were reconstructed from those release tags.

## [1.42.0] — 2026-10-19

Cells typed into the table now follow MATLAB more closely, and a Simulink.Parameter's Dimensions and Complexity follow its Value after every edit. More damaged or hand-edited files open with a warning, more values that could not be read show as not read rather than as a made-up value, and a copy or a save this extension cannot spell is refused rather than written wrong.

A cell typed into the table now refuses arithmetic written without spaces, as it already refused `{1 + 2}`: `{1+2}`, `{a+b}`, `{-a}`, `{2*3}` and `{2i+3i}` are refused with `Invalid MATLAB expression`, where each was taken as one text member, such as `'1+2'`. A sign that belongs to a number is still read, as in `{-2}`, `{1e-3}`, `{1+2i}` and `{i+1}`, and a bare word such as `{abc}` is still text. Other unquoted members holding `+`, `-`, `*`, `/`, `\` or `^`, such as `{1:-1:0}` and `{@(x)x+1}`, are refused the same way: type them in quotes to set the text. In a Simulink.VariantBank's Variant Conditions, `{V==-1}` and `{V>-2}`, which were saved as `'V == -1'` and `'V > -2'`, are now refused with `'VariantConditions' property for Simulink.VariantBank must be a cell array.`, and `{'V==-1'}` is still taken. Only typing changes: a file that already holds such text opens and saves as before. A member whose imaginary part is zero is now the real number MATLAB makes of it, so `{1+0i}`, `{1 + 0i}`, `{0i + 1}` and `{0i}` set a real double where they set a complex one; a Value typed as `1 + 0i` outside a cell is still complex. So that an edit of a cell's text cannot make a file's complex member real, a cell holding one whose imaginary part is 0, such as `complex(1,0)` in a cell shown as `{1+0i, 5}`, no longer opens an editor for its text: edit its elements one at a time, and that member stays complex.

A Simulink.VariantBank in a JSON dictionary that R2026b wrote, which holds its properties as plain properties rather than in the form R2027a writes, now shows them in its Bank Name, Variant Conditions, All Choices Coder Info and Active Choice Coder Info columns and in the Properties panel, and an edit there is saved into those same properties. Before, its cells showed the defaults, its values were listed only under Other, and every edit was refused with a message that it had nowhere to be saved. A value there that MATLAB refuses is warned of as MATLAB reads it, as that property's default alone. A Simulink.VariantBankCoderInfo whose properties are held in a property named `undefined`, as an earlier version of this extension could save one, now opens with a warning: in a binary dictionary, that MATLAB cannot read it at all, and in a JSON dictionary, that MATLAB reads it with every property at its default. Before, its cells were blank and nothing said why; it is still shown and saved as read. A Simulink.VariantConfigurations entry is no longer saved with a Value, which MATLAB's class does not have. Before, one this extension created or edited was saved with an empty Value, and one held as plain properties in a JSON dictionary gained `"Value": ""` even when nobody edited it. A Value a file already holds is kept as it was.

A Simulink.Parameter's Dimensions and Complexity now follow its Value, as MATLAB sets them, after every cut, Add, element edit and typed Value, and after Redo of one. On a 1x3 complex row, cutting an element sets Dimensions to `[1 2]`, typing `[1 2 3 4]` sets `[1 4]` and `real`, and setting every element real sets Complexity to `real`. Before, only a cut that left a single element changed them, and every other edit saved the old `[1 3]` and `complex`. As in MATLAB, a symbolic Dimensions such as `'[1,N]'` is kept, an empty Value keeps both, a struct Value keeps its Complexity, and a text Value is `[1 1]` and `real`. Neither is added to a file that does not hold it. Undo gives back the Dimensions and Complexity from before the edit, even in a hand-edited file where they disagree with the Value.

In a JSON dictionary, a bus with one element is now saved in the form MATLAB writes it, so a save leaves such a bus that nobody edited as it was; before, a save rewrote its element in the form MATLAB uses for two or more. One that grows to two elements and back to one is saved in that form again, as MATLAB saves it, and so is a one-element bus copied from a `.mat` file. A Simulink.Bus, Simulink.ConnectionBus, Simulink.ServiceBus or enumeration in a hand-edited JSON dictionary whose list of elements is not a list, such as `5`, `"x"`, `{"a": 1}` or `null`, now opens with a warning such as `"MyBus" holds 5 where its list of bus elements belongs; it is not shown, and an edit to the bus drops it from the file.`, and is saved as read. Before, any of these but `null` stopped the whole file from opening, and `null` opened with no warning and was saved as an empty list. In a binary dictionary, a struct array pasted as a Parameter's Value or as an object's property, whose elements do not all hold every field, such as one element with `a = 1` and one with no fields, is now saved with each of the struct's fields in every element, in the struct's order, and a field an element lacks as `[]`, so MATLAB reads it as it reads the text it was copied from. Before, each element was saved with only its own fields, in its own order, and MATLAB read such a struct back with no fields, or with its fields in another order. A pasted object array of one object whose size says otherwise, such as dimensions `[2,1]` in a hand-edited JSON dictionary, is now refused at a binary dictionary's save with `Cannot write ...: ... declaring dimensions [2,1] and holding 1 element, which no Dimension spells. Nothing was written.`; before, it was saved as a single object.

In a `.mat` file, more values that could not be read now show as not decoded, with a warning, no editor and a refused copy, where they showed a made-up value, were left out, or stopped the file from opening. A numeric array of more than 134,217,728 elements, such as a 1x134217729 uint8, no longer stops the whole file from opening, here or in a model workspace or a dictionary: it shows as `<1x134217729 uint8, not decoded>`. An element of a cell in a MATLAB object's property that could not be read showed an editable `0` with no warning, and copied as `0`; it now shows `<unknown, not decoded>`, with a warning such as `"holder.C" declares 2 cell(s) and only 1 could be read.` A field of a 1x1 struct whose data is not a matrix, which was left out with no warning, is now listed. A value of a MAT array class this extension does not read showed an editable `null`, which a Value edit turned into a double. A copy of a cell or struct array that holds none of the elements it declares is refused too, such as `a 1x3 cell none of whose 3 elements could be read`: pasted into a binary dictionary, such a cell was saved as a 0x0 cell, and MATLAB read such a struct array back with no fields. The refusal of a copy of a sparse array that was not read now says `a 3x4 sparse double`, as its row does, where it said `a 3x4 double`. This version ships `data-explorer-core` 1.43.0.

## [1.41.0] — 2026-10-18

Saving a binary dictionary now writes an edited entry as the bytes it was read from, with only what the edit changed written anew, and more saved values are spelled as MATLAB reads them back. A save this extension cannot spell is refused rather than written wrong, and more damaged or hand-edited files open with a warning.

In a binary dictionary, each edit of an entry no longer adds four spaces in front of it in the file. The edited entry is now written laid out as the rest of the file is, whether the file is on one line or has LF or CRLF line ends, and nothing around it changes. An entry put back by Undo or Redo, including one whose delete was undone, now keeps the file's own text for it, so a later edit of it changes only what that edit changes. Before, that later edit rewrote the whole entry as this extension writes it. Saving a binary dictionary now also checks what it is about to write against the file as last opened or saved: an entry no edit changed must be exactly as it was, and an edited entry must keep every part the edit did not change. If either is not so, the save is refused with a message naming the entry, and the file on disk is left as it was. The save of an edited entry that the check cannot read, such as one with a processing instruction inside it, is refused too, because that save would rewrite parts of the entry the edit did not touch: undo that edit to save the others.

A `.mat` file with more than 500,000 values now opens with some of them shown as their summary, without the rows under them; copying one still copies it whole. The warning above the table says the file was read in full, where it said that a part of the file could not be read, and when parts of the file really could not be read it counts only those.

In a JSON dictionary, an entry whose text holds a size that is not a count, such as a hand-typed `1e400` in its dimensions, can now be edited in the text view and then in the table. Opened from the file, such an entry was already accepted, and a save wrote it back as read. But after an edit of its text, even one that changed nothing in it, the entry showed as Modified, and a table edit of it then failed with `Cannot write ...: ... a size that is not a count`.

A Simulink.VariantBank's and a Simulink.VariantBankCoderInfo's own properties are now columns of the table, and are edited there. A bank's Bank Name (the name MATLAB gives the bank itself, which is not the entry's name), Variant Conditions, All Choices Coder Info and Active Choice Coder Info are in a new Variant Bank group of the column menu. A coder info's Definition File, Pre Statement, Post Statement and Qualifier are under Code Generation, beside the Header File column it shares with a Parameter or a Signal. Like the other grouped columns they are hidden by default: show them from the column menu. The Properties panel lists the same properties under the same group names. Variant Conditions is typed as a cell of conditions, such as `{'V == 1','V == 2'}`, and is saved as MATLAB spells it, so `{'V==1'}` is saved as `{'V == 1'}`. Qualifier is a dropdown of MATLAB's four choices. Pre Statement and Post Statement keep their line breaks: Enter saves the cell, as in every other cell, and Shift+Enter starts a new line. A value MATLAB refuses is refused with MATLAB's message, such as `'Name' property for Simulink.VariantBank must be a valid C identifier that does not start with "rt".`, and nothing changes. Before, none of these properties was shown in the table, and the Properties panel showed them only as one row under Other.

A complex value whose imaginary part is a negative zero, such as `complex(1,-0)` in a binary dictionary, now shows `1+0i`, as the same value in a JSON dictionary does; it showed `1-0i`, which reads as a negative imaginary part. The value is saved unchanged. A cell typed into the table takes a sign with a space after it, `{- 2}` and `{1, - 2}`, and a member written imaginary part first, such as `{i + 1}` or `{2i - 3}`, as MATLAB reads them; before, these were refused. A cell holding arithmetic, such as `{1 + 2}`, is still refused. In a binary dictionary, a 1x1 cell is saved with no size of its own, as MATLAB writes it.

In a hand-edited JSON dictionary, an object such as a Simulink.Signal, Simulink.AliasType or Simulink.NumericType whose properties sit beside its class, rather than in an element list, is now saved exactly as it was read, in every class. Before, a Simulink.Parameter, a bus or an enumeration in that form could not be saved at all, and the other classes wrote a made-up element beside those properties and accepted edits into it. Such an entry can still be renamed, but its other properties cannot be shown or edited here, and an edit is refused with a message saying so. A value of no shape MATLAB writes, such as `{"foo": 1}`, now shows as its text, `<{"foo":1}>`, with a warning, where it showed `[object Object]`, and pasting it into a binary dictionary is refused rather than written as that text. This version ships `data-explorer-core` 1.42.0.

## [1.40.0] — 2026-10-17

More numbers and classes read from a `.mat` file or a model workspace now match MATLAB and the dictionaries. A number inside an object, such as a Simulink.Parameter's Value, keeps its class: `int32([100 200 300 400])` shows class `int32` and a logical row shows `logical`, where both showed `double`, and an `int64` or `uint64` at the end of its range, such as `18446744073709551615`, shows as a number where it showed in quotes as text. A `single` shows the digits MATLAB writes into a dictionary, such as `3.3` and `[1.1 2.2 3.3]`, where it showed `3.299999952316284` and `[1.100000023841858 2.200000047683716 3.299999952316284]`, inside an object or not. A Parameter copied out of a `.mat` file into a dictionary keeps its Value's class; before, an `int8` -42 was pasted into a binary dictionary as the double `-42.0`. An array of objects of more than one class, held inside an object, takes the class MATLAB records for the array, and each element keeps its own: an array of a Simulink.Signal subclass and a Simulink.Signal shows as `<1x2 Simulink.Signal>`, where both elements showed as the subclass, and a configuration set's Components show in the Properties panel as `<9x1 Simulink.ConfigComponent>`, the class MATLAB gives them. Before, every element took the first one's class, so a configuration set copied into a dictionary was written with every one of its components as a Simulink.SolverCC.

In a binary dictionary, the Properties panel's Other group shows a nested object's own properties, as it already did for a `.mat` file: a Simulink.LookupTable's Table and Breakpoints list their Value, such as `[1+2i, 3+4i, 5+6i]`, their Dimensions, Data Type and the rest, as they already did in a JSON dictionary, and a Simulink.Signal's LoggingInfo lists its seven settings, where each was one empty row. In a JSON dictionary too, a bus with a single element now lists that element's properties there, where it was one empty row. In every kind of file, a nested array of more than one object shows its size and class there, such as `<2x1 Simulink.BusElement>` for a bus's elements, where it was empty.

A Simulink.Signal's Complexity and Dimensions Mode, and an mpt.Signal's, are now dropdowns in the table, offering MATLAB's choices (`auto`, `real` or `complex`; `auto`, `Fixed` or `Variable`), as a bus element's already were; before, both were read-only. These columns, like Storage Class and Alignment below, are hidden by default: show them from the column menu. A Signal left at `auto`, or set back to it, is saved as MATLAB saves it, with no key added in a JSON dictionary. A Simulink.Parameter's or Simulink.Signal's Alignment, and an mpt subclass's, can now be edited in the table when its Storage Class is not `Auto`, by MATLAB's rule: `-1`, or a power of two from 1 to 2^30. A value is first rounded as MATLAB's `int32` rounds it, so `1.5` sets `2`, and any value that is then neither is refused with MATLAB's message, such as `3 is not a valid alignment boundary. The alignment boundary must be either -1 or a power of two.`, and nothing changes. An accepted value is saved as MATLAB saves it. Setting the Storage Class to `Auto` resets Alignment to `-1`, as MATLAB does. Before, Alignment could not be edited at all.

Cells for five properties that MATLAB's classes do not have no longer open an editor. Before, a Simulink.LookupTable's or Simulink.Breakpoint's Description could be typed and saved, though MATLAB ignores it; a Simulink.VariantControl's Description was shown and then dropped on save; and a Simulink.VariantBank's or Simulink.VariantBankCoderInfo's Value was saved into the file, where MATLAB ignores it. One that a LookupTable, Breakpoint, VariantBank or VariantBankCoderInfo already has in its file is shown read-only and saved unchanged, and a VariantBank or VariantBankCoderInfo written by MATLAB shows an empty Value, where it showed `''`. Clearing a Simulink.VariantVariable's Specification now clears it in the saved file, as MATLAB clears it. Before, if this extension had set and saved the Specification, clearing it and saving again left the old value in the file, and it came back on reopening, in MATLAB too. This affected VariantVariables in binary dictionaries, and those this extension created in JSON dictionaries.

A dictionary that holds two entries with the same name in one section, which only a damaged or hand-edited file does, now opens with a banner saying so, such as `Two entries in Design Data are named 'gravity'. Neither can be edited or deleted until the file gives one of them another name.`, and an edit or a delete of either one is refused, leaving the file as it was. Before, nothing said the names were shared, and an edit or a delete of one entry could change or remove the other.

An mpt.Parameter or mpt.Signal entry can now be pasted or dropped into a dictionary's Design Data, from a JSON or a binary dictionary into either, and keeps its class; before, Paste and the drop refused it there. New mpt entries still cannot be created from the Add gallery. Dragging entries from two sections onto one of them now moves them there, as cutting and pasting them already did; before, the drop could be refused without a message. With two section headers selected, or a header and an entry from another section, Paste is now disabled, with the tooltip `Select rows in one section to paste`, and Ctrl+V or Cmd+V does nothing. Before, Paste stayed enabled, and the context menu pasted into the right-clicked row's section while Ctrl+V or Cmd+V pasted into the first selected row's, so one selection could paste into two different places. A lone header still pastes into its section, and so does a header selected with its own section's entries. Because a selected header now counts, Paste is also disabled after Ctrl+A or Cmd+A, even when only one section holds entries.

Every top-level name in a file now gets a row. Before, a file with more than 100,000 of them, counting every section's entries together, showed only about the first 100,000 and a banner saying the rest existed: on a 291,564-entry dictionary, 191,568 names had no row. A cell array with more than 100,000 elements lost its tail the same way when it was opened. In a file with more names than that, each row loads its contents when it is expanded. Only if the view cannot take the rows at all does it show the first 100,000, with a banner saying so. Closing a file's last tab now releases the parsed copy the tab held; before, every file opened stayed parsed until the window closed, about 67 MB for a 20 MB dictionary. When the table updates while a cell is being edited, such as after a save or an edit in the text view, and the update removes that cell's row or column, the editor now closes without writing anything, and the keyboard keeps working. Before, the editor disappeared but the table went on ignoring every key. An update that keeps the row and the column leaves the editor open with what was typed, as before.

A model that references one model from two Model blocks now shows two Model References rows that can each be selected on its own, and the Properties panel shows each one's own Block Path. Before, clicking either one selected both, and the Properties panel showed the second block's path for both. Two External Data rows for files with one name in different folders, such as `a/signals.mat` and `b/signals.mat`, are told apart the same way, each with its own Path.

If columns that are hidden by default, such as Last Modified By, appeared in your table after an update, Reset to default in the column menu hides them again, restoring the default layout. From this version on, a column a later version adds hidden by default starts hidden, even after you have changed the column layout. The Status column's Modified mark now takes the theme's colour for a modified file, the one the Data Explorer tree's Modified badge uses, so it meets WCAG AA's 4.5:1 contrast on dark and high-contrast themes; before, it measured 3.54:1 on Dark Modern and 4.18:1 on High Contrast Black. It was one fixed colour in every theme, and still is where the theme colour is not defined, such as with VS Code's built-in Git extension disabled. The tooltip on the Add gallery's Keep open checkbox no longer says that closing the gallery selects every entry added, which it never did. It now reads `Stay open after each add. Entries land immediately and are not renamed.`, and closing still selects the last entry added.

An open JSON dictionary's or `.mat` file's Usage column now updates when a model that uses it is created or deleted in the workspace, such as by a branch switch; before, it kept showing the old usage until the file was edited, saved or reopened. A model changed on disk still does not update it until you do one of those. For a model whose model workspace is loaded from a `.mat` file, Usage now looks in that file before the model's dictionary, as MATLAB does. So for a name both define, the `.mat` variable's Usage names the blocks that use it and the dictionary entry's no longer does; before, it was the other way round. A link that names a file only by its name, such as a Model Reference or an External Data link, now opens the copy in the same project or folder as the file the link is in when the workspace holds more than one file of that name, as the Data Explorer tree does, whether it is clicked in a table or in the Properties panel; before, it opened whichever copy the workspace search found first. When a file in the workspace is replaced by a write that keeps its modification time and size, such as restoring it from a zip or tar archive, the Data Explorer tree, Search Data Source Entries and the Usage column now follow the new contents; before, they could keep the old contents until the window was reloaded. A write that puts back the exact sub-second time the file had is still not seen, because VS Code does not report it.

More damaged files now open with what could be read, and a warning says what could not, though in a model's workspace some damaged values show as not decoded with no warning. A `.mat` file or a model with a variable whose type information is damaged no longer fails to open with `Cannot read properties of null (reading 're')`: that variable shows as not decoded with its own size, such as `<1x1 unknown, not decoded>`, and the rest of the file opens as usual. A value nested more than 128 levels deep is read down to that depth and shown as not decoded below it; before, one nested about 1,500 levels deep stopped a `.mat` file opening with `Maximum call stack size exceeded`, left a model's workspace section empty, and showed in a JSON dictionary as a long char row, such as `<1x320033 char>`. A hand-edited model whose list of configuration sets or of model references holds a single item instead of a list now opens. If the list is malformed in any other way, or an item in it has no name, the model now opens with a warning for what was skipped. Before, most of these stopped the model opening, and the rest were read as an empty list with no warning. A model whose zip archive holds a part larger than the size the archive's own index records for it now opens without that part, with a warning naming it, so a model whose workspace part is damaged this way opens with an empty workspace section. Before, the part was silently cut at the recorded size: in one model, five of its seven workspace variables showed `[ ]` where the file holds values such as `11-12i`.

More values that could not be read are no longer shown as if they had been. In a `.mat` file, a struct array with a damaged field in one of its elements shows as not decoded, such as `<1x3 struct, not decoded>`, with a warning; before, that field's later values moved up onto earlier elements, so element 3's value showed as element 2's. A number whose data is missing from the file shows as not decoded, such as `<2x3 double, not decoded>`, and cannot be edited, in any kind of file, and a `.mat` file also names it in a warning; before, it showed `null` or `[null]` and could be edited. When a MATLAB object's stored data is damaged part-way, in a `.mat` file, a model workspace or a dictionary, a warning now names the variable that was read only in part. The objects after the damage still show their class's defaults rather than their own values; before, nothing said so. In a `.mat` file or a model workspace, an object whose stored data cannot be matched to an object of its class shows as its class alone, such as `<1x1 Simulink.Parameter>`, with a warning that it could not be decoded. Before, it showed as an empty object of that class, such as a Parameter with Value `[ ]` and Data Type `auto` that is not the one in the file, and copying it carried that empty Parameter. A value in a JSON dictionary stored as a MATLAB data stream that does not decode is named in a warning and can no longer be edited; it still shows as its encoded text and is saved unchanged, where before nothing said it had not been read. A System Composer definition whose type is missing from the file is now named in a warning, because its Kind column then falls back to its Simulink class and may be wrong. Before, a struct type in that state showed as a Data Interface with no warning. This version ships `data-explorer-core` 1.40.0.

## [1.39.0] — 2026-10-16

Renaming a function element of a service interface now also renames the function in System Composer's list of the interface's functions, in a JSON dictionary and in a binary dictionary alike. The dictionary records the function twice, as the function element the table shows and in that list, and only the first was renamed. Before, renaming `f`, with Prototype `y = f(u)`, to `compute` changed the function element to `compute` and `y = compute(u)`, but System Composer's list still said `f` and `y = f(u)`, so the saved file disagreed with itself about the function's name. MATLAB opened such a file without a warning, but the first read of the interface's functions after `systemcomposer.openDictionary` still named `f`, and reading their arguments gave the error `Invalid or deleted object`; only a second read named `compute`. Now both are renamed together, also when the interface was renamed first and when a function renamed in this version is renamed again, and after the rename the first read names `compute`. Undo restores both, in one step. As before, a rename whose Prototype cannot follow is refused, with a message saying why, and changes nothing. A dictionary saved this way by an earlier version keeps the old name in System Composer's list, and renaming the function again does not change it; to repair one, rename the function back to its old name and then to the new one. This version ships `data-explorer-core` 1.39.0.

## [1.38.0] — 2026-10-16

Enumeration values show their value and their size. In a JSON dictionary, `on` and `off` looked the same, both `<1x1 matlab.lang.OnOffSwitchState>`, and a vector of them showed as 1x1; they now show `on`, `off` and `<1x3 matlab.lang.OnOffSwitchState>`, with a row for each element. A JSON dictionary stores only an enumeration's number, so a value whose enumeration the same dictionary defines shows its name, such as `Color.Red`, and any other shows its number, such as `Color(1)`; before, a single value and a vector alike showed `<1x1 Color>`. In a `.mat` file, enumeration values show their names and sizes, such as `Color.Red` or `<1x2 Color>` with a row for each element, where every one showed `<1x1 …>`, and a Simulink.Parameter whose Value is an enumeration shows that value, such as `Color.Green`, instead of a struct with fields such as `EnumerationInstanceTag` and `ValueNames`. In a binary dictionary, an `OnOffSwitchState` value shows `on` or `off` and its size, where it showed `<1x1 matlab.lang.OnOffSwitchState>`. Copying an `OnOffSwitchState` value from a `.mat` file or a binary dictionary into a binary dictionary now carries its value, where it carried `0`; it is written in a form no MATLAB-written dictionary uses, and not yet checked in MATLAB. In every file type, `fi`, `categorical` and `table` values show their real size, such as `<1x3 embedded.fi>`, `<1x2 categorical>` and `<2x2 table>`, where all three showed 1x1.

In a `.mat` file, a function handle shows its text and its class, such as `@sin` or `@(x)x.^2+1` with class `function_handle`, at the top level and inside a struct field or a cell. Before, it showed `null` with class `unknown`, and a cell holding handles read `{null, null, [ ], 3}`. An empty handle shows `[ ]` with class `function_handle`. Opening such a file no longer shows the warning that part of the file could not be read. In a JSON or a binary dictionary, a function handle inside a struct or cell that the dictionary stores as a MATLAB data stream shows the same way, cannot be edited, and is saved unchanged. Copying a `.mat` struct or cell that holds function handles now carries each handle, where it carried `null`; pasted into a binary dictionary, a handle is still not kept.

Text holding a control character, such as a newline or a tab, shows the MATLAB expression that builds it: `['a' newline 'b']`, `['a' char(9) 'b']` or `"a" + newline + "b"`. Before, the Value column drew a newline or a tab as a space and left a null character out, so the text looked like a different value. The expression can be edited, and is saved as the text it builds. A complex array's summary says it is complex, `<1x11 complex double>` or `<1x2 sparse complex double>`, where it read `<1x11 double>` and `<1x2 sparse double>`. In a JSON dictionary, a row vector that MATLAB wrote in its `Vector(N)` form, such as a 1x10 `int8` or a 1x11 `logical`, showed as a single `0` or `false`; it now shows the whole vector, such as `[1 2 3 4 5 6 7 8 9 10]`, or for a longer one its size and class, such as `<1x11 int8>`, with a row for each element, as a binary dictionary or a `.mat` file does, and an edited one is saved as a row MATLAB reads back. A value MATLAB wrote to a JSON dictionary as `null`, as it does for a 2x2x2 string array, showed as `0`; it now shows `[ ]`, a 1x0 double, which is what MATLAB reads back.

A cell array in a dictionary that holds an object, such as a Simulink.Parameter, shows the object's size and class, `{<1x1 Simulink.Parameter>}`, and no longer opens an editor. Before, it showed the object's value, such as `{1}`, and typing over it silently replaced the object with a number. In a `.mat` file, an object or a string array inside a cell array shows its own size, such as `<1x3 string>`, where every one showed `<1x1 …>`.

The Value cell of a bus element, a connection element or a function element no longer opens an editor. A value typed there marked the bus modified and was then dropped when the file was saved. Inside a Simulink.Parameter's Value, the Add Child and Delete menu items are greyed out where MATLAB refuses the result: deleting the last field of a struct nested in the Value, and, in a struct array, adding or deleting a field or an array element inside just one of its elements. Before, the edit was made, and the dictionary could be saved with a Value MATLAB will not accept. Removing elements from a Parameter's Value until one is left now sets its Dimensions to `[1 1]` and its Complexity to match the element that is left, as MATLAB does; before, they kept their old values, such as `[1 3]`, and were saved that way. Dimensions given by a name, such as `[1,N]`, are kept. Undo restores both. A removal that leaves more than one element still leaves them as they were.

More values that a JSON dictionary cannot store, such as a 2x2x2 cell array holding a string, are now refused when you paste them, with a message naming the entry and the reason. Before, such a cell copied from a binary dictionary, whether or not you had edited it there, was pasted and saved in a form MATLAB does not write for it. A value refused only for its size is still refused when the file is saved, as before. Editing a bus in a JSON dictionary no longer adds a `"_mw_element_type": "MATLABArray"` line to its list of elements, which MATLAB does not write there.

A model file that is an empty zip archive now opens with its five sections empty and no warning, as a zip archive holding no model parts already did; before, it failed to open with the error `Not a Simulink model`. A model whose model workspace data is cut short now opens, with its other sections shown in full; before, it failed to open with an error such as `Cannot set properties of undefined (setting 'name')` or `Cannot read properties of null (reading 're')`. The change is `data-explorer-core` 1.38.1.

## [1.37.0] — 2026-10-15

The binary dictionary editor now follows its file when another program, such as MATLAB, changes it, the way VS Code treats a text file. With no unsaved edits, the view reloads from disk. With unsaved edits, your edits are kept, and saving asks before it overwrites the newer file: Overwrite writes yours, Revert discards yours and reloads. Before, the view went on showing the old contents, and the next save silently wrote over the other program's changes. The `files.saveConflictResolution` setting is honoured, and the editor's own saves are not mistaken for outside changes.

A Simulink.Parameter now refuses the values MATLAB refuses, with MATLAB's message, so you can no longer save a dictionary MATLAB will not accept: a cell or a string array as its Value, and an empty `[]` or `''` as a field of a struct Value. Renaming a function element of a service interface also renames the function in its Prototype, which MATLAB requires to match; a Prototype the rename cannot follow refuses the rename instead of leaving the two disagreeing.

The Value and Class columns read as MATLAB's Workspace browser shows them. A complex empty in a binary dictionary shows `[ ]` instead of `''`. The Class column says `int16 (complex)`, `double (sparse)` and `logical (matlab.lang.OnOffSwitchState)` where it said `double`, `double` and `logical`. Empty cells, string arrays and logicals show their size and class, such as `<0x3 cell>` or `<1x0 logical>`, and a 0x0 cell shows `{}`.

Values a JSON dictionary stores as a MATLAB data stream, such as high-dimensional arrays and complex values, are now shown but not edited in place, because once changed they cannot be written back as MATLAB wrote them; you can still rename and delete their entries. A numeric array of three or more dimensions pasted from a binary dictionary into a JSON one is now saved the way MATLAB saves it; before, MATLAB read it back as empty. A pasted value a JSON dictionary cannot store is refused with a message. Removing elements from a complex vector until one is left keeps its class and value, where an `int16` one became 0 and a double one became text.

Saving a binary dictionary keeps more of what was pasted into it: an object that saves itself in its own form keeps that form, an object held in a struct field or a cell element keeps its class and properties (it was written empty, losing even the field's name), and an empty cell keeps its size. An object's own Value cell no longer accepts an edit that would be lost on save. In a `.mat` file, a damaged object no longer stops the whole file opening, an object's column-vector property shows as a column, and a property whose text index is out of range is left out rather than shown as empty text. The change is `data-explorer-core` 1.37.0.

## [1.36.11] — 2026-10-14

The Variable Editor opens from the Property Inspector again. Clicking the grid icon on a matrix's Value row in the Property Inspector flashed the panel's `Loading…` line and closed it before any numbers appeared, every time, since 1.32.0; the same icon in the table worked. 1.32.0 began fetching a matrix's numbers when its panel opens rather than sending them with every selection, so the numbers now arrive as a message from the extension — and the inspector closed its Variable Editor on every message it received, a rule written when the only messages were a new selection or none. The panel now closes only when the selection changes or is cleared, as the table's does, and stays open with its grid. A test now opens the editor from the inspector and delivers the numbers the way the extension does, so this path is checked rather than assumed.

## [1.36.10] — 2026-10-13

Dictionaries open closer to what MATLAB wrote, and an entry you edit is saved closer to it. A value whose text looks like a number but is not one, such as a char `'007'` or `0.00`, or a hex-encoded value, is no longer read as a number; before, it showed as the number and an edit of its entry saved the number. A carriage return MATLAB wrote inside a value is read and saved as one, where it showed as `&#xD;` and was saved as `&amp;#xD;`. In an object array that mixes classes, such as a configuration set's components or an array of signals and signal subclasses, each element keeps its own class and the array shows the class MATLAB names for it; editing the entry no longer writes every element under one class. In a text dictionary, an object array's elements keep their identity when the entry is edited or pasted. An enumeration value set directly as an entry's or a property's value shows its enumeration name and keeps it when saved. An empty value with a class or a size, such as an empty `int8` property or a bus's empty list of elements, keeps that class and size instead of becoming an empty character value when its entry is saved, and an `int8` or `single` value you clear to `[]` keeps its class. Dynamic properties keep how MATLAB declared them, and an empty struct entry is saved the way MATLAB writes it. A damaged `.mat` file can no longer run the extension out of memory by declaring far more elements than it holds: values are read only as far as the file's bytes go, and a warning names the variable that was cut short. The change is `data-explorer-core` 1.36.8.

## [1.36.9] — 2026-10-13

A number typed into a value of an integer class, such as `int8` or `uint16`, is now converted the way MATLAB converts it. It is rounded to the nearest integer, with a half going away from zero; a number past the class's range becomes its largest or smallest value; and NaN becomes 0. So 70000 typed into an `int16` is saved as 32767, and 2.5 typed into an `int8` as 3. Before, the number was kept as typed and then saved however each kind of file happened to convert it. Complex values can now be typed in the forms MATLAB accepts, such as `i`, `-i`, `1+2j` and `3 + 4i`, and as `Infi` and `NaNi`, the way the extension shows them; all of these used to be refused. In a binary dictionary, a complex value with an Inf or NaN part, such as `complex(1,NaN)`, now opens as numbers, with a row for each element, instead of as quoted text. Saving a binary dictionary now keeps three kinds of value inside a cell that it used to lose: an enumeration value, which showed as `<1x1 GearMode>` and was saved without its value; an empty object array, which opened and saved as an empty char; and an empty logical, such as a 1x0 one, which opened as `false`. A text dictionary in which an element of an object is empty (null) now opens. A struct with an empty element can now be pasted into a binary dictionary, where the paste used to fail. An object of a class that saves itself in its own form keeps that form when it is pasted from a text dictionary into a binary one. A `.mat` file holding a struct array with no fields and a very large size no longer takes down VS Code. MATLAB writes `repmat(struct(), 1e4, 1e4)` in about 200 bytes; such an array now opens as its summary, `<10000x10000 struct>`, without a row for each element. A damaged `.mat` file whose struct claims more elements than the file holds no longer takes seconds to open or runs the extension out of memory. The change is `data-explorer-core` 1.36.7.

## [1.36.8] — 2026-10-12

A damaged `.mat` file of a few hundred bytes can no longer take down VS Code. The extension read a struct's field names past the end of their block and could run out of memory doing it; it now stops where the names end. A zero-length matrix in a `.mat`, which MATLAB writes for some empty struct fields, now reads as `[]` instead of taking the next value's bytes as its size. Saving keeps more of what the file had: the bookkeeping keys MATLAB writes into some objects, such as a table's, the nested cells, structs, strings and matrices of a cell inside an object property in a binary dictionary, and characters MATLAB writes as codes, such as `char(1)`, which used to open and save as digits. A text dictionary whose struct has an empty (null) element now opens. An entry whose value a binary dictionary stores as hex, such as a Parameter holding a sparse array, keeps its Value when it is pasted into a text dictionary and the file is reopened. An element of a complex array can now be given a complex value, and undo restores it; undoing an edit to an empty value restores its size and class. A size the writers would have saved as a different size is now refused with a message instead of being saved wrong. The change is `data-explorer-core` 1.36.6.

## [1.36.7] — 2026-10-12

A name that is also a built-in JavaScript name, such as `toString`, `constructor` or `__proto__`, no longer breaks the file that holds it. A dictionary entry whose class had such a name stopped the whole dictionary opening; it now opens, and that entry shows as a generic object, as any class the extension does not know does. A struct field with such a name, in a MAT-file or a dictionary, is a field like any other: a struct array with one made the MAT-file fail to open, and a field named `__proto__` silently disappeared or came back wrong after a save. A model holding a package part named `__proto__` opens, where it took seconds and then failed. Editing a binary dictionary can no longer freeze on a malformed entry: finding the entry for a cell edit, rename, delete, move or cut-paste could take up to a minute on a file of a few kilobytes, and is now immediate. A classic `.mdl` whose mask style text holds many brackets across a line break opens at once instead of after seconds. Also fixed: the Variable Editor grid no longer freezes on a complex value with a very long element, removing a filter chip after a very long typed filter no longer freezes, and a project label named `toString` no longer hides one of a component's dictionaries on the project page. The change is `data-explorer-core` 1.36.5.

## [1.36.6] — 2026-10-12

A dictionary or model with malformed contents can no longer freeze VS Code. Four places where the extension reads a file's text used patterns whose running time grew with the square, or the cube, of a long run of the wrong characters: the System Composer interface list inside a binary `.sldd`, complex values in a dictionary, block parameter values in an `.slx` or `.mdl`, and the trailing `.0` MATLAB writes in complex values. A file of about a kilobyte could hold the extension host, and every other extension running in it, for over ten seconds, either when it was opened or when the Data Explorer view scanned its folder. A single stray quote in a large binary dictionary's interface list made the whole dictionary fail to open. Each is now read in time proportional to its length, with the same results as before, and that dictionary opens. Also fixed: a struct, numeric, enumeration or alias type whose name is also a built-in JavaScript name, such as `toString` or `constructor`, showed as a Data Interface and lost its icon; it now shows as what it is. A new entry's identifier is now drawn from the platform's secure random source, in the same format as before. The change is `data-explorer-core` 1.36.4.

## [1.36.5] — 2026-10-11

A sparse array is now held as its nonzeros alone, so even a huge one opens at once. The extension used to expand a sparse array into its full matrix, zeros included, before showing it: a 1000x1000 array with five nonzeros took about 10 ms and 7.6 MB to read, and an array too large to expand, such as a 10000000x2 one, showed `<10000000x2 sparse double, not decoded>` and no rows at all, and in a `.mat` file it raised a warning that part of the file could not be read. Now only the nonzeros are read, whatever the size of the array. That 1000x1000 array reads in under a millisecond, and the 10000000x2 one shows `<10000000x2 sparse double>` with a row for each nonzero, labelled `A(9999999,2)` as MATLAB does. The Variable Editor grid is no longer offered for a sparse array. This reverses 1.36.4, where the grid still showed the full matrix, zeros included: the grid is the one view that lays a sparse array out in full, and the array's values are in its nonzero rows. A Parameter whose Value is an all-zero sparse array no longer shows an empty Value row, which existed only to open the grid. A sparse array with more than 10,000 nonzeros shows its summary only, with no element rows: the table lists an array's elements only when there are at most 10,000 of them. A complex number whose imaginary part is NaN is now written into a binary dictionary so that MATLAB reads it back correctly. It was written `1.0NaNi`, which MATLAB split into two numbers, so that element and every one after it came back wrong; it is now written `1.0+NaNi`. A sparse value this extension wrote in its row form, such as `[0, 7, 0]`, now reads as the sparse array it is rather than as the full row `[0 7 0]`, and a binary dictionary saves it as MATLAB's own stream. A value too large to write is now refused, with a message that names it, instead of being attempted. Only a malformed or hand-made value is that large, such as a cell that declares a hundred million elements and holds one, or a cell of tens of thousands of empty sparse arrays. Pasting one into a binary dictionary could run the extension out of memory and crash it. Now the paste or edit stops with a message like `Cannot write "bigCell": … Nothing was written.`, and the dictionary is left as it was. Also fixed: after a paste or drop that a text dictionary refused, the next paste no longer skips a number in the name it gives its copy, and an entry cut for the refused paste can still be edited; a drag that cannot start now says why instead of doing nothing. Checked by reading the written dictionaries back in MATLAB, both text and binary, after a plain save, an element edit, an element set to zero, a rename and a paste. The change is `data-explorer-core` 1.36.3.

## [1.36.4] — 2026-10-10

A binary dictionary's hex-encoded values now open as what they hold and are no longer destroyed by an edit. A binary (zipped) `.sldd` stores some values as a hex-encoded MAT stream instead of XML: every sparse array, any struct, cell or Parameter that holds one, and objects with a function-handle property. The extension read the hex text as a number, so every such value showed as `1494`, the digits at the front of the stream. Worse, editing, renaming or pasting that entry wrote `1494` back over it, and on two corpus files the result was a dictionary MATLAB crashes opening. Each hex value is now decoded through the same MAT-stream reader the text dictionary uses, and shows exactly what its JSON twin shows. An unedited one is written back byte for byte, an edited sparse array is written as MATLAB's own stream, and a damaged stream opens with a placeholder and a warning instead of failing the whole dictionary. Sparse arrays also look the way MATLAB describes them. The class column shows the data class, `double` or `logical`, rather than `sparse`; MATLAB's `whos` lists sparse as an attribute, not a class. The value reads `<10x10 sparse double>`, MATLAB's own wording. Expanding one lists only the nonzero elements, labelled `matSparse(3,3)` as MATLAB does, so a million-element matrix with five nonzeros opens as five rows rather than a million. The Variable Editor grid still shows the full matrix, zeros included. A cell that holds a sparse value shows the summary inside its one-line value and offers no in-cell editor there; its elements still edit. Also fixed on the way: a struct-array property of an object kept only its first element; a sparse array too large to read, inside a property or a cell, showed as `[ ]`; and a column vector or a matrix copied out of a `.mat` file lost its shape. Checked against MATLAB on new reference files, a `.mat` file, a model workspace and a text and a binary dictionary, with every written file read back in MATLAB. The change is `data-explorer-core` 1.36.2.

## [1.36.3] — 2026-10-09

A complex value inside an MCOS object now shows as the number it is. A `Simulink.Parameter` whose Value is `3+4i` or `[1+2i 3+4i 5+6i]`, saved in a `.mat` file or an `.slx` or `.mdl` model workspace, showed `[[object Object]]` in its value cell, its Value row, each element row and the Variable Editor grid. It now reads `3+4i` and `[1+2i 3+4i 5+6i]`, spelled exactly as the extension already spells complex numbers in dictionaries and in plain MAT variables: a column is `[1+2i; 3+4i]` and a matrix is `[1+2i 3-4i; 5+6i 7-8i]`. The MAT reader kept each complex element as a pair of real and imaginary parts, and the step that turns an object's stored properties into values had no case for that pair, so it was handed on as an object and printed as one. Three related things are fixed with it. A value with a NaN or Inf part keeps its elements instead of turning into a quoted string. An integer or single complex array shows its own class, `<1x60 int16>` rather than `double`. The Property Inspector lays a complex matrix out as a matrix instead of in storage order. Two older faults in the dictionary writers, found while checking this, are fixed too. Copying or editing a complex Parameter that is not a double scalar in a binary dictionary wrote it back as a double with its shape lost: MATLAB misread 17 of 29 such entries after a plain save, and now misreads none. A complex value written into a text dictionary in its binary form was one MATLAB reads as empty: 50 of 79 entries were misread, now none. All of this was checked against MATLAB on new reference files that save complex Parameters of every shape and class, nested in structs and cells beside separately built twins, in a `.mat` file, a model workspace, and a text and a binary dictionary. The change is `data-explorer-core` 1.36.1.

## [1.36.2] — 2026-10-09

An MCOS object saved inside a struct field or a cell element now opens as exactly what the same object is at top level, in a `.mat` file and in an `.slx` or `.mdl` model workspace alike. This covers a `Simulink.Parameter`, a `Simulink.Bus`, a `string`, and every class the extension already shows at top level. Before, such an object was a `<1x1 Simulink.Parameter>` or `<1x1 string>` leaf with no value and no properties. The object's data lives in the file's one shared MCOS store, and the reader looked that store up only for named top-level variables, by name, so a field or a cell element, which has no name of its own, was never decoded. Now every object at any depth carries its handle into the store and is decoded against it, just as a top-level one is, and its row is built by the same rule. A nested Parameter shows its Value and its property rows, a nested string shows its text, and a nested object array has its elements. Some things are unchanged on purpose. A cell's one-line value still spells each object `<1x1 Class>`, a struct's summary is still `<1x1 struct>`, a nested name still cannot be edited, and the file is still read-only. An object whose handle is damaged or names nothing stays the opaque leaf it was, and its neighbours are unaffected. This was checked against MATLAB on two new reference files. Each saves every nested object beside a top-level twin of equal value, built separately, because a `Simulink.Parameter` is a handle and a copy made by assignment would share the nested one's storage and prove nothing. All 24 pairs present identically: 22 in a `.mat` file and 2 in a model workspace. The change is `data-explorer-core` 1.36.0. This version also ships `strnum` 2.4.2, the number parser the dictionary XML reader uses.

## [1.36.1] — 2026-10-03

The filter popup a column header opens now shows which comparison it is about to write, in every theme. The seven operator buttons mark the chosen one by painting its background, and that background came from a colour name the themes do not define — so instead of the colour, each button painted the pale blue literal written beside the name as a fallback, in all four themes at once. On a dark theme that is a pale blue tile under near-white text, 1.22:1 against its own glyph; on High Contrast Black, 1.31:1. The one element in the popup that says whether Apply will write `contains` or `≥` was the one element a dark-theme user could not read, and nothing anywhere reported a problem, because a colour name nothing declares is not a missing colour but a silent one — every reader of it quietly takes its own fallback. All four themes now measure past 7:1. The value is not a new choice: the extension already defines the colour it uses for a selected surface, mapped onto the one VS Code paints selections with, and the literal that had been shipping was that same colour with one digit changed — a misspelled name rather than a design. The `writes:` line beside it, which shows the literal text to retype into the search box, was reading a font name that is also undefined and so ignored the font you actually type code in; it now follows `editor.fontFamily` like the rest of the extension's monospace. High-contrast forced-colors mode was never affected and still marks the chosen operator with a system-colour outline. The underlying mistake is now caught by a test rather than by a customer: every theme colour this popup asks for must be one the themes define, so a name invented by accident fails in the test suite instead of going quiet in a theme nobody opened.

## [1.36.0] — 2026-10-02

A file too large to show whole now lists every entry it has and loads a row's contents when that row is opened, where before it hung with no table and no message. Reported against an 8 MB MAT-file — a cell array of MIDI songs — which "keeps spinning" and never opens: it flattens to 2,016,325 nodes over 7 levels, a row was built for every one of them, and the resulting `setRows` payload was 704 MiB of JSON. V8 cannot produce a string that long (the limit is 536,870,888), so `JSON.stringify` threw inside VS Code's own `postMessage`, which is `async` and serializes the message itself — the throw therefore arrived as a rejected promise that the `try`/`catch` around the post could not see, nothing posted `setRows`, nothing posted an error, and the table's spinner ended on nothing else. Three layers, because there were three faults. The post is now awaited and a rejection becomes the error banner, so an undeliverable payload can never again be silent. A hard cap of 100,000 rows sits in front of the read-only row payload — not a tuning knob but what keeps the payload serializable at all, sized for the worst row shape rather than the measured 366 B, and taken as a PREFIX because every builder emits a parent before its children and a prefix is the only cut in which every surviving row's parent is also present; a sample would leave orphans the webview cannot place. The editable `.sldd` views get the guard but not the cap, since a structural edit computed against a truncated row set is worse than an honest banner. And then the cap alone, which is where this version's real work is: a prefix of a 2-million-row pre-order traversal is the first cell's descendants and nothing else, so ten of the eleven top-level variables were not on screen and no gesture could reach them — the file opened and was still unusable. The rule now is breadth over depth, for every data source and every entry type: stop expanding large entries, but list all entries, because a name present matters more than a value shown. The payload is planned by whole LEVELS of the tree, level by level while the next one fits, and the first level that does not is omitted entirely rather than half-delivered — which is what makes a deferred row mean exactly "has children, none of them here" and makes one fetch the whole answer for that row. The reported file now delivers 238 rows, levels 1 through 4 complete, and paints them in 7 ms. One plan spans every section rather than one plan per section, and that is the half the rule actually turns on: a per-section plan would also deliver whole levels and also defer honestly while spending the budget on the depth of section 1 and leaving section 9's entries unnamed, so a dictionary's References heading would read as empty on a file whose Design Data is deep. Opening a deferred row fetches it: the twisty is driven by the deferred mark as well as by delivered children — through one predicate read by the click, the Space key and `aria-expanded` alike, so a tree a mouse can open is one a keyboard can open — the click asks the host, the host answers from the same planner that built the payload, and the rows are merged under their parent instead of being routed through a fresh payload, which would re-derive the columns and close an open grid view. Pairing the two halves on one choice of planner is deliberate: a fetch answered by a different rule than the payload was built with is a row that opens onto the wrong thing, with no error anywhere. The answer carries a count of children that got no row at all, for the one loss a fetch can still inflict — a node with more direct children than a whole delivery holds, since a cell's children are built uncapped — and the table says that number in the banner strip, because the file's own banner was composed before the user opened anything and cannot. Entry-scoped repaints, which is how an edit writes back, take the same budget: a 1000x1000 double is 1,000,001 rows from a single name, enough to be the whole problem by itself. That banner is also now in the strip rather than in the document's normal flow ahead of a full-bleed `position:absolute` table, which had been painting over it — an error message that was in the DOM and on screen nowhere, leaving the panel reading "No data". Qualified against the reported file in a real browser over the shipped bundle: all eleven variables named, the banner legible in both themes, descending to a frontier row costing no round trip until the frontier itself, and opening a 1x19252 struct array four levels down posting one request, answering in 90 ms and landing its rows under the row that was clicked. Unchanged by any of this: parsing that file still costs about 2.3 GiB of extension-host heap, so a file several times larger exhausts the host before a single row is built — that is the MAT reader in `data-explorer-core`, and no amount of planning on this side recovers it.

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
