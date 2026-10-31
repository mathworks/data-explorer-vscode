// Copyright 2026 The MathWorks, Inc.
//
// One text change in a JSON .sldd as one entry-level model op, or nothing: core's (data-explorer-
// core's jsonEntrySync), which this file was word for word. Re-exported under the names this
// extension's tests import until they are rehomed (step 6b's V6); the JSON editor's engine (view's
// JsonEngine) uses core's directly.
export {
  hintFor,
  isEchoOfEdit,
  isPaintedEcho,
  planEntrySync,
  planKnownChange,
  planKnownOps,
  planOwnEdit,
  type EntrySyncPlan,
  type HostEdit,
  type KnownEdit,
  type OwnEditPlan,
  type PaintedWrite,
  type RangeReplacement,
  type TextChange,
} from 'data-explorer-core';
