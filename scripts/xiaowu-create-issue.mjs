import { readFileSync } from "node:fs";
import { appendEvent, getRepo, rootDir, run, writeLatest, writeTempFile } from "./lib.mjs";

const repo = getRepo();
const prd = readFileSync(`${rootDir}/docs/smallcalc-prd.md`, "utf8");
const runId = `RUN-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}`;

for (const label of ["xiaowu", "cc-task", "smallcalc"]) {
  try {
    run("gh", ["label", "create", label, "--color", "2563eb", "--description", "XiaoWu/CC demo"]);
  } catch {
    // Label already exists.
  }
}

const body = `# TaskSpec: SmallCalc MVP

Created by: XiaoWu PM Agent

This issue is the product contract for CC.

${prd}

## Reporting Required

CC must open a PR and include an implementation report with:

- Summary
- Files changed
- Verification commands and results
- Acceptance criteria status by ID
- Known gaps or risks
`;

const bodyFile = writeTempFile("smallcalc-task.md", body);
const issueUrl = run("gh", [
  "issue",
  "create",
  "--title",
  "[XiaoWu TaskSpec] SmallCalc MVP",
  "--body-file",
  bodyFile,
  "--label",
  "xiaowu,cc-task,smallcalc",
]).trim();

const issue = JSON.parse(
  run("gh", ["issue", "view", issueUrl, "--json", "number,title,url,state,body"]),
);

const latest = {
  runId,
  repo,
  issue,
  status: "ready",
};

writeLatest(latest);
appendEvent("TASKSPEC_CREATED", { issue: issue.url, repo: repo.nameWithOwner });

console.log(`XiaoWu created TaskSpec Issue: ${issue.url}`);
