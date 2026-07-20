import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { runFixture } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import type { FlowDefinition } from '../src/flow.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureCommand = path.join(root, 'test/fixtures/capture-fixture.mjs');
const hangingFixtureCommand = path.join(root, 'test/fixtures/hanging-fixture.mjs');
const flow: FlowDefinition = {
  key: 'lesson-completion',
  name: 'Lesson completion',
  description: 'Complete a lesson',
  instructions: 'Complete it',
  maxTurns: 10,
  evidence: { stages: [{ name: 'done', all: [{ name: 'Done' }], none: [] }] },
};

test('fixture command receives bounded flow metadata before a journey', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'flowproof-fixture-'));
  const capturePath = path.join(directory, 'metadata.json');
  await chmod(fixtureCommand, 0o755);
  const config = loadConfig({
    APP_PATH: './Example.app',
    FLOW_PATH: './example.flow.yaml',
    SIMULATOR_UDID: 'test-udid',
    FLOWPROOF_FIXTURE_COMMAND: fixtureCommand,
    FLOWPROOF_FIXTURE_NAME: 'lesson-ready',
    FLOWPROOF_LOCALE: 'de_DE',
    FLOWPROOF_ACCOUNT_NAMESPACE: 'release-test',
  });

  await runFixture(config, flow, 'attempt-123', {
    ...process.env,
    OPENAI_API_KEY: 'must-not-reach-fixture',
    FLOWPROOF_INPUT_TEST_PASSWORD: 'must-not-reach-fixture',
    FLOWPROOF_FIXTURE_INPUT_CAPTURE_PATH: capturePath,
  });

  assert.deepEqual(JSON.parse(await readFile(capturePath, 'utf8')), {
    flowKey: 'lesson-completion',
    fixtureName: 'lesson-ready',
    attemptId: 'attempt-123',
    locale: 'de_DE',
    accountNamespace: 'release-test',
    receivedOpenAIKey: false,
    receivedRuntimeInput: false,
  });
});

test('fixture commands are bounded', async () => {
  await chmod(hangingFixtureCommand, 0o755);
  const config = loadConfig({
    APP_PATH: './Example.app',
    FLOW_PATH: './example.flow.yaml',
    SIMULATOR_UDID: 'test-udid',
    FLOWPROOF_FIXTURE_COMMAND: hangingFixtureCommand,
    FLOWPROOF_FIXTURE_NAME: 'lesson-ready',
    FLOWPROOF_FIXTURE_TIMEOUT_MS: '50',
  });

  await assert.rejects(runFixture(config, flow, 'attempt-timeout'), /timed out after 50 ms/);
});

test('configuration failure still writes a structured terminal report', async () => {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'flowproof-report-'));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'src/cli.ts')], {
      cwd: root,
      env: {
        ...process.env,
        APP_PATH: '',
        FLOW_PATH: '',
        SIMULATOR_UDID: '',
        ARTIFACTS_DIR: artifactsDir,
        FLOWPROOF_SUITE_KEY: 'release-critical',
        FLOWPROOF_FLOW_KEY: 'lesson-completion',
        FLOWPROOF_FLOW_NAME: 'Lesson completion',
        FLOWPROOF_ARTIFACT_ID: 'release-critical-lesson-completion',
        FLOWPROOF_REQUIRED: 'true',
        FLOWPROOF_BUILD_SHA: 'abc123',
        FLOWPROOF_ATTEMPT_ID: 'attempt-configuration-error',
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 1);
  const report = JSON.parse(await readFile(path.join(artifactsDir, 'report.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'error');
  assert.deepEqual(report.failure, {
    phase: 'configuration',
    name: 'Error',
    message: 'APP_PATH is required',
  });
  const suiteResult = JSON.parse(await readFile(path.join(artifactsDir, 'flow-result.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(suiteResult.status, 'error');
  assert.equal(suiteResult.errorClass, 'Error');
  assert.equal(suiteResult.flowKey, 'lesson-completion');
});

test('a nonzero fixture command produces a structured fixture error before recording', async () => {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'flowproof-fixture-error-'));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'src/cli.ts')], {
      cwd: root,
      env: {
        ...process.env,
        APP_PATH: path.join(root, 'package.json'),
        FLOW_PATH: path.join(root, 'examples/app-launch.flow.yaml'),
        SIMULATOR_UDID: 'not-used',
        OPENAI_API_KEY: 'not-used',
        ARTIFACTS_DIR: artifactsDir,
        FLOWPROOF_FIXTURE_COMMAND: '/usr/bin/false',
        FLOWPROOF_FIXTURE_NAME: 'broken-fixture',
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 1);
  const report = JSON.parse(await readFile(path.join(artifactsDir, 'report.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(report.status, 'error');
  assert.deepEqual(report.fixture, { name: 'broken-fixture', status: 'error' });
  assert.deepEqual(report.failure, {
    phase: 'fixture',
    name: 'Error',
    message: 'Fixture command failed (exit 1)',
  });
  assert.equal('screenRecording' in report, false);
});
