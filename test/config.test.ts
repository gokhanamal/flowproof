import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

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
  const config = loadConfig({ ...required, OPENAI_MODEL: 'gpt-5.4-nano' });
  assert.equal(config.model, 'gpt-5.4-nano');
});

test('loadConfig requires project-specific app, flow, and simulator boundaries', () => {
  assert.throws(() => loadConfig({ APP_PATH: './Example.app' }), /FLOW_PATH is required/);
  assert.throws(
    () => loadConfig({ APP_PATH: './Example.app', FLOW_PATH: './example.flow.yaml' }),
    /SIMULATOR_UDID is required/,
  );
});
