import { Agent, MaxTurnsExceededError, OpenAIProvider, Runner, getGlobalTraceProvider, tool } from '@openai/agents';
import { z } from 'zod';
import type { MobileDriver } from './appium.js';
import type { Config } from './config.js';
import { EvidenceGate } from './evidence.js';
import { EvidenceStore } from './evidence-store.js';
import type { FlowDefinition } from './flow.js';
import { compactAccessibilityTree, selectorForObservedText } from './observation.js';
import { RecordingModel, sanitizeTranscriptValue } from './transcript.js';

export const AGENT_INSTRUCTIONS = [
  'Complete the supplied mobile test journey using only the tools.',
  'Call observe first and after every tap. Take one action at a time.',
  'Only tap an exact accessibility name or label returned by the latest observation.',
  'Stop as soon as every deterministic check returned by observe is true.',
  'If blocked, stop and concisely describe the visible blocker.',
  'Do not grade the test yourself; deterministic runner checks decide pass or fail.',
].join(' ');

export interface AgentRunReport {
  model: string;
  agentSummary: unknown;
  evidence: ReturnType<EvidenceGate['status']>;
  usage?: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  transcriptTurns: number;
  error?: string;
}

export async function runAgent(
  config: Config,
  flow: FlowDefinition,
  driver: MobileDriver,
  store: EvidenceStore,
): Promise<AgentRunReport> {
  const gate = new EvidenceGate(flow.evidence);
  let latestTapTargets = new Set<string>();
  let latestNodes = [] as ReturnType<typeof compactAccessibilityTree>['nodes'];

  const observe = tool({
    name: 'observe',
    description: 'Inspect the current screen as compact visible accessibility nodes. Screenshots are saved locally but never sent to the model.',
    parameters: z.object({}),
    timeoutMs: 30_000,
    execute: async () => {
      const xml = await driver.getPageSource();
      const screenshot = await driver.takeScreenshot();
      const observation = compactAccessibilityTree(xml);
      latestNodes = observation.nodes;
      latestTapTargets = new Set(
        observation.nodes.flatMap((node) => [node.name, node.label]).filter((value): value is string => Boolean(value)),
      );
      const status = gate.record(observation.nodes);
      await store.observation(xml, screenshot, observation.nodes);
      return JSON.stringify({
        elements: observation.nodes,
        truncated: observation.truncated,
        deterministicChecks: status.checks,
      });
    },
  });

  const tapText = tool({
    name: 'tap_text',
    description: 'Tap one exact accessibility name or label from the most recent observation.',
    parameters: z.object({ text: z.string().min(1).max(120) }),
    timeoutMs: 20_000,
    execute: async ({ text }) => {
      if (!latestTapTargets.has(text)) {
        throw new Error(`Refusing to tap unobserved text: ${text}`);
      }
      const element = await driver.$(selectorForObservedText(text, latestNodes));
      if (!(await element.isExisting()) || !(await element.isDisplayed())) {
        throw new Error(`Observed element is no longer visible: ${text}`);
      }
      await element.click();
      store.recordAction('tap_text', text);
      return 'Tapped. Observe the new screen before taking another action.';
    },
  });

  const modelSettings = {
    reasoning: { effort: 'none' as const },
    text: { verbosity: 'low' as const },
    parallelToolCalls: false,
    maxTokens: 384,
  };
  const prompt = `Flow: ${flow.name}\n\nDescription:\n${flow.description}\n\nJourney:\n${flow.instructions}`;
  const maxTurns = flow.maxTurns;
  const provider = new OpenAIProvider();
  const recordingModel = new RecordingModel(await provider.getModel(config.model), store);

  await store.writeJson('agent-input.json', {
    model: config.model,
    instructions: AGENT_INSTRUCTIONS,
    prompt,
    modelSettings,
    tools: ['observe', 'tap_text'],
    maxTurns,
  });

  const agent = new Agent({
    name: 'iOS Appium flow agent',
    model: recordingModel,
    modelSettings,
    outputType: z.object({ summary: z.string().max(300) }),
    instructions: AGENT_INSTRUCTIONS,
    tools: [observe, tapText],
  });

  const runner = new Runner({
    workflowName: 'OpenAI Appium E2E',
    traceIncludeSensitiveData: false,
    tracingDisabled: process.env.OPENAI_AGENTS_DISABLE_TRACING === '1',
  });

  try {
    const result = await runner.run(agent, prompt, { maxTurns });
    const usage = recordingModel.usage;
    await store.writeJson('conversation-history.json', sanitizeTranscriptValue(result.history));
    await store.writeJson('transcript-manifest.json', {
      complete: true,
      model: config.model,
      turns: recordingModel.turns,
      turnFiles: 'model-turn-NNN-input.json / model-turn-NNN-output.json',
      exclusions: [
        'API keys and authorization values',
        'provider-specific metadata',
        'hidden or encrypted reasoning',
        'screenshots and raw Appium XML',
        'simulator screen recording',
      ],
    });
    return {
      model: config.model,
      agentSummary: result.finalOutput,
      evidence: gate.status(),
      transcriptTurns: recordingModel.turns,
      usage,
    };
  } catch (error) {
    await store.writeJson('transcript-manifest.json', {
      complete: false,
      model: config.model,
      turns: recordingModel.turns,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return {
      model: config.model,
      agentSummary: null,
      evidence: gate.status(),
      transcriptTurns: recordingModel.turns,
      usage: recordingModel.usage,
      error: error instanceof MaxTurnsExceededError ? `Agent exceeded the ${maxTurns}-turn limit` : String(error),
    };
  } finally {
    await provider.close();
    await getGlobalTraceProvider().forceFlush();
  }
}
