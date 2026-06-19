# Codex App Server 深度调研报告

生成时间：2026-06-19 19:43:29 CST  
调研对象：小五 PM Agent 与 CC Coding Agent 的真实通信机制  
调研结论：建议将当前 `agentbus + codex exec` 的执行层，升级为 `agentbus + Codex App Server Adapter`。

## 1. 结论先行

Codex App Server 是更适合“小五控制 CC”的官方机制。它不是一次性命令执行工具，而是 Codex 给富客户端使用的长期控制协议，目标能力包括会话历史、审批、实时事件流、线程恢复、文件变更与命令执行状态。

当前 demo 已经证明了“小五可以真实唤起 CC”：小五写入 `.agentbus/cc-inbox`，本地 orchestrator 启动 `codex exec`，CC 写回 `.agentbus/xiaowu-inbox`。但这个机制更像脚本自动化，适合验证链路，不适合长期承载一个 PM Agent 产品。

建议下一阶段不要直接全量重构，而是先做一个技术 Spike：

1. 保留 `.agentbus` 作为业务审计层。
2. 新增 `CodexAppServerAdapter` 作为 CC 执行层。
3. 用 `codex app-server` 创建 thread 和 turn。
4. UI 直接展示结构化事件，而不是解析 stdout/stderr。
5. 验证“小五驳回后，CC 是否能在同一个 thread 中继续修复”。

## 2. 信息来源

本次调研只使用官方 OpenAI/Codex 文档和本机 Codex CLI 生成的协议 schema。

官方资料：

- OpenAI Codex App Server 文档：<https://developers.openai.com/codex/app-server>
- OpenAI Codex SDK 文档：<https://developers.openai.com/codex/sdk>
- OpenAI Codex Non-interactive mode 文档：<https://developers.openai.com/codex/noninteractive>
- OpenAI Codex CLI command line options 文档：<https://developers.openai.com/codex/cli/reference>
- OpenAI Codex Agent approvals & security 文档：<https://developers.openai.com/codex/agent-approvals-security>
- OpenAI Codex environment variables 文档：<https://developers.openai.com/codex/environment-variables>

本机验证：

```bash
codex app-server --help
codex app-server generate-json-schema --experimental --out /tmp/codex-app-server-schema
```

验证结果：本机 Codex CLI 支持 `app-server`、`generate-ts`、`generate-json-schema`，并成功生成了 v1/v2 JSON Schema。

项目规则检查：按照 `/Users/mockplus/X5-s/AGENTS.md` 要求，已检查项目级 `pskill.md`；在 `/Users/mockplus/X5-s` 三层范围内未发现该文件。

## 3. Codex App Server 是什么

官方定位是：把 Codex 嵌入到自己的产品中，服务于富客户端集成。它是 Codex App、IDE 扩展等产品形态背后的控制协议之一。

关键点：

- 协议：JSON-RPC 2.0，但 wire format 省略 `"jsonrpc": "2.0"` 字段。
- 默认传输：`stdio://`，使用 JSONL。
- 其他传输：`ws://IP:PORT`、`unix://`、`off`。
- WebSocket：官方标注为 experimental and unsupported；本地或 SSH port-forward 场景可用，但远程暴露必须额外配置认证。
- 工作流：客户端先 `initialize`，再发送 `initialized` notification，然后 `thread/start`、`turn/start`，并持续读取 server notifications。

这说明 App Server 不是“让 CC 监听文件”的机制，而是“小五作为客户端，主动控制 CC 的 Codex runtime”。

## 4. 和 `codex exec` 的差异

`codex exec` 的官方定位是 non-interactive mode，适合脚本和 CI。它可以输出 JSONL，也可以约束最终结构化输出，但核心仍是一轮命令式执行。

对小五项目的影响：

| 维度 | 当前 `codex exec` | Codex App Server |
| --- | --- | --- |
| 执行模型 | 一次性进程 | 长期 server + thread/turn |
| 上下文 | 每次主要依赖 prompt 和落盘文件 | thread 可恢复，可继续 turn |
| UI 事件 | stdout/stderr，需要解析 | 结构化 `thread/*`、`turn/*`、`item/*` |
| 审批 | 适合预设 `-a never` 或人工 CLI | server request 形式交给客户端决策 |
| 文件变更 | 只能从日志或 git diff 推断 | `fileChange` item 和 `turn/diff/updated` |
| 命令输出 | stderr/stdout 捕获 | `item/commandExecution/outputDelta` |
| 小五验收循环 | 每轮新起 CC，不天然连续 | 同一 thread 后续 turn 更自然 |
| 产品化程度 | 适合 MVP 探针 | 适合正式小五工作台 |

结论：当前机制是正确的第一步，但不是最终执行内核。

## 5. 协议能力拆解

### 5.1 Thread 生命周期

本机 schema 显示 client request 包含：

- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/read`
- `thread/list`
- `thread/turns/list`
- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`
- `thread/metadata/update`

对小五的意义：

- 一个 PRD 可以对应一个 thread。
- 小五给 CC 的每一次任务、验收不通过、修复要求，可以对应同一个 thread 的多个 turn。
- 这样 CC 不需要靠外部文件重新拼接全部上下文，也能沿用之前对 PRD、代码、验收意见的理解。

### 5.2 Turn 生命周期

本机 schema 显示 `turn/start` 的核心参数包括：

- `threadId`
- `input`
- `cwd`
- `model`
- `approvalPolicy`
- `approvalsReviewer`
- `sandboxPolicy`
- `permissions`
- `outputSchema`

对小五的意义：

- 小五可以在每个 turn 指定 CC 工作目录，也就是目标 repo。
- 小五可以按任务风险设置 sandbox，例如只读评审、workspace-write 实现、特定场景才 danger-full-access。
- 小五可以要求结构化最终输出，便于验收。

### 5.3 事件流

官方文档说明，客户端启动或恢复 thread 后，需要持续读取事件流。关键事件包括：

- `thread/started`
- `thread/status/changed`
- `turn/started`
- `turn/completed`
- `turn/diff/updated`
- `turn/plan/updated`
- `thread/tokenUsage/updated`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/commandExecution/outputDelta`
- `serverRequest/resolved`

对 UI 的意义：

- 小五工作台不再显示“伪阶段”，而是可以显示 CC 的真实执行状态。
- 命令输出可以按 `commandExecution` 展示。
- 文件修改可以按 `fileChange` 和 diff 展示。
- 计划变更可以按 `turn/plan/updated` 展示。
- 最终报告可以从 `agentMessage` 或结构化输出中生成。

### 5.4 Item 类型

官方文档列出的常见 `ThreadItem` 包括：

- `userMessage`
- `agentMessage`
- `plan`
- `reasoning`
- `commandExecution`
- `fileChange`
- `mcpToolCall`
- `dynamicToolCall`
- `webSearch`
- `imageView`
- `contextCompaction`

对小五的意义：

- 小五可以把 CC 执行过程拆成“读需求、计划、命令、文件修改、测试、报告”这些真实 item。
- 验收时不必只看 CC 自述，还可以看命令、diff、测试输出等证据。

### 5.5 审批机制

App Server 支持 server-initiated request，也就是 server 主动向客户端请求决策。

本机 schema 和官方文档都确认了几类请求：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `item/tool/call`
- `item/permissions/requestApproval`

命令审批决策包括：

- `accept`
- `acceptForSession`
- `decline`
- `cancel`
- 带 exec policy amendment 的 accept

文件变更审批决策包括：

- `accept`
- `acceptForSession`
- `decline`
- `cancel`

对小五的意义：

- 小五可以成为审批主体，而不只是旁观日志。
- 例如 CC 要运行破坏性命令、访问网络、修改仓库外文件时，小五 UI 可以要求老布确认，或由小五策略自动拒绝。
- 这比 `-a never` 更适合真实产品。

## 6. 对小五 8 步流程的映射

用户定义的流程是：

1. 小五创建 SmallCalc PRD。
2. 小五给 CC 安排 MVP 任务。
3. CC 完成后提交报告。
4. 小五验收。
5. 小五判定不通过并列出不合格项。
6. CC 根据验收结果改进。
7. CC 再次提交。
8. 小五验收通过。

用 App Server 映射后：

| 小五流程 | App Server 机制 |
| --- | --- |
| 创建 PRD | 小五本地生成 PRD 文件，并记录到 `.agentbus` |
| 安排任务 | `thread/start` 创建 CC thread，`turn/start` 发送 TaskSpec |
| CC 执行 | 订阅 `item/*`、`turn/*` 事件 |
| CC 提交报告 | `agentMessage` final 或结构化 `outputSchema` |
| 小五验收不通过 | 小五读取 diff、测试、报告，生成 ReviewResult |
| CC 改进 | 同一 `threadId` 再发一个 `turn/start` |
| CC 再提交 | 同一 thread 继续产出报告 |
| 小五验收通过 | 小五记录 Approval，必要时触发 PR/GitHub 后续动作 |

这比当前每次 `codex exec` 新进程更贴近真实 PM/工程循环。

## 7. 建议架构

建议采用三层结构：

```text
小五 UI
  |
  | HTTP / SSE
  v
小五 Backend / Orchestrator
  |
  | 业务消息审计
  v
.agentbus
  |
  | 执行适配
  v
CodexAppServerAdapter
  |
  | JSON-RPC over stdio
  v
codex app-server
  |
  v
目标 Git 仓库 / 工作区
```

### 7.1 `.agentbus` 仍然保留

原因：

- 它是小五和 CC 的业务消息审计层。
- 它能保存 TaskSpec、ReviewResult、ImplementationReport、Approval。
- 即使未来更换执行引擎，业务消息模型仍然稳定。

### 7.2 执行层替换

当前：

```text
TaskSpec -> spawn codex exec -> stdout/stderr -> report file
```

建议：

```text
TaskSpec -> app-server thread/turn -> structured events -> report + evidence
```

### 7.3 UI 展示变化

当前 UI 的 `CC 执行台` 显示 run events。升级后建议显示：

- Thread ID
- Turn ID
- 当前 turn status
- plan updates
- commandExecution items
- command output deltas
- fileChange items
- diff updates
- approval requests
- final agent message
- token usage

## 8. 传输方式建议

第一阶段建议使用 `stdio://`。

理由：

- 官方默认传输。
- 无需端口管理。
- 无需 WebSocket 认证。
- 最适合本地 Vite/Node orchestrator 作为父进程启动 `codex app-server`。

第二阶段再评估 `ws://127.0.0.1:PORT`。

只有当我们需要多个客户端同时连接、独立后端进程长期运行、或跨进程复用 app-server 时，才值得切 WebSocket。官方明确提示 WebSocket 仍是 experimental and unsupported，不能贸然作为正式远程暴露机制。

## 9. SDK 是否更适合

官方 Codex SDK 也是一个选择。文档说明 SDK 可用于在应用中控制本地 Codex agents，并且比 non-interactive mode 更完整灵活。

判断：

- 如果我们只要“发任务、拿最终结果”，SDK 更快。
- 如果我们要“小五 UI 完整显示 CC 执行过程、审批、文件变更、命令输出、turn 状态”，直接对接 App Server 更透明。
- Python SDK 文档明确提到它通过 JSON-RPC 控制本地 app-server，因此 SDK 本质上可以视为 app-server 的上层封装。

建议：

- 技术 Spike 直接用 raw `codex app-server`，学习完整协议。
- 后续如果 SDK 已覆盖我们需要的事件和审批能力，再评估是否用 SDK 降低维护成本。

## 10. 安全与权限建议

不要在正式小五里默认使用 `danger-full-access`。

建议权限策略：

| 场景 | sandbox | approvalPolicy |
| --- | --- | --- |
| 读取 PRD、理解仓库、给计划 | `read-only` | `on-request` |
| 修改目标 repo 内文件 | `workspace-write` | `on-request` |
| 运行测试、构建 | `workspace-write` | `on-request` |
| 网络访问、安装依赖 | 默认禁止，必要时审批 | `on-request` |
| 危险清理、跨目录写入 | 不自动允许 | 必须人工确认 |

官方安全文档强调 sandbox mode 和 approval policy 是两层控制：前者决定技术上能做什么，后者决定什么时候必须询问用户。这正适合小五成为“PM 审批者”。

## 11. 最小技术 Spike 定义

Spike 名称：`Codex App Server Adapter Spike`

验收目标：

1. Node 后端能启动 `codex app-server`。
2. 能完成 `initialize` 和 `initialized`。
3. 能 `thread/start`，指定 `cwd` 为 SmallCalc 目标仓库。
4. 能 `turn/start`，发送一条“小五 TaskSpec”。
5. 能把 `thread/*`、`turn/*`、`item/*` 事件写入 `.agentbus/runs/<runId>/events.jsonl`。
6. UI 能实时显示结构化事件。
7. CC 能产出一份结构化 ImplementationReport。
8. 小五能在同一 `threadId` 里追加一个“验收不通过，请修复”的 turn。
9. 第二个 turn 能看到上一轮上下文，并提交修复报告。

不建议在 Spike 中同时做：

- GitHub PR 创建。
- 完整 SmallCalc 实现。
- 多用户权限系统。
- 远程 WebSocket server。
- 复杂审批策略自动化。

原因：先验证 app-server thread/turn/事件/上下文连续性，避免一次性引入太多变量。

## 12. 主要风险

### 12.1 协议仍有 experimental 部分

本机 CLI 和官方文档都把 `app-server` 标注为 experimental，WebSocket 也标注为 experimental and unsupported。必须把适配层做薄，避免协议字段变动时影响小五业务模型。

缓解方式：

- 使用 `codex app-server generate-ts` 或 `generate-json-schema` 固化当前版本类型。
- 把协议类型封装在 `CodexAppServerAdapter` 内部。
- `.agentbus` 只存小五自己的稳定业务事件，不直接暴露完整 app-server 原始结构。

### 12.2 审批流复杂

App Server 会主动发起 server request，客户端必须响应，否则 turn 可能挂起。

缓解方式：

- Spike 阶段先用 `approvalPolicy: "never"` 或低风险只读任务验证主链路。
- 第二阶段再加入 `on-request` 审批 UI。
- 所有 pending approval 必须在 UI 中有明确状态。

### 12.3 权限与 cwd 边界必须严格

小五需要确保 CC 工作在正确 repo 和正确分支。App Server 支持 thread/turn 层面的 `cwd`，但业务上仍要做防护。

缓解方式：

- 小五 Backend 维护目标 repo allowlist。
- 每个 TaskSpec 明确 `targetRepo.localPath`、`baseBranch`、`workBranch`。
- Adapter 在 `thread/start` 和 `turn/start` 时都写入明确 `cwd`。

### 12.4 事件量可能较大

真实 CC 执行时事件量会明显多于当前 demo。UI 如果逐条全量渲染，可能变慢或难读。

缓解方式：

- 原始事件落盘。
- UI 做事件聚合：命令、文件、计划、报告分组。
- 默认折叠低价值日志。

## 13. 推荐下一步

建议立刻进入 `Codex App Server Adapter Spike`，但保持范围极小。

实施顺序：

1. 新增 `server/codexAppServerAdapter.ts`。
2. 用 stdio 启动 `codex app-server`。
3. 实现 JSON-RPC request/response id 路由。
4. 实现 notification 订阅和事件落盘。
5. 替换当前 `startCcWorker()` 的内部执行方式，但保留 `.agentbus` 对外协议。
6. UI 先只增加 App Server 原始事件视图。
7. 跑通“小五发 TaskSpec -> CC 回报告”。
8. 再跑通“小五驳回 -> 同 thread 二次 turn -> CC 再报告”。

这会让小五从“能叫醒 CC”的 demo，进入“能持续管理 CC 工作”的产品雏形。

## 14. 本次调研自查

任务完成情况：

- 已阅读 OpenAI Codex App Server 相关官方文档。
- 已对比 `codex exec`、Codex SDK、Codex App Server 的适用边界。
- 已使用本机 Codex CLI 生成 JSON Schema，并抽取关键方法与字段。
- 已形成小五架构迁移建议。

验证结果：

- `codex app-server --help`：通过。
- `codex app-server generate-json-schema --experimental --out /tmp/codex-app-server-schema`：通过。
- 本机 schema 确认存在 `thread/start`、`turn/start`、`item/*`、审批请求、文件系统请求等能力。

术语影响：

- 建议新增核心术语：`Codex App Server Adapter`，中文可称“小五 CC 执行适配器”。
- 建议保留 `agentbus` 作为业务通信审计层，不把它和 App Server 协议混为一谈。

代码注释检查：

- 本次仅新增调研文档，没有修改核心代码。

可能存在风险：

- App Server 和部分 schema 字段仍带 experimental 属性。
- WebSocket transport 不宜作为第一阶段正式方案。
- 审批流如果未处理完整，可能导致 CC turn 挂起。

需要请示的问题：

- 是否批准进入 `Codex App Server Adapter Spike`。
- Spike 是否仍以 SmallCalc 为测试任务。
- 第一阶段是否允许继续保留 `.agentbus`，只替换 CC 执行层。
