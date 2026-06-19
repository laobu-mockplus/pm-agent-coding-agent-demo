# PM Agent / Coding Agent Demo

This repository is a real GitHub-loop MVP for a PM agent named **XiaoWu** and a coding agent named
**CC**.

The demo product is **SmallCalc**, a small calculator app. The value of this repo is not the
calculator itself; it is the end-to-end product-engineering loop:

1. XiaoWu writes a PRD.
2. XiaoWu creates a GitHub Issue with a structured task spec.
3. CC reads the Issue and implements the product through a branch and PR.
4. CC submits an implementation report in the PR body.
5. XiaoWu reviews the PR against the acceptance criteria.
6. XiaoWu requests changes on the first pass.
7. CC fixes the failed criteria.
8. XiaoWu approves the PR.

## Main Commands

```bash
npm run xiaowu:issue
npm run cc:first
npm run xiaowu:review
npm run cc:fix
npm run xiaowu:approve
```

The scripts use real local tools:

- `gh` for GitHub Issue, PR, and review operations
- `codex exec` for CC
- `.agentbus` for local audit logs

## Demo Product

SmallCalc uses:

- Vite
- React
- TypeScript
- Vitest
- Testing Library
- Playwright
- GitHub Actions

See [docs/smallcalc-prd.md](docs/smallcalc-prd.md) for XiaoWu's PRD.
