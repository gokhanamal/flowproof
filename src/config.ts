import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export interface Config {
  appPath: string;
  appiumServerUrl: URL;
  artifactsDir: string;
  flowPath: string;
  language?: string;
  locale?: string;
  model: string;
  simulatorUdid: string;
  runtimeInputs: RuntimeInputs;
  fixture?: {
    command: string;
    name: string;
    locale: string;
    accountNamespace: string;
    timeoutMs: number;
  };
}

const inputNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

export class RuntimeInputs {
  private readonly values: Map<string, string>;

  constructor(values: ReadonlyMap<string, string>) {
    this.values = new Map(values);
  }

  get names(): string[] {
    return [...this.values.keys()].sort();
  }

  resolve(name: string): string {
    const value = this.values.get(name);
    if (value === undefined) throw new Error(`Runtime input is not allow-listed: ${name}`);
    return value;
  }

  redact(text: string): string {
    let redacted = text;
    const values = [...new Set(this.values.values())].sort((left, right) => right.length - left.length);
    for (const value of values) {
      if (value) redacted = redacted.replaceAll(value, '[REDACTED]');
    }
    return redacted;
  }

  toJSON(): { names: string[] } {
    return { names: this.names };
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const server = new URL(env.APPIUM_SERVER_URL ?? 'http://127.0.0.1:4723');
  if (!['http:', 'https:'].includes(server.protocol)) {
    throw new Error('APPIUM_SERVER_URL must use http or https');
  }

  const runtimeInputs = loadRuntimeInputs(env);
  const fixtureCommand = env.FLOWPROOF_FIXTURE_COMMAND?.trim();
  const fixtureName = env.FLOWPROOF_FIXTURE_NAME?.trim();
  if (Boolean(fixtureCommand) !== Boolean(fixtureName)) {
    throw new Error('FLOWPROOF_FIXTURE_COMMAND and FLOWPROOF_FIXTURE_NAME must be configured together');
  }
  const fixtureTimeoutMs = Number.parseInt(env.FLOWPROOF_FIXTURE_TIMEOUT_MS ?? '60000', 10);
  if (!Number.isInteger(fixtureTimeoutMs) || fixtureTimeoutMs < 10 || fixtureTimeoutMs > 300_000) {
    throw new Error('FLOWPROOF_FIXTURE_TIMEOUT_MS must be an integer from 10 to 300000');
  }

  return {
    appPath: path.resolve(required(env, 'APP_PATH')),
    appiumServerUrl: server,
    artifactsDir: path.resolve(env.ARTIFACTS_DIR ?? path.join(repoRoot, 'artifacts')),
    flowPath: path.resolve(required(env, 'FLOW_PATH')),
    language: env.FLOWPROOF_LANGUAGE?.trim() || undefined,
    locale: env.FLOWPROOF_LOCALE?.trim() || undefined,
    model: env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna',
    simulatorUdid: required(env, 'SIMULATOR_UDID'),
    runtimeInputs,
    fixture: fixtureCommand && fixtureName ? {
      command: path.resolve(fixtureCommand),
      name: fixtureName,
      locale: env.FLOWPROOF_LOCALE?.trim() || 'en_US',
      accountNamespace: env.FLOWPROOF_ACCOUNT_NAMESPACE?.trim() || 'default',
      timeoutMs: fixtureTimeoutMs,
    } : undefined,
  };
}

function loadRuntimeInputs(env: NodeJS.ProcessEnv): RuntimeInputs {
  const names = (env.FLOWPROOF_INPUTS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (new Set(names).size !== names.length) throw new Error('FLOWPROOF_INPUTS contains duplicate aliases');

  const values = new Map<string, string>();
  for (const name of names) {
    if (!inputNamePattern.test(name)) {
      throw new Error(`Invalid runtime input alias: ${name}`);
    }
    const envName = `FLOWPROOF_INPUT_${name.toUpperCase()}`;
    const value = env[envName];
    if (!value?.trim()) throw new Error(`${envName} is required`);
    values.set(name, value);
  }
  return new RuntimeInputs(values);
}

export function repositoryRoot(): string {
  return repoRoot;
}
