import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadFlow } from '../src/flow.js';

test('loadFlow reads a project-defined ordered evidence journey', async () => {
  const flow = await loadFlow(path.resolve(import.meta.dirname, '../examples/feature-toggle-round-trip.flow.yaml'));
  assert.equal(flow.key, 'ios-feature-toggle-round-trip');
  assert.equal(flow.maxTurns, 18);
  assert.equal(flow.evidence.stages.at(-1)?.name, 'notifications restored');
});

test('loadFlow defaults maxTurns and permits arbitrary project flow keys', async () => {
  const flow = await loadFlow(path.resolve(import.meta.dirname, '../examples/flow-template.yaml'));
  assert.equal(flow.key, 'replace-with-stable-flow-key');
  assert.equal(flow.maxTurns, 10);
});

test('loadFlow rejects missing evidence and invalid patterns', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'appium-agent-flow-'));
  const missingEvidence = path.join(directory, 'missing-evidence.yaml');
  const invalidPattern = path.join(directory, 'invalid-pattern.yaml');
  await writeFile(missingEvidence, 'key: other\nname: Other\ndescription: Test\ninstructions: Test\n');
  await writeFile(invalidPattern, [
    'key: other',
    'name: Other',
    'description: Test',
    'instructions: Test',
    'evidence:',
    '  stages:',
    '    - name: ready',
    '      all:',
    '        - namePattern: "["',
  ].join('\n'));
  await assert.rejects(loadFlow(missingEvidence), /evidence/);
  await assert.rejects(loadFlow(invalidPattern), /Invalid regular expression/);
});
