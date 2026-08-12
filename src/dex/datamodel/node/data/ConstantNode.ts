// Copyright 2026 The MathWorks, Inc.
//
// A Constant is an Architectural Data entry: on disk it is byte-identical to a
// plain (derived) MATLAB variable — the only distinction is metadata.isderived.
// So a ConstantNode is a MatlabVariableNode specialized with the Constant rules:
//   • its Kind is always 'Constant' and its icon the arch-flavored one;
//   • it has no children (a Constant is a scalar leaf);
//   • its Value must be SCALAR and NUMERIC — validated on edit.
// It shares all of MatlabVariableNode's parse + serialize machinery, so a Constant
// round-trips identically to the variable it is. A Constant and a Design MATLAB
// Variable convert back and forth purely by rebinding isderived (see
// SectionNode.parseEntry, which reclasses a derived plain variable via this class).

import MatlabVariableNode from './MatlabVariableNode';
import DataNode, { type SetPropertyResult } from '../DataNode';
import type BaseNode from '../BaseNode';
import MatlabValueParser, { parsedIsScalarNumeric } from '../../parser/MatlabValueParser';

export default class ConstantNode extends MatlabVariableNode {
  // A Constant is always a Constant — its Kind never follows the section/derived
  // logic MatlabVariableNode uses (that logic is what turns a plain variable INTO
  // a Constant in the first place).
  get kind(): string {
    return 'Constant';
  }

  get icon(): string {
    return 'typeConstant';
  }

  // A Constant is a scalar leaf: no children, ever.
  canAddChild(): boolean {
    return false;
  }

  // A well-formed Constant is scalar-numeric and editable. Defensive: if a file on
  // disk carries a derived entry whose value is NOT scalar-numeric (invalid in
  // MATLAB, but possible in a hand-edited .sldd), render it read-only rather than
  // let it be edited into a still-invalid state.
  get valueEditable(): boolean {
    if (!this.isScalarNumeric) {
      return false;
    }
    return super.valueEditable;
  }

  setProperty(propName: string, stringValue: string): true | SetPropertyResult {
    if (propName === 'Value') {
      const parsed = MatlabValueParser.parse(stringValue);
      if (!parsed) {
        return {
          error: true,
          reason: 'Invalid MATLAB expression',
          invalidValue: stringValue,
          validValue: this.displayValue,
        };
      }
      if (!parsedIsScalarNumeric(parsed)) {
        return {
          error: true,
          reason: `The value for constant '${this.name}' must be scalar and numeric.`,
          invalidValue: stringValue,
          validValue: this.displayValue,
        };
      }
      // Valid scalar-numeric value: apply via the variable machinery.
      return super.setProperty(propName, stringValue);
    }
    // Non-Value edits (name, description, data type) follow the generic path.
    return DataNode.prototype.setProperty.call(this, propName, stringValue);
  }

  static get defaultName(): string {
    return 'Const';
  }

  static createDefault(name: string, parent: BaseNode | null): ConstantNode {
    return ConstantNode.fromVariable(MatlabVariableNode.createDefault(name, parent));
  }

  static parse(rawVal: unknown, name: string, parent: BaseNode | null): ConstantNode {
    return ConstantNode.fromVariable(MatlabVariableNode.parse(rawVal, name, parent));
  }

  // Reclass an already-parsed plain MATLAB variable AS a Constant, in place. A
  // ConstantNode adds no instance state over MatlabVariableNode — it only
  // overrides behavior — so swapping the prototype specializes the node while
  // preserving its identity, children, parent pointers, metadata, and serial
  // state. This is what SectionNode uses to turn a derived variable into a
  // Constant without a fragile field-by-field copy.
  static fromVariable(node: MatlabVariableNode): ConstantNode {
    Object.setPrototypeOf(node, ConstantNode.prototype);
    return node as unknown as ConstantNode;
  }
}
