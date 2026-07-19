#!/usr/bin/env node
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { connectAppium } from './appium.js';
import { runAgent, type AgentRunReport } from './agent.js';
import { loadConfig } from './config.js';
import { EvidenceStore } from './evidence-store.js';
import { loadFlow } from './flow.js';
import { startScreenRecording } from './screen-recording.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is required');
  }
  await access(config.appPath);

  const flow = await loadFlow(config.flowPath);
  const store = new EvidenceStore(config.artifactsDir);
  await store.initialize();
  await store.writeJson('resolved-flow.json', flow);

  const recording = await startScreenRecording(config.simulatorUdid, config.artifactsDir);
  let driver: Awaited<ReturnType<typeof connectAppium>> | undefined;
  let report: AgentRunReport | undefined;
  try {
    driver = await connectAppium(config);
    report = await runAgent(config, flow, driver, store);
  } finally {
    try {
      await driver?.deleteSession();
    } finally {
      await recording.stop();
    }
  }
  const recordingSize = (await stat(recording.outputPath)).size;
  if (recordingSize === 0) throw new Error('Simulator screen recording is empty');
  const completedReport = {
    ...report,
    screenRecording: path.basename(recording.outputPath),
    screenRecordingBytes: recordingSize,
  };
  await store.writeJson('steps.json', store.steps);
  await store.writeJson('report.json', completedReport);
  console.log(JSON.stringify(completedReport, null, 2));
  if (!report.evidence.passed || report.error) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
