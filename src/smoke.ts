#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { connectAppium } from './appium.js';
import { loadConfig } from './config.js';
import { EvidenceStore } from './evidence-store.js';
import { EvidenceGate } from './evidence.js';
import { loadFlow } from './flow.js';
import { compactAccessibilityTree } from './observation.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await access(config.appPath);
  const flow = await loadFlow(config.flowPath);
  const store = new EvidenceStore(config.artifactsDir);
  await store.initialize();

  const driver = await connectAppium(config);
  try {
    const xml = await driver.getPageSource();
    const screenshot = await driver.takeScreenshot();
    const observation = compactAccessibilityTree(xml);
    const evidence = new EvidenceGate(flow.evidence).record(observation.nodes);
    await store.observation(xml, screenshot, observation.nodes);
    await store.writeJson('appium-smoke.json', { evidence, nodes: observation.nodes.length, truncated: observation.truncated });
    console.log(JSON.stringify({ evidence, nodes: observation.nodes.length, truncated: observation.truncated }, null, 2));
  } finally {
    await driver.deleteSession();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
