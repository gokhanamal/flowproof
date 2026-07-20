# Security and privacy

FlowProof controls an application, calls an external model, and produces rich
debugging evidence. Treat the runner and its artifacts as sensitive systems.

## Data flow

FlowProof sends the following data to the configured OpenAI model:

- the flow name, description, and free-form journey instructions;
- compact text derived from visible iOS accessibility nodes;
- deterministic check status and bounded tool results; and
- the model conversation needed to continue the journey.

The compact accessibility text can include names, labels, values, placeholders,
and other content exposed by the application. Do not display secrets, customer
data, or production credentials in the test application.

FlowProof captures the following data locally on the runner:

- raw Appium accessibility XML and compact JSON observations;
- a PNG screenshot for every observation;
- a full simulator screen recording and the Appium log;
- resolved flow instructions, tool history, and model transcripts; and
- deterministic evidence, token usage, errors, and the final report.

Current releases do not implement visual assertions. Screenshots, raw XML, and
video are not sent to the model. They remain in the configured artifact
directory and, when using the action, are uploaded to GitHub Actions.

Values passed to `enter_text` are redacted from recorded tool arguments and the
chronological action log. They can still appear in later screenshots, XML,
accessibility JSON, video, Appium logs, or application output. This redaction is
not a data-loss-prevention boundary.

Provider API keys, authorization fields, provider metadata, and hidden
reasoning are excluded or redacted from FlowProof transcripts. Other
application content is not guaranteed to be redacted.

## Tracing

The composite GitHub Action sets `OPENAI_AGENTS_DISABLE_TRACING=1`, disabling
OpenAI Agents SDK tracing for that run. Direct local CLI runs follow the SDK
default unless you set the same environment variable:

```bash
OPENAI_AGENTS_DISABLE_TRACING=1 npm start
```

When SDK tracing is enabled, FlowProof configures
`traceIncludeSensitiveData: false`. This reduces trace contents but does not
change the model request or FlowProof's local evidence files. Review the Agents
SDK and OpenAI data controls for your chosen account before processing
sensitive information.

## Artifact retention and deletion

The composite action uploads the complete artifact directory. Its default
retention is seven days and can be shortened with `retention_days`. The reusable
workflow exposes the same input and default. Repository and organization
retention policies may impose a lower maximum.

Artifact access follows GitHub repository and Actions permissions. The URL may
appear in a public pull-request comment and must not be treated as a secret.
Anyone authorized to read the run may be able to download it, and public-repository
artifacts can have a much broader audience. Assume screenshots, XML, video, logs,
and transcripts are sensitive even when the tested source code is public.

Use synthetic test accounts and data. Restrict Actions access, grant the
smallest job permissions, keep retention short, and delete artifacts or the
workflow run promptly after an incident or accidental capture. Deleting a pull
request comment only removes its link; it does not delete the artifact.

For direct action usage, set a short retention explicitly:

```yaml
- uses: gokhanamal/flowproof@v0.1.0
  with:
    app_path: ${{ github.workspace }}/build/Example.app
    flow_path: ${{ github.workspace }}/.e2e/app-launch.flow.yaml
    simulator_udid: ${{ steps.simulator.outputs.udid }}
    retention_days: "1"
```

## Pull-request threat model

The reusable workflow is suitable only for code and flow definitions you trust
to execute with the job's effective permissions.

`build_command` is intentionally an arbitrary shell command. It runs after
checking out the caller revision. A modified build script, dependency hook,
Xcode build phase, test application, or flow can execute code, access available
runner credentials, influence model input, and place data into uploaded
artifacts. Pinning FlowProof does not make caller code safe.

Use these controls:

- Run secret-backed workflows only for trusted, same-repository changes.
- Require approval or a separate maintainer-controlled workflow for untrusted
  contributions.
- Do not use `pull_request_target` to build or run untrusted pull-request code.
- Keep `GITHUB_TOKEN` permissions minimal and protect workflow files with code
  review or CODEOWNERS.
- Pin FlowProof and third-party actions to reviewed full commit SHAs.
- Avoid exposing unrelated repository, environment, or organization secrets.

GitHub normally withholds Actions secrets from fork-originated `pull_request`
runs. That is a useful boundary, not a reason to add a bypass. A maintainer who
reruns or copies untrusted code into a trusted branch must review the exact
revision first.

## Network and supply-chain dependencies

The action installs npm dependencies and the pinned XCUITest driver during each
run. It also depends on GitHub-hosted runner images, Xcode simulator runtimes,
GitHub Actions and artifact services, and the OpenAI API. Local runs need the
same npm, Appium registry, and OpenAI connectivity unless dependencies and the
driver are already available.

Pin released FlowProof revisions, review lockfile and action updates, and expect
external outages or runner-image changes to affect reproducibility.

## Cost controls

Flow files cap execution at 1 to 30 model turns. The runner uses deterministic
evidence rather than asking the model to judge success. `report.json` records
request and token totals for each completed run.

Set an appropriate model, keep journeys short, limit workflow triggers and
concurrency, and configure account-level OpenAI spending controls. GitHub-hosted
macOS minutes and artifact storage may also be billable under the caller's plan.
