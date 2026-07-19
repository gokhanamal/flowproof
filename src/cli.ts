#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectAppium } from './appium.js';
import { runAgent, type AgentRunReport } from './agent.js';
import { loadConfig, repositoryRoot, type Config } from './config.js';
import { EvidenceStore } from './evidence-store.js';
import { loadFlow, type FlowDefinition } from './flow.js';
import { startScreenRecording } from './screen-recording.js';
import { flowRunResultSchema, SUITE_RESULT_SCHEMA_VERSION, type FlowRunResult } from './suite.js';

type FailurePhase = 'configuration' | 'setup' | 'fixture' | 'recording' | 'appium' | 'agent' | 'cleanup' | 'reporting';

interface TerminalFailure {
  phase: FailurePhase;
  name: string;
  message: string;
}

interface TerminalReport {
  schemaVersion: 1;
  status: 'passed' | 'failed' | 'error';
  attemptId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  flow?: { key: string; name: string };
  fixture?: { name: string; status: 'passed' | 'error' };
  model?: string;
  agentSummary?: unknown;
  evidence?: AgentRunReport['evidence'];
  usage?: AgentRunReport['usage'];
  transcriptTurns?: number;
  screenRecording?: string;
  screenRecordingBytes?: number;
  failure?: TerminalFailure;
  cleanupFailures?: TerminalFailure[];
}

function suiteResult(report: TerminalReport, env: NodeJS.ProcessEnv): FlowRunResult | undefined {
  if (!env.FLOWPROOF_SUITE_KEY?.trim()) return undefined;
  const flowKey = report.flow?.key ?? env.FLOWPROOF_FLOW_KEY?.trim();
  const flowName = report.flow?.name ?? env.FLOWPROOF_FLOW_NAME?.trim();
  const required = env.FLOWPROOF_REQUIRED === 'true' ? true : env.FLOWPROOF_REQUIRED === 'false' ? false : undefined;
  if (!flowKey || !flowName || required === undefined) {
    throw new Error('Suite execution requires FLOWPROOF_FLOW_KEY, FLOWPROOF_FLOW_NAME, and FLOWPROOF_REQUIRED');
  }
  const firstFailedStage = report.evidence?.stages.find((stage) => stage.state !== 'passed')?.name;
  const reason = report.status === 'error'
    ? report.failure?.message ?? 'Flow infrastructure error'
    : report.status === 'failed'
      ? firstFailedStage ? `Deterministic evidence did not complete stage: ${firstFailedStage}` : 'Deterministic evidence did not pass'
      : undefined;
  return flowRunResultSchema.parse({
    schemaVersion: SUITE_RESULT_SCHEMA_VERSION,
    suiteKey: env.FLOWPROOF_SUITE_KEY.trim(),
    flowKey,
    flowName,
    artifactId: env.FLOWPROOF_ARTIFACT_ID?.trim(),
    required,
    status: report.status,
    durationMs: report.durationMs,
    turns: report.transcriptTurns ?? 0,
    attemptId: report.attemptId,
    buildSha: env.FLOWPROOF_BUILD_SHA?.trim(),
    ...(firstFailedStage ? { firstFailedStage } : {}),
    ...(reason ? { reason } : {}),
    ...(report.status === 'error' ? { errorClass: report.failure?.name ?? 'Error' } : {}),
    artifacts: {
      report: 'report.json',
      ...(report.screenRecording ? { screenRecording: report.screenRecording } : {}),
    },
  });
}

function failure(phase: FailurePhase, error: unknown): TerminalFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function runFixture(
  config: Config,
  flow: FlowDefinition,
  attemptId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!config.fixture) return;
  await new Promise<void>((resolve, reject) => {
    const fixtureInputs = Object.fromEntries(
      Object.entries(env).filter(([name, value]) => name.startsWith('FLOWPROOF_FIXTURE_INPUT_') && value !== undefined),
    ) as Record<string, string>;
    const child = spawn(config.fixture!.command, [], {
      env: {
        PATH: env.PATH ?? '/usr/bin:/bin',
        HOME: env.HOME ?? '',
        TMPDIR: env.TMPDIR ?? '/tmp',
        ...fixtureInputs,
        FLOWPROOF_FLOW_KEY: flow.key,
        FLOWPROOF_FIXTURE_NAME: config.fixture!.name,
        FLOWPROOF_ATTEMPT_ID: attemptId,
        FLOWPROOF_LOCALE: config.fixture!.locale,
        FLOWPROOF_ACCOUNT_NAMESPACE: config.fixture!.accountNamespace,
      },
      stdio: 'ignore',
    });
    let timedOut = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, config.fixture!.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (timedOut) {
        reject(new Error(`Fixture command timed out after ${config.fixture!.timeoutMs} ms`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`Fixture command failed (${signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`})`));
    });
  });
}

async function main(): Promise<void> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const attemptId = process.env.FLOWPROOF_ATTEMPT_ID?.trim() || randomUUID();
  const artifactsDir = path.resolve(process.env.ARTIFACTS_DIR ?? path.join(repositoryRoot(), 'artifacts'));
  const store = new EvidenceStore(artifactsDir);
  let phase: FailurePhase = 'configuration';
  let primaryFailure: TerminalFailure | undefined;
  const cleanupFailures: TerminalFailure[] = [];
  let config: Config | undefined;
  let flow: FlowDefinition | undefined;
  let agentReport: AgentRunReport | undefined;
  let fixtureStatus: 'passed' | 'error' | undefined;
  let recording: Awaited<ReturnType<typeof startScreenRecording>> | undefined;
  let driver: Awaited<ReturnType<typeof connectAppium>> | undefined;
  let recordingBytes: number | undefined;

  try {
    await store.initialize();
    config = loadConfig();
    phase = 'setup';
    if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required');
    await access(config.appPath);
    flow = await loadFlow(config.flowPath);
    await store.writeJson('resolved-flow.json', flow);

    if (config.fixture) {
      phase = 'fixture';
      try {
        await runFixture(config, flow, attemptId);
        fixtureStatus = 'passed';
      } catch (error) {
        fixtureStatus = 'error';
        throw error;
      }
    }

    phase = 'recording';
    recording = await startScreenRecording(config.simulatorUdid, config.artifactsDir);
    phase = 'appium';
    driver = await connectAppium(config);
    phase = 'agent';
    agentReport = await runAgent(config, flow, driver, store);
    if (agentReport.status === 'error') {
      primaryFailure = failure('agent', new Error(agentReport.error ?? 'Agent run failed'));
    }
  } catch (error) {
    primaryFailure ??= failure(phase, error);
  } finally {
    try {
      await driver?.deleteSession();
    } catch (error) {
      cleanupFailures.push(failure('cleanup', error));
    }
    try {
      await recording?.stop();
    } catch (error) {
      cleanupFailures.push(failure('cleanup', error));
    }
  }

  if (recording) {
    try {
      recordingBytes = (await stat(recording.outputPath)).size;
      if (recordingBytes === 0) throw new Error('Simulator screen recording is empty');
    } catch (error) {
      primaryFailure ??= failure('recording', error);
    }
  }
  if (!primaryFailure && cleanupFailures.length > 0) primaryFailure = cleanupFailures[0];

  const finished = Date.now();
  const report: TerminalReport = {
    schemaVersion: 1,
    status: primaryFailure ? 'error' : (agentReport?.status ?? 'error'),
    attemptId,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    ...(flow ? { flow: { key: flow.key, name: flow.name } } : {}),
    ...(config?.fixture ? { fixture: { name: config.fixture.name, status: fixtureStatus ?? 'error' } } : {}),
    ...(agentReport ? {
      model: agentReport.model,
      agentSummary: agentReport.agentSummary,
      evidence: agentReport.evidence,
      usage: agentReport.usage,
      transcriptTurns: agentReport.transcriptTurns,
    } : config ? { model: config.model } : {}),
    ...(recording ? { screenRecording: path.basename(recording.outputPath) } : {}),
    ...(recordingBytes !== undefined ? { screenRecordingBytes: recordingBytes } : {}),
    ...(primaryFailure ? { failure: primaryFailure } : {}),
    ...(cleanupFailures.length > 0 ? { cleanupFailures } : {}),
  };

  try {
    await store.writeJson('steps.json', store.steps);
  } catch (error) {
    report.status = 'error';
    report.failure ??= failure('reporting', error);
    console.error(`Could not write steps.json: ${failure('reporting', error).message}`);
    process.exitCode = 1;
  }

  let flowResult: FlowRunResult | undefined;
  try {
    flowResult = suiteResult(report, process.env);
  } catch (error) {
    report.status = 'error';
    report.failure ??= failure('reporting', error);
    process.exitCode = 1;
  }

  let reportWritten = false;
  try {
    await store.writeJson('report.json', report);
    reportWritten = true;
  } catch (error) {
    console.error(`Could not write report.json: ${failure('reporting', error).message}`);
    process.exitCode = 1;
  }
  if (reportWritten && flowResult) {
    try {
      await store.writeJson('flow-result.json', flowResult);
    } catch (error) {
      report.status = 'error';
      report.failure ??= failure('reporting', error);
      console.error(`Could not write suite flow result: ${failure('reporting', error).message}`);
      process.exitCode = 1;
      try {
        await store.writeJson('report.json', report);
      } catch (rewriteError) {
        console.error(`Could not update report.json: ${failure('reporting', rewriteError).message}`);
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
