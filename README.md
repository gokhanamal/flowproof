# FlowProof

Agent-driven mobile E2E testing with deterministic evidence.

FlowProof runs bounded iOS journeys with Appium and the OpenAI Agents SDK.

The model navigates. Project-owned YAML defines deterministic pass conditions.

## Installation

Require Node.js 22+, Xcode, an iOS Simulator runtime, and an OpenAI API key.

Clone this private repository, then install dependencies:

```bash
npm ci
```

Install the pinned Appium driver:

```bash
APPIUM_HOME="$PWD/.appium" npm exec -- appium driver install xcuitest@11.17.7
```

## Quick Start

Copy the flow template into your application repository:

```bash
mkdir -p .flowproof
cp examples/flow-template.yaml .flowproof/app-launch.flow.yaml
```

Replace its instructions and evidence stages with your user journey.

Build and boot your simulator. Start Appium separately:

```bash
APPIUM_HOME="$PWD/.appium" npm exec -- appium --address 127.0.0.1 --port 4723
```

Run the agent:

```bash
OPENAI_API_KEY="..." \
SIMULATOR_UDID="<booted-udid>" \
APP_PATH="/absolute/path/Example.app" \
FLOW_PATH="/absolute/path/app-launch.flow.yaml" \
npm start
```

## Flow Format

Keep journeys goal-oriented. End with the behavior requiring verification.

Define ordered evidence stages under `evidence.stages`:

```yaml
key: checkout-completes
name: iOS - Checkout completes
maxTurns: 14
description: Verify a customer can complete checkout.
instructions: |
  Add the featured item to the cart and complete checkout.

  End after confirming the order was accepted.
evidence:
  stages:
    - name: product list
      all:
        - name: Featured products
    - name: order accepted
      all:
        - type: StaticText
          namePattern: "^Order [A-Z0-9]+ confirmed$"
      none:
        - namePattern: "Error|Try again later"
```

Each observation can complete only the next stage. The first stage can match the
initial screen. Every later stage requires a meaningful action and a changed
accessibility state, so repeated observations of one screen cannot pass a flow.

For a state that is intentionally unchanged, such as checking persistence after
an app restart, name the required action and opt out of the state-change check:

```yaml
- name: progress remains after relaunch
  afterAction: relaunch_app
  allowSameState: true
  all:
    - value: 20% complete
```

Use `allowSameState` only with `afterAction`; otherwise the assertion is weaker
than the normal transition rule.

Matchers under `all` must appear. Matchers under `none` must not appear while
that stage is being evaluated. Failure reports include the first incomplete
stage and matcher-level diagnostics.

Match exact `type`, `name`, `label`, `value`, or `enabled` fields.

Use `typePattern`, `namePattern`, `labelPattern`, or `valuePattern` for regex matching.

Keep patterns anchored whenever possible. Every matcher must match one accessibility node.

See [`examples/`](examples/) for reusable stateful journeys.

## Supported Actions

The agent can use these structured tools:

- `observe`: capture accessible elements and evaluate deterministic evidence;
- `tap_text`: tap an exact name or label from the latest observation;
- `enter_text` and `clear_text`: edit a text input by its observed name, label,
  or placeholder/value;
- `enter_secret`: enter an allow-listed runtime input without exposing its value
  to the model;
- `swipe` and `scroll`: move in one of four directions without coordinates;
- `wait`: pause for 250 milliseconds to 10 seconds;
- `dismiss_keyboard`: hide the software keyboard when visible, with a bounded
  downward-swipe fallback for phones without a keyboard-dismiss button;
- `handle_alert`: accept or dismiss the current iOS alert;
- `relaunch_app`: terminate and relaunch the active app without clearing data.

Raw Appium commands, arbitrary selectors, and coordinate gestures are not
exposed to the model. After every action, the agent must observe again.

### Runtime inputs and fixtures

Keep credentials out of flow YAML. Declare aliases and supply their values only
at runtime:

```bash
FLOWPROOF_INPUTS="test_email,test_password" \
FLOWPROOF_INPUT_TEST_EMAIL="learner@example.test" \
FLOWPROOF_INPUT_TEST_PASSWORD="..." \
npm start
```

The model sees alias names and can call `enter_secret`; it never receives their
values. Use synthetic test accounts because rendered values can still appear in
screenshots or raw accessibility XML.

For deterministic server-side state, configure a trusted executable fixture
script with `FLOWPROOF_FIXTURE_COMMAND` and `FLOWPROOF_FIXTURE_NAME`. FlowProof
runs it before Appium and supplies `FLOWPROOF_FLOW_KEY`,
`FLOWPROOF_ATTEMPT_ID`, `FLOWPROOF_LOCALE`, and
`FLOWPROOF_ACCOUNT_NAMESPACE`. The script must be idempotent. A nonzero exit is
reported as an infrastructure error and the journey does not start. Fixture
commands have a 60-second default timeout and receive only basic process
variables, FlowProof metadata, and explicitly configured
`FLOWPROOF_FIXTURE_INPUT_<ALIAS>` values.

## GitHub Actions

Allow private Actions access from your GitHub repository settings first.

Store the OpenAI key as the caller repository secret `OPENAI_API_KEY`.

Call the reusable workflow from your application repository:

```yaml
name: Agent E2E

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write

jobs:
  ios-e2e:
    uses: gokhanamal/flowproof/.github/workflows/ios-e2e.yml@main
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      flow_path: .flowproof/app-launch.flow.yaml
      model: gpt-5.6-luna
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The reusable workflow builds the app and creates a disposable simulator.

When invoked by a `pull_request` workflow, it creates or updates one FlowProof
comment with the result, workflow-run link, and a private artifact link. The
artifact contains `screen-recording.mp4` plus the complete evidence bundle.
The caller must grant `pull-requests: write`; viewers must be signed in and
have access to the repository. Manual and non-PR runs skip the comment.

Run secret-backed PR workflows only for trusted same-repository contributors.
GitHub does not provide Actions secrets to workflows triggered from forks, so
fork pull requests cannot run this journey without a separately approved path.

The composite action installs Appium, runs the journey, and uploads evidence.

Use `gokhanamal/flowproof@main` directly when managing simulators yourself.

### Release regression suites

An application repository can own an explicit `.flowproof/suite.yaml`:

```yaml
key: language-learning-release
name: Language-learning release checks
device: iPhone 16
locale: en_US
language: en
flows:
  - path: flows/sign-in.flow.yaml
    required: true
    fixture: returning_learner
    inputs: [test_email, test_password]
  - path: flows/complete-beginner-lesson.flow.yaml
    required: true
    fixture: beginner_lesson_ready
    inputs: [test_email, test_password]
```

Call the suite workflow to build once and run every flow in an isolated
simulator. Execution starts sequentially, continues after failures, uploads a
unique evidence artifact for each flow, and publishes one aggregate release
gate:

```yaml
jobs:
  release-regression:
    uses: gokhanamal/flowproof/.github/workflows/ios-e2e-suite.yml@main
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      suite_path: .flowproof/suite.yaml
      fixture_command: .flowproof/reset-fixture.sh
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      TEST_EMAIL: ${{ secrets.FLOWPROOF_TEST_EMAIL }}
      TEST_PASSWORD: ${{ secrets.FLOWPROOF_TEST_PASSWORD }}
      FIXTURE_API_TOKEN: ${{ secrets.FLOWPROOF_FIXTURE_API_TOKEN }}
```

`TEST_EMAIL` and `TEST_PASSWORD` map to the `test_email` and `test_password`
aliases used by the suite manifest. `FIXTURE_API_TOKEN` is optional and is
available only to the fixture command as
`FLOWPROOF_FIXTURE_INPUT_FIXTURE_API_TOKEN`.

Suite results are `passed`, `failed`, `error`, or `skipped`. Every required
result must be `passed`; missing or corrupt results are blocking errors. There
are no automatic retries that turn a failure into a pass.

The representative language-learning suite under
[`examples/language-learning/`](examples/language-learning/) covers sign-in,
lesson completion, and progress persistence. These are functional-area
templates, not a substitute for manager approval of the real release checklist.

Start by asking each manager for one release-critical journey from their area.
For each journey, capture the seeded starting state, user actions, visible
expected states, forbidden error states, and whether it blocks release. Convert
those visible outcomes into ordered `all`/`none` stages, then run the automated
flow beside the manual check for three releases before retiring the manual test.

The generated `flow-result.json` uses schema version 1 and records the suite and
flow identity, `passed`/`failed`/`error`/`skipped` status, required flag, duration,
turn count, first failed stage, reason or error class, build SHA, attempt ID, and
artifact paths. `suite-report.json` preserves manifest order, totals every
status, and sets `gatePassed` only when every required flow passed.

## Artifacts

Each run records:

- numbered model inputs and outputs;
- chronological tool history;
- Appium actions and deterministic checks;
- accessibility XML and screenshots;
- an H.264 simulator recording;
- token usage and the final report.

Suite runs also include a strict `flow-result.json`, aggregate
`suite-report.json`, and human-readable `suite-summary.md`.

Credentials, provider internals, and hidden reasoning are excluded.

Values passed to `enter_text` are redacted from recorded function-call
arguments. Named `enter_secret` values are also redacted from model
observations, evidence diagnostics, action history, errors, and reports. They
may still become visible in a screenshot or raw accessibility dump if the
application renders them. Never use production credentials in a test flow.

Treat artifacts as sensitive application data. Keep retention short.

## Cost and Safety

The default model is `gpt-5.6-luna`. Set `OPENAI_MODEL` to override it.

The agent receives compact accessibility text only. Images and XML remain local.

Element-targeted actions can only use text from the latest accessibility
observation. Gesture directions and wait durations are bounded by their tool
schemas.

Flow files cap runs between one and thirty model turns.

Deterministic evidence decides pass or failure. The model never grades itself.

Use `report.json` and per-turn cached tokens for cost calculations.

Check current rates on the [OpenAI pricing page](https://developers.openai.com/api/docs/pricing).

## Limitations

The runner currently supports iOS simulators and accessibility-driven native
application journeys.

It does not support physical-device provisioning, arbitrary coordinate
gestures, multi-touch gestures, automatic retries, or visual assertions.

## Development

Run all offline checks:

```bash
npm run validate
```

Validate workflows locally:

```bash
actionlint
```

## License

This private repository is proprietary. Do not redistribute it.
