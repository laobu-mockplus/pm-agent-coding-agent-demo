import { useEffect, useMemo, useState } from "react";

// 小五工作台的单页演示入口：小五先发 TaskSpec，再由 CC 调用器启动真实 Coding Agent。
// 当前默认 CC 实现是 Codex App Server；agentbus 仍保留为业务消息和审计记录层。
type WorkflowStatus = "waiting" | "active" | "done" | "failed" | "approved";

type WorkflowStep = {
  id: number;
  title: string;
  actor: "小五" | "CC";
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
  artifacts: Artifact[];
  tasks: Array<{ id: string; type: string; status: string }>;
  reports: Array<{ id: string; type: string; status: string; payload?: { summary?: string } }>;
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    configured: boolean;
  };
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

type Artifact = {
  id: string;
  stepId: number;
  actor: "小五" | "CC";
  type: string;
  title: string;
  status: string;
  summary: string;
  body: string;
  createdAt: string;
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
  },
  {
    id: 2,
    title: "小五给 CC 安排 MVP 任务",
    actor: "小五",
  },
  {
    id: 3,
    title: "CC 执行任务并提交报告",
    actor: "CC",
  },
  {
    id: 4,
    title: "小五第一次验收",
    actor: "小五",
  },
  {
    id: 5,
    title: "小五判定不通过并列出不合格项",
    actor: "小五",
  },
  {
    id: 6,
    title: "CC 根据验收结果修复并再次提交",
    actor: "CC",
  },
  {
    id: 7,
    title: "小五再次验收并通过",
    actor: "小五",
  },
];

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
  const [actionBusy, setActionBusy] = useState(false);
  const artifacts = agentBus?.artifacts ?? [];
  const latestArtifact = currentStepIndex >= 0
    ? [...artifacts].reverse().find((artifact) => artifact.stepId === workflowSteps[currentStepIndex].id)
    : artifacts.at(-1);
  const hasPrd = artifacts.some((artifact) => artifact.type === "PRD");
  const hasTaskSpec = artifacts.some((artifact) => artifact.type === "TaskSpec");
  const hasReport = (agentBus?.reports.length ?? 0) > 0;
  const hasReview = artifacts.some((artifact) => artifact.type === "ReviewResult");

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
  const nextActionLabel = !hasPrd
    ? "小五创建 PRD"
    : !hasTaskSpec
      ? "发送 TaskSpec 给 CC"
      : hasReport && !hasReview
        ? "小五验收报告"
        : agentBus?.run?.status === "running"
          ? "等待 CC 报告"
          : "等待真实下一步";
  const canRunAction = !actionBusy && (!hasPrd || !hasTaskSpec || (hasReport && !hasReview));

  function getStepStatus(step: WorkflowStep): WorkflowStatus {
    if (step.id === 1) return hasPrd ? "done" : "waiting";
    if (step.id === 2) return hasTaskSpec ? "done" : hasPrd ? "active" : "waiting";
    if (step.id === 3) {
      if (hasReport) return "done";
      if (agentBus?.run) return "active";
      return hasTaskSpec ? "active" : "waiting";
    }
    if (step.id === 4) return hasReview ? "done" : hasReport ? "active" : "waiting";
    if (step.id === 5) return hasReview ? "failed" : "waiting";
    return "waiting";
  }

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
    const endpoint = !hasPrd
      ? "/api/xiaowu/prd"
      : !hasTaskSpec
        ? "/api/agentbus/tasks/smallcalc"
        : hasReport && !hasReview
          ? "/api/xiaowu/review"
          : null;

    if (!endpoint) return;

    setActionBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `${endpoint} failed: ${response.status}`);
      }
      await refreshAgentBus();
      if (endpoint === "/api/xiaowu/prd") setCurrentStepIndex(0);
      if (endpoint === "/api/agentbus/tasks/smallcalc") setCurrentStepIndex(1);
      if (endpoint === "/api/xiaowu/review") setCurrentStepIndex(3);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "执行失败");
    } finally {
      setActionBusy(false);
    }
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

    if (hasReview) {
      setCurrentStepIndex(4);
      return;
    }

    if (hasReport) {
      setCurrentStepIndex(2);
      return;
    }

    if (hasTaskSpec) {
      setCurrentStepIndex(1);
      return;
    }

    if (hasPrd) {
      setCurrentStepIndex(0);
    }
  }, [agentBus, currentStepIndex, hasPrd, hasReport, hasReview, hasTaskSpec]);

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
            disabled={!canRunAction}
            onClick={() => void advanceWorkflow()}
            type="button"
          >
            {actionBusy ? "小五处理中..." : nextActionLabel}
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
              const status = getStepStatus(step);
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
            <span className={`state-pill ${latestArtifact ? "done" : "waiting"}`}>
              {latestArtifact?.status ?? "等待真实产出"}
            </span>
          </div>

          <article className="artifact-document" aria-label="当前步骤产出物">
            <div className="artifact-document-header">
              <div>
                <p className="eyebrow">{latestArtifact ? `Step ${latestArtifact.stepId} · ${latestArtifact.actor}` : "Ready"}</p>
                <h3>{latestArtifact?.title ?? "尚未生成产出物"}</h3>
              </div>
              <span>{latestArtifact?.type ?? "等待小五发令"}</span>
            </div>

            <div className="artifact-body">
              <p>{latestArtifact?.body ?? "当前还没有 PRD、TaskSpec 或报告。点击“小五创建 PRD”后，小五会通过真实 LLM 生成第一份产出物。"}</p>
            </div>

            <div className="artifact-output-list">
              {[
                agentBus?.llm?.configured ? `LLM: ${agentBus.llm.provider} / ${agentBus.llm.model}` : "LLM 未配置",
                latestArtifact ? latestArtifact.type : "等待真实产出",
                latestArtifact ? latestArtifact.createdAt : "无预置结果",
              ].map((item) => (
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
