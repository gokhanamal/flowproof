import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateSuiteArtifacts, buildSuiteMatrix } from '../src/suite-cli.js';
import { loadSuite, SUITE_RESULT_SCHEMA_VERSION } from '../src/suite.js';

const manifestPath = path.resolve(import.meta.dirname, '../examples/language-learning/.flowproof/suite.yaml');
const aliases = {
  fixtures: ['returning_learner', 'beginner_lesson_ready', 'learner_with_progress'],
  inputs: ['test_email', 'test_password'],
};

test('buildSuiteMatrix creates portable paths and unique execution metadata', async () => {
  const suite = await loadSuite(manifestPath, aliases);
  const workspace = path.resolve(import.meta.dirname, '..');
  const matrix = buildSuiteMatrix(suite, workspace);

  assert.equal(matrix.include.length, 3);
  assert.equal(matrix.include[0]?.flow_path, 'examples/language-learning/.flowproof/flows/sign-in.flow.yaml');
  assert.equal(matrix.include[0]?.inputs, 'test_email,test_password');
  assert.equal(new Set(matrix.include.map((entry) => entry.artifact_id)).size, 3);
});

test('aggregateSuiteArtifacts writes a complete blocking summary when results are missing', async () => {
  const suite = await loadSuite(manifestPath, aliases);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowproof-suite-cli-'));
  const resultsDirectory = path.join(directory, 'results');
  const outputDirectory = path.join(directory, 'summary');
  const first = suite.flows[0]!;
  await mkdir(path.join(resultsDirectory, first.artifactId), { recursive: true });
  await writeFile(path.join(resultsDirectory, first.artifactId, 'flow-result.json'), JSON.stringify({
    schemaVersion: SUITE_RESULT_SCHEMA_VERSION,
    suiteKey: suite.key,
    flowKey: first.flow.key,
    flowName: first.flow.name,
    artifactId: first.artifactId,
    required: first.required,
    status: 'passed',
    durationMs: 100,
    turns: 2,
    attemptId: 'run-1',
    buildSha: 'abc123',
    artifacts: {},
  }));

  const result = await aggregateSuiteArtifacts({
    manifestPath,
    resultsDirectory,
    outputDirectory,
    attemptId: 'run-1',
    buildSha: 'abc123',
    aliases,
    env: {},
  });

  assert.equal(result.gatePassed, false);
  const report = JSON.parse(await readFile(result.jsonPath, 'utf8')) as { totals: { passed: number; error: number } };
  assert.deepEqual(report.totals, { total: 3, passed: 1, failed: 0, error: 2, skipped: 0 });
  assert.match(await readFile(result.markdownPath, 'utf8'), /Release gate: FAILED/);
});
