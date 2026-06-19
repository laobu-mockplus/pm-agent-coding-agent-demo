# XiaoWu / CC Protocol

## Roles

- **XiaoWu**: PM Agent. Owns product intent, PRD, task specs, and acceptance decisions.
- **CC**: Coding Agent. Owns implementation, tests, PRs, and implementation reports.

## GitHub Objects

- Issue: TaskSpec from XiaoWu to CC
- Branch: CC's isolated implementation workspace
- PR: CC's implementation result
- PR body: ImplementationReport
- PR Review: XiaoWu's acceptance decision

## State Machine

```txt
draft -> ready -> claimed -> in_progress -> implemented -> changes_requested
                                                       -> accepted
changes_requested -> in_progress -> implemented -> accepted
```

## TaskSpec Shape

```md
## Product
## Goal
## Scope
## Out of Scope
## Acceptance Criteria
## Constraints
## Verification Required
## Reporting Required
```

Every acceptance criterion must have a stable ID, such as `AC-1`.

## ImplementationReport Shape

```md
## CC Implementation Report
## Summary
## Files Changed
## Verification
## Acceptance Criteria
## Known Gaps / Risks
```

## Demo Choreography

The first CC pass intentionally leaves keyboard entry incomplete so XiaoWu can demonstrate a
structured `REQUEST_CHANGES` review. The second CC pass must fix that failed acceptance criterion
and update the same PR.

This is deliberate demo choreography, but all GitHub operations, code changes, tests, commits, and
reviews are real.
