// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode';
import type { PropClass, PIGroupDef } from '../BaseNode';
import PropName from '../../prop/PropName';
import PropValue from '../../prop/PropValue';
import PropDataType from '../../prop/PropDataType';

export default class ModelConfigSetNode extends BaseNode {
  active: boolean;
  configData: unknown;
  objectClass: string;

  constructor(name: string, parent: BaseNode | null, active: boolean, data: unknown) {
    super(name, parent);
    this.active = active;
    this.configData = data;
    this.objectClass =
      ((data ? (data as Record<string, unknown>)._object_class : undefined) as string | undefined) ||
      'Simulink.ConfigSet';
  }

  get icon(): string {
    const isRef = this.objectClass === 'Simulink.ConfigSetRef';
    if (this.active) {
      return isRef ? 'check_configurationReference' : 'check_settings';
    }
    return isRef ? 'configurationReference' : 'settings';
  }

  get dataType(): string {
    return this.objectClass;
  }

  get displayValue(): string {
    const suffix = this.active ? ' (Active)' : '';
    return this.name + suffix;
  }

  get nameEditable(): boolean {
    return false;
  }

  get valueEditable(): boolean {
    return false;
  }

  getProperties(): PropClass[] {
    return [PropName, PropValue, PropDataType];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'Configuration', items: [PropName, PropValue, PropDataType] }];
  }
}
