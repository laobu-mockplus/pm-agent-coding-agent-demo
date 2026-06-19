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
const targetRepoDir = path.resolve(rootDir, "../workspaces/smallcalc-app");
let activeRunner: CcRunnerHandle | null = null;
const llmProvider = new XiaowuLlmProvider(rootDir);

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

function createTaskSpec(runId: string, taskSpecBody: string) {
  return {
    id: "task-smallcalc-mvp-001",
    messageId: "MSG-001",
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
      goal: "小五基于真实 PRD 生成 TaskSpec，并通过 Codex App Server 调用器启动和管理 CC。",
      taskSpecBody,
      acceptanceCriteria: [
        "CC 必须通过 Codex App Server thread/turn 接收任务",
        "CC 必须写回 ImplementationReport",
        "UI 必须显示 Codex App Server 结构化事件",
      ],
      constraints: {
        doNotImplementSmallCalcYet: true,
        writeReportToXiaowuInbox: true,
      },
    },
  };
}

function buildCcPrompt(taskPath: string, reportPath: string, runId: string) {
  return `你是 CC。你现在被小五通过 Codex App Server 调用器唤起。

请严格读取 TaskSpec，并按 TaskSpec 执行。当前阶段如果 TaskSpec 明确要求不要实现 SmallCalc，就不得实现；如果 TaskSpec 要求实现，则按目标仓库完成实现。

1. 读取 TaskSpec 文件：${taskPath}
2. 输出几条简短进度日志，说明你读到了任务、确认目标仓库、准备写报告。
3. 创建 ImplementationReport JSON 文件：${reportPath}

ImplementationReport JSON 必须包含：
{
  "id": "report-smallcalc-mvp-001",
  "messageId": "MSG-002",
  "from": "CC",
  "to": "小五",
  "type": "ImplementationReport",
  "runId": "${runId}",
  "status": "submitted",
  "payload": {
    "summary": "CC 已通过 Codex App Server 收到并读取 TaskSpec，并已按 TaskSpec 提交本轮执行报告。",
    "didImplementSmallCalc": false,
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

function agentBusPlugin() {
  return {
    name: "xiaowu-agentbus-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/agentbus") && !req.url?.startsWith("/api/xiaowu")) {
          next();
          return;
        }

        ensureDir(ccInboxDir);
        ensureDir(xiaowuInboxDir);
        ensureDir(artifactsDir);
        ensureDir(runsDir);

        try {
        if (req.method === "GET" && req.url === "/api/agentbus/state") {
          const tasks = readJsonFiles(ccInboxDir);
          const reports = readJsonFiles(xiaowuInboxDir);
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
          activeRunner?.cancel();
          activeRunner = null;
          fs.rmSync(ccInboxDir, { recursive: true, force: true });
          fs.rmSync(xiaowuInboxDir, { recursive: true, force: true });
          fs.rmSync(artifactsDir, { recursive: true, force: true });
          fs.rmSync(runsDir, { recursive: true, force: true });
          ensureDir(ccInboxDir);
          ensureDir(xiaowuInboxDir);
          ensureDir(artifactsDir);
          ensureDir(runsDir);
          fs.writeFileSync(path.join(runsDir, ".gitkeep"), "");
          sendJson(res, { ok: true });
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
          const task = createTaskSpec(runId, taskSpecBody);
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
