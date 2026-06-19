# Codex App Server 调用器改造情况汇报

生成时间：2026-06-19 20:03:00 CST  
分支：`xiaowu-workbench-ui`  
任务：将小五管理 CC 的执行层切换为 Codex App Server，并为未来 Qoder、Claude、Cursor 等 CC 预留调用器架构。

## 1. 任务完成情况

已完成。

本次改造把原来的直接 `codex exec` 执行方式，替换为 CC 调用器架构：

- 新增 `server/cc-runners.ts`。
- 定义 `CcAgentRunner` 通用接口。
- 实现 `CodexAppServerRunner`，通过 `codex app-server` 的 JSON-RPC stdio 协议启动和管理 Codex。
- 实现 `CodexAppServerTestRunner`，用于单测和 e2e 的稳定验证。
- `vite.config.ts` 不再直接 spawn `codex exec`，而是通过 runner 启动 CC。
- `.agentbus` 继续作为小五和 CC 的业务消息审计层。
- `.agentbus/runs/<runId>/runner.json` 记录 provider、adapter、protocol、threadId、turnId、状态。
- `.agentbus/runs/<runId>/events.jsonl` 记录 Codex App Server 结构化事件。
- 主界面新增 Codex App Server 控制台，显示 provider、adapter、protocol、status、threadId、turnId 和结构化事件。

## 2. 验证结果

自动化验证：

- `npm test`：通过，6 个单测全部通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run test:e2e`：通过，2 个 Chromium e2e 测试全部通过。

真实 Codex App Server 验证：

- runId：`run-1781870417092`
- provider：`codex`
- adapter：`Codex App Server`
- protocol：`json-rpc/stdio`
- threadId：`019edfc0-dbda-7c53-90d1-11225db9d27e`
- turnId：`019edfc0-dc26-7fc2-ba7e-6922b33e8282`
- 事件数：453
- 最终状态：`completed`
- CC 报告：`.agentbus/xiaowu-inbox/report-smallcalc-mvp-001.json`

真实报告确认：

- `ImplementationReport` 已写回。
- `didImplementSmallCalc` 为 `false`。
- 本轮仍符合“不提前实现 SmallCalc”的约束。

## 3. 自查与审计结论

通过。

关键链路已经从：

```text
小五 -> agentbus -> codex exec -> stdout/stderr -> report
```

改为：

```text
小五 -> agentbus -> CcAgentRunner -> CodexAppServerRunner -> codex app-server -> thread/turn/events -> report
```

这个结构满足用户提出的三个要求：

1. 使用 Codex App Server 启动和管理 CC。
2. 调用器接口已抽象，后续可增加 Qoder、Claude、Cursor 等实现。
3. 主界面已增加 Codex UI 显示区，便于查看 thread、turn、事件和状态。

## 4. 术语影响

新增并确认以下术语：

- `CC 调用器`：小五后端用于启动和管理不同 Coding Agent 的抽象层。
- `CodexAppServerRunner`：Codex 的第一版 CC 调用器实现。
- `Codex App Server 控制台`：主界面中展示 Codex provider、adapter、thread、turn 和结构化事件的区域。

未修改 SmallCalc 的产品定义。

## 5. 代码注释检查

已检查。

- `server/cc-runners.ts` 包含中文注释，说明 CC 调用器的架构边界和后续扩展方向。
- `src/App.tsx` 顶部注释已更新，说明当前默认 CC 实现是 Codex App Server，agentbus 仍是业务消息层。
- 未给普通展示逻辑添加无意义逐行注释。

## 6. 可能存在风险

1. Codex App Server 仍有 experimental 属性，协议字段未来可能变化。
2. 当前第一版为本地 stdio 调用器，没有做 WebSocket 长连接和多客户端管理。
3. 当前真实模式使用 `approvalPolicy: "never"` 和 `danger-full-access` 来完成本地探针，后续正式实现必须收紧为 `workspace-write` 或可审批模式。
4. 当前只跑通“小五发 TaskSpec -> Codex App Server turn -> CC 写报告”，尚未实现“小五驳回 -> 同一 thread 二次 turn -> CC 修复”的连续上下文验证。
5. 工作区中存在一份既有调研报告的未提交删除，本次未恢复也未提交该删除。

## 7. 需要请示的问题

1. 是否进入下一步：实现“小五验收不通过后，在同一个 Codex thread 里追加第二个 turn，让 CC 根据验收结果继续修复”。
2. 是否把真实模式权限从 `danger-full-access` 收紧为 `workspace-write + 审批 UI`。
3. 是否开始设计 Qoder / Claude / Cursor 调用器接口字段，还是等 Codex 跑通完整闭环后再扩展。
