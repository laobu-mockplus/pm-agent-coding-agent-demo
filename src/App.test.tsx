import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function createAgentBusState(hasTask = false) {
  return {
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
  let hasTask = false;

  beforeEach(() => {
    hasTask = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: { method?: string }) => {
        const url = String(input);

        if (url === "/api/agentbus/tasks/smallcalc" && init?.method === "POST") {
          hasTask = true;
          return Response.json({ ok: true });
        }

        if (url === "/api/agentbus/reset" && init?.method === "POST") {
          hasTask = false;
          return Response.json({ ok: true });
        }

        if (url === "/api/agentbus/state") {
          return Response.json(createAgentBusState(hasTask));
        }

        return Response.json({ error: "not found" }, { status: 404 });
      }),
    );
  });

  it("默认等待小五发令，不展示已开始实现的状态", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "等待小五发出第一条指令" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("SmallCalc 尚未开始实现。");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("小五发出指令后展示创建 PRD 的第一步", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始：小五创建 PRD" }));

    expect(screen.getByRole("heading", { name: "小五创建 SmallCalc PRD" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("小五已生成 PRD，尚未产生 SmallCalc 程序代码。");
  });

  it("第二步明确展示小五发送给 CC 的 TaskSpec 通信包", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始：小五创建 PRD" }));
    expect(screen.getByText("尚未通信")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送 TaskSpec 给 CC" }));

    const communication = screen.getByLabelText("小五和 CC 通信消息");
    expect(within(communication).getByText("MSG-001")).toBeInTheDocument();
    expect(within(communication).getByText("TaskSpec")).toBeInTheDocument();
    expect(within(communication).getByText("小五")).toBeInTheDocument();
    expect(within(communication).getByText("CC")).toBeInTheDocument();
    expect(within(communication).getByText("目标：SmallCalc")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CC 执行台" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Codex App Server" })).toBeInTheDocument();
    expect(screen.getByText("json-rpc/stdio")).toBeInTheDocument();
    expect(screen.getByText("thread-test")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Codex App Server 结构化事件")).getByText(
        /CC test worker received TaskSpec through Codex App Server/,
      ),
    ).toBeInTheDocument();
  });

  it("可以按 7 个步骤逐步推进到最终通过", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始：小五创建 PRD" }));
    for (let index = 0; index < 6; index += 1) {
      await user.click(
        screen.getByRole("button", { name: index === 0 ? "发送 TaskSpec 给 CC" : "执行下一步" }),
      );
    }

    expect(screen.getByRole("heading", { name: "小五再次验收并通过" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("流程完成，小五 PM Agent demo 通过。");
    expect(screen.getByRole("button", { name: "流程已完成" })).toBeDisabled();
  });

  it("第 5 步明确展示不通过项，第 7 步展示通过项", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始：小五创建 PRD" }));
    for (let index = 0; index < 4; index += 1) {
      await user.click(
        screen.getByRole("button", { name: index === 0 ? "发送 TaskSpec 给 CC" : "执行下一步" }),
      );
    }

    expect(screen.getByRole("heading", { name: "小五判定不通过并列出不合格项" })).toBeInTheDocument();
    expect(screen.getAllByText(/AC-6 Keyboard input/).length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("验收不通过，CC 进入修复。");

    await user.click(screen.getByRole("button", { name: "执行下一步" }));
    await user.click(screen.getByRole("button", { name: "执行下一步" }));

    const statusStrip = screen.getByLabelText("当前流程状态");
    expect(within(statusStrip).getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("SmallCalc MVP is approved。模拟 PR 进入 xiaowu:approved 状态。")).toBeInTheDocument();
  });

  it("可以从任意步骤重置回第一步", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "开始：小五创建 PRD" }));
    await user.click(screen.getByRole("button", { name: "重置" }));

    expect(screen.getByRole("heading", { name: "等待小五发出第一条指令" })).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
