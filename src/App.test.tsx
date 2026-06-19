import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type TestStage = "empty" | "prd" | "task" | "report" | "review";

function createAgentBusState(stage: TestStage = "empty") {
  const hasPrd = ["prd", "task", "report", "review"].includes(stage);
  const hasTask = ["task", "report", "review"].includes(stage);
  const hasReport = ["report", "review"].includes(stage);
  const hasReview = stage === "review";

  return {
    artifacts: [
      ...(hasPrd
        ? [
            {
              id: "prd-smallcalc-v1",
              stepId: 1,
              actor: "小五",
              type: "PRD",
              title: "SmallCalc PRD v1",
              status: "created",
              summary: "真实 LLM PRD",
              body: "SmallCalc PRD body",
              createdAt: "2026-06-19T00:00:00.000Z",
            },
          ]
        : []),
      ...(hasTask
        ? [
            {
              id: "taskspec-smallcalc-v1",
              stepId: 2,
              actor: "小五",
              type: "TaskSpec",
              title: "SmallCalc TaskSpec v1",
              status: "created",
              summary: "真实 LLM TaskSpec",
              body: "SmallCalc TaskSpec body",
              createdAt: "2026-06-19T00:00:01.000Z",
            },
          ]
        : []),
      ...(hasReview
        ? [
            {
              id: "review-smallcalc-v1",
              stepId: 4,
              actor: "小五",
              type: "ReviewResult",
              title: "小五验收报告 v1",
              status: "created",
              summary: "真实 LLM Review",
              body: "验收不通过：CC 本轮只提交报告，尚未实现 SmallCalc。",
              createdAt: "2026-06-19T00:00:02.000Z",
            },
          ]
        : []),
    ],
    tasks: hasTask ? [{ id: "task-smallcalc-mvp-001", type: "TaskSpec", status: "queued" }] : [],
    reports: hasReport
      ? [{ id: "report-smallcalc-mvp-001", type: "ImplementationReport", status: "submitted", payload: { summary: "CC submitted real report." } }]
      : [],
    llm: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
      configured: true,
    },
    messages: hasTask
      ? [
          {
            id: "MSG-001",
            from: "小五",
            to: "CC",
            type: "TaskSpec",
            channel: ".agentbus/cc-inbox",
            status: "queued",
            payload: ["目标：SmallCalc", "目标仓库：/tmp/smallcalc-app"],
          },
        ]
      : [],
    run: hasTask
      ? {
          id: "run-test",
          status: "running",
          targetRepo: "/tmp/smallcalc-app",
          runner: {
            provider: "codex",
            adapter: "Codex App Server",
            protocol: "json-rpc/stdio",
            mode: "test",
            status: "running",
            threadId: "thread-test",
            turnId: "turn-test",
          },
          events: [
            {
              at: "2026-06-19T00:00:00.000Z",
              type: "codex-event",
              method: "turn/started",
              threadId: "thread-test",
              turnId: "turn-test",
              text: "turn turn-test: inProgress",
            },
            {
              at: "2026-06-19T00:00:01.000Z",
              type: "codex-event",
              method: "item/started",
              itemType: "agentMessage",
              text: "CC test worker received TaskSpec through Codex App Server.",
            },
          ],
        }
      : null,
  };
}

describe("小五工作台", () => {
  let stage: TestStage = "empty";

  beforeEach(() => {
    stage = "empty";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: { method?: string }) => {
        const url = String(input);

        if (url === "/api/xiaowu/prd" && init?.method === "POST") {
          stage = "prd";
          return Response.json({ ok: true });
        }

        if (url === "/api/agentbus/tasks/smallcalc" && init?.method === "POST") {
          stage = "task";
          return Response.json({ ok: true });
        }

        if (url === "/api/xiaowu/review" && init?.method === "POST") {
          stage = "review";
          return Response.json({ ok: true });
        }

        if (url === "/api/agentbus/reset" && init?.method === "POST") {
          stage = "empty";
          return Response.json({ ok: true });
        }

        if (url === "/api/agentbus/state") {
          return Response.json(createAgentBusState(stage));
        }

        return Response.json({ error: "not found" }, { status: 404 });
      }),
    );
  });

  it("默认等待小五发令，不展示任何预置结果", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "产出物" })).toBeInTheDocument();
    expect(screen.getByText("尚未生成产出物")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "小五创建 PRD" })).toBeEnabled();
    expect(screen.queryByLabelText("当前流程状态")).not.toBeInTheDocument();
  });

  it("小五创建 PRD 后才展示 PRD 产出物", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "小五创建 PRD" }));

    expect(screen.getByRole("heading", { name: "SmallCalc PRD v1" })).toBeInTheDocument();
    expect(screen.getByText("SmallCalc PRD body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送 TaskSpec 给 CC" })).toBeEnabled();
  });

  it("TaskSpec 必须在 PRD 之后真实发送给 CC", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "小五创建 PRD" }));
    expect(screen.getByText("尚未通信")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送 TaskSpec 给 CC" }));

    const conversation = screen.getByLabelText("小五和 CC 会话消息");
    expect(within(conversation).getByText("TaskSpec")).toBeInTheDocument();
    expect(within(conversation).getByText(/目标：SmallCalc/)).toBeInTheDocument();
    expect(within(conversation).getByText(/目标仓库：\/tmp\/smallcalc-app/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "产出物" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SmallCalc TaskSpec v1" })).toBeInTheDocument();
    expect(screen.getByText("Codex App Server")).toBeInTheDocument();
    expect(screen.getByText("thread-test")).toBeInTheDocument();
    expect(
      within(conversation).getByText(
        /CC test worker received TaskSpec through Codex App Server/,
      ),
    ).toBeInTheDocument();
  });

  it("没有真实报告时不会允许小五验收", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "小五创建 PRD" }));
    await user.click(screen.getByRole("button", { name: "发送 TaskSpec 给 CC" }));

    expect(screen.getByRole("button", { name: "等待 CC 报告" })).toBeDisabled();
    expect(screen.queryByText(/Approved/)).not.toBeInTheDocument();
  });

  it("可以从任意步骤重置回第一步", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "小五创建 PRD" }));
    await user.click(screen.getByRole("button", { name: "重置" }));

    expect(screen.getByText("尚未生成产出物")).toBeInTheDocument();
    expect(screen.queryByLabelText("当前流程状态")).not.toBeInTheDocument();
  });
});
