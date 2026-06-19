import { expect, test } from "@playwright/test";

test("小五工作台可以逐步演示不通过到通过", async ({ page }) => {
  await page.request.post("/api/agentbus/reset");
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "产出物", exact: true })).toBeVisible();
  await expect(page.getByText("尚未生成产出物")).toBeVisible();
  await expect(page.getByLabel("当前流程状态")).toHaveCount(0);

  await page.getByRole("button", { name: "开始：小五创建 PRD" }).click();
  await expect(page.getByRole("heading", { name: "PRD v0.1" })).toBeVisible();
  await expect(page.getByText("尚未通信")).toBeVisible();

  await page.getByRole("button", { name: "发送 TaskSpec 给 CC" }).click();
  const conversation = page.getByLabel("小五和 CC 会话消息");
  await expect(conversation.getByText("TaskSpec", { exact: true })).toBeVisible();
  await expect(conversation.getByText("目标：SmallCalc")).toBeVisible();
  await expect(page.getByRole("heading", { name: "TaskSpec" })).toBeVisible();
  await expect(page.getByLabel("Codex App Server 状态").getByText("Codex App Server")).toBeVisible();
  await expect(conversation.getByText("thread/started")).toBeVisible();
  await expect(
    conversation.getByText("CC test worker received TaskSpec through Codex App Server."),
  ).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "执行下一步" }).click();
  }

  await expect(page.getByRole("heading", { name: "XiaoWu PM Review" })).toBeVisible();
  await expect(page.getByText(/AC-6 Keyboard input/)).toBeVisible();

  await page.getByRole("button", { name: "执行下一步" }).click();
  await page.getByRole("button", { name: "执行下一步" }).click();

  await expect(page.getByRole("heading", { name: "XiaoWu PM Review: Approved" })).toBeVisible();
  await expect(page.getByText("SmallCalc MVP is approved。模拟 PR 进入 xiaowu:approved 状态。")).toBeVisible();
});

test("小五工作台使用固定窗口和内部滚动", async ({ page }) => {
  await page.request.post("/api/agentbus/reset");
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");

  const layout = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    htmlScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    shellHeight: document.querySelector(".app-shell")?.getBoundingClientRect().height ?? 0,
    timelineOverflow: getComputedStyle(document.querySelector(".timeline") as Element).overflowY,
    chatOverflow: getComputedStyle(document.querySelector(".chat-list") as Element).overflowY,
  }));

  expect(layout.shellHeight).toBe(layout.viewportHeight);
  expect(layout.htmlScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.timelineOverflow).toBe("auto");
  expect(layout.chatOverflow).toBe("auto");
});
