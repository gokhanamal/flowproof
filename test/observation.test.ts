import assert from 'node:assert/strict';
import test from 'node:test';
import { EvidenceGate } from '../src/evidence.js';
import {
  compactAccessibilityTree,
  selectorForObservedInput,
  selectorForObservedText,
} from '../src/observation.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="ExampleApp" visible="true" enabled="true" x="0" y="0" width="430" height="932">
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Welcome" label="Welcome" visible="true" enabled="true" x="20" y="100" width="100" height="40" />
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Hidden" visible="false" enabled="true" />
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Settings" label="Settings" visible="true" enabled="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>`;

test('compactAccessibilityTree keeps visible labeled nodes and useful attributes', () => {
  const result = compactAccessibilityTree(xml);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.nodes.map((node) => node.name), ['ExampleApp', 'Welcome', 'Settings']);
  assert.equal(result.nodes[1]?.type, 'StaticText');
  assert.equal(result.nodes[1]?.bounds, '20,100,100x40');
  assert.doesNotMatch(result.text, /Hidden/);
});

test('compactAccessibilityTree enforces the model-input budget', () => {
  const result = compactAccessibilityTree(xml, 100);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 100);
  assert.deepEqual(result.nodes.map((node) => node.name), ['ExampleApp', 'Welcome', 'Settings']);
  assert.doesNotMatch(result.text, /Settings/);
});

test('deterministic evidence receives nodes beyond the model-input budget', () => {
  const observation = compactAccessibilityTree(xml, 100);
  const gate = new EvidenceGate({ stages: [{ name: 'settings', all: [{ name: 'Settings' }] }] });

  assert.doesNotMatch(observation.text, /Settings/);
  assert.equal(gate.record(observation.nodes).passed, true);
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

test('selectorForObservedInput only accepts observed editable controls', () => {
  const nodes = [
    { type: 'StaticText', name: 'Email' },
    { type: 'TextField', name: 'Email' },
  ];

  assert.equal(
    selectorForObservedInput('Email', nodes),
    '-ios predicate string:type == "XCUIElementTypeTextField" AND (name == "Email" OR label == "Email" OR value == "Email")',
  );
  assert.equal(
    selectorForObservedInput('Search products', [{ type: 'SearchField', value: 'Search products' }]),
    '-ios predicate string:type == "XCUIElementTypeSearchField" AND (name == "Search products" OR label == "Search products" OR value == "Search products")',
  );
  assert.throws(() => selectorForObservedInput('Password', nodes), /unobserved text input/);
});
