---
title: "feat: Automate language-learning release regression"
type: feat
status: active
date: 2026-07-19
---

# Automate language-learning release regression

## Overview

Evolve FlowProof from a single iOS journey runner into a trustworthy release gate for the language-learning application. Managers will continue to own the intent and release criticality of each manual journey; engineers will provide stable accessibility identifiers, deterministic test fixtures, and CI integration.

The MVP will automate a small set of release-blocking journeys, beginning with one lesson-completion pilot. The model remains a bounded navigator. Explicit deterministic evidence, not model judgment, decides pass or failure.

## Problem Statement

Team managers currently run manual integration tests before every release. This is costly, difficult to repeat consistently, and produces limited machine-readable evidence. FlowProof already navigates one bounded iOS flow and records accessibility evidence, screenshots, transcripts, and video, but it lacks the state control, assertion strength, suite orchestration, and aggregate reporting required to replace a release checklist.

Current gaps include:

- one `FLOW_PATH` and one coarse result per workflow run;
- no app-owned backend fixture/reset contract;
- no safe named secret entry for login journeys;
- only positive `all` assertions;
- no requirement for an action or state transition between stages;
- incomplete diagnostics when an assertion does not match;
- no guaranteed terminal report for every infrastructure failure;
- no suite preflight, isolation, aggregate report, or release-gate policy.

## Product Scope

### MVP

- Inventory 5–10 release-blocking manual journeys.
- Automate one representative lesson-completion journey first.
- Strengthen deterministic flow assertions and diagnostics.
- Provide safe fixture setup and secret entry contracts.
- Run an explicit suite with independent per-flow state.
- Publish complete per-flow and aggregate results.
- Block release when any required flow does not pass.

### Deferred

- Visual model judgment and reference-image comparison.
- Direct backend assertions.
- Audio quality, pronunciation, and speech-recognition oracles.
- Physical devices and broad device/OS/locale matrices.
- Automatic retries, quarantine, and flake trend dashboards.

The existing visual-assertion design remains useful future input, but it is not part of the blocking MVP (`docs/brainstorms/2026-07-19-visual-assertions-brainstorm.md`).

## Ownership Model

- **Managers/QA:** journey intent, expected user-visible states, release-blocking classification, and pilot approval.
- **Application engineers:** stable accessibility identifiers, fixture setup/reset, synthetic accounts, and intentionally broken validation build/state.
- **FlowProof maintainers:** schema, runner correctness, isolation, reporting, CI orchestration, and security boundaries.
- **Release owners:** required-suite selection and final gate policy.

## Result Semantics

The first release must define these statuses consistently across CLI JSON, artifacts, job summaries, and the required check:

- `passed`: every deterministic stage completed in order and no forbidden assertion matched.
- `failed`: the app journey ran, but required evidence was missing or forbidden evidence appeared.
- `error`: setup, Appium, model, timeout, recording, result serialization, or another infrastructure condition prevented a valid evaluation.
- `skipped`: an explicitly disabled optional flow did not run, with a machine-readable reason.

Every required status other than `passed` blocks release. The MVP has no automatic retries and therefore no `flaky` status. A manual rerun is a separate attempt and never rewrites the original result.

## Proposed Configuration

Application repositories own an explicit suite manifest rather than relying on ambiguous file discovery:

```yaml
# .flowproof/suite.yaml
key: release-critical
name: Release-critical iOS journeys
device: iPhone 16
locale: en_US
language: en
flows:
  - path: flows/complete-beginner-lesson.flow.yaml
    required: true
    fixture: beginner-lesson-ready
    inputs: [test_email, test_password]
  - path: flows/progress-survives-relaunch.flow.yaml
    required: true
    fixture: progress-ready
```

Each flow remains goal-oriented and declares observable evidence:

```yaml
key: complete-beginner-lesson
name: Complete a beginner lesson
maxTurns: 20
description: Verify a learner can finish the seeded beginner lesson.
instructions: |
  Sign in with the configured test account, open the seeded beginner lesson,
  answer its exercises, and finish the lesson.
evidence:
  stages:
    - name: lesson ready
      all:
        - name: Beginner lesson
      none:
        - namePattern: "Error|Unable to load"
    - name: answer accepted
      all:
        - name: Correct
    - name: lesson complete
      all:
        - name: Lesson complete
        - value: "+10 XP"
      none:
        - namePattern: "Error|Try again later"
```

Secrets are aliases only. Flow files and resolved artifacts never contain their values. A dedicated `enter_secret(target, inputName)` action resolves allow-listed values at execution time without exposing them to the model.

## Technical Approach

### A. Trustworthy single-flow engine

Update `src/flow.ts`, `src/evidence.ts`, `src/agent.ts`, `src/actions.ts`, `src/cli.ts`, and reporting types.

- Add stage-level `none` matchers with the same exact/regex fields as `all`.
- Evaluate `none` only when evaluating its target stage. Global crash/error checks can be considered after the pilot.
- Let the initial observation satisfy only stage one.
- Require every later stage to follow at least one meaningful app action and a changed accessibility-state fingerprint from the observation that completed the prior stage.
- Do not count `observe` or `wait` as meaningful transitions.
- Record the completing observation, preceding action index, before/after fingerprints, and matcher-level results.
- Separate product assertion failure from infrastructure error.
- Always write a terminal `report.json`, even when setup, Appium connection, model execution, recording, or cleanup fails.
- Preserve cleanup in `finally` paths and keep the original failure when cleanup also fails.

The deterministic matcher should operate on the complete filtered accessibility-node set. The current 12,000-character model-input limit in `src/observation.ts` must not truncate nodes used by the evidence oracle.

### B. Fixture and secret contracts

FlowProof orchestrates setup; the application repository owns it.

- Define one trusted caller-owned fixture command for the MVP.
- Invoke it before each flow with the flow key, fixture name, attempt ID, locale, and synthetic account namespace.
- Require it to be idempotent and return nonzero on failure.
- Classify fixture failure as `error` and do not start the flow.
- Use dedicated non-production accounts and seeded lesson/course content.
- Pass credentials only through GitHub Actions secrets and named runtime aliases.
- Redact secret entry from action history, model inputs, resolved configuration, XML-derived reporting, and terminal output.
- Document that rendered credentials may still appear in screenshots/XML; fixtures must never contain production PII.

### C. Explicit suite orchestration

Keep the existing composite action and CLI capable of running one flow. Add a suite layer that validates and coordinates many independent single-flow executions.

Preflight must validate before execution:

- suite and flow schemas;
- unique suite/flow keys;
- referenced file existence;
- regex validity;
- fixture and runtime-input aliases;
- required flags;
- device, locale, and language values;
- artifact-safe unique names.

Each flow receives a clean simulator/app session and a fresh fixture reset. Start sequentially. Later bounded matrix parallelism is allowed only when each flow has an isolated backend identity/namespace.

The per-flow result includes status, required flag, duration, turns, first failed stage, every matcher result, forbidden matched node, last action/observation, error class, build SHA, suite/flow identity, attempt ID, and artifact paths.

The aggregate result includes all flows, totals, gate conclusion, missing/corrupt-result detection, and stable schema version. Produce both JSON for automation and Markdown for people.

### D. GitHub Actions release gate

Evolve `.github/workflows/ios-e2e.yml` without weakening the pinned composite action dependencies in `action.yml`.

- Build the release candidate once and capture its SHA/build identity.
- Resolve the explicit suite into per-flow work.
- Run all flows with `fail-fast: false`; begin with `max-parallel: 1`.
- Give every flow a unique artifact name because `upload-artifact@v4` artifacts are immutable.
- Upload result and evidence under `if: always()`.
- Run aggregation under `if: always()` and treat absent/corrupt results as `error`.
- Publish one aggregate PR comment and one `$GITHUB_STEP_SUMMARY`, not competing per-flow comments.
- Expose one required gate conclusion: all required flows must be `passed`.
- Keep artifact retention short and configurable.

## Implementation Phases

### Phase 0: Define and baseline the pilot

- [x] Add representative sign-in, lesson-completion, and progress-persistence templates while the managers' private checklist is unavailable.
- [ ] Export the managers’ current manual checklist.
- [ ] Rank 5–10 journeys by release impact and automation feasibility.
- [ ] For each journey record owner, starting state, fixture/data dependency, actions, expected states, cleanup, required/optional status, and current duration.
- [ ] Select lesson completion as the pilot only if course, lesson, exercises, account state, locale, and feature flags can be seeded deterministically.
- [ ] Have managers and engineers jointly approve the pilot evidence.
- [ ] Run the manual pilot three times on one known-good release candidate and record expected result/duration.

Exit criterion: one approved pilot specification has no hidden manual judgment in its pass criteria.

### Phase 1: Make one flow trustworthy

- [x] Add `none` assertions and schema tests in `src/flow.ts` and `test/flow.test.ts`.
- [x] Add action/state transition enforcement and matcher diagnostics in `src/evidence.ts` and `test/evidence.test.ts`.
- [x] Separate full evidence nodes from truncated model input in `src/observation.ts` and tests.
- [x] Add named runtime secret entry with strict allow-listing and redaction in `src/actions.ts`, `src/agent.ts`, `src/transcript.ts`, and tests.
- [x] Introduce stable result/status types and terminal reports in `src/cli.ts`.
- [x] Implement the bounded app-owned fixture command contract.
- [x] Encode a representative lesson-completion template.
- [ ] Encode and run the lesson-completion pilot.

Exit criteria:

- unchanged repeated observations cannot complete successive stages;
- forbidden evidence fails the target stage with a useful diagnostic;
- secret values are absent from prompts, resolved flow/configuration, logs, reports, and model transcripts;
- setup, Appium, model, timeout, and recording failures emit structured `error` reports;
- the known-good pilot passes 5/5 clean runs;
- an intentionally incorrect expected state or controlled regression fails reliably.

### Phase 2: Add suites and isolation

- [x] Add suite schema/parser and preflight tests in `src/suite.ts` and `test/suite.test.ts`.
- [x] Preserve single-flow execution while adding a suite coordination/reporting layer.
- [x] Reset fixtures and provision clean simulator/app state per flow in the reusable workflow.
- [x] Emit schema-versioned per-flow result JSON and aggregate JSON/Markdown.
- [x] Always continue to the next flow after a product failure or isolated flow error.
- [x] Detect duplicate keys, missing files, unsafe artifact names, and missing/corrupt terminal results.
- [x] Test pass, product failure, infrastructure error, and optional skipped aggregation.

Exit criteria:

- a three-flow suite continues after the middle flow fails;
- no flow sees prior local or backend state;
- invalid manifests fail during preflight;
- all terminal outcomes appear in the aggregate summary;
- artifact paths and names never collide;
- aggregate JSON remains stable under snapshot/schema tests.

### Phase 3: Integrate the release gate

- [x] Add a reusable workflow that accepts a suite manifest.
- [x] Build once, execute all flow jobs, and aggregate under `always()` semantics.
- [x] Set `fail-fast: false` and initially cap parallelism at one.
- [x] Upload unique per-flow artifacts plus one suite summary.
- [x] Update one stable PR comment in place with a per-flow table and workflow link.
- [ ] Configure the aggregate result as the release-blocking required check.
- [x] Document trusted-contributor, secret, synthetic-data, and retention requirements.

Exit criteria:

- all required flows passing makes the gate succeed;
- any required `failed`, `error`, or `skipped` result makes it fail;
- an optional skipped flow is visible but non-blocking only when explicitly configured;
- a crashed/missing flow job still produces an aggregate failure summary;
- build SHA, suite version, attempt ID, durations, and artifact links are present.

### Phase 4: Pilot adoption

- [ ] Migrate the remaining approved manager journeys incrementally.
- [ ] Run automated and manual suites side by side for at least three release candidates.
- [ ] Compare disagreements and fix fixtures/assertions before removing manual coverage.
- [ ] Assign an owner to every flow and require review when product behavior changes.
- [ ] Retire a manual test only after both managers and engineers accept the automated evidence.

Exit criterion: the agreed release-blocking subset is automated without reducing defect-detection confidence.

## Interaction Graph

```text
Release workflow
  -> suite preflight
     -> validates manifest, flows, inputs, fixtures
  -> build release candidate once
  -> for each flow
     -> reset app-owned fixture/backend state
     -> provision clean simulator and install app
     -> run bounded agent navigation
        -> actions produce observations
        -> deterministic gate evaluates transitions and assertions
     -> always finalize recording/session/result
     -> upload unique artifacts
  -> aggregate all terminal results
     -> publish JSON, Markdown, PR comment, and job summary
     -> set release gate conclusion
```

## Error and Cleanup Rules

- Preflight error: no flows start; emit suite-level `error`.
- Build error: no flows start; aggregate reports build `error`.
- Fixture error: affected flow is `error`; agent does not start.
- Product assertion mismatch: flow is `failed`; continue suite.
- Appium/model/timeout error: flow is `error`; preserve last action and observation.
- Recording/artifact finalization error: flow is `error`, even if assertions passed.
- Missing/corrupt matrix result: aggregator synthesizes `error`.
- Cleanup always attempts driver deletion, recording stop, simulator deletion/erase, and fixture cleanup. Secondary cleanup errors are attached without hiding the primary cause.

## Cross-Layer Test Scenarios

1. **Known-good lesson:** seeded learner completes a fixed lesson, sees correct feedback and XP update, and passes.
2. **Intentional regression:** final XP or completion evidence is changed/removed; navigation succeeds but result is `failed` with the precise matcher.
3. **Forbidden state:** expected content and an error banner coexist; target-stage `none` assertion fails.
4. **Setup outage:** fixture command exits nonzero; no simulator journey begins, result is `error`, and aggregation continues.
5. **Middle-job crash:** three-flow suite loses the second result; first and third complete, aggregator synthesizes an error, and release remains blocked.

## Success Metrics

- Pilot known-good reliability: 5/5 clean runs before suite work proceeds.
- Release adoption: agreed critical flows automated and approved by both managers and engineers.
- Diagnostic completeness: every non-pass has a terminal status, first failure, and artifact link.
- Isolation: zero order-dependent outcomes in the three-flow acceptance suite.
- Gate integrity: zero cases where a required non-pass produces a successful release check.
- Manual-effort reduction: measured after three side-by-side releases, without setting a target before the checklist baseline exists.

## Risks and Mitigations

- **Backend state leaks across flows:** idempotent fixture reset and unique synthetic namespaces; remain sequential initially.
- **Brittle localized content:** pin locale/language and seed fixed lesson data; prefer stable accessibility identifiers over dynamic prose.
- **Secret leakage through rendered UI:** non-production accounts, redaction, short artifact retention, and no real learner data.
- **False confidence from weak evidence:** managers own expected outcomes; engineers review identifiers/fixtures; controlled-regression test is mandatory.
- **Agent variability:** deterministic oracle, bounded tools/turns, explicit transition checks, and no retry-to-pass.
- **CI cost:** build once, start sequentially, measure duration/cost, then parallelize only with isolated fixtures.
- **Visual false positives/privacy:** defer visual gating; later make it opt-in and initially advisory with `inconclusive` handling.

## Worktree Note

Implementation must preserve the existing uncommitted `@main` workflow reference and `.flowproof` README convention. The interrupted visual evaluator code was removed before this plan; the visual design note remains for later work.

## Post-Deploy Monitoring and Validation

- Run the representative suite against the real language-learning simulator build without making it a required check.
- Compare FlowProof with the managers' manual result for three release candidates and record every disagreement.
- Review `report.json`, `flow-result.json`, the first failed stage, screenshots, and recording for each non-pass.
- Treat fixture timeouts, missing/corrupt results, unexpected cost growth, and order-dependent outcomes as rollout blockers.
- Make the aggregate job a required check only after the agreed critical journeys pass the side-by-side period.
- Roll back by removing the caller workflow or required-check setting; the application build and manager process remain unchanged.

## Documentation Plan

- Update `README.md` with suite authoring, result semantics, fixture contract, secrets, and release-gate examples.
- Add a language-learning pilot flow and suite manifest under `examples/` without real credentials.
- Document the result JSON schema and troubleshooting by status.
- Document artifact contents, retention, and privacy boundary.
- Add an owner/review checklist for converting a manual journey.

## Sources and References

### Internal

- Single-flow configuration: `src/config.ts:6-36`
- Bounded navigation contract: `src/agent.ts:12-21`
- Current evidence semantics: `src/evidence.ts:18-63`
- Current accessibility truncation: `src/observation.ts:72-99`
- Appium reset capabilities: `src/appium.ts:35-48`
- Terminal CLI decision: `src/cli.ts:18-51`
- Single-flow reusable workflow: `.github/workflows/ios-e2e.yml:42-140`
- Stateful round-trip example: `examples/feature-toggle-round-trip.flow.yaml:1-48`
- Future visual design: `docs/brainstorms/2026-07-19-visual-assertions-brainstorm.md`

No prior `docs/solutions/` institutional knowledge exists for this feature. The applicable lesson is `tasks/lessons.md`: confirm the operational workflow before optimizing a mechanism.

### Official guidance

- [Appium XCUITest capabilities and reset behavior](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/)
- [Apple: Eliminate test failures with XCTest](https://developer.apple.com/videos/play/wwdc2021/10296/)
- [GitHub: Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [GitHub: Matrix fail-fast and max-parallel](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategyfail-fast)
- [GitHub: Store and share artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [GitHub: Add a job summary](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#adding-a-job-summary)
- [GitHub Actions secret guidance](https://docs.github.com/en/actions/concepts/security/secrets)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OWASP mobile testing guidance](https://mas.owasp.org/MASTG/0x04b-Mobile-App-Security-Testing/)

## Final Review Checklist

- [ ] Managers and engineers approve the pilot’s journey and evidence.
- [ ] Result and transition semantics are implemented exactly once and reused by CLI, reports, and CI.
- [ ] Required non-pass statuses block release.
- [ ] Every failure path emits a terminal report and runs cleanup.
- [ ] Secrets and synthetic-data requirements are verified with tests.
- [ ] Full unit/type checks, action metadata tests, `actionlint`, and a real simulator pilot pass before rollout.
