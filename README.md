# 小五 PM Agent 工作台 Demo

这个仓库当前用于验证 **小五** 作为 PM Agent 管理 **CC** 作为 Coding Agent 的可视化流程。

当前重点不是提前交付 SmallCalc 计算器程序，而是验证：

1. 小五先创建 PRD。
2. 小五再向 CC 发出 TaskSpec。
3. CC 只有收到小五指令后，才开始实现。
4. 小五根据报告进行验收。
5. 小五可以判定不通过并列出不合格项。
6. CC 根据验收结果修复。
7. 小五最终验收通过。

## 当前状态

- SmallCalc 程序实现不应提前存在。
- 页面打开后不会预置 PRD、TaskSpec、报告或验收结果。
- 点击“小五创建 PRD”后，小五会通过 `.env.local` 中的真实 LLM provider 生成 PRD。
- 点击“发送 TaskSpec 给 CC”后，小五会通过真实 LLM 把 PRD 转成 TaskSpec，并写入 `.agentbus/cc-inbox/`。
- 本地 orchestrator 会通过 CC 调用器启动真实 `codex app-server`，用 JSON-RPC stdio 创建 thread/turn。
- Codex App Server 的结构化事件会写入 `.agentbus/runs/<runId>/events.jsonl`，主界面会显示 Codex 控制台。
- CC 完成后会把真实 `ImplementationReport` 写回 `.agentbus/xiaowu-inbox/`。
- 小五验收报告也通过真实 LLM 基于 TaskSpec 和 CC 报告生成。
- 如果真实 LLM provider 不可用，页面只显示错误，不会生成假产物。
- 当前只验证真实编排、通信和执行链路，不会让 CC 提前实现 SmallCalc。

## 通信目录

```text
.agentbus/
  artifacts/                # 小五真实 LLM 生成的 PRD、TaskSpec、验收报告
  cc-inbox/                 # 小五发给 CC 的 TaskSpec
  xiaowu-inbox/             # CC 写回给小五的 ImplementationReport
  runs/<runId>/runner.json  # CC 调用器快照：provider、adapter、threadId、turnId
  runs/<runId>/events.jsonl # Codex App Server 结构化事件和退出状态
```

## CC 调用器

当前默认调用器是 `Codex App Server`：

```text
小五 UI -> Vite orchestrator -> CcAgentRunner -> CodexAppServerRunner -> codex app-server
```

调用器接口已和小五业务消息分离。后续接 Qoder、Claude、Cursor 等其它 CC 时，应新增对应 Adapter，而不是改写 `.agentbus` 的 TaskSpec / ImplementationReport 模型。

## LLM Provider

小五的 LLM provider 读取父级工作区的 `.env.local`，支持 OpenAI-compatible `OPENAI_*` 和 Azure OpenAI `AZURE_OPENAI_*` 两组配置。API key 不会下发到前端；前端只显示 provider、baseUrl、model 等非敏感摘要。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

## 验证

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

## 后续真实接入

后续如果要接入真实 GitHub 和更多 Coding Agent，必须把“小五发出 TaskSpec”作为 CC 启动的前置门禁。CC 不应在小五发令前创建实现分支、提交 PR 或生成 SmallCalc 程序代码。
