import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("小五工作台", () => {
  it("默认展示小五创建 PRD 的第一步", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "小五创建 SmallCalc PRD" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("PRD 已生成，进入任务分配。");
  });

  it("可以按 7 个步骤逐步推进到最终通过", async () => {
    const user = userEvent.setup();
    render(<App />);

    for (let index = 0; index < 6; index += 1) {
      await user.click(screen.getByRole("button", { name: "执行下一步" }));
    }

    expect(screen.getByRole("heading", { name: "小五再次验收并通过" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("流程完成，小五 PM Agent demo 通过。");
    expect(screen.getByRole("button", { name: "流程已完成" })).toBeDisabled();
  });

  it("第 5 步明确展示不通过项，第 7 步展示通过项", async () => {
    const user = userEvent.setup();
    render(<App />);

    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole("button", { name: "执行下一步" }));
    }

    expect(screen.getByRole("heading", { name: "小五判定不通过并列出不合格项" })).toBeInTheDocument();
    expect(screen.getByText(/AC-6 Keyboard input/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("验收不通过，CC 进入修复。");

    await user.click(screen.getByRole("button", { name: "执行下一步" }));
    await user.click(screen.getByRole("button", { name: "执行下一步" }));

    const statusStrip = screen.getByLabelText("当前流程状态");
    expect(within(statusStrip).getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("SmallCalc MVP is approved。PR 只保留 xiaowu:approved 标签。")).toBeInTheDocument();
  });

  it("可以从任意步骤重置回第一步", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "执行下一步" }));
    await user.click(screen.getByRole("button", { name: "重置" }));

    expect(screen.getByRole("heading", { name: "小五创建 SmallCalc PRD" })).toBeInTheDocument();
    expect(screen.getByText("14%")).toBeInTheDocument();
  });
});
