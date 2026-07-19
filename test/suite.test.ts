import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SUITE_RESULT_SCHEMA_VERSION,
  aggregateSuiteResults,
  loadSuite,
  renderSuiteJson,
  renderSuiteMarkdown,
  type FlowRunResult,
  type LoadedSuite,
} from '../src/suite.js';

const exampleSuitePath = path.resolve(
  import.meta.dirname,
  '../examples/language-learning/.flowproof/suite.yaml',
);

const declaredAliases = {
  fixtures: ['returning_learner', 'beginner_lesson_ready', 'learner_with_progress'],
  inputs: ['test_email', 'test_password'],
};

test('loadSuite resolves ordered language-learning flows and safe artifact IDs', async () => {
  const suite = await loadSuite(exampleSuitePath, declaredAliases);

  assert.equal(suite.key, 'language-learning-release');
  assert.equal(suite.device, 'iPhone 16');
  assert.deepEqual(suite.flows.map((entry) => entry.flow.key), [
    'learner-sign-in',
    'complete-beginner-lesson',
    'progress-survives-relaunch',
  ]);
  assert.equal(
    suite.flows[0]?.absolutePath,
    path.resolve(path.dirname(exampleSuitePath), 'flows/sign-in.flow.yaml'),
  );
  assert.deepEqual(suite.flows.map((entry) => entry.artifactId), [
    'language-learning-release-learner-sign-in',
    'language-learning-release-complete-beginner-lesson',
    'language-learning-release-progress-survives-relaunch',
  ]);
});

async function createSuite(files: Record<string, string>, manifest: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowproof-suite-'));
  await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(path.join(directory, name), contents)));
  const manifestPath = path.join(directory, 'suite.yaml');
  await writeFile(manifestPath, manifest);
  return manifestPath;
}

const flowYaml = (key: string) => [
  `key: ${key}`,
  `name: ${key}`,
  'description: Test flow',
  'instructions: Exercise the flow',
  'evidence:',
  '  stages:',
  '    - name: ready',
  '      all:',
  '        - name: Ready',
].join('\n');

const suiteYaml = (entries: string) => [
  'key: release-critical',
  'name: Release critical',
  'device: iPhone 16',
  'locale: en_US',
  'language: en',
  'flows:',
  entries,
].join('\n');

test('loadSuite rejects duplicate loaded flow keys and unsafe artifact keys', async () => {
  const duplicate = await createSuite(
    { 'one.yaml': flowYaml('same-flow'), 'two.yaml': flowYaml('same-flow') },
    suiteYaml('  - path: one.yaml\n    required: true\n  - path: two.yaml\n    required: false'),
  );
  await assert.rejects(loadSuite(duplicate), /Duplicate flow key "same-flow"/);

  const unsafe = await createSuite(
    { 'unsafe.yaml': flowYaml('Unsafe/Flow') },
    suiteYaml('  - path: unsafe.yaml\n    required: true'),
  );
  await assert.rejects(loadSuite(unsafe), /artifact-safe lowercase kebab-case/);
});

test('loadSuite rejects missing files and undeclared fixture or input aliases', async () => {
  const missing = await createSuite({}, suiteYaml('  - path: missing.yaml\n    required: true'));
  await assert.rejects(loadSuite(missing), /Invalid suite flow missing.yaml/);

  const fixture = await createSuite(
    { 'flow.yaml': flowYaml('flow') },
    suiteYaml('  - path: flow.yaml\n    required: true\n    fixture: unknown_fixture'),
  );
  await assert.rejects(loadSuite(fixture, { fixtures: ['known_fixture'] }), /Unknown fixture alias/);

  const input = await createSuite(
    { 'flow.yaml': flowYaml('flow') },
    suiteYaml('  - path: flow.yaml\n    required: true\n    inputs: [unknown_input]'),
  );
  await assert.rejects(loadSuite(input, { inputs: ['known_input'] }), /Unknown input alias/);
});

test('loadSuite rejects flow paths outside the suite directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowproof-suite-parent-'));
  const suiteDirectory = path.join(directory, 'suite');
  await mkdir(suiteDirectory);
  await writeFile(path.join(directory, 'outside.yaml'), flowYaml('outside'));
  const manifest = path.join(suiteDirectory, 'suite.yaml');
  await writeFile(manifest, suiteYaml('  - path: ../outside.yaml\n    required: true'));

  await assert.rejects(loadSuite(manifest), /must stay inside the suite directory/);
});

test('loadSuite rejects unsafe suite IDs and malformed locale metadata during preflight', async () => {
  const unsafeKey = await createSuite(
    { 'flow.yaml': flowYaml('flow') },
    suiteYaml('  - path: flow.yaml\n    required: true').replace('key: release-critical', 'key: Release/Critical'),
  );
  await assert.rejects(loadSuite(unsafeKey), /artifact-safe lowercase kebab-case/);

  const badLocale = await createSuite(
    { 'flow.yaml': flowYaml('flow') },
    suiteYaml('  - path: flow.yaml\n    required: true').replace('locale: en_US', 'locale: english'),
  );
  await assert.rejects(loadSuite(badLocale), /language_REGION/);
});

function passedResult(suite: LoadedSuite, index: number, required = true): FlowRunResult {
  const entry = suite.flows[index];
  assert.ok(entry);
  return {
    schemaVersion: SUITE_RESULT_SCHEMA_VERSION,
    suiteKey: suite.key,
    flowKey: entry.flow.key,
    flowName: entry.flow.name,
    artifactId: entry.artifactId,
    required,
    status: 'passed',
    durationMs: 1200,
    turns: 3,
    attemptId: 'attempt-7',
    buildSha: 'abc123',
    artifacts: { report: `${entry.artifactId}/report.json` },
  };
}

test('aggregateSuiteResults preserves manifest order and passes only when required flows pass', async () => {
  const suite = await loadSuite(exampleSuitePath, declaredAliases);
  const results = Object.fromEntries(suite.flows.map((entry, index) => [entry.flow.key, passedResult(suite, index)]));
  const aggregate = aggregateSuiteResults(suite, results, { attemptId: 'attempt-7', buildSha: 'abc123' });

  assert.equal(aggregate.gatePassed, true);
  assert.deepEqual(aggregate.totals, { total: 3, passed: 3, failed: 0, error: 0, skipped: 0 });
  assert.deepEqual(aggregate.flows.map((entry) => entry.flowKey), suite.flows.map((entry) => entry.flow.key));
});

test('aggregateSuiteResults converts missing and corrupt expected results to blocking errors', async () => {
  const suite = await loadSuite(exampleSuitePath, declaredAliases);
  const corrupt = { ...passedResult(suite, 1), suiteKey: 'another-suite' };
  const aggregate = aggregateSuiteResults(
    suite,
    { [suite.flows[0]!.flow.key]: passedResult(suite, 0), [suite.flows[1]!.flow.key]: corrupt },
    { attemptId: 'attempt-7', buildSha: 'abc123' },
  );

  assert.equal(aggregate.gatePassed, false);
  assert.deepEqual(aggregate.totals, { total: 3, passed: 1, failed: 0, error: 2, skipped: 0 });
  assert.match(aggregate.flows[1]!.reason ?? '', /identity does not match/);
  assert.equal(aggregate.flows[2]!.reason, 'Missing terminal result');
});

test('optional non-passed results remain visible without failing the release gate', async () => {
  const suite = await loadSuite(exampleSuitePath, declaredAliases);
  suite.flows[2]!.required = false;
  const skipped: FlowRunResult = {
    ...passedResult(suite, 2, false),
    status: 'skipped',
    reason: 'Disabled for this release',
  };
  const aggregate = aggregateSuiteResults(suite, {
    [suite.flows[0]!.flow.key]: passedResult(suite, 0),
    [suite.flows[1]!.flow.key]: passedResult(suite, 1),
    [suite.flows[2]!.flow.key]: skipped,
  }, { attemptId: 'attempt-7', buildSha: 'abc123' });

  assert.equal(aggregate.gatePassed, true);
  assert.equal(aggregate.totals.skipped, 1);
  const markdown = renderSuiteMarkdown(aggregate);
  assert.match(markdown, /\*\*Release gate: PASSED\*\*/);
  assert.match(markdown, /Progress survives relaunch \| no \| skipped/);
  assert.match(markdown, /Disabled for this release/);

  const json = renderSuiteJson(aggregate);
  assert.equal(json.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(json), aggregate);
});
