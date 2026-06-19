import { expect, test } from "@playwright/test";

test("小五工作台可以逐步演示不通过到通过", async ({ page }) => {
  await page.request.post("/api/agentbus/reset");
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "等待小五发出第一条指令" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("SmallCalc 尚未开始实现。");

  await page.getByRole("button", { name: "开始：小五创建 PRD" }).click();
  await expect(page.getByRole("heading", { name: "小五创建 SmallCalc PRD" })).toBeVisible();
  await expect(page.getByText("尚未通信")).toBeVisible();

  await page.getByRole("button", { name: "发送 TaskSpec 给 CC" }).click();
  const communication = page.getByLabel("小五和 CC 通信消息");
  await expect(communication.getByText("MSG-001")).toBeVisible();
  await expect(communication.getByText("TaskSpec", { exact: true })).toBeVisible();
  await expect(communication.getByText("目标：SmallCalc")).toBeVisible();
  await expect(page.getByRole("heading", { name: "CC 执行台" })).toBeVisible();
  await expect(page.getByLabel("CC 执行过程消息").getByText("CC test worker received TaskSpec.")).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "执行下一步" }).click();
  }

  await expect(page.getByRole("heading", { name: "小五判定不通过并列出不合格项" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("验收不通过，CC 进入修复。");

  await page.getByRole("button", { name: "执行下一步" }).click();
  await page.getByRole("button", { name: "执行下一步" }).click();

  await expect(page.getByRole("heading", { name: "小五再次验收并通过" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("流程完成，小五 PM Agent demo 通过。");
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
    commOverflow: getComputedStyle(document.querySelector(".comm-list") as Element).overflowY,
  }));

  expect(layout.shellHeight).toBe(layout.viewportHeight);
  expect(layout.htmlScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  expect(layout.timelineOverflow).toBe("auto");
  expect(layout.commOverflow).toBe("auto");
});
