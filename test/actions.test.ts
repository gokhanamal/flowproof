import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredActions } from '../src/actions.js';
import type { ElementHandle, MobileDriver } from '../src/appium.js';
import { RuntimeInputs } from '../src/config.js';

function fixture(options: {
  clearValueError?: boolean;
  hideKeyboardError?: boolean;
  keyboardStates?: boolean[];
  pageSource?: string;
  runtimeInputs?: RuntimeInputs;
  setValueError?: (value: string) => Error;
} = {}) {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const element: ElementHandle = {
    async clearValue() {
      calls.push({ name: 'clearValue' });
      if (options.clearValueError) throw new Error('stale element');
    },
    async click() { calls.push({ name: 'click' }); },
    async isDisplayed() { return true; },
    async isExisting() { return true; },
    async setValue(value) {
      calls.push({ name: 'setValue', value });
      const error = options.setValueError?.(value);
      if (error) throw error;
    },
  };
  const driver: MobileDriver = {
    async $(selector) {
      calls.push({ name: '$', value: selector });
      return element;
    },
    async deleteSession() {},
    async execute(script, arguments_) {
      calls.push({ name: script, value: arguments_ });
      if (script === 'mobile: activeAppInfo') return { bundleId: 'com.example.app' };
      return null;
    },
    async getPageSource() { return options.pageSource ?? '<AppiumAUT />'; },
    async hideKeyboard() {
      calls.push({ name: 'hideKeyboard' });
      if (options.hideKeyboardError) throw new Error('native dismissal unavailable');
    },
    async isKeyboardShown() { return options.keyboardStates?.shift() ?? true; },
    async takeScreenshot() { return ''; },
  };
  const records: Array<{ action: string; detail: string }> = [];
  const actions = new StructuredActions(driver, {
    recordAction(action, detail) { records.push({ action, detail }); },
  }, options.runtimeInputs);
  return { actions, calls, records };
}

test('tap and text actions only target controls from the latest observation', async () => {
  const { actions, calls, records } = fixture();
  await assert.rejects(actions.tapText('Continue'), /unobserved text/);
  await assert.rejects(actions.enterText('Email', 'person@example.com'), /unobserved text input/);

  actions.updateObservation([
    { type: 'Button', name: 'Continue' },
    { type: 'TextField', name: 'Email' },
  ]);
  await actions.tapText('Continue');
  await actions.enterText('Email', 'person@example.com');
  await actions.clearText('Email');

  assert.equal(calls.filter((call) => call.name === 'click').length, 1);
  assert.deepEqual(calls.find((call) => call.name === 'setValue'), {
    name: 'setValue',
    value: 'person@example.com',
  });
  assert.deepEqual(records.at(-2), { action: 'enter_text', detail: 'TextField (18 characters)' });
  assert.deepEqual(records.at(-1), { action: 'clear_text', detail: 'TextField' });
});

test('secret entry redacts a driver error that echoes the submitted value', async () => {
  const secret = 'driver-must-not-echo-this';
  const { actions } = fixture({
    runtimeInputs: new RuntimeInputs(new Map([['test_password', secret]])),
    setValueError: (value) => new Error(`Could not enter ${value}`),
  });
  actions.updateObservation([{ type: 'SecureTextField', name: 'Password' }]);

  await assert.rejects(actions.enterSecret('Password', 'test_password'), (error: Error) => {
    assert.equal(error.message, 'Could not enter [REDACTED]');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('secret entry resolves an allow-listed alias only at action execution and records no value', async () => {
  const secret = 'never-record-this-value';
  const { actions, calls, records } = fixture({
    runtimeInputs: new RuntimeInputs(new Map([['test_password', secret]])),
  });
  actions.updateObservation([{ type: 'SecureTextField', name: 'Password' }]);

  await actions.enterSecret('Password', 'test_password');

  assert.deepEqual(calls.find((call) => call.name === 'setValue'), { name: 'setValue', value: secret });
  assert.deepEqual(records, [{ action: 'enter_secret', detail: 'SecureTextField ([REDACTED])' }]);
  assert.equal(JSON.stringify(records).includes(secret), false);
  await assert.rejects(actions.enterSecret('Password', 'other_password'), /not allow-listed/);
});

test('gesture and alert actions expose fixed Appium commands', async () => {
  const { actions, calls } = fixture();
  await actions.swipe('left');
  await actions.scroll('down');
  await actions.handleAlert('accept');

  assert.deepEqual(calls, [
    { name: 'mobile: swipe', value: { direction: 'left' } },
    { name: 'mobile: scroll', value: { direction: 'down' } },
    { name: 'mobile: alert', value: { action: 'accept' } },
  ]);
});

test('clear accepts a stale-element response when the observed value was removed', async () => {
  const { actions, records } = fixture({ clearValueError: true });
  actions.updateObservation([{ type: 'TextField', value: 'draft text' }]);

  await actions.clearText('draft text');

  assert.deepEqual(records, [{ action: 'clear_text', detail: 'TextField' }]);
});

test('keyboard dismissal and app relaunch use bounded driver operations', async () => {
  const { actions, calls, records } = fixture();
  await actions.dismissKeyboard();
  await actions.relaunchApp();

  assert.deepEqual(calls, [
    { name: 'hideKeyboard' },
    { name: 'mobile: activeAppInfo', value: {} },
    { name: 'mobile: terminateApp', value: { bundleId: 'com.example.app' } },
    { name: 'mobile: launchApp', value: { bundleId: 'com.example.app' } },
  ]);
  assert.deepEqual(records.at(-1), { action: 'relaunch_app', detail: 'active application' });
});

test('keyboard dismissal falls back to a bounded downward swipe', async () => {
  const { actions, calls, records } = fixture({
    hideKeyboardError: true,
    keyboardStates: [true, false],
  });
  await actions.dismissKeyboard();

  assert.deepEqual(calls, [
    { name: 'hideKeyboard' },
    { name: 'mobile: swipe', value: { direction: 'down' } },
  ]);
  assert.deepEqual(records, [
    { action: 'dismiss_keyboard', detail: 'keyboard hidden with downward swipe' },
  ]);
});

test('wait rejects durations outside its safety boundary', async () => {
  const { actions } = fixture();
  await assert.rejects(actions.wait(249), /250 to 10000/);
  await assert.rejects(actions.wait(10_001), /250 to 10000/);
  await assert.rejects(actions.wait(250.5), /250 to 10000/);
});
