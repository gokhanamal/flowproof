# Dependency review policy

FlowProof commits `package-lock.json` and installs with `npm ci`. Direct versions
are pinned rather than expressed as ranges because the composite action installs
them in adopter workflows at runtime.

## Current direct licenses

Reviewed for `v0.1.0` from the installed package metadata:

| Package | Scope | License |
| --- | --- | --- |
| `@openai/agents` | Runtime | MIT |
| `fast-xml-parser` | Runtime | MIT |
| `webdriverio` | Runtime | MIT |
| `yaml` | Runtime | ISC |
| `zod` | Runtime | MIT |
| `@types/node` | Development | MIT |
| `appium` | Development/runtime tooling | Apache-2.0 |
| `tsx` | Development/runtime tooling | MIT |
| `typescript` | Development | Apache-2.0 |

The lockfile also contains transitive and platform-optional packages. A direct
license list is therefore not a complete redistribution or compatibility
review.

The initial lockfile review identified items that require an explicit release
decision rather than being silently classified as permissive:

- optional `libvips` platform packages carry LGPL-3.0-or-later terms through
  Appium's development toolchain;
- `@promptbook/utils`, reached through WebdriverIO tooling, declares CC-BY-4.0;
- `css-value`, `ftp-response-parser`, and `parse-listing` omit license metadata
  from their lockfile entries; and
- several packages declare alternative license expressions that must be read as
  SPDX expressions, not as a mandatory GPL choice.

These packages are installed from their upstream registries and are not copied
into this repository. Before publishing a bundled action, binary, or container,
repeat the review for the exact distributed artifact and add required notices or
source offers.

## Change and release checks

- Dependabot monitors npm and GitHub Actions dependencies weekly.
- The Dependency Review workflow rejects pull requests that introduce a known
  high- or critical-severity vulnerability.
- Every release must run `npm audit`, inspect missing or changed license metadata
  across the complete lockfile, and resolve any notice, attribution, copyleft,
  source-availability, or redistribution obligation before tagging.
- External GitHub Actions must use reviewed full commit SHAs.
- A dependency with unclear ownership, license metadata, or incompatible terms
  blocks release until it is removed, replaced, or reviewed by the maintainer.

Security advisories follow the private process in [SECURITY.md](../SECURITY.md).
