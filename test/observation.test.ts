import assert from 'node:assert/strict';
import test from 'node:test';
import { compactAccessibilityTree, selectorForObservedText } from '../src/observation.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="EloAdsExample" visible="true" enabled="true" x="0" y="0" width="430" height="932">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Daimon" label="Daimon" visible="true" enabled="true" x="20" y="100" width="100" height="40" />
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Hidden" visible="false" enabled="true" />
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Diagnostics" label="Diagnostics" visible="true" enabled="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>`;

test('compactAccessibilityTree keeps visible labeled nodes and useful attributes', () => {
  const result = compactAccessibilityTree(xml);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.nodes.map((node) => node.name), ['EloAdsExample', 'Daimon', 'Diagnostics']);
  assert.equal(result.nodes[1]?.type, 'StaticText');
  assert.equal(result.nodes[1]?.bounds, '20,100,100x40');
  assert.doesNotMatch(result.text, /Hidden/);
});

test('compactAccessibilityTree enforces the model-input budget', () => {
  const result = compactAccessibilityTree(xml, 100);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 100);
});

test('selectorForObservedText targets the interactive control instead of duplicate static text', () => {
  const nodes = [
    { type: 'Switch', name: 'Session enabled', value: '1' },
    { type: 'StaticText', name: 'Session enabled' },
    { type: 'Switch', value: '1' },
  ];

  assert.equal(
    selectorForObservedText('Session enabled', nodes),
    '//XCUIElementTypeSwitch[@name="Session enabled"]/XCUIElementTypeSwitch',
  );
});
