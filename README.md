# FlowProof

Agent-driven iOS end-to-end testing with deterministic evidence.

FlowProof runs bounded Appium journeys on an iOS Simulator. The model
navigates, while project-owned YAML defines the ordered pass conditions.

## Requirements

- macOS with Xcode and an iOS Simulator runtime
- Node.js 22 or later
- an OpenAI API key
- network access to npm, Appium's driver registry, and the OpenAI API

The reusable workflow runs on GitHub's `macos-15` runner and installs Node.js
24, dependencies, and the pinned XCUITest driver at runtime.

## Install from a public clone

```bash
git clone https://github.com/gokhanamal/flowproof.git
cd flowproof
npm ci
APPIUM_HOME="$PWD/.appium" npm exec -- appium driver install xcuitest@11.17.7
```

FlowProof is distributed as a GitHub Action and reusable workflow. It is not
currently distributed as an npm package.

## Quick start

Copy a flow into your application repository:

```bash
cd /path/to/your-app
mkdir -p .flowproof
cp /path/to/flowproof/examples/flow-template.yaml .flowproof/app-launch.flow.yaml
```

Replace its instructions and evidence stages with your journey. Build and boot
your simulator, then start Appium:

```bash
APPIUM_HOME="$PWD/.appium" npm exec -- appium --address 127.0.0.1 --port 4723
```

Run FlowProof from the cloned repository:

```bash
cd /path/to/flowproof
OPENAI_API_KEY="..." \
SIMULATOR_UDID="<booted-udid>" \
APP_PATH="/absolute/path/Example.app" \
FLOW_PATH="/absolute/path/app-launch.flow.yaml" \
npm start
```

## Flow format

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

Store the OpenAI key as the caller repository secret `OPENAI_API_KEY`. Call the
reusable workflow from your application repository:

```yaml
name: Agent E2E

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  ios-e2e:
    uses: gokhanamal/flowproof/.github/workflows/ios-e2e.yml@main
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      flow_path: .flowproof/app-launch.flow.yaml
      model: gpt-5.6-luna
      retention_days: 7
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The safe starting point is manual execution from a reviewed ref. The workflow
runs `build_command`, creates a disposable simulator, runs the journey, and
uploads evidence.

After defining a trusted-change policy, callers may add a `pull_request` trigger
and grant `pull-requests: write` for the report job. Do not use that configuration
for unreviewed same-repository branches: the checked-out code and `build_command`
execute before the API key is used. Fork pull requests should run only FlowProof's
secretless validation checks. See [Security and
privacy](docs/security-and-privacy.md#pull-request-threat-model).

Use the composite action when you manage the simulator yourself:

```yaml
- uses: gokhanamal/flowproof@v0.1.0
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  with:
    app_path: ${{ github.workspace }}/build/Example.app
    flow_path: ${{ github.workspace }}/.e2e/app-launch.flow.yaml
    simulator_udid: ${{ steps.simulator.outputs.udid }}
```

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

FlowProof does not intentionally retarget published version tags. For the direct
composite action, replacing `v0.1.0` with the release's full 40-character commit
SHA is the strongest immutable pin. A full SHA on the reusable workflow pins the
workflow file; that workflow also pins its secret-bearing composite action to an
audited full SHA:

```yaml
uses: gokhanamal/flowproof/.github/workflows/ios-e2e.yml@<full-commit-sha>
```

Enable GitHub release immutability before publishing `v0.1.0`. Dependabot or
Renovate can propose later SHA updates. Review those changes like any other
executable dependency update.

## Supported contract

The supported public interfaces are:

- the inputs and outputs declared in [`action.yml`](action.yml);
- the `workflow_call` inputs and secret in
  [`.github/workflows/ios-e2e.yml`](.github/workflows/ios-e2e.yml);
- the strict YAML flow shape demonstrated in [`examples/`](examples/); and
- `report.json`, `steps.json`, transcripts, accessibility dumps, screenshots,
  and `screen-recording.mp4` as diagnostic artifacts.

Suite runs also include a strict `flow-result.json`, aggregate
`suite-report.json`, and human-readable `suite-summary.md`.

Credentials, provider internals, and hidden reasoning are excluded.

Values passed to `enter_text` are redacted from recorded function-call
arguments. Named `enter_secret` values are also redacted from model
observations, evidence diagnostics, action history, errors, and reports. They
may still become visible in a screenshot or raw accessibility dump if the
application renders them. Never use production credentials in a test flow.

FlowProof currently supports iOS Simulator journeys on macOS with native
accessibility elements. Releases before `1.0.0` may change these interfaces;
pin a release and review its notes before upgrading.

## Data, security, and cost

Flow instructions and compact accessibility text are sent to OpenAI. Raw
screenshots, XML, video, Appium logs, transcripts, and reports remain on the
runner and in GitHub artifacts; screenshots are not sent to the model. The
GitHub Action disables Agents SDK tracing.

Artifacts can expose application data. Pull-request execution and the reusable
workflow's arbitrary `build_command` also require a deliberate trust policy.
Read [Security and privacy](docs/security-and-privacy.md) before enabling
secret-backed runs.

Each run consumes OpenAI tokens and may consume billable GitHub-hosted macOS
minutes and artifact storage. Token counts are recorded in `report.json`.
Check current [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
and your GitHub Actions plan.

## Limitations

FlowProof does not currently support physical devices, Android, web apps,
coordinate or multi-touch gestures, visual assertions, or automatic retries.
Screenshots are evidence only. Accessibility quality directly limits what the
agent can observe and target. Runner image, Xcode, npm, Appium registry, GitHub,
and OpenAI availability can affect otherwise unchanged runs.

## Development

Run offline checks:

```bash
npm run validate
```

Validate workflow syntax when `actionlint` is installed:

```bash
actionlint
```

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before starting substantial work. Support requests follow [SUPPORT.md](SUPPORT.md),
and vulnerabilities must use the private process in [SECURITY.md](SECURITY.md).
All project spaces follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

FlowProof is available under the [Apache License 2.0](LICENSE).
