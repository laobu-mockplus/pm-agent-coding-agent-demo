import { useMemo, useState } from "react";

// 小五工作台的单页演示入口：当前阶段使用固定流程数据，验证 PM Agent 与 Coding Agent
// 的可视化协作表达；后续接入真实编排时，应把 workflowSteps 替换为运行记录数据源。
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
    result: "PRD 已生成，进入任务分配。",
  },
  {
    id: 2,
    title: "小五给 CC 安排 MVP 任务",
    actor: "小五",
    statusAfterRun: "done",
    summary: "小五把 PRD 转成 TaskSpec，要求 CC 在 GitHub PR 中提交实现报告。",
    artifactTitle: "TaskSpec",
    artifactBody: "实现 SmallCalc MVP，并在 PR body 中提交 CC Implementation Report，逐条说明 AC 状态。",
    evidence: ["GitHub Issue #1", "任务类型：MVP implementation", "指定 Coding Agent：Codex"],
    result: "任务已分配给 CC。",
  },
  {
    id: 3,
    title: "CC 完成第一次实现并提交报告",
    actor: "CC",
    statusAfterRun: "done",
    summary: "CC 创建 PR，实现按钮式计算器，并提交第一次实现报告。",
    artifactTitle: "第一次 CC Implementation Report",
    artifactBody: "基础计算器行为已完成，但键盘输入 AC-6 暂未完成，报告中保留 known gap。",
    evidence: ["GitHub PR #2", "npm test 通过", "npm run build 通过", "AC-6 标记为未完成"],
    result: "第一次实现已提交，等待小五验收。",
  },
  {
    id: 4,
    title: "小五第一次验收",
    actor: "小五",
    statusAfterRun: "active",
    summary: "小五按 PRD 中的 AC-1 到 AC-8 检查报告和实现结果。",
    artifactTitle: "验收检查表",
    artifactBody: "AC-1 到 AC-5、AC-7、AC-8 通过；AC-6 键盘输入没有实现。",
    evidence: ["检查 PR body", "检查测试结果", "对照 PRD 验收标准"],
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
    evidence: ["commit 47c4425", "npm test：17 tests passed", "npm run build：passed", "AC-6 测试已覆盖"],
    result: "修复完成，等待小五最终验收。",
  },
  {
    id: 7,
    title: "小五再次验收并通过",
    actor: "小五",
    statusAfterRun: "approved",
    summary: "小五重新运行测试和构建，确认 8 条 AC 全部通过。",
    artifactTitle: "XiaoWu PM Review: Approved",
    artifactBody: "SmallCalc MVP is approved。PR 只保留 xiaowu:approved 标签。",
    evidence: ["npm test：17 passed", "npm run build：passed", "PR comment: Approved", "label: xiaowu:approved"],
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
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = workflowSteps[currentStepIndex];
  const completedCount = currentStepIndex + 1;
  const progress = Math.round((completedCount / workflowSteps.length) * 100);

  const eventLog = useMemo(() => [...workflowSteps.slice(0, completedCount)].reverse(), [completedCount]);
  const canGoNext = currentStepIndex < workflowSteps.length - 1;

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
            onClick={() => setCurrentStepIndex(0)}
            type="button"
          >
            重置
          </button>
          <button
            className="primary"
            disabled={!canGoNext}
            onClick={() => setCurrentStepIndex((step) => Math.min(step + 1, workflowSteps.length - 1))}
            type="button"
          >
            {canGoNext ? "执行下一步" : "流程已完成"}
          </button>
        </div>
      </header>

      <section className="status-strip" aria-label="当前流程状态">
        <div>
          <span>当前步骤</span>
          <strong>{`${currentStep.id} / ${workflowSteps.length}`}</strong>
        </div>
        <div>
          <span>当前角色</span>
          <strong>{currentStep.actor}</strong>
        </div>
        <div>
          <span>流程进度</span>
          <strong>{progress}%</strong>
        </div>
        <div>
          <span>验收状态</span>
          <strong>{statusLabel(currentStep.statusAfterRun)}</strong>
        </div>
      </section>

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

        <section className="detail-panel" aria-labelledby="detail-title">
          <div className="detail-header">
            <div>
              <p className="eyebrow">{`Step ${currentStep.id}`}</p>
              <h2 id="detail-title">{currentStep.title}</h2>
            </div>
            <span className={`state-pill ${currentStep.statusAfterRun}`}>
              {statusLabel(currentStep.statusAfterRun)}
            </span>
          </div>

          <p className="summary">{currentStep.summary}</p>

          <div className="artifact-block">
            <div>
              <p className="eyebrow">Artifact</p>
              <h3>{currentStep.artifactTitle}</h3>
            </div>
            <p>{currentStep.artifactBody}</p>
          </div>

          <div className="evidence-grid">
            {currentStep.evidence.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          <div className="result-block" role="status" aria-live="polite">
            <span>结果</span>
            <strong>{currentStep.result}</strong>
          </div>
        </section>

        <aside className="log-panel" aria-labelledby="log-title">
          <div className="panel-heading">
            <p className="eyebrow">State</p>
            <h2 id="log-title">状态日志</h2>
          </div>

          <div className="log-list">
            {eventLog.map((step) => (
              <article className="log-row" key={step.id}>
                <span>{`#${step.id}`}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.result}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
