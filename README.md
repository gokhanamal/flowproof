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
mkdir -p .e2e
cp /path/to/flowproof/examples/flow-template.yaml .e2e/app-launch.flow.yaml
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
```

Each observation can complete only the next stage. Match exact `type`, `name`,
`label`, `value`, or `enabled` fields. Use their `Pattern` variants for regular
expressions. Anchor patterns when possible. Every matcher must match one
accessibility node. See [`examples/`](examples/) for more journeys.

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
    uses: gokhanamal/flowproof/.github/workflows/ios-e2e.yml@v0.1.0
    with:
      build_command: ./scripts/build-simulator-app.sh
      app_path: build/Example.app
      flow_path: .e2e/app-launch.flow.yaml
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
