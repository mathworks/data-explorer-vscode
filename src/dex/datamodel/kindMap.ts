// Copyright 2026 The MathWorks, Inc.
//
// The Class → user-facing Kind mapping, factored out of DataNode so it has NO
// model dependencies and can be bundled into the webview (the drag/drop tooltip
// needs human-readable Kind labels — "Bus", "Data Interface" — without a live
// model). Pure data + one pure function; safe on both host and client.

// The user-facing Kind for each object Class. This is the friendly name shown in
// the Kind column (e.g. Class 'Simulink.Bus' → Kind 'Bus'); it never appears in
// the Class column (raw class identity) or the Data Type column (a real data
// type). A class absent from this map falls back to its raw class name.
export const KIND_BY_CLASS: Record<string, string> = {
  'Simulink.Parameter': 'Simulink Parameter',
  'Simulink.Signal': 'Simulink Signal',
  'Simulink.LookupTable': 'Lookup Table',
  'Simulink.Breakpoint': 'Breakpoint',
  'Simulink.Bus': 'Bus',
  'Simulink.BusElement': 'Bus Element',
  'Simulink.ConnectionBus': 'Connection Bus',
  'Simulink.ConnectionElement': 'Connection Element',
  'Simulink.ServiceBus': 'Service Interface',
  'Simulink.FunctionElement': 'Function Element',
  'Simulink.ValueType': 'Value Type',
  'Simulink.AliasType': 'Alias Type',
  'Simulink.NumericType': 'Numeric Type',
  'Simulink.data.dictionary.EnumTypeDefinition': 'Enumerated Type',
  'Simulink.VariantExpression': 'Variant Expression',
  'Simulink.VariantControl': 'Variant Control',
  'Simulink.VariantVariable': 'Variant Variable',
  'Simulink.VariantBank': 'Variant Bank',
  'Simulink.VariantBankCoderInfo': 'Variant Bank Coder Info',
  'Simulink.VariantConfigurationData': 'Variant Configuration',
  'Simulink.VariantConfigurations': 'Variant Configuration',
  'Simulink.ConfigSet': 'Configuration Set',
  'Simulink.ConfigSetRef': 'Configuration Reference',
};

// The default user-facing Kind for a DERIVED (architectural) entry when the
// SystemComposer catalog doesn't classify it — e.g. a freshly pasted entry, whose
// new name isn't in the catalog. Architectural data stores interfaces as ordinary
// Simulink objects, so the same Class means a different Kind there: a derived
// Simulink.Bus is a Data Interface, a derived Simulink.ConnectionBus a Physical
// Interface. Classes whose Kind is identical in both sections (e.g.
// Simulink.ServiceBus → 'Service Interface', value/numeric/alias types) are
// omitted — KIND_BY_CLASS already yields the right label for them.
export const DERIVED_KIND_BY_CLASS: Record<string, string> = {
  'Simulink.Bus': 'Data Interface',
  'Simulink.ConnectionBus': 'Physical Interface',
};

// The user-facing Kind for each semantic classification token. Some entries are
// classified (via the systemcomposer catalog) into a Kind that comes from the
// classification rather than the Class, so the same Simulink.Bus can be a 'Data
// Interface' or a 'Struct Type' depending on how the catalog models it.
export const KIND_BY_CLASSIFICATION: Record<string, string> = {
  DataInterface: 'Data Interface',
  PhysicalInterface: 'Physical Interface',
  ServiceInterface: 'Service Interface',
  ValueType: 'Value Type',
  StructType: 'Struct Type',
  NumericType: 'Numeric Type',
  EnumType: 'Enumerated Type',
  AliasType: 'Alias Type',
};

// The Kind a plain MATLAB variable (className 'double', 'int8', a struct, etc.)
// shows: 'MATLAB Variable' in Design Data, 'Constant' when derived (arch). A
// MATLAB variable has no entry in KIND_BY_CLASS (its className is a raw data
// type), so this is handled separately from the object-class path.
export function matlabVariableKind(isDerived: boolean): string {
  return isDerived ? 'Constant' : 'MATLAB Variable';
}

// Resolve the user-facing Kind for a Class in a given section context, WITHOUT a
// live node — used by the webview drag/drop tooltip. `classification` (when the
// catalog classified the source) wins; then a derived object class takes its arch
// default; else the plain class map; else the raw class name. `isMatlabVariable`
// routes 'double'/struct/etc. through matlabVariableKind. Mirrors DataNode.kind
// and MatlabVariableNode.kind so the tooltip label matches the Kind column.
export function kindForClass(
  className: string,
  opts: { isDerived?: boolean; isMatlabVariable?: boolean; classification?: string } = {},
): string {
  const { isDerived = false, isMatlabVariable = false, classification } = opts;
  if (isMatlabVariable) {
    if (classification) return KIND_BY_CLASSIFICATION[classification] || classification;
    return matlabVariableKind(isDerived);
  }
  if (classification) return KIND_BY_CLASSIFICATION[classification] || classification;
  if (isDerived && DERIVED_KIND_BY_CLASS[className]) return DERIVED_KIND_BY_CLASS[className];
  return KIND_BY_CLASS[className] || className;
}
