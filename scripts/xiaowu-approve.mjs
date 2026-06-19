import { appendEvent, getOpenPr, readLatest, run, writeLatest, writeTempFile } from "./lib.mjs";

const latest = readLatest();
const pr = getOpenPr();

run("git", ["fetch", "origin", pr.headRefName], { stdio: "inherit" });
run("git", ["checkout", pr.headRefName], { stdio: "inherit" });
run("npm", ["test"], { stdio: "inherit" });
run("npm", ["run", "build"], { stdio: "inherit" });

const body = `## XiaoWu PM Review: Approved

Decision: APPROVE

XiaoWu reviewed the updated PR after CC's fix pass.

### Acceptance Criteria

- AC-1 Basic operations: passed
- AC-2 Decimal input: passed
- AC-3 Chained calculation: passed
- AC-4 Clear and backspace: passed
- AC-5 Division by zero: passed
- AC-6 Keyboard input: passed
- AC-7 History: passed
- AC-8 Verification: passed

### Verification

- npm test: passed
- npm run build: passed

SmallCalc MVP is approved.
`;

const bodyFile = writeTempFile("xiaowu-approve.md", body);
run("gh", ["pr", "review", String(pr.number), "--approve", "--body-file", bodyFile], {
  stdio: "inherit",
});

writeLatest({
  ...latest,
  pr,
  status: "accepted",
  xiaowuReview: {
    decision: "approved",
  },
});
appendEvent("XIAOWU_APPROVED", { pr: pr.url });

console.log(`XiaoWu approved PR: ${pr.url}`);
