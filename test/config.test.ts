import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, RuntimeInputs } from '../src/config.js';

const required = {
  APP_PATH: './Example.app',
  FLOW_PATH: './example.flow.yaml',
  SIMULATOR_UDID: 'test-udid',
};

test('loadConfig defaults to the cost-sensitive model', () => {
  const config = loadConfig(required);
  assert.equal(config.model, 'gpt-5.6-luna');
  assert.equal(config.appiumServerUrl.href, 'http://127.0.0.1:4723/');
});

test('loadConfig accepts an explicit model override', () => {
  const config = loadConfig({
    ...required,
    OPENAI_MODEL: 'gpt-5.4-nano',
    FLOWPROOF_LANGUAGE: 'de',
    FLOWPROOF_LOCALE: 'de_DE',
  });
  assert.equal(config.model, 'gpt-5.4-nano');
  assert.equal(config.language, 'de');
  assert.equal(config.locale, 'de_DE');
});

test('loadConfig exposes only allow-listed runtime input aliases', () => {
  const config = loadConfig({
    ...required,
    FLOWPROOF_INPUTS: 'test_password,test_email',
    FLOWPROOF_INPUT_TEST_PASSWORD: ' correct horse battery staple ',
    FLOWPROOF_INPUT_TEST_EMAIL: 'learner@example.test',
  });

  assert.deepEqual(config.runtimeInputs.names, ['test_email', 'test_password']);
  assert.equal(config.runtimeInputs.resolve('test_password'), ' correct horse battery staple ');
  assert.equal(config.runtimeInputs.redact('value=learner@example.test'), 'value=[REDACTED]');
  assert.deepEqual(JSON.parse(JSON.stringify(config.runtimeInputs)), { names: ['test_email', 'test_password'] });
  assert.equal(JSON.stringify(config).includes('correct horse battery staple'), false);
  assert.throws(() => config.runtimeInputs.resolve('admin_password'), /not allow-listed/);
});

test('loadConfig rejects unsafe, duplicate, and missing runtime inputs', () => {
  assert.throws(() => loadConfig({ ...required, FLOWPROOF_INPUTS: 'UPPER' }), /Invalid runtime input alias/);
  assert.throws(() => loadConfig({ ...required, FLOWPROOF_INPUTS: 'email,email' }), /duplicate aliases/);
  assert.throws(() => loadConfig({ ...required, FLOWPROOF_INPUTS: 'email' }), /FLOWPROOF_INPUT_EMAIL is required/);
});

test('loadConfig requires fixture command and name together', () => {
  assert.throws(
    () => loadConfig({ ...required, FLOWPROOF_FIXTURE_COMMAND: './fixtures/reset' }),
    /must be configured together/,
  );
  const config = loadConfig({
    ...required,
    FLOWPROOF_FIXTURE_COMMAND: './fixtures/reset',
    FLOWPROOF_FIXTURE_NAME: 'lesson-ready',
    FLOWPROOF_LOCALE: 'de_DE',
    FLOWPROOF_ACCOUNT_NAMESPACE: 'release-42',
  });
  assert.equal(config.fixture?.name, 'lesson-ready');
  assert.equal(config.fixture?.locale, 'de_DE');
  assert.equal(config.fixture?.accountNamespace, 'release-42');
});

test('runtime redaction handles overlapping secrets without leaking suffixes', () => {
  const inputs = new RuntimeInputs(new Map([
    ['short', 'abc'],
    ['long', 'abcdef'],
  ]));
  assert.equal(inputs.redact('value=abcdef'), 'value=[REDACTED]');
});

test('loadConfig requires project-specific app, flow, and simulator boundaries', () => {
  assert.throws(() => loadConfig({ APP_PATH: './Example.app' }), /FLOW_PATH is required/);
  assert.throws(
    () => loadConfig({ APP_PATH: './Example.app', FLOW_PATH: './example.flow.yaml' }),
    /SIMULATOR_UDID is required/,
  );
});
