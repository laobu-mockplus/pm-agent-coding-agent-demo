import { appendEvent, getOpenPr, readLatest, run, writeLatest, writeTempFile } from "./lib.mjs";

const latest = readLatest();
const pr = getOpenPr();

const body = `## XiaoWu PM Review: Changes Requested

Decision: REQUEST_CHANGES

XiaoWu reviewed the PR against the SmallCalc PRD acceptance criteria.

### Failed Acceptance Criteria

- **AC-6 Keyboard input**: Not implemented in the first pass. The MVP requires number keys, decimal
  point, operators, Enter, Backspace, and Escape to work as expected.

### Requested Changes for CC

- Add keyboard event handling for digits, decimal point, operators, Enter, Backspace, and Escape.
- Ensure keyboard input shares the same calculator logic as button clicks.
- Add tests that prove keyboard operation works.
- Update the PR body ImplementationReport so AC-6 is marked passed only after verification.

### XiaoWu Notes

The first pass is useful and most calculator behavior is present, but SmallCalc cannot pass MVP
acceptance until AC-6 is complete.
`;

const bodyFile = writeTempFile("xiaowu-review-request-changes.md", body);
run("gh", ["pr", "review", String(pr.number), "--request-changes", "--body-file", bodyFile], {
  stdio: "inherit",
});

writeLatest({
  ...latest,
  pr,
  status: "changes_requested",
  xiaowuReview: {
    decision: "changes_requested",
    failedAcceptanceCriteria: ["AC-6"],
  },
});
appendEvent("XIAOWU_REQUESTED_CHANGES", { pr: pr.url, failedAcceptanceCriteria: ["AC-6"] });

console.log(`XiaoWu requested changes on PR: ${pr.url}`);
