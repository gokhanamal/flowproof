# OpenAI Appium E2E

Run bounded iOS journeys with Appium and the OpenAI Agents SDK.

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

See [`examples/`](examples/) for stateful and extracted Elo journeys.

## GitHub Actions

Allow private Actions access from your GitHub repository settings first.

Store the OpenAI key as the caller repository secret `OPENAI_API_KEY`.

Call the reusable workflow from your application repository:

```yaml
name: Agent E2E

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  ios-e2e:
    uses: gokhanamal/openai-appium-e2e/.github/workflows/ios-e2e.yml@v0.1.0
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      flow_path: .e2e/app-launch.flow.yaml
      model: gpt-5.6-luna
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

The reusable workflow builds the app and creates a disposable simulator.

The composite action installs Appium, runs the journey, and uploads evidence.

Use `gokhanamal/openai-appium-e2e@v0.1.0` directly when managing simulators yourself.

## Artifacts

Each run records:

- numbered model inputs and outputs;
- chronological tool history;
- Appium actions and deterministic checks;
- accessibility XML and screenshots;
- an H.264 simulator recording;
- token usage and the final report.

Credentials, provider internals, and hidden reasoning are excluded.

Treat artifacts as sensitive application data. Keep retention short.

## Cost and Safety

The default model is `gpt-5.6-luna`. Set `OPENAI_MODEL` to override it.

The agent receives compact accessibility text only. Images and XML remain local.

The agent can only observe and tap previously observed accessible text.

Flow files cap runs between one and thirty model turns.

Deterministic evidence decides pass or failure. The model never grades itself.

Use `report.json` and per-turn cached tokens for cost calculations.

Check current rates on the [OpenAI pricing page](https://developers.openai.com/api/docs/pricing).

## Limitations

The runner currently supports iOS simulators, observation, and tapping.

It does not support Android, text entry, swipes, retries, or visual assertions.

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
