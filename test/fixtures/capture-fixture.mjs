#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

writeFileSync(process.env.FLOWPROOF_FIXTURE_INPUT_CAPTURE_PATH, JSON.stringify({
  flowKey: process.env.FLOWPROOF_FLOW_KEY,
  fixtureName: process.env.FLOWPROOF_FIXTURE_NAME,
  attemptId: process.env.FLOWPROOF_ATTEMPT_ID,
  locale: process.env.FLOWPROOF_LOCALE,
  accountNamespace: process.env.FLOWPROOF_ACCOUNT_NAMESPACE,
  receivedOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
  receivedRuntimeInput: Boolean(process.env.FLOWPROOF_INPUT_TEST_PASSWORD),
}));
