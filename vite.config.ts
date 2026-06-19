import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CodexAppServerRunner,
  CodexAppServerTestRunner,
  type AgentBusEvent,
  type CcRunnerHandle,
  type CcRunnerSnapshot,
} from "./server/cc-runners";
import { XiaowuLlmProvider } from "./server/llm-provider";

const rootDir = process.cwd();
const agentBusDir = path.join(rootDir, ".agentbus");
const ccInboxDir = path.join(agentBusDir, "cc-inbox");
const xiaowuInboxDir = path.join(agentBusDir, "xiaowu-inbox");
const artifactsDir = path.join(agentBusDir, "artifacts");
const runsDir = path.join(agentBusDir, "runs");
const settingsPath = path.join(agentBusDir, "settings.json");
const orchestratorPath = path.join(agentBusDir, "orchestrator.json");
const staleDir = path.join(agentBusDir, "stale");
const targetRepoDir = path.resolve(rootDir, "../workspaces/smallcalc-app");
let activeRunner: CcRunnerHandle | null = null;
let activeOrchestrator: Promise<void> | null = null;
let orchestratorToken = 0;
const llmProvider = new XiaowuLlmProvider(rootDir);

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

type AgentArtifact = {
  id: string;
  stepId?: number;
  actor?: "小五" | "CC";
  to?: "小五" | "CC";
  type: string;
  title: string;
  status?: string;
  summary?: string;
  body?: string;
  createdAt?: string;
};

type AgentReport = {
  id?: string;
  messageId?: string;
  from?: string;
  to?: string;
  type?: string;
  runId?: string;
  status?: string;
  payload?: {
    summary?: string;
    didImplementSmallCalc?: boolean;
  };
};

type OrchestratorSnapshot = {
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  startedAt?: string;
  updatedAt: string;
  error?: string;
};

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonFile<T>(filePath: string, fallback: T) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function defaultSettings(): XiaowuSettings {
  return {
    ccPersona: {
      profileName: "严谨资深工程师",
      displayName: "CC",
      executionPersona:
        "你是 CC，一个严谨的资深 Coding Agent。你必须真实读取任务、真实修改目标仓库、真实运行验证命令，并如实报告成功、失败和阻塞。不得用 mock、占位文件或只补报告冒充完成。",
      uiDisplayPersona:
        "在小五工作台中，用简洁中文展示 CC 的关键动作。隐藏对用户无意义的协议事件和长 ID；保留命令执行、文件修改、错误、报告提交和任务完成等关键信息。",
      communicationStyle: "concise",
      showTechnicalEvents: false,
    },
  };
}

function readSettings(): XiaowuSettings {
  const defaults = defaultSettings();
  const saved = readJsonFile<Partial<XiaowuSettings> | null>(settingsPath, null);

  return {
    ...defaults,
    ...saved,
    ccPersona: {
      ...defaults.ccPersona,
      ...(saved?.ccPersona ?? {}),
    },
  };
}

function writeSettings(value: XiaowuSettings) {
  writeJson(settingsPath, value);
  return value;
}

function readJsonFiles(dir: string) {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

function readArtifacts(): AgentArtifact[] {
  ensureDir(artifactsDir);
  return fs
    .readdirSync(artifactsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readJsonFile<AgentArtifact | null>(path.join(artifactsDir, name), null))
    .filter((artifact): artifact is AgentArtifact => Boolean(artifact));
}

function appendRunEvent(runDir: string, event: Omit<AgentBusEvent, "at">) {
  ensureDir(runDir);
  fs.appendFileSync(
    path.join(runDir, "events.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
  );
}

function writeRunSnapshot(runDir: string, snapshot: CcRunnerSnapshot) {
  writeJson(path.join(runDir, "runner.json"), snapshot);
}

function readRunSnapshot(runDir: string) {
  return readJsonFile<CcRunnerSnapshot | null>(path.join(runDir, "runner.json"), null);
}

function readRunEvents(runDir: string) {
  const eventsFile = path.join(runDir, "events.jsonl");

  if (!fs.existsSync(eventsFile)) {
    return [];
  }

  return fs
    .readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureTargetRepo() {
  ensureDir(targetRepoDir);
  const readmePath = path.join(targetRepoDir, "README.md");

  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      "# SmallCalc target repo\n\nThis repo is reserved for CC after XiaoWu sends a TaskSpec.\n",
    );
  }

  if (!fs.existsSync(path.join(targetRepoDir, ".git"))) {
    spawnSync("git", ["init"], { cwd: targetRepoDir, stdio: "ignore" });
  }
}

function readBody(req: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, value: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function writeArtifact(id: string, value: Record<string, unknown>) {
  const artifact = {
    id,
    createdAt: new Date().toISOString(),
    ...value,
  };
  writeJson(path.join(artifactsDir, `${id}.json`), artifact);
  return artifact;
}

function readArtifactText(id: string) {
  const artifact = readJsonFile<{ body?: string } | null>(path.join(artifactsDir, `${id}.json`), null);
  return artifact?.body ?? "";
}

function quarantineStaleReport(reportPath: string, expectedRunId: string, actualRunId: string | undefined) {
  ensureDir(staleDir);
  const staleName = `${Date.now()}-${path.basename(reportPath)}-${actualRunId ?? "missing-run"}.stale`;
  fs.renameSync(reportPath, path.join(staleDir, staleName));
  writeOrchestratorSnapshot({
    status: "running",
    phase: `忽略旧报告：期望 ${expectedRunId}，收到 ${actualRunId ?? "未知 runId"}`,
  });
}

function readOrchestratorSnapshot() {
  return readJsonFile<OrchestratorSnapshot | null>(orchestratorPath, null);
}

function writeOrchestratorSnapshot(value: Omit<OrchestratorSnapshot, "updatedAt">) {
  const previous = readOrchestratorSnapshot();
  const snapshot: OrchestratorSnapshot = {
    ...previous,
    ...value,
    updatedAt: new Date().toISOString(),
  };
  writeJson(orchestratorPath, snapshot);
  return snapshot;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureNotCancelled(token: number) {
  if (token !== orchestratorToken) {
    throw new Error("Orchestrator was cancelled.");
  }
}

async function waitForReport(reportFileName: string, phase: string, token: number, expectedRunId: string) {
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.XIAOWU_ORCHESTRATOR_TIMEOUT_MS ?? 10 * 60_000);
  const reportPath = path.join(xiaowuInboxDir, reportFileName);

  while (true) {
    ensureNotCancelled(token);
    writeOrchestratorSnapshot({ status: "running", phase });

    if (fs.existsSync(reportPath)) {
      const report = readJsonFile<AgentReport | null>(reportPath, null);

      if (report?.runId === expectedRunId) {
        return report;
      }

      quarantineStaleReport(reportPath, expectedRunId, report?.runId);
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待 CC 报告超时：${reportFileName}`);
    }

    const runIds = fs.existsSync(runsDir)
      ? fs
          .readdirSync(runsDir)
          .filter((name) => name !== ".gitkeep")
          .sort()
      : [];
    const latestRunId = runIds.at(-1);
    const latestRunDir = latestRunId ? path.join(runsDir, latestRunId) : null;
    const runner = latestRunDir ? readRunSnapshot(latestRunDir) : null;

    if (runner?.status === "failed" || runner?.status === "cancelled") {
      throw new Error(`CC 执行失败，未收到报告：${reportFileName}`);
    }

    if (runner?.status === "completed" && Date.now() - startedAt > 3000) {
      throw new Error(`CC 执行已结束，但未提交报告：${reportFileName}`);
    }

    await sleep(1000);
  }
}

function readTargetRepoSnapshot() {
  if (!fs.existsSync(targetRepoDir)) {
    return "目标仓库不存在。";
  }

  const files: Array<{ path: string; content?: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist", "coverage", "test-results"].includes(entry.name)) {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(targetRepoDir, absolutePath);

      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (files.length >= 40) {
        return;
      }

      const text = fs.readFileSync(absolutePath, "utf8");
      files.push({ path: relativePath, content: text.slice(0, 6000) });
    }
  };

  walk(targetRepoDir);
  return JSON.stringify(files, null, 2);
}

function runTargetVerification() {
  const commands = [
    ["npm", ["test"]],
    ["npm", ["run", "build"]],
  ] as const;

  return commands.map(([command, args]) => {
    const result = spawnSync(command, args, {
      cwd: targetRepoDir,
      encoding: "utf8",
      timeout: 60_000,
    });

    return {
      command: [command, ...args].join(" "),
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 4000) ?? "",
      stderr: result.stderr?.slice(0, 4000) ?? "",
      error: result.error?.message,
    };
  });
}

function createTaskSpec(
  runId: string,
  taskSpecBody: string,
  options: {
    id?: string;
    messageId?: string;
    goal: string;
    doNotImplementSmallCalcYet: boolean;
    acceptanceCriteria: string[];
  },
) {
  return {
    id: options.id ?? "task-smallcalc-mvp-001",
    messageId: options.messageId ?? "MSG-001",
    from: "小五",
    to: "CC",
    type: "TaskSpec",
    status: "queued",
    createdAt: new Date().toISOString(),
    runId,
    channel: ".agentbus/cc-inbox",
    targetRepo: {
      localPath: targetRepoDir,
      baseBranch: "main",
      workBranch: "cc/smallcalc-mvp",
    },
    ccRunner: {
      provider: "codex",
      adapter: "Codex App Server",
      protocol: "json-rpc/stdio",
    },
    payload: {
      product: "SmallCalc",
      goal: options.goal,
      taskSpecBody,
      acceptanceCriteria: options.acceptanceCriteria,
      constraints: {
        doNotImplementSmallCalcYet: options.doNotImplementSmallCalcYet,
        writeReportToXiaowuInbox: true,
      },
    },
  };
}

function buildCcPrompt(taskPath: string, reportPath: string, runId: string) {
  const settings = readSettings();
  const persona = settings.ccPersona;

  return `你是 ${persona.displayName}。你现在被小五通过 Codex App Server 调用器唤起。

## Coding Agent 执行能力人格

${persona.executionPersona}

## 对用户可见的沟通方式

${persona.uiDisplayPersona}

请严格读取 TaskSpec，并按 TaskSpec 执行。当前阶段如果 TaskSpec 明确要求不要实现 SmallCalc，就不得实现；如果 TaskSpec 要求实现，则按目标仓库完成实现。

1. 读取 TaskSpec 文件：${taskPath}
2. 在目标仓库中按 TaskSpec 执行；如果 TaskSpec 要求实现 SmallCalc，就真实创建或修改代码、运行可用的验证命令。
3. 执行过程中请用中文输出简短进度，重点说明正在读取任务、修改文件、运行命令、遇到阻塞或提交报告。
4. 创建 ImplementationReport JSON 文件：${reportPath}

ImplementationReport JSON 必须包含：
{
  "id": "<report file basename without .json>",
  "messageId": "<new message id>",
  "from": "CC",
  "to": "小五",
  "type": "ImplementationReport",
  "runId": "${runId}",
  "status": "submitted",
  "payload": {
    "summary": "<本轮真实完成情况>",
    "didImplementSmallCalc": <true 或 false>,
    "changedFiles": ["<真实修改或创建的文件>"],
    "verification": ["<真实运行过的命令和结果>"],
    "next": "等待小五验收。"
  }
}
`;
}

function startCcWorker(runId: string, taskPath: string, reportPath: string) {
  const runDir = path.join(runsDir, runId);
  const mode = process.env.XIAOWU_CC_MODE ?? "real";

  appendRunEvent(runDir, { type: "status", status: "starting", text: `启动 CC 调用器：Codex App Server，模式：${mode}` });
  const prompt = buildCcPrompt(taskPath, reportPath, runId);
  const runner = mode === "test" ? new CodexAppServerTestRunner() : new CodexAppServerRunner();
  writeRunSnapshot(runDir, {
    provider: runner.provider,
    adapter: runner.adapter,
    protocol: runner.protocol,
    mode,
    status: "starting",
  });

  activeRunner = runner.start(
    { runId, targetRepoDir, taskPath, reportPath, prompt },
    {
      appendEvent: (event) => appendRunEvent(runDir, event),
      writeReport: (value) => writeJson(reportPath, value),
      updateSnapshot: (snapshot) => {
        const previous = readRunSnapshot(runDir);
        writeRunSnapshot(runDir, {
          provider: runner.provider,
          adapter: runner.adapter,
          protocol: runner.protocol,
          mode,
          status: "starting",
          ...(previous ?? {}),
          ...snapshot,
        });
      },
    },
  );
}

function ensureTokenIfPresent(token?: number) {
  if (typeof token === "number") {
    ensureNotCancelled(token);
  }
}

async function createPrdArtifact(token?: number) {
  const body = await llmProvider.complete([
    {
      role: "system",
      content:
        "你是名为小五的 PM Agent。请用中文写真实 PRD，不要写演示话术，不要声称已经实现。输出 Markdown。",
    },
    {
      role: "user",
      content:
        "为一个名为 SmallCalc 的计算器 app 创建 MVP PRD。必须包含目标、用户故事、功能范围、非功能要求、验收标准、暂不做范围。强调 CC 只有收到 TaskSpec 后才开始实现。",
    },
  ]);
  ensureTokenIfPresent(token);

  return writeArtifact("prd-smallcalc-v1", {
    stepId: 1,
    actor: "小五",
    to: "CC",
    type: "PRD",
    title: "SmallCalc PRD v1",
    status: "created",
    summary: "小五通过真实 LLM 生成 SmallCalc PRD。",
    body,
  });
}

async function createInitialTaskSpecAndStartCc(token?: number) {
  ensureTargetRepo();
  const prdBody = readArtifactText("prd-smallcalc-v1");
  if (!prdBody) {
    throw new Error("PRD is required before TaskSpec.");
  }

  const runId = `run-${Date.now()}`;
  const runDir = path.join(runsDir, runId);
  const taskSpecBody = await llmProvider.complete([
    {
      role: "system",
      content:
        "你是小五 PM Agent。请把 PRD 转成给 Coding Agent 的 TaskSpec。输出中文 Markdown，不要编造执行结果。",
    },
    {
      role: "user",
      content: `基于以下 PRD 生成 SmallCalc MVP TaskSpec。本轮要求 CC 只读取任务、确认目标仓库、写回报告；暂不实现 SmallCalc。\n\n${prdBody}`,
    },
  ]);
  ensureTokenIfPresent(token);

  writeArtifact("taskspec-smallcalc-v1", {
    stepId: 2,
    actor: "小五",
    to: "CC",
    type: "TaskSpec",
    title: "SmallCalc TaskSpec v1",
    status: "created",
    summary: "小五通过真实 LLM 将 PRD 转成 TaskSpec。",
    body: taskSpecBody,
  });

  const task = createTaskSpec(runId, taskSpecBody, {
    goal: "小五基于真实 PRD 生成 TaskSpec，并通过 Codex App Server 调用器启动和管理 CC。本轮只验证通信链路，不实现 SmallCalc。",
    doNotImplementSmallCalcYet: true,
    acceptanceCriteria: [
      "CC 必须通过 Codex App Server thread/turn 接收任务",
      "CC 必须写回 ImplementationReport",
      "UI 必须显示 Codex App Server 结构化事件",
    ],
  });
  const taskPath = path.join(ccInboxDir, `${task.id}.json`);
  const reportPath = path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json");

  writeJson(taskPath, task);
  appendRunEvent(runDir, { type: "status", status: "queued", text: `小五写入 TaskSpec：${taskPath}` });
  startCcWorker(runId, taskPath, reportPath);
  return { runId, task };
}

async function createFirstReviewArtifact(token?: number) {
  const report = readJsonFile<{ payload?: unknown } | null>(
    path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json"),
    null,
  );
  const taskSpecBody = readArtifactText("taskspec-smallcalc-v1");
  if (!report) {
    throw new Error("ImplementationReport is required before review.");
  }

  const body = await llmProvider.complete([
    {
      role: "system",
      content:
        "你是小五 PM Agent。请基于 TaskSpec 和 CC 报告做真实验收。不能编造通过，必须指出证据和结论。输出中文 Markdown。",
    },
    {
      role: "user",
      content: `TaskSpec:\n${taskSpecBody}\n\nCC ImplementationReport:\n${JSON.stringify(report, null, 2)}`,
    },
  ]);
  ensureTokenIfPresent(token);

  return writeArtifact("review-smallcalc-v1", {
    stepId: 4,
    actor: "小五",
    to: "CC",
    type: "ReviewResult",
    title: "小五验收报告 v1",
    status: "created",
    summary: "小五通过真实 LLM 生成验收报告。",
    body,
  });
}

async function createFixTaskAndStartCc(token?: number) {
  ensureTargetRepo();

  const prdBody = readArtifactText("prd-smallcalc-v1");
  const taskSpecBody = readArtifactText("taskspec-smallcalc-v1");
  const reviewBody = readArtifactText("review-smallcalc-v1");
  const firstReport = readJsonFile<{ payload?: unknown } | null>(
    path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json"),
    null,
  );

  if (!prdBody || !taskSpecBody || !reviewBody || !firstReport) {
    throw new Error("PRD, TaskSpec, first ImplementationReport and ReviewResult are required before FixTask.");
  }

  const runId = `run-${Date.now()}`;
  const runDir = path.join(runsDir, runId);
  const fixTaskBody = await llmProvider.complete([
    {
      role: "system",
      content:
        "你是小五 PM Agent。请基于 PRD、上一轮 TaskSpec、CC 报告和小五验收结果，生成给 Coding Agent 的真实整改任务。输出中文 Markdown，不要编造执行结果。",
    },
    {
      role: "user",
      content: `请生成 SmallCalc 真实实现整改任务。要求 CC 这次必须在目标仓库实现 SmallCalc MVP、运行验证命令、写回 ImplementationReport。不得使用 mock，不得只补报告。\n\nPRD:\n${prdBody}\n\n上一轮 TaskSpec:\n${taskSpecBody}\n\nCC 上一轮 ImplementationReport:\n${JSON.stringify(firstReport, null, 2)}\n\n小五验收结果:\n${reviewBody}`,
    },
  ]);
  ensureTokenIfPresent(token);

  writeArtifact("fixtask-smallcalc-v1", {
    stepId: 6,
    actor: "小五",
    to: "CC",
    type: "FixTask",
    title: "SmallCalc 实现整改任务 v1",
    status: "created",
    summary: "小五通过真实 LLM 将不通过验收转成 CC 整改任务。",
    body: fixTaskBody,
  });

  const task = createTaskSpec(runId, fixTaskBody, {
    id: "task-smallcalc-implementation-001",
    messageId: "MSG-003",
    goal: "小五第一次验收不通过后，要求 CC 真实实现 SmallCalc MVP，并提交可验收的 ImplementationReport。",
    doNotImplementSmallCalcYet: false,
    acceptanceCriteria: [
      "CC 必须在目标仓库真实实现 SmallCalc MVP",
      "CC 必须运行可用的验证命令，并在报告中写明命令和结果",
      "CC 必须写回 ImplementationReport，且 didImplementSmallCalc 必须反映真实实现结果",
      "不得用 mock、占位文件或只补报告冒充实现",
    ],
  });
  const taskPath = path.join(ccInboxDir, `${task.id}.json`);
  const reportPath = path.join(xiaowuInboxDir, "report-smallcalc-implementation-001.json");

  writeJson(taskPath, task);
  appendRunEvent(runDir, { type: "status", status: "queued", text: `小五写入 FixTask：${taskPath}` });
  startCcWorker(runId, taskPath, reportPath);
  return { runId, task };
}

async function createFinalReviewArtifact(token?: number) {
  const fixTaskBody = readArtifactText("fixtask-smallcalc-v1");
  const implementationReport = readJsonFile<{ payload?: unknown } | null>(
    path.join(xiaowuInboxDir, "report-smallcalc-implementation-001.json"),
    null,
  );

  if (!fixTaskBody || !implementationReport) {
    throw new Error("FixTask and second ImplementationReport are required before final review.");
  }

  const body = await llmProvider.complete([
    {
      role: "system",
      content:
        "你是小五 PM Agent。请基于 FixTask、CC 第二次报告和目标仓库文件快照做真实最终验收。不能编造通过；必须写出证据、风险和结论。输出中文 Markdown。",
    },
    {
      role: "user",
      content: `FixTask:\n${fixTaskBody}\n\nCC 第二次 ImplementationReport:\n${JSON.stringify(implementationReport, null, 2)}\n\n小五后端复验命令结果:\n${JSON.stringify(runTargetVerification(), null, 2)}\n\n目标仓库文件快照:\n${readTargetRepoSnapshot()}`,
    },
  ]);
  ensureTokenIfPresent(token);

  return writeArtifact("review-smallcalc-final-v1", {
    stepId: 7,
    actor: "小五",
    to: "CC",
    type: "FinalReviewResult",
    title: "小五再次验收报告 v1",
    status: "created",
    summary: "小五通过真实 LLM 基于 FixTask、CC 第二次报告和仓库快照生成最终验收。",
    body,
  });
}

async function runContinuousWorkflow(token: number) {
  try {
    writeOrchestratorSnapshot({ status: "running", phase: "小五正在创建 PRD", startedAt: new Date().toISOString() });

    if (!readArtifactText("prd-smallcalc-v1")) {
      await createPrdArtifact(token);
    }
    ensureNotCancelled(token);

    writeOrchestratorSnapshot({ status: "running", phase: "小五正在发送 TaskSpec 给 CC" });
    const firstRun = !readArtifactText("taskspec-smallcalc-v1")
      ? await createInitialTaskSpecAndStartCc(token)
      : null;
    ensureNotCancelled(token);

    await waitForReport(
      "report-smallcalc-mvp-001.json",
      "等待 CC 第一轮 ImplementationReport",
      token,
      firstRun?.runId ?? readJsonFile<{ runId?: string } | null>(path.join(ccInboxDir, "task-smallcalc-mvp-001.json"), null)?.runId ?? "",
    );

    writeOrchestratorSnapshot({ status: "running", phase: "小五正在第一次验收" });
    if (!readArtifactText("review-smallcalc-v1")) {
      await createFirstReviewArtifact(token);
    }
    ensureNotCancelled(token);

    writeOrchestratorSnapshot({ status: "running", phase: "小五正在生成整改任务" });
    const fixRun = !readArtifactText("fixtask-smallcalc-v1") ? await createFixTaskAndStartCc(token) : null;
    ensureNotCancelled(token);

    await waitForReport(
      "report-smallcalc-implementation-001.json",
      "等待 CC 修复后的 ImplementationReport",
      token,
      fixRun?.runId ??
        readJsonFile<{ runId?: string } | null>(path.join(ccInboxDir, "task-smallcalc-implementation-001.json"), null)
          ?.runId ??
        "",
    );

    writeOrchestratorSnapshot({ status: "running", phase: "小五正在最终验收" });
    if (!readArtifactText("review-smallcalc-final-v1")) {
      await createFinalReviewArtifact(token);
    }

    writeOrchestratorSnapshot({ status: "completed", phase: "流程已完成" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Orchestrator was cancelled." ? "cancelled" : "failed";
    if (token === orchestratorToken) {
      writeOrchestratorSnapshot({ status, phase: status === "cancelled" ? "流程已取消" : "流程失败", error: message });
    }
    throw error;
  } finally {
    if (token === orchestratorToken) {
      activeOrchestrator = null;
    }
  }
}

function startContinuousWorkflow() {
  const current = readOrchestratorSnapshot();

  if (activeOrchestrator || current?.status === "running") {
    return current ?? writeOrchestratorSnapshot({ status: "running", phase: "流程正在运行" });
  }

  orchestratorToken += 1;
  const token = orchestratorToken;
  const snapshot = writeOrchestratorSnapshot({
    status: "running",
    phase: "流程已启动",
    startedAt: new Date().toISOString(),
  });
  activeOrchestrator = runContinuousWorkflow(token).catch(() => undefined);
  return snapshot;
}

function agentBusPlugin() {
  return {
    name: "xiaowu-agentbus-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (
          !req.url?.startsWith("/api/agentbus") &&
          !req.url?.startsWith("/api/xiaowu") &&
          !req.url?.startsWith("/api/settings") &&
          !req.url?.startsWith("/api/orchestrator")
        ) {
          next();
          return;
        }

        ensureDir(ccInboxDir);
        ensureDir(xiaowuInboxDir);
        ensureDir(artifactsDir);
        ensureDir(runsDir);

        try {
          if (req.method === "GET" && req.url === "/api/settings") {
            sendJson(res, readSettings());
            return;
          }

          if (req.method === "POST" && req.url === "/api/settings") {
            const body = await readBody(req);
            const incoming = JSON.parse(body || "{}") as Partial<XiaowuSettings>;
            const defaults = defaultSettings();
            const settings = writeSettings({
              ...defaults,
              ...incoming,
              ccPersona: {
                ...defaults.ccPersona,
                ...(incoming.ccPersona ?? {}),
              },
            });
            sendJson(res, { ok: true, settings });
            return;
          }

          if (req.method === "GET" && req.url === "/api/agentbus/state") {
          const tasks = readJsonFiles(ccInboxDir);
          const taskRunIds = new Set(tasks.map((task) => task.runId).filter(Boolean));
          const reports = readJsonFiles(xiaowuInboxDir).filter((report: AgentReport) => taskRunIds.has(report.runId));
          const artifacts = readArtifacts();
          const runIds = fs
            .readdirSync(runsDir)
            .filter((name) => name !== ".gitkeep")
            .sort();
          const latestRunId = runIds.at(-1);
          const runDir = latestRunId ? path.join(runsDir, latestRunId) : null;
          const events = runDir ? readRunEvents(runDir) : [];
          const runner = runDir ? readRunSnapshot(runDir) : null;
          const latestExit = [...events].reverse().find((event) => event.type === "exit" || event.type === "error");

          sendJson(res, {
            tasks,
            reports,
            artifacts,
            llm: llmProvider.info,
            settings: readSettings(),
            orchestrator: readOrchestratorSnapshot(),
            messages: [
              ...artifacts.map((artifact) => ({
                id: artifact.id,
                from: artifact.actor ?? "小五",
                to: artifact.to ?? "CC",
                type: artifact.type,
                channel: ".agentbus/artifacts",
                status: artifact.status ?? "created",
                payload: [artifact.title, artifact.summary ?? artifact.body?.slice(0, 160) ?? ""].filter(Boolean),
              })),
              ...tasks.map((task) => ({
                id: task.messageId,
                from: task.from,
                to: task.to,
                type: task.type,
                  channel: task.channel,
                  status: task.status,
                  payload: [
                    `目标：${task.payload.product}`,
                    `目标仓库：${task.targetRepo.localPath}`,
                    `CC 调用器：${task.ccRunner?.adapter ?? "Codex App Server"}`,
                    `约束：不提前实现 SmallCalc = ${task.payload.constraints.doNotImplementSmallCalcYet}`,
                  ],
                })),
              ...reports.map((report) => ({
                id: report.messageId,
                from: report.from,
                to: report.to,
                type: report.type,
                channel: ".agentbus/xiaowu-inbox",
                status: report.status,
                payload: [report.payload.summary, `didImplementSmallCalc: ${report.payload.didImplementSmallCalc}`],
              })),
            ],
            run: latestRunId
              ? {
                  id: latestRunId,
                  status: latestExit?.status ?? "running",
                  targetRepo: targetRepoDir,
                  runner,
                  events,
                }
              : null,
          });
          return;
        }

        if (req.method === "POST" && req.url === "/api/agentbus/reset") {
          orchestratorToken += 1;
          activeRunner?.cancel();
          activeRunner = null;
          activeOrchestrator = null;
          fs.rmSync(ccInboxDir, { recursive: true, force: true });
          fs.rmSync(xiaowuInboxDir, { recursive: true, force: true });
          fs.rmSync(artifactsDir, { recursive: true, force: true });
          fs.rmSync(runsDir, { recursive: true, force: true });
          fs.rmSync(orchestratorPath, { force: true });
          fs.rmSync(staleDir, { recursive: true, force: true });
          ensureDir(ccInboxDir);
          ensureDir(xiaowuInboxDir);
          ensureDir(artifactsDir);
          ensureDir(runsDir);
          fs.writeFileSync(path.join(runsDir, ".gitkeep"), "");
          sendJson(res, { ok: true });
          return;
        }

        if (req.method === "POST" && req.url === "/api/orchestrator/start") {
          await readBody(req);
          const snapshot = startContinuousWorkflow();
          sendJson(res, { ok: true, orchestrator: snapshot });
          return;
        }

        if (req.method === "POST" && req.url === "/api/xiaowu/prd") {
          await readBody(req);
          const body = await llmProvider.complete([
            {
              role: "system",
              content:
                "你是名为小五的 PM Agent。请用中文写真实 PRD，不要写演示话术，不要声称已经实现。输出 Markdown。",
            },
            {
              role: "user",
              content:
                "为一个名为 SmallCalc 的计算器 app 创建 MVP PRD。必须包含目标、用户故事、功能范围、非功能要求、验收标准、暂不做范围。强调 CC 只有收到 TaskSpec 后才开始实现。",
            },
          ]);
          const artifact = writeArtifact("prd-smallcalc-v1", {
            stepId: 1,
            actor: "小五",
            to: "CC",
            type: "PRD",
            title: "SmallCalc PRD v1",
            status: "created",
            summary: "小五通过真实 LLM 生成 SmallCalc PRD。",
            body,
          });
          sendJson(res, { ok: true, artifact, llm: llmProvider.info });
          return;
        }

        if (req.method === "POST" && req.url === "/api/agentbus/tasks/smallcalc") {
          await readBody(req);
          ensureTargetRepo();
          const prdBody = readArtifactText("prd-smallcalc-v1");
          if (!prdBody) {
            sendJson(res, { error: "PRD is required before TaskSpec." }, 409);
            return;
          }
          const runId = `run-${Date.now()}`;
          const runDir = path.join(runsDir, runId);
          const taskSpecBody = await llmProvider.complete([
            {
              role: "system",
              content:
                "你是小五 PM Agent。请把 PRD 转成给 Coding Agent 的 TaskSpec。输出中文 Markdown，不要编造执行结果。",
            },
            {
              role: "user",
              content: `基于以下 PRD 生成 SmallCalc MVP TaskSpec。本轮要求 CC 只读取任务、确认目标仓库、写回报告；暂不实现 SmallCalc。\n\n${prdBody}`,
            },
          ]);
          writeArtifact("taskspec-smallcalc-v1", {
            stepId: 2,
            actor: "小五",
            to: "CC",
            type: "TaskSpec",
            title: "SmallCalc TaskSpec v1",
            status: "created",
            summary: "小五通过真实 LLM 将 PRD 转成 TaskSpec。",
            body: taskSpecBody,
          });
          const task = createTaskSpec(runId, taskSpecBody, {
            goal: "小五基于真实 PRD 生成 TaskSpec，并通过 Codex App Server 调用器启动和管理 CC。本轮只验证通信链路，不实现 SmallCalc。",
            doNotImplementSmallCalcYet: true,
            acceptanceCriteria: [
              "CC 必须通过 Codex App Server thread/turn 接收任务",
              "CC 必须写回 ImplementationReport",
              "UI 必须显示 Codex App Server 结构化事件",
            ],
          });
          const taskPath = path.join(ccInboxDir, `${task.id}.json`);
          const reportPath = path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json");

          writeJson(taskPath, task);
          appendRunEvent(runDir, { type: "status", status: "queued", text: `小五写入 TaskSpec：${taskPath}` });
          startCcWorker(runId, taskPath, reportPath);
          sendJson(res, { ok: true, runId, task });
          return;
        }

        if (req.method === "POST" && req.url === "/api/xiaowu/review") {
          await readBody(req);
          const report = readJsonFile<{ payload?: unknown } | null>(
            path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json"),
            null,
          );
          const taskSpecBody = readArtifactText("taskspec-smallcalc-v1");
          if (!report) {
            sendJson(res, { error: "ImplementationReport is required before review." }, 409);
            return;
          }
          const body = await llmProvider.complete([
            {
              role: "system",
              content:
                "你是小五 PM Agent。请基于 TaskSpec 和 CC 报告做真实验收。不能编造通过，必须指出证据和结论。输出中文 Markdown。",
            },
            {
              role: "user",
              content: `TaskSpec:\n${taskSpecBody}\n\nCC ImplementationReport:\n${JSON.stringify(report, null, 2)}`,
            },
          ]);
          const artifact = writeArtifact("review-smallcalc-v1", {
            stepId: 4,
            actor: "小五",
            to: "CC",
            type: "ReviewResult",
            title: "小五验收报告 v1",
            status: "created",
            summary: "小五通过真实 LLM 生成验收报告。",
            body,
          });
          sendJson(res, { ok: true, artifact, llm: llmProvider.info });
          return;
        }

        if (req.method === "POST" && req.url === "/api/xiaowu/fix-task") {
          await readBody(req);
          ensureTargetRepo();

          const prdBody = readArtifactText("prd-smallcalc-v1");
          const taskSpecBody = readArtifactText("taskspec-smallcalc-v1");
          const reviewBody = readArtifactText("review-smallcalc-v1");
          const firstReport = readJsonFile<{ payload?: unknown } | null>(
            path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json"),
            null,
          );

          if (!prdBody || !taskSpecBody || !reviewBody || !firstReport) {
            sendJson(
              res,
              { error: "PRD, TaskSpec, first ImplementationReport and ReviewResult are required before FixTask." },
              409,
            );
            return;
          }

          const runId = `run-${Date.now()}`;
          const runDir = path.join(runsDir, runId);
          const fixTaskBody = await llmProvider.complete([
            {
              role: "system",
              content:
                "你是小五 PM Agent。请基于 PRD、上一轮 TaskSpec、CC 报告和小五验收结果，生成给 Coding Agent 的真实整改任务。输出中文 Markdown，不要编造执行结果。",
            },
            {
              role: "user",
              content: `请生成 SmallCalc 真实实现整改任务。要求 CC 这次必须在目标仓库实现 SmallCalc MVP、运行验证命令、写回 ImplementationReport。不得使用 mock，不得只补报告。\n\nPRD:\n${prdBody}\n\n上一轮 TaskSpec:\n${taskSpecBody}\n\nCC 上一轮 ImplementationReport:\n${JSON.stringify(firstReport, null, 2)}\n\n小五验收结果:\n${reviewBody}`,
            },
          ]);

          writeArtifact("fixtask-smallcalc-v1", {
            stepId: 6,
            actor: "小五",
            to: "CC",
            type: "FixTask",
            title: "SmallCalc 实现整改任务 v1",
            status: "created",
            summary: "小五通过真实 LLM 将不通过验收转成 CC 整改任务。",
            body: fixTaskBody,
          });

          const task = createTaskSpec(runId, fixTaskBody, {
            id: "task-smallcalc-implementation-001",
            messageId: "MSG-003",
            goal: "小五第一次验收不通过后，要求 CC 真实实现 SmallCalc MVP，并提交可验收的 ImplementationReport。",
            doNotImplementSmallCalcYet: false,
            acceptanceCriteria: [
              "CC 必须在目标仓库真实实现 SmallCalc MVP",
              "CC 必须运行可用的验证命令，并在报告中写明命令和结果",
              "CC 必须写回 ImplementationReport，且 didImplementSmallCalc 必须反映真实实现结果",
              "不得用 mock、占位文件或只补报告冒充实现",
            ],
          });
          const taskPath = path.join(ccInboxDir, `${task.id}.json`);
          const reportPath = path.join(xiaowuInboxDir, "report-smallcalc-implementation-001.json");

          writeJson(taskPath, task);
          appendRunEvent(runDir, { type: "status", status: "queued", text: `小五写入 FixTask：${taskPath}` });
          startCcWorker(runId, taskPath, reportPath);
          sendJson(res, { ok: true, runId, task });
          return;
        }

        if (req.method === "POST" && req.url === "/api/xiaowu/final-review") {
          await readBody(req);
          const fixTaskBody = readArtifactText("fixtask-smallcalc-v1");
          const implementationReport = readJsonFile<{ payload?: unknown } | null>(
            path.join(xiaowuInboxDir, "report-smallcalc-implementation-001.json"),
            null,
          );

          if (!fixTaskBody || !implementationReport) {
            sendJson(res, { error: "FixTask and second ImplementationReport are required before final review." }, 409);
            return;
          }

          const body = await llmProvider.complete([
            {
              role: "system",
              content:
                "你是小五 PM Agent。请基于 FixTask、CC 第二次报告和目标仓库文件快照做真实最终验收。不能编造通过；必须写出证据、风险和结论。输出中文 Markdown。",
            },
            {
              role: "user",
              content: `FixTask:\n${fixTaskBody}\n\nCC 第二次 ImplementationReport:\n${JSON.stringify(implementationReport, null, 2)}\n\n小五后端复验命令结果:\n${JSON.stringify(runTargetVerification(), null, 2)}\n\n目标仓库文件快照:\n${readTargetRepoSnapshot()}`,
            },
          ]);
          const artifact = writeArtifact("review-smallcalc-final-v1", {
            stepId: 7,
            actor: "小五",
            to: "CC",
            type: "FinalReviewResult",
            title: "小五再次验收报告 v1",
            status: "created",
            summary: "小五通过真实 LLM 基于 FixTask、CC 第二次报告和仓库快照生成最终验收。",
            body,
          });
          sendJson(res, { ok: true, artifact, llm: llmProvider.info });
          return;
        }

        sendJson(res, { error: "Not found" }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown API error";
        sendJson(res, { error: message }, 500);
      }
    });
    },
  };
}

export default defineConfig({
  plugins: [react(), agentBusPlugin()],
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
