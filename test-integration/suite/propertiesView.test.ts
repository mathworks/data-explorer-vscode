// Copyright 2026 The MathWorks, Inc.
// PropertiesViewProvider's contribution point. What the provider sends on which `ready`, a clear,
// a node shown again and a view that went is InspectorPage's (view's src/model/inspector), proven in
// view's test/inspectorPage.test.ts; the referrer it hands a link click is navigateReferrer.test.ts.
import * as assert from 'assert';
import { PropertiesViewProvider } from '../../src/host/PropertiesViewProvider';

suite('PropertiesViewProvider', () => {
  test('exposes the properties viewType', () => {
    assert.strictEqual(PropertiesViewProvider.viewType, 'dataExplorer.properties');
  });
});
