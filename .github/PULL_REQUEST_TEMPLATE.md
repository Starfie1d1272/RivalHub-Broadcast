## Summary

<!-- What real capability or fix does this PR deliver? -->

## Issue

Closes #

## Scope completed

- [ ] Required scope implemented
- [ ] Non-goals were not expanded without approval

## Canonical decisions / architecture

<!-- Confirm the relevant ADR/docs were followed. List any deviations explicitly. -->

- Relevant ADR/docs:
- Deviations: None / describe below

## Key changes

<!-- Packages/apps/ownership boundaries changed. -->

## Validation evidence

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

<!-- Replace/add the exact commands actually run. -->

## Platform validation

- Implementation environment: Cross-platform / macOS-primary / Windows-specific / other
- Automated validation completed:
  - [ ] Local deterministic tests
  - [ ] macOS CI
  - [ ] Windows CI
  - [ ] Linux CI
- Real-environment acceptance required by Issue: Not required / Real Windows / Windows + CS2 / Windows + OBS / Windows + CS2 + OBS
- Real-environment acceptance status: Not required / Pending / Passed / Failed
- Evidence / validator:

<!-- Never mark real Windows/CS2/OBS evidence as passed if it was not actually run. If pending evidence is a closing gate, say explicitly that the Issue is not fully accepted yet. -->

## Runtime / reliability checks

<!-- Check only what is relevant. -->

- [ ] slow consumer / backpressure considered
- [ ] reconnect considered
- [ ] duplicate / out-of-order considered
- [ ] session / epoch boundaries considered
- [ ] wrong-match / stale behavior considered
- [ ] queue/memory growth considered

## Documentation

- [ ] Docs updated where required
- [ ] No known conflict between implementation and docs/ADR

## Remaining risks / follow-up

<!-- Explicitly list unfinished work, pending platform acceptance, and link/create follow-up Issues instead of hiding it in TODOs. -->
