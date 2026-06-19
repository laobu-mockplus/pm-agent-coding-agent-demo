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
- 页面打开后处于 `0 / 7` 的等待状态。
- 点击“开始：小五创建 PRD”后，UI 才开始模拟流程推进。
- 第二步会把真实 `TaskSpec` 写入 `.agentbus/cc-inbox/`。
- 本地 orchestrator 会通过 CC 调用器启动真实 `codex app-server`，用 JSON-RPC stdio 创建 thread/turn。
- Codex App Server 的结构化事件会写入 `.agentbus/runs/<runId>/events.jsonl`，主界面会显示 Codex 控制台。
- CC 完成后会把真实 `ImplementationReport` 写回 `.agentbus/xiaowu-inbox/`。
- 当前只验证通信和执行链路，不会让 CC 提前实现 SmallCalc。

## 通信目录

```text
.agentbus/
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
