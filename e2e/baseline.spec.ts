import { expect, test } from "@playwright/test";

test("小五工作台不会预置结果，必须先真实创建 PRD 再发送 TaskSpec", async ({ page }) => {
  test.setTimeout(120_000);
  await page.request.post("/api/agentbus/reset");
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "小五工作台：SmallCalc MVP 验收演示" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "产出物", exact: true })).toBeVisible();
  await expect(page.getByText("尚未生成产出物")).toBeVisible();
  await expect(page.getByLabel("当前流程状态")).toHaveCount(0);

  await page.getByRole("button", { name: "小五创建 PRD" }).click();
  const prdOutcome = await page
    .waitForFunction(
      () => {
        const body = document.body.textContent ?? "";
        const hasPrd = Array.from(document.querySelectorAll("h3")).some((heading) =>
          heading.textContent?.includes("SmallCalc PRD v1"),
        );
        const hasProviderError = body.includes("All configured LLM providers failed");

        if (hasPrd) return "prd";
        if (hasProviderError) return "provider-error";
        return false;
      },
      undefined,
      { timeout: 90_000 },
    )
    .then((handle) => handle.jsonValue());

  if (prdOutcome === "provider-error") {
    await expect(page.getByText("All configured LLM providers failed")).toBeVisible();
    await expect(page.getByText("尚未生成产出物")).toBeVisible();
    await expect(page.getByRole("heading", { name: "SmallCalc PRD v1" })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("heading", { name: "SmallCalc PRD v1" })).toBeVisible();
  const conversation = page.getByLabel("小五和 CC 会话消息");
  await expect(conversation.getByText("TaskSpec", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "发送 TaskSpec 给 CC" }).click();
  await expect(conversation.getByText("TaskSpec", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(conversation.getByText("目标：SmallCalc")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SmallCalc TaskSpec v1" })).toBeVisible();
  await expect(page.getByLabel("Codex App Server 状态").getByText("Codex App Server")).toBeVisible();
  await expect(conversation.getByText("CC 会话已建立")).toBeVisible();
  await expect(
    conversation.getByText("CC test worker received TaskSpec through Codex App Server."),
  ).toBeVisible();
  await page.waitForFunction(() => {
    const buttonText = Array.from(document.querySelectorAll("button")).map((button) => button.textContent ?? "");
    return buttonText.some((text) => text.includes("等待 CC 报告") || text.includes("小五验收报告"));
  });
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
