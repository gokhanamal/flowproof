---
date: 2026-07-19
topic: visual-assertions
---

# Visual Assertions

## What We're Building

Flows may optionally declare a short list of visual expectations. After deterministic evidence passes, FlowProof sends only the last observed screenshot and those expectations to the configured model. Every visual expectation must pass for the run to pass.

## Why This Approach

This adds coverage for clipping, overlap, incorrect imagery, and other visible defects without replacing the deterministic accessibility checks. It keeps existing flows and their screenshot privacy behavior unchanged unless visual assertions are explicitly configured.

## Key Decisions

- Deterministic evidence remains mandatory and is evaluated first.
- The initial schema is `visual.assertions`, containing plain, observable expectations.
- Visual evaluation uses the final observed screenshot only.
- Every assertion must pass; evaluation errors fail closed.
- Reference images, regions, confidence thresholds, and backend checks are deferred.

## Open Questions

- None for the initial version.

## Next Steps

- Implement, document, and verify the optional visual assertion path.
