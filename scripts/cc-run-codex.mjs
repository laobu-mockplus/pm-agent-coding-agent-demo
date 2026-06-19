import { appendEvent, getOpenPr, readLatest, rootDir, runInteractive, writeLatest } from "./lib.mjs";

const mode = process.argv[2];
if (!["first", "fix"].includes(mode)) {
  throw new Error("Usage: node scripts/cc-run-codex.mjs <first|fix>");
}

const latest = readLatest();
const baseContext = `You are CC, the real Coding Agent in the XiaoWu PM Agent demo.

Repository: ${latest.repo.nameWithOwner}
Local path: ${rootDir}
TaskSpec Issue: ${latest.issue.url}

Rules:
- Work in this git repository.
- Use branch cc/smallcalc-mvp.
- Make real code changes.
- Run verification commands before finishing.
- Commit and push your changes.
- Open or update a real GitHub PR.
- The PR body must contain "## CC Implementation Report".
- Report acceptance criteria status by AC ID from docs/smallcalc-prd.md.
- Keep the implementation scoped to SmallCalc.
`;

const firstPrompt = `${baseContext}

First-pass demo choreography:
- Implement the SmallCalc MVP except keyboard input.
- Do NOT implement AC-6 Keyboard input in this first pass.
- In the PR body, honestly mark AC-6 as incomplete / known gap.
- Implement clickable buttons, arithmetic, decimals, clear, backspace, divide-by-zero handling, chained calculation, history, and tests.
- Create PR title: "CC: Implement SmallCalc MVP".

This intentional first-pass gap allows XiaoWu to demonstrate a structured REQUEST_CHANGES review.`;

const fixPrompt = `${baseContext}

Fix pass:
- Read the latest XiaoWu PR review comments on the open PR for branch cc/smallcalc-mvp.
- Implement every requested change, especially AC-6 Keyboard input.
- Add or update tests that prove keyboard number keys, decimal point, operators, Enter, Backspace, and Escape work.
- Keep the same PR and branch.
- Update the PR body so every acceptance criterion is marked passed if verified.
- Run npm test and npm run build before finishing.`;

appendEvent(mode === "first" ? "CC_FIRST_PASS_STARTED" : "CC_FIX_PASS_STARTED", {
  issue: latest.issue.url,
});

runInteractive("codex", [
  "exec",
  "--cd",
  rootDir,
  "-a",
  "never",
  "-s",
  "danger-full-access",
  mode === "first" ? firstPrompt : fixPrompt,
]);

const pr = getOpenPr();
writeLatest({
  ...latest,
  pr,
  status: mode === "first" ? "implemented_first_pass" : "implemented_fix_pass",
});
appendEvent(mode === "first" ? "CC_FIRST_PASS_REPORTED" : "CC_FIX_PASS_REPORTED", {
  pr: pr.url,
});

console.log(`CC ${mode} pass completed on PR: ${pr.url}`);
