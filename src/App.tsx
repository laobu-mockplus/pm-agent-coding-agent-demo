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

type XiaowuSettings = {
  ccPersona: {
    profileName: string;
    displayName: string;
    executionPersona: string;
    uiDisplayPersona: string;
    communicationStyle: "concise" | "detailed" | "debug";
    showTechnicalEvents: boolean;
  };
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
    proxy?: {
      enabled: boolean;
      url?: string;
    };
  };
  settings: XiaowuSettings;
  orchestrator: {
    status: "idle" | "running" | "completed" | "failed" | "cancelled";
    phase: string;
    startedAt?: string;
    updatedAt: string;
    error?: string;
  } | null;
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
  speaker: string;
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

const ccPersonaPresets: Array<{
  id: string;
  label: string;
  executionPersona: string;
  uiDisplayPersona: string;
  communicationStyle: XiaowuSettings["ccPersona"]["communicationStyle"];
}> = [
  {
    id: "senior",
    label: "严谨资深工程师",
    executionPersona:
      "你是 CC，一个严谨的资深 Coding Agent。你必须真实读取任务、真实修改目标仓库、真实运行验证命令，并如实报告成功、失败和阻塞。不得用 mock、占位文件或只补报告冒充完成。",
    uiDisplayPersona:
      "在小五工作台中，用简洁中文展示 CC 的关键动作。隐藏对用户无意义的协议事件和长 ID；保留命令执行、文件修改、错误、报告提交和任务完成等关键信息。",
    communicationStyle: "concise",
  },
  {
    id: "test-first",
    label: "测试优先工程师",
    executionPersona:
      "你是 CC，一个测试优先的 Coding Agent。你先澄清验收标准，再优先补充或运行验证命令，随后实现代码。任何通过结论都必须有测试、构建或可复现检查支撑。",
    uiDisplayPersona:
      "在小五工作台中，用中文优先展示验证相关进展：准备检查什么、运行了什么命令、结果是什么、还缺什么证据。",
    communicationStyle: "detailed",
  },
  {
    id: "repair",
    label: "审慎修复工程师",
    executionPersona:
      "你是 CC，一个审慎修复型 Coding Agent。你只改动完成任务必需的文件，避免无关重构；遇到不确定、权限不足或外部依赖失败时，必须停止伪装并写明阻塞。",
    uiDisplayPersona:
      "在小五工作台中，用中文突出修复动作、影响范围和剩余风险。隐藏底层协议日志，只展示用户能判断进度的信息。",
    communicationStyle: "concise",
  },
  {
    id: "debug",
    label: "调试透明工程师",
    executionPersona:
      "你是 CC，一个调试透明的 Coding Agent。你真实执行任务，并在关键节点说明正在调用的命令、读取的文件、遇到的错误和下一步判断。",
    uiDisplayPersona:
      "在小五工作台中，保留更多技术进度，用中文解释每条关键运行事件的意义；必要时展示底层事件，便于排查调用器问题。",
    communicationStyle: "debug",
  },
];

const defaultSettings: XiaowuSettings = {
  ccPersona: {
    profileName: ccPersonaPresets[0].label,
    displayName: "CC",
    executionPersona: ccPersonaPresets[0].executionPersona,
    uiDisplayPersona: ccPersonaPresets[0].uiDisplayPersona,
    communicationStyle: "concise",
    showTechnicalEvents: false,
  },
};

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

function shouldShowCodexEvent(event: RunEvent, showTechnicalEvents: boolean) {
  const method = event.method ?? "";

  if (!showTechnicalEvents) {
    if (
      method.startsWith("mcpServer/") ||
      method.startsWith("account/") ||
      method === "thread/status/changed" ||
      method === "thread/tokenUsage/updated" ||
      method === "turn/diff/updated" ||
      event.type === "codex-request"
    ) {
      return false;
    }
  }

  if (method === "item/agentMessage/delta" || method === "item/reasoning/delta") {
    return false;
  }

  if (method.endsWith("/delta") && event.itemType !== "commandExecution") {
    return false;
  }

  if (method === "thread/tokenUsage/updated") {
    return false;
  }

  return true;
}

function humanizeCodexEvent(event: RunEvent, showTechnicalEvents: boolean) {
  const method = event.method ?? event.type;
  const body = event.text ?? event.status ?? "运行中";

  if (event.itemType === "agentMessage") {
    return { title: "CC 进度", body };
  }

  if (event.itemType === "commandExecution") {
    return { title: "CC 正在运行命令", body };
  }

  if (event.itemType === "fileChange") {
    return { title: "CC 修改了文件", body: body.replace(/^fileChange\s*:?/i, "").trim() || "已产生文件变更" };
  }

  if (method === "thread/started") {
    return { title: "CC 会话已建立", body: "Coding Agent 已准备接收小五的任务。" };
  }

  if (method === "turn/started") {
    return { title: "CC 开始执行任务", body: "正在处理小五发来的任务。" };
  }

  if (method === "turn/completed") {
    return { title: "CC 本轮执行完成", body: event.status === "failed" ? "本轮执行失败，等待查看错误信息。" : "本轮任务已经结束，等待报告或验收。" };
  }

  if (showTechnicalEvents) {
    return { title: method, body };
  }

  return { title: "CC 运行状态", body };
}

export default function App() {
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [agentBus, setAgentBus] = useState<AgentBusState | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<XiaowuSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const settings = agentBus?.settings ?? defaultSettings;
  const artifacts = agentBus?.artifacts ?? [];
  const selectedStepArtifact =
    currentStepIndex >= 0
      ? [...artifacts].reverse().find((artifact) => artifact.stepId === workflowSteps[currentStepIndex].id)
      : undefined;
  const latestArtifact = selectedStepArtifact ?? artifacts.at(-1);
  const hasPrd = artifacts.some((artifact) => artifact.type === "PRD");
  const hasTaskSpec = artifacts.some((artifact) => artifact.type === "TaskSpec");
  const reports = agentBus?.reports ?? [];
  const hasReport = reports.some((report) => report.id === "report-smallcalc-mvp-001");
  const hasReview = artifacts.some((artifact) => artifact.type === "ReviewResult");
  const hasFixTask = artifacts.some((artifact) => artifact.type === "FixTask");
  const hasImplementationReport = reports.some((report) => report.id === "report-smallcalc-implementation-001");
  const hasFinalReview = artifacts.some((artifact) => artifact.type === "FinalReviewResult");
  const orchestrator = agentBus?.orchestrator;
  const isOrchestratorRunning = orchestrator?.status === "running";
  const showTechnicalEvents = settings.ccPersona.showTechnicalEvents || settings.ccPersona.communicationStyle === "debug";

  const codexEvents = useMemo(
    () =>
      (agentBus?.run?.events ?? []).filter(
        (event) =>
          (event.type === "codex-event" || event.type === "codex-request") &&
          shouldShowCodexEvent(event, showTechnicalEvents),
      ),
    [agentBus?.run?.events, showTechnicalEvents],
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
    const eventItems = codexEvents.slice(-18).map((event, index) => {
      const translated = humanizeCodexEvent(event, showTechnicalEvents);

      return {
        id: `${event.at}-${index}`,
        speaker: settings.ccPersona.displayName,
        tone: "system" as const,
        title: translated.title,
        body: translated.body,
        meta: showTechnicalEvents ? event.method ?? event.type : "运行事件",
      };
    });

    return [...messageItems, ...eventItems];
  }, [agentBus?.messages, codexEvents, settings.ccPersona.displayName, showTechnicalEvents]);
  const canRunAction = !actionBusy && !isOrchestratorRunning;

  function getStepStatus(step: WorkflowStep): WorkflowStatus {
    if (step.id === 1) return hasPrd ? "done" : "waiting";
    if (step.id === 2) return hasTaskSpec ? "done" : hasPrd ? "active" : "waiting";
    if (step.id === 3) {
      if (hasReport) return "done";
      if (agentBus?.run || isOrchestratorRunning) return "active";
      return hasTaskSpec ? "active" : "waiting";
    }
    if (step.id === 4) return hasReview ? "done" : hasReport || (isOrchestratorRunning && hasReport) ? "active" : "waiting";
    if (step.id === 5) return hasReview ? "failed" : "waiting";
    if (step.id === 6) {
      if (hasImplementationReport) return "done";
      if (hasFixTask) return "active";
      return hasReview ? "active" : "waiting";
    }
    if (step.id === 7) return hasFinalReview ? "approved" : hasImplementationReport ? "active" : "waiting";
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
    setActionError(null);

    try {
      await fetch("/api/agentbus/reset", { method: "POST" });
      await refreshAgentBus();
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "无法重置 agentbus");
    }
  }

  async function advanceWorkflow() {
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/orchestrator/start", { method: "POST" });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `orchestrator failed: ${response.status}`);
      }
      await refreshAgentBus();
      setCurrentStepIndex(-1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "执行失败");
    } finally {
      setActionBusy(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsError(null);
    setSettingsOpen(true);
  }

  function applyPersonaPreset(presetId: string) {
    const preset = ccPersonaPresets.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    setSettingsDraft((current) => ({
      ...current,
      ccPersona: {
        ...current.ccPersona,
        profileName: preset.label,
        executionPersona: preset.executionPersona,
        uiDisplayPersona: preset.uiDisplayPersona,
        communicationStyle: preset.communicationStyle,
        showTechnicalEvents: preset.communicationStyle === "debug",
      },
    }));
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `settings failed: ${response.status}`);
      }

      await refreshAgentBus();
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "无法保存设置");
    } finally {
      setSettingsSaving(false);
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
    if (agentBus?.settings && !settingsOpen) {
      setSettingsDraft(agentBus.settings);
    }
  }, [agentBus?.settings, settingsOpen]);

  useEffect(() => {
    if (!agentBus) {
      return;
    }

    if (currentStepIndex !== -1 && !isOrchestratorRunning) {
      return;
    }

    if (hasFinalReview) {
      setCurrentStepIndex(6);
      return;
    }

    if (hasImplementationReport) {
      setCurrentStepIndex(5);
      return;
    }

    if (hasFixTask) {
      setCurrentStepIndex(5);
      return;
    }

    if (hasReview) {
      setCurrentStepIndex(3);
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
  }, [
    agentBus,
    currentStepIndex,
    hasFinalReview,
    hasFixTask,
    hasImplementationReport,
    isOrchestratorRunning,
    hasPrd,
    hasReport,
    hasReview,
    hasTaskSpec,
  ]);

  return (
    <main className="app-shell" aria-labelledby="app-title">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-mark" src="/xiaowu-logo.png" alt="" aria-hidden="true" />
          <div>
            <h1 id="app-title">小五工作台：SmallCalc MVP 验收演示</h1>
          </div>
        </div>

        <div className="run-controls" aria-label="流程控制">
          <button
            className="secondary"
            onClick={openSettings}
            type="button"
          >
            设置
          </button>
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
            开始
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="timeline-panel" aria-labelledby="timeline-title">
          <div className="panel-heading">
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
              <h2 id="detail-title">产出物</h2>
            </div>
            <span className={`state-pill ${latestArtifact ? "done" : "waiting"}`}>
              {latestArtifact?.status ?? "等待真实产出"}
            </span>
          </div>

          <article className="artifact-document" aria-label="当前步骤产出物">
            <div className="artifact-document-header">
              <div>
                <p className="eyebrow">{latestArtifact ? `第 ${latestArtifact.stepId} 步 · ${latestArtifact.actor}` : "等待"}</p>
                <h3>{latestArtifact?.title ?? "尚未生成产出物"}</h3>
              </div>
              <span>{latestArtifact?.type ?? "等待小五发令"}</span>
            </div>

            <div className="artifact-body">
              <p>{latestArtifact?.body ?? "当前还没有 PRD、TaskSpec 或报告。点击“开始”后，小五会通过真实 LLM 生成第一份产出物。"}</p>
            </div>

            <div className="artifact-output-list">
              {[
                agentBus?.llm?.configured
                  ? `LLM: ${agentBus.llm.provider} / ${agentBus.llm.model} / 代理${agentBus.llm.proxy?.enabled ? "已启用" : "未启用"}`
                  : "LLM 未配置",
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
            <h2 id="comm-title">小五 / CC 会话</h2>
          </div>

          <div className="chat-list" aria-label="小五和 CC 会话消息">
            {actionBusy ? (
              <article className="chat-empty pending">
                <strong>正在启动真实编排器</strong>
                <p>启动后会按真实产物和 CC 报告连续推进；不会生成任何假结果。</p>
              </article>
            ) : null}

            {isOrchestratorRunning ? (
              <article className="chat-empty pending">
                <strong>编排器运行中</strong>
                <p>{orchestrator?.phase ?? "正在推进真实流程。"}</p>
              </article>
            ) : null}

            {orchestrator?.status === "failed" ? (
              <article className="chat-empty warning">
                <strong>编排器失败</strong>
                <p>{orchestrator.error ?? orchestrator.phase}</p>
              </article>
            ) : null}

            {actionError ? (
              <article className="chat-empty warning">
                <strong>小五调用失败</strong>
                <p>{actionError}</p>
              </article>
            ) : null}

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

      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-panel" aria-labelledby="settings-title" role="dialog" aria-modal="true">
            <header className="settings-head">
              <div>
                <p className="eyebrow">Settings</p>
                <h2 id="settings-title">工作台设置</h2>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} type="button" aria-label="关闭设置">
                ×
              </button>
            </header>

            <div className="settings-body">
              <nav className="settings-nav" aria-label="设置分类">
                <button className="active" type="button">
                  <strong>Coding Agent 人格</strong>
                  <span>执行能力与展示方式</span>
                </button>
              </nav>

              <form className="settings-form" onSubmit={(event) => {
                event.preventDefault();
                void saveSettings();
              }}>
                <section className="settings-section">
                  <div className="settings-section-head">
                    <div>
                      <h3>执行能力人格</h3>
                      <p>这部分会进入 CC 的真实任务 prompt，影响下一次 Codex App Server 唤起后的行为。</p>
                    </div>
                  </div>

                  <label className="field">
                    <span>人格预设</span>
                    <select
                      value={ccPersonaPresets.find((item) => item.label === settingsDraft.ccPersona.profileName)?.id ?? "senior"}
                      onChange={(event) => applyPersonaPreset(event.target.value)}
                    >
                      {ccPersonaPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>显示名称</span>
                    <input
                      value={settingsDraft.ccPersona.displayName}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          ccPersona: { ...current.ccPersona, displayName: event.target.value },
                        }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span>执行规则</span>
                    <textarea
                      rows={7}
                      value={settingsDraft.ccPersona.executionPersona}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          ccPersona: { ...current.ccPersona, executionPersona: event.target.value },
                        }))
                      }
                    />
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <div>
                      <h3>UI 展示人格</h3>
                      <p>这部分控制小五工作台如何呈现 CC 消息，默认隐藏底层协议噪声。</p>
                    </div>
                  </div>

                  <label className="field">
                    <span>展示风格</span>
                    <select
                      value={settingsDraft.ccPersona.communicationStyle}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          ccPersona: {
                            ...current.ccPersona,
                            communicationStyle: event.target.value as XiaowuSettings["ccPersona"]["communicationStyle"],
                          },
                        }))
                      }
                    >
                      <option value="concise">简洁中文</option>
                      <option value="detailed">详细中文</option>
                      <option value="debug">调试透明</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>展示规则</span>
                    <textarea
                      rows={6}
                      value={settingsDraft.ccPersona.uiDisplayPersona}
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          ccPersona: { ...current.ccPersona, uiDisplayPersona: event.target.value },
                        }))
                      }
                    />
                  </label>

                  <label className="toggle-row">
                    <input
                      checked={settingsDraft.ccPersona.showTechnicalEvents}
                      type="checkbox"
                      onChange={(event) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          ccPersona: { ...current.ccPersona, showTechnicalEvents: event.target.checked },
                        }))
                      }
                    />
                    <span>
                      显示底层技术事件
                      <em>打开后会显示 mcpServer、thread、turn 等调试事件。</em>
                    </span>
                  </label>
                </section>

                {settingsError ? (
                  <p className="settings-error">{settingsError}</p>
                ) : null}

                <footer className="settings-actions">
                  <button className="secondary" type="button" onClick={() => setSettingsOpen(false)}>
                    取消
                  </button>
                  <button className="primary" type="submit" disabled={settingsSaving}>
                    {settingsSaving ? "保存中..." : "保存设置"}
                  </button>
                </footer>
              </form>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
