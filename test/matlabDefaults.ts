// Copyright 2026 The MathWorks, Inc.
//
// GENERATED — do not hand-edit. What real MATLAB writes into a text .sldd for a
// DEFAULT-CONSTRUCTED entry of each class, captured from an R2027a Prerelease run
// against the Bmain LKG on 2026-09-29.
//
// Regenerate by re-running the probe described in
// docs/deep-work/sldd-add-entry-parity/method.md. This file is the reason
// addEntryMatlabParity.test.ts can assert MATLAB parity in CI with no MATLAB present:
// the measurement is done once, by MATLAB, and frozen here.
//
// MATLAB version: R2027a
//
// Three tables, because "same" has three failure directions:
//  * MATLAB_DEFAULTS — every scalar property MATLAB's default carries, and its value.
//    Nested-object properties (CoderInfo, Breakpoints, Elements) are deliberately NOT
//    here; they are compared structurally by the suite, since flattening them would
//    compare representations instead of values.
//  * MATLAB_ABSENT — the COMPLETE property-name set of MATLAB's default, nested ones
//    included. Used to assert we invent nothing MATLAB does not have.
//  * MATLAB_CUSTOM_SAVE — the four classes that have no property bag at all, because
//    their whole state is one `saveobj` struct. Neither table above can say anything
//    about them, and the assertion for them is per-FORMAT: two binary-only defects hid
//    in exactly this gap. See that table's own note.

export const MATLAB_DEFAULTS: Record<string, Record<string, unknown>> = {
  "Simulink.AliasType": {
    "BaseType": "double",
    "DataScope": "Auto",
    "Description": "",
    "HeaderFile": ""
  },
  "Simulink.Breakpoint": {
    "SupportTunableSize": false
  },
  "Simulink.Bus": {
    "DataScope": "Auto",
    "Description": "",
    "HeaderFile": "",
    "PreserveElementDimensions": false
  },
  "Simulink.ConnectionBus": {
    "Description": ""
  },
  "Simulink.LookupTable": {
    "AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes": false,
    "SupportTunableSize": false
  },
  "Simulink.NumericType": {
    "Bias": 0,
    "DataScope": "Auto",
    "DataTypeMode": "Double",
    "DataTypeOverride": "Inherit",
    "Description": "",
    "FixedExponent": 0,
    "HeaderFile": "",
    "IsAlias": false,
    "SignednessBool": true,
    "SlopeAdjustmentFactor": 1,
    "WordLength": 64
  },
  "Simulink.Parameter": {
    "Complexity": "real"
  },
  "Simulink.ServiceBus": {
    "Description": ""
  },
  "Simulink.Signal": {},
  "Simulink.ValueType": {},
  "Simulink.VariantControl": {
    "ValueType": "Numeric"
  },
  "Simulink.VariantExpression": {
    "Condition": ""
  }
};

/**
 * The four classes the two tables above CANNOT describe, and MATLAB's own field list for each.
 *
 * These save through MATLAB's `saveobj` hook: the whole object is one struct, there are no
 * ordinary properties at all, and `loadobj` destructures the struct on the way back in. So
 * `MATLAB_DEFAULTS` has nothing to compare (our emitted entry has no property bag) and
 * `MATLAB_ABSENT` would pass on an empty set no matter what we wrote — which is why they were
 * simply left out, and why nothing here was covered until this table existed.
 *
 * Measured differently from the two above, and worth stating: not from a dictionary MATLAB
 * default-constructed, but from MATLAB's REWRITE of ours. probe7 opened the extension's own
 * 28-entry dictionary in both formats, called `setValue` on every entry so nothing could pass
 * through as an unread blob, saved, and reopened; these are the field names MATLAB then wrote,
 * in MATLAB's order. That makes the table claim 2 and claim 3 at once — what MATLAB makes of
 * what we wrote is what we wrote.
 *
 * Order matters and is asserted: `loadobj` reads the struct by field name, but a reordering
 * means our writer stopped following the class's own declaration order, which is the first
 * sign of the envelope being rebuilt from a property bag rather than carried.
 *
 * `Simulink.VariantBankCoderInfo` is the one to read twice — it does NOT carry the
 * StorageClass/CustomStorageClass/Alias names every other CoderInfo class in Simulink has.
 */
export const MATLAB_CUSTOM_SAVE: Record<string, string[]> = {
  "Simulink.VariantVariable": [
    "Choices",
    "Specification",
    "Bank"
  ],
  "Simulink.VariantBank": [
    "Name",
    "Description",
    "VariantConditions",
    "AllChoicesCoderInfo",
    "ActiveChoiceCoderInfo",
    "BankCoderInfo"
  ],
  "Simulink.VariantBankCoderInfo": [
    "HeaderFile",
    "DefinitionFile",
    "PreStatement",
    "PostStatement",
    "Qualifier"
  ],
  "Simulink.VariantConfigurations": [
    "Configurations",
    "VariantConfigurations",
    "Constraints",
    "PreferredConfiguration",
    "DefaultConfigurationName",
    "DataDictionaryName",
    "DataDictionarySection",
    "AreSubModelConfigurationsMigrated",
    "ComponentConfigurationData",
    "Version"
  ]
};

export const MATLAB_ABSENT: Record<string, string[]> = {
  "Simulink.AliasType": [
    "BaseType",
    "DataScope",
    "Description",
    "HeaderFile"
  ],
  "Simulink.Breakpoint": [
    "Breakpoints",
    "CoderInfo",
    "StructTypeInfo",
    "SupportTunableSize"
  ],
  "Simulink.Bus": [
    "DataScope",
    "Description",
    "Elements_internal",
    "HeaderFile",
    "PreserveElementDimensions"
  ],
  "Simulink.ConnectionBus": [
    "Description",
    "Elements_internal"
  ],
  "Simulink.LookupTable": [
    "AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes",
    "Breakpoints",
    "CoderInfo",
    "StructTypeInfo",
    "SupportTunableSize",
    "Table"
  ],
  "Simulink.NumericType": [
    "Bias",
    "DataScope",
    "DataTypeMode",
    "DataTypeOverride",
    "Description",
    "FixedExponent",
    "HeaderFile",
    "IsAlias",
    "SignednessBool",
    "SlopeAdjustmentFactor",
    "WordLength"
  ],
  "Simulink.Parameter": [
    "CoderInfo",
    "Complexity",
    "Dimensions"
  ],
  "Simulink.ServiceBus": [
    "Description",
    "Elements_internal"
  ],
  "Simulink.Signal": [
    "CoderInfo",
    "LoggingInfo"
  ],
  "Simulink.ValueType": [],
  "Simulink.VariantControl": [
    "Value",
    "ValueType"
  ],
  "Simulink.VariantExpression": [
    "Condition"
  ]
};
