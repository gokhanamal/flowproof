# Maintainer and release policy

FlowProof is currently owned and maintained by
[@gokhanamal](https://github.com/gokhanamal). CODEOWNERS routes reviews but does
not replace judgment or permit a maintainer to bypass protected-branch checks.

## Decision making

The maintainer has final responsibility for project scope, security response,
releases, and moderation. Decisions should favor a small public contract,
fork-safe validation, deterministic evidence, and explicit privacy and cost
boundaries. New maintainers may be added after sustained, trusted contributions;
repository and release access must follow least privilege.

## Releases

FlowProof follows Semantic Versioning. Before 1.0.0, a minor release may be
breaking and must identify migration steps in `CHANGELOG.md` and the release
notes. Published version tags are immutable.

For each release, the maintainer should:

1. confirm ownership, license, dependency, secret, privacy, and security reviews;
2. run `npm ci`, `npm run validate`, `actionlint`, and the release security checks
   from a clean checkout;
3. update `CHANGELOG.md` and verify action, workflow, and documentation references
   resolve to matching immutable code;
4. test the candidate in a separate canary repository, including failure paths;
5. create the signed-off version tag and GitHub release only after checks pass;
6. rerun the public canary against the exact tag and document any deprecation or
   rollback guidance.

A moving major tag such as `v0` is optional and may be advanced only after the
immutable release passes its canary. Never retarget a version tag. If a release
is unsafe, publish an advisory and deprecation notice, then issue a new version.

Only the latest `0.x` release receives security fixes. Support expectations and
private disclosure instructions are defined in `SUPPORT.md` and `SECURITY.md`.
