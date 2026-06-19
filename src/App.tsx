import { useEffect, useMemo, useState } from "react";

// 小五工作台的单页演示入口：小五先发 TaskSpec，再由 CC 调用器启动真实 Coding Agent。
// 当前默认 CC 实现是 Codex App Server；agentbus 仍保留为业务消息和审计记录层。
type WorkflowStatus = "waiting" | "active" | "done" | "failed" | "approved";

type WorkflowStep = {
  id: number;
  title: string;
  actor: "小五" | "CC";
  statusAfterRun: WorkflowStatus;
  summary: string;
  artifactTitle: string;
  artifactBody: string;
  evidence: string[];
  result: string;
};

type CommunicationMessage = {
  id: string;
  stepId: number;
  from: "小五" | "CC";
  to: "小五" | "CC";
  type: string;
  channel: string;
  status: string;
  payload: string[];
};

type RunEvent = {
  at: string;
  type: string;
  text?: string;
  status?: string;
  code?: number | null;
  method?: string;
  threadId?: string;
  turnId?: string;
  itemType?: string;
};

type AgentBusState = {
  messages: CommunicationMessage[];
  run: {
    id: string;
    status: string;
    targetRepo: string;
    runner: {
      provider: string;
      adapter: string;
      protocol: string;
      mode: string;
      status: string;
      threadId?: string;
      turnId?: string;
      pid?: number;
    } | null;
    events: RunEvent[];
  } | null;
};

type ChatItem = {
  id: string;
  speaker: "小五" | "CC" | "Codex";
  tone: "xiaowu" | "cc" | "system";
  title: string;
  body: string;
  meta: string;
};

const workflowSteps: WorkflowStep[] = [
  {
    id: 1,
    title: "小五创建 SmallCalc PRD",
    actor: "小五",
    statusAfterRun: "done",
    summary: "把“做一个计算器 app”的意图整理成产品目标、范围和验收标准。",
    artifactTitle: "PRD v0.1",
    artifactBody: "SmallCalc 是一个基础计算器 MVP，需要支持四则运算、小数、清空、退格、历史记录和键盘输入。",
    evidence: ["docs/smallcalc-prd.md", "验收标准 AC-1 到 AC-8 已定义", "目标应用：SmallCalc"],
    result: "小五已生成 PRD，尚未产生 SmallCalc 程序代码。",
  },
  {
    id: 2,
    title: "小五给 CC 安排 MVP 任务",
    actor: "小五",
    statusAfterRun: "done",
    summary: "小五把 PRD 转成 TaskSpec，并通过 CC 调用器交给 Codex App Server。",
    artifactTitle: "TaskSpec",
    artifactBody: "本轮先验证调用器链路：CC 必须通过 Codex App Server thread/turn 接收任务，并写回 ImplementationReport。",
    evidence: [".agentbus/cc-inbox", "调用器：Codex App Server", "协议：JSON-RPC stdio"],
    result: "小五已写入真实 TaskSpec，orchestrator 开始通过 Codex App Server 管理 CC。",
  },
  {
    id: 3,
    title: "CC 执行任务并提交报告",
    actor: "CC",
    statusAfterRun: "done",
    summary: "CC 由 Codex App Server thread/turn 管理，读取 TaskSpec，并把真实报告写回小五 inbox。",
    artifactTitle: "ImplementationReport",
    artifactBody: "本轮报告只证明通信和执行链路：CC 已读到任务，未实现 SmallCalc，等待小五验收链路。",
    evidence: [".agentbus/xiaowu-inbox", "Codex thread/turn 已捕获", "结构化 item events 已写入"],
    result: "CC 报告已提交，等待小五验收通信链路。",
  },
  {
    id: 4,
    title: "小五第一次验收",
    actor: "小五",
    statusAfterRun: "active",
    summary: "小五先验收通信链路是否成立，再决定是否进入真实 SmallCalc 实现。",
    artifactTitle: "验收检查表",
    artifactBody: "通信链路要求：TaskSpec 真实落盘、Codex App Server 真实启动、结构化事件可见、ImplementationReport 真实写回。",
    evidence: ["检查 cc-inbox", "检查 Codex thread/turn", "检查 xiaowu-inbox"],
    result: "发现不合格项，准备给出不通过判定。",
  },
  {
    id: 5,
    title: "小五判定不通过并列出不合格项",
    actor: "小五",
    statusAfterRun: "failed",
    summary: "小五在 PR 上给出 changes requested，并明确 CC 必须修复 AC-6。",
    artifactTitle: "XiaoWu PM Review",
    artifactBody: "不通过项：AC-6 Keyboard input。要求补齐数字键、小数点、运算符、Enter、Backspace、Escape。",
    evidence: ["PR comment: Changes Requested", "label: xiaowu:changes-requested", "失败原因可追踪"],
    result: "验收不通过，CC 进入修复。",
  },
  {
    id: 6,
    title: "CC 根据验收结果修复并再次提交",
    actor: "CC",
    statusAfterRun: "done",
    summary: "CC 补齐键盘输入，并把键盘操作复用到同一套计算器逻辑。",
    artifactTitle: "第二次 CC Implementation Report",
    artifactBody: "新增 KeyboardEvent.key 到 CalculatorButton 的映射，补充 AC-6 测试，PR body 更新为全 AC 通过。",
    evidence: ["模拟修复提交", "模拟 npm test：passed", "模拟 npm run build：passed", "AC-6 测试已覆盖"],
    result: "CC 修复报告已提交，等待小五最终验收。",
  },
  {
    id: 7,
    title: "小五再次验收并通过",
    actor: "小五",
    statusAfterRun: "approved",
    summary: "小五重新运行测试和构建，确认 8 条 AC 全部通过。",
    artifactTitle: "XiaoWu PM Review: Approved",
    artifactBody: "SmallCalc MVP is approved。模拟 PR 进入 xiaowu:approved 状态。",
    evidence: ["模拟 npm test：passed", "模拟 npm run build：passed", "模拟 PR comment: Approved", "label: xiaowu:approved"],
    result: "流程完成，小五 PM Agent demo 通过。",
  },
];

function getStepStatus(stepIndex: number, currentStepIndex: number): WorkflowStatus {
  if (stepIndex > currentStepIndex) {
    return "waiting";
  }

  return workflowSteps[stepIndex].statusAfterRun;
}

function statusLabel(status: WorkflowStatus) {
  const labels: Record<WorkflowStatus, string> = {
    waiting: "待执行",
    active: "验收中",
    done: "完成",
    failed: "不通过",
    approved: "通过",
  };

  return labels[status];
}

export default function App() {
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [agentBus, setAgentBus] = useState<AgentBusState | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const currentStep = currentStepIndex >= 0 ? workflowSteps[currentStepIndex] : null;

  const codexEvents = useMemo(
    () => (agentBus?.run?.events ?? []).filter((event) => event.type === "codex-event" || event.type === "codex-request"),
    [agentBus?.run?.events],
  );
  const chatItems = useMemo<ChatItem[]>(() => {
    const messageItems = (agentBus?.messages ?? []).map((message) => ({
      id: message.id,
      speaker: message.from,
      tone: message.from === "小五" ? ("xiaowu" as const) : ("cc" as const),
      title: message.type,
      body: message.payload.join("\n"),
      meta: `${message.status} · ${message.channel}`,
    }));
    const eventItems = codexEvents.slice(-18).map((event, index) => ({
      id: `${event.at}-${index}`,
      speaker: "Codex" as const,
      tone: "system" as const,
      title: event.method ?? event.type,
      body: event.itemType ? `${event.itemType} · ${event.text ?? event.status ?? ""}` : event.text ?? event.status ?? "运行中",
      meta: event.turnId ?? event.threadId ?? agentBus?.run?.id ?? "runtime",
    }));

    return [...messageItems, ...eventItems];
  }, [agentBus?.messages, agentBus?.run?.id, codexEvents]);
  const canGoNext = currentStepIndex < workflowSteps.length - 1;
  const visibleStatus = currentStep ? statusLabel(currentStep.statusAfterRun) : "待小五发令";
  const nextActionLabel =
    currentStepIndex < 0
      ? "开始：小五创建 PRD"
      : currentStepIndex === 0
        ? "发送 TaskSpec 给 CC"
        : canGoNext
          ? "执行下一步"
          : "流程已完成";

  async function refreshAgentBus() {
    try {
      const response = await fetch("/api/agentbus/state");

      if (!response.ok) {
        throw new Error(`agentbus state failed: ${response.status}`);
      }

      setAgentBus(await response.json());
      setApiError(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "无法读取 agentbus");
    }
  }

  async function resetWorkflow() {
    setCurrentStepIndex(-1);

    try {
      await fetch("/api/agentbus/reset", { method: "POST" });
      await refreshAgentBus();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "无法重置 agentbus");
    }
  }

  async function advanceWorkflow() {
    if (currentStepIndex === 0) {
      setCurrentStepIndex(1);

      try {
        const response = await fetch("/api/agentbus/tasks/smallcalc", { method: "POST" });

        if (!response.ok) {
          throw new Error(`send task failed: ${response.status}`);
        }

        await refreshAgentBus();
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "无法发送 TaskSpec");
      }
      return;
    }

    setCurrentStepIndex((step) => Math.min(step + 1, workflowSteps.length - 1));
  }

  useEffect(() => {
    void refreshAgentBus();
    const timer = window.setInterval(() => {
      void refreshAgentBus();
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (currentStepIndex !== -1 || !agentBus) {
      return;
    }

    if (agentBus.messages.some((message) => message.type === "ImplementationReport")) {
      setCurrentStepIndex(2);
      return;
    }

    if (agentBus.messages.some((message) => message.type === "TaskSpec")) {
      setCurrentStepIndex(1);
    }
  }, [agentBus, currentStepIndex]);

  return (
    <main className="app-shell" aria-labelledby="app-title">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            小五
          </span>
          <div>
            <p className="eyebrow">PM Agent Workbench</p>
            <h1 id="app-title">小五工作台：SmallCalc MVP 验收演示</h1>
          </div>
        </div>

        <div className="run-controls" aria-label="流程控制">
          <button
            className="secondary"
            onClick={() => void resetWorkflow()}
            type="button"
          >
            重置
          </button>
          <button
            className="primary"
            disabled={!canGoNext}
            onClick={() => void advanceWorkflow()}
            type="button"
          >
            {nextActionLabel}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="timeline-panel" aria-labelledby="timeline-title">
          <div className="panel-heading">
            <p className="eyebrow">Replay</p>
            <h2 id="timeline-title">7 步流程</h2>
          </div>

          <ol className="timeline">
            {workflowSteps.map((step, index) => {
              const status = getStepStatus(index, currentStepIndex);
              const isCurrent = index === currentStepIndex;

              return (
                <li className={isCurrent ? "timeline-item current" : "timeline-item"} key={step.id}>
                  <button
                    aria-current={isCurrent ? "step" : undefined}
                    onClick={() => setCurrentStepIndex(index)}
                    type="button"
                  >
                    <span className={`status-dot ${status}`} aria-hidden="true" />
                    <span className="step-copy">
                      <span className="step-title">{step.title}</span>
                      <span className="step-meta">{`${step.actor} · ${statusLabel(status)}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="detail-panel artifact-viewer" aria-labelledby="detail-title">
          <div className="detail-header artifact-viewer-head">
            <div>
              <p className="eyebrow">Artifact Viewer</p>
              <h2 id="detail-title">产出物</h2>
            </div>
            <span className={`state-pill ${currentStep?.statusAfterRun ?? "waiting"}`}>
              {visibleStatus}
            </span>
          </div>

          <article className="artifact-document" aria-label="当前步骤产出物">
            <div className="artifact-document-header">
              <div>
                <p className="eyebrow">{currentStep ? `Step ${currentStep.id} · ${currentStep.actor}` : "Ready"}</p>
                <h3>{currentStep?.artifactTitle ?? "尚未生成产出物"}</h3>
              </div>
              <span>{currentStep?.title ?? "等待小五发令"}</span>
            </div>

            <div className="artifact-body">
              <p>{currentStep?.artifactBody ?? "当前还没有 PRD、TaskSpec 或报告。点击“开始：小五创建 PRD”后，小五才会生成第一份产出物。"}</p>
            </div>

            <div className="artifact-output-list">
              {(currentStep?.evidence ?? ["SmallCalc 尚未开始实现", "等待小五生成 PRD"]).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </article>
        </section>

        <aside className="comm-panel chat-panel" aria-labelledby="comm-title">
          <div className="panel-heading">
            <p className="eyebrow">Conversation</p>
            <h2 id="comm-title">小五 / CC 会话</h2>
          </div>

          <div className="chat-list" aria-label="小五和 CC 会话消息">
            {apiError ? (
              <article className="chat-empty warning">
                <strong>agentbus 暂不可读</strong>
                <p>{apiError}</p>
              </article>
            ) : null}

            {agentBus?.run ? (
              <section className="runtime-strip" aria-label="Codex App Server 状态">
                <span>{agentBus.run.runner?.adapter ?? "Codex App Server"}</span>
                <strong>{agentBus.run.runner?.status ?? agentBus.run.status}</strong>
                <em>{agentBus.run.runner?.threadId ?? "thread pending"}</em>
              </section>
            ) : null}

            {chatItems.length > 0 ? (
              chatItems.map((item) => (
                <article className={`chat-message ${item.tone}`} key={item.id}>
                  <div className="chat-avatar" aria-hidden="true">
                    {item.speaker}
                  </div>
                  <div className="chat-bubble">
                    <div className="chat-meta">
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </div>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))
            ) : (
              <article className="chat-empty">
                <strong>尚未通信</strong>
                <p>当前没有 TaskSpec 发给 CC；SmallCalc 不会提前开始实现。</p>
              </article>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
