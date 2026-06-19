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
- 本地 orchestrator 会拉起真实 `codex exec`，并把 stdout/stderr 写入 `.agentbus/runs/<runId>/events.jsonl`。
- CC 完成后会把真实 `ImplementationReport` 写回 `.agentbus/xiaowu-inbox/`。
- 当前只验证通信和执行链路，不会让 CC 提前实现 SmallCalc。

## 通信目录

```text
.agentbus/
  cc-inbox/                 # 小五发给 CC 的 TaskSpec
  xiaowu-inbox/             # CC 写回给小五的 ImplementationReport
  runs/<runId>/events.jsonl # CC 执行过程 stdout/stderr/exit
```

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

后续如果要接入真实 GitHub 和真实 Coding Agent，必须把“小五发出 TaskSpec”作为 CC 启动的前置门禁。CC 不应在小五发令前创建实现分支、提交 PR 或生成 SmallCalc 程序代码。
