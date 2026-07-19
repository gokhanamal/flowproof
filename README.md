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
mkdir -p .e2e
cp examples/flow-template.yaml .e2e/app-launch.flow.yaml
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
```

Each observation can complete only the next stage. This preserves journey order.

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
- `swipe` and `scroll`: move in one of four directions without coordinates;
- `wait`: pause for 250 milliseconds to 10 seconds;
- `dismiss_keyboard`: hide the software keyboard when visible, with a bounded
  downward-swipe fallback for phones without a keyboard-dismiss button;
- `handle_alert`: accept or dismiss the current iOS alert;
- `relaunch_app`: terminate and relaunch the active app without clearing data.

Raw Appium commands, arbitrary selectors, and coordinate gestures are not
exposed to the model. After every action, the agent must observe again.

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
    uses: gokhanamal/flowproof/.github/workflows/ios-e2e.yml@v0.1.0
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      flow_path: .e2e/app-launch.flow.yaml
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

Use `gokhanamal/flowproof@v0.1.0` directly when managing simulators yourself.

## Artifacts

Each run records:

- numbered model inputs and outputs;
- chronological tool history;
- Appium actions and deterministic checks;
- accessibility XML and screenshots;
- an H.264 simulator recording;
- token usage and the final report.

Credentials, provider internals, and hidden reasoning are excluded.

Values passed to `enter_text` are redacted from the chronological action log
and recorded function-call arguments. They may still become visible in a later
screenshot or accessibility dump if the application renders them. Never use
production credentials in a test flow.

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
