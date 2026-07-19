import { Agent, MaxTurnsExceededError, OpenAIProvider, Runner, getGlobalTraceProvider, tool } from '@openai/agents';
import { z } from 'zod';
import type { MobileDriver } from './appium.js';
import { StructuredActions } from './actions.js';
import type { Config } from './config.js';
import { EvidenceGate } from './evidence.js';
import { EvidenceStore } from './evidence-store.js';
import type { FlowDefinition } from './flow.js';
import { compactAccessibilityTree } from './observation.js';
import { RecordingModel, sanitizeTranscriptValue } from './transcript.js';

export const AGENT_INSTRUCTIONS = [
  'Complete the supplied mobile test journey using only the tools.',
  'Call observe first and after every action. Take one action at a time.',
  'Only tap an exact accessibility name or label returned by the latest observation.',
  'Only enter or clear text in an exact text-input name, label, or value returned by the latest observation.',
  'Use bounded waits only when the interface is visibly loading or changing asynchronously.',
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
  const actions = new StructuredActions(driver, store);
  const observeNext = 'Action completed. Observe the screen before taking another action.';

  const observe = tool({
    name: 'observe',
    description: 'Inspect the current screen as compact visible accessibility nodes. Screenshots are saved locally but never sent to the model.',
    parameters: z.object({}),
    timeoutMs: 30_000,
    execute: async () => {
      const xml = await driver.getPageSource();
      const screenshot = await driver.takeScreenshot();
      const observation = compactAccessibilityTree(xml);
      actions.updateObservation(observation.nodes);
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
      await actions.tapText(text);
      return observeNext;
    },
  });

  const enterText = tool({
    name: 'enter_text',
    description: 'Replace the value of an observed text field, secure text field, search field, or text view.',
    parameters: z.object({
      target: z.string().min(1).max(120),
      text: z.string().min(1).max(1_000),
    }),
    timeoutMs: 20_000,
    execute: async ({ target, text }) => {
      await actions.enterText(target, text);
      return observeNext;
    },
  });

  const clearText = tool({
    name: 'clear_text',
    description: 'Clear an observed text field, secure text field, search field, or text view.',
    parameters: z.object({ target: z.string().min(1).max(120) }),
    timeoutMs: 20_000,
    execute: async ({ target }) => {
      await actions.clearText(target);
      return observeNext;
    },
  });

  const swipe = tool({
    name: 'swipe',
    description: 'Perform one full-screen directional swipe without using coordinates.',
    parameters: z.object({ direction: z.enum(['up', 'down', 'left', 'right']) }),
    timeoutMs: 20_000,
    execute: async ({ direction }) => {
      await actions.swipe(direction);
      return observeNext;
    },
  });

  const scroll = tool({
    name: 'scroll',
    description: 'Scroll the current page by one screen in a direction.',
    parameters: z.object({ direction: z.enum(['up', 'down', 'left', 'right']) }),
    timeoutMs: 20_000,
    execute: async ({ direction }) => {
      await actions.scroll(direction);
      return observeNext;
    },
  });

  const wait = tool({
    name: 'wait',
    description: 'Wait briefly for an asynchronous interface update before observing again.',
    parameters: z.object({ durationMs: z.number().int().min(250).max(10_000) }),
    timeoutMs: 12_000,
    execute: async ({ durationMs }) => {
      await actions.wait(durationMs);
      return observeNext;
    },
  });

  const dismissKeyboard = tool({
    name: 'dismiss_keyboard',
    description: 'Hide the software keyboard if it is currently visible.',
    parameters: z.object({}),
    timeoutMs: 20_000,
    execute: async () => {
      await actions.dismissKeyboard();
      return observeNext;
    },
  });

  const handleAlert = tool({
    name: 'handle_alert',
    description: 'Accept or dismiss the currently visible iOS alert.',
    parameters: z.object({ action: z.enum(['accept', 'dismiss']) }),
    timeoutMs: 20_000,
    execute: async ({ action }) => {
      await actions.handleAlert(action);
      return observeNext;
    },
  });

  const relaunchApp = tool({
    name: 'relaunch_app',
    description: 'Terminate and relaunch the active application without clearing its saved data.',
    parameters: z.object({}),
    timeoutMs: 60_000,
    execute: async () => {
      await actions.relaunchApp();
      return observeNext;
    },
  });

  const tools = [observe, tapText, enterText, clearText, swipe, scroll, wait, dismissKeyboard, handleAlert, relaunchApp];
  const toolNames = tools.map((agentTool) => agentTool.name);

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
    tools: toolNames,
    maxTurns,
  });

  const agent = new Agent({
    name: 'iOS Appium flow agent',
    model: recordingModel,
    modelSettings,
    outputType: z.object({ summary: z.string().max(300) }),
    instructions: AGENT_INSTRUCTIONS,
    tools,
  });

  const runner = new Runner({
    workflowName: 'FlowProof',
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
