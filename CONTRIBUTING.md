# Contributing to FlowProof

Thank you for helping improve FlowProof. Bug reports, documentation fixes, tests,
and focused code changes are welcome.

## Before you start

- Use GitHub Issues to check for existing work and discuss substantial changes.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Keep changes focused. Avoid unrelated refactors in the same pull request.

## Development setup

FlowProof requires Node.js 22 or newer. Xcode, an iOS Simulator runtime, an
OpenAI API key, and Appium are needed only for end-to-end simulator runs.

```bash
npm ci
npm run validate
```

If you change GitHub Actions files, also run:

```bash
actionlint
```

The offline validation suite must work in a fork without secrets, Xcode, or
network calls to model providers. Do not add secrets to tests, fixtures, logs,
screenshots, accessibility dumps, or pull requests. Maintainers run privileged
iOS journeys only from trusted refs.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Add or update tests for behavior changes.
3. Update documentation and `CHANGELOG.md` when the public contract changes.
4. Run the relevant checks and describe their results in the pull request.
5. Open a pull request that explains the problem, the solution, and any privacy,
   compatibility, or cost impact.

Use clear commit messages; Conventional Commits such as `fix:`, `feat:`,
`docs:`, and `test:` are preferred. Maintainers may ask for changes or squash
commits when merging.

## Public contract

Treat action inputs and outputs, reusable-workflow inputs and secrets, the flow
YAML schema, report and artifact formats, and documented platform requirements
as public interfaces. Call out breaking changes explicitly.

## Contribution terms

By submitting a contribution, you agree that it is your original work or that
you have the right to submit it, and that it is licensed under the repository's
Apache License 2.0. FlowProof does not require a Contributor License Agreement
or Developer Certificate of Origin sign-off at this time.

All contributors must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
