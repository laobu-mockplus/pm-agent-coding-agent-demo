import { useMemo, useState } from "react";

// 小五工作台的单页演示入口：当前阶段只模拟流程状态，不提前生成 SmallCalc 程序。
// 后续接入真实编排时，应由小五发出 TaskSpec 后再触发 CC 运行并写回真实记录。
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
    result: "小五已生成 PRD，尚未产生 SmallCalc 程序代码。",
  },
  {
    id: 2,
    title: "小五给 CC 安排 MVP 任务",
    actor: "小五",
    statusAfterRun: "done",
    summary: "小五把 PRD 转成 TaskSpec，要求 CC 在 GitHub PR 中提交实现报告。",
    artifactTitle: "TaskSpec",
    artifactBody: "实现 SmallCalc MVP，并在 PR body 中提交 CC Implementation Report，逐条说明 AC 状态。",
    evidence: ["模拟 GitHub Issue", "任务类型：MVP implementation", "指定 Coding Agent：Codex"],
    result: "小五已发出任务指令，CC 此时才允许开始。",
  },
  {
    id: 3,
    title: "CC 完成第一次实现并提交报告",
    actor: "CC",
    statusAfterRun: "done",
    summary: "CC 收到小五指令后才创建实现分支，模拟完成第一次实现报告。",
    artifactTitle: "第一次 CC Implementation Report",
    artifactBody: "基础计算器行为已完成，但键盘输入 AC-6 暂未完成，报告中保留 known gap。",
    evidence: ["模拟 PR", "模拟 npm test 通过", "模拟 npm run build 通过", "AC-6 标记为未完成"],
    result: "CC 第一次报告已提交，等待小五验收。",
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
  const currentStep = currentStepIndex >= 0 ? workflowSteps[currentStepIndex] : null;
  const completedCount = Math.max(currentStepIndex + 1, 0);
  const progress = Math.round((completedCount / workflowSteps.length) * 100);

  const eventLog = useMemo(() => [...workflowSteps.slice(0, completedCount)].reverse(), [completedCount]);
  const canGoNext = currentStepIndex < workflowSteps.length - 1;
  const visibleStatus = currentStep ? statusLabel(currentStep.statusAfterRun) : "待小五发令";

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
            onClick={() => setCurrentStepIndex(-1)}
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
            {currentStepIndex < 0 ? "小五发出指令" : canGoNext ? "执行下一步" : "流程已完成"}
          </button>
        </div>
      </header>

      <section className="status-strip" aria-label="当前流程状态">
        <div>
          <span>当前步骤</span>
          <strong>{`${completedCount} / ${workflowSteps.length}`}</strong>
        </div>
        <div>
          <span>当前角色</span>
          <strong>{currentStep?.actor ?? "小五"}</strong>
        </div>
        <div>
          <span>流程进度</span>
          <strong>{progress}%</strong>
        </div>
        <div>
          <span>验收状态</span>
          <strong>{visibleStatus}</strong>
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
              <p className="eyebrow">{currentStep ? `Step ${currentStep.id}` : "Ready"}</p>
              <h2 id="detail-title">{currentStep?.title ?? "等待小五发出第一条指令"}</h2>
            </div>
            <span className={`state-pill ${currentStep?.statusAfterRun ?? "waiting"}`}>
              {visibleStatus}
            </span>
          </div>

          <p className="summary">
            {currentStep?.summary ?? "当前没有 SmallCalc 程序实现，也没有 CC 执行分支。点击“小五发出指令”后，才开始模拟 PRD、TaskSpec、CC 实现和小五验收流程。"}
          </p>

          <div className="artifact-block">
            <div>
              <p className="eyebrow">Artifact</p>
              <h3>{currentStep?.artifactTitle ?? "未生成"}</h3>
            </div>
            <p>{currentStep?.artifactBody ?? "SmallCalc 处于未启动状态；小五尚未向 CC 下发实现任务。"}</p>
          </div>

          <div className="evidence-grid">
            {(currentStep?.evidence ?? ["无实现分支", "无打开的 SmallCalc PR", "等待小五发令"]).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>

          <div className="result-block" role="status" aria-live="polite">
            <span>结果</span>
            <strong>{currentStep?.result ?? "SmallCalc 尚未开始实现。"}</strong>
          </div>
        </section>

        <aside className="log-panel" aria-labelledby="log-title">
          <div className="panel-heading">
            <p className="eyebrow">State</p>
            <h2 id="log-title">状态日志</h2>
          </div>

          <div className="log-list">
            {eventLog.length > 0 ? (
              eventLog.map((step) => (
                <article className="log-row" key={step.id}>
                  <span>{`#${step.id}`}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.result}</p>
                  </div>
                </article>
              ))
            ) : (
              <article className="log-row">
                <span>#0</span>
                <div>
                  <strong>等待小五指令</strong>
                  <p>当前没有 SmallCalc 实现任务。</p>
                </div>
              </article>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
