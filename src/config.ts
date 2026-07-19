import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export interface Config {
  appPath: string;
  appiumServerUrl: URL;
  artifactsDir: string;
  flowPath: string;
  model: string;
  simulatorUdid: string;
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

  return {
    appPath: path.resolve(required(env, 'APP_PATH')),
    appiumServerUrl: server,
    artifactsDir: path.resolve(env.ARTIFACTS_DIR ?? path.join(repoRoot, 'artifacts')),
    flowPath: path.resolve(required(env, 'FLOW_PATH')),
    model: env.OPENAI_MODEL?.trim() || 'gpt-5.6-luna',
    simulatorUdid: required(env, 'SIMULATOR_UDID'),
  };
}

export function repositoryRoot(): string {
  return repoRoot;
}
