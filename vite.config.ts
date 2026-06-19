import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type AgentBusEvent = {
  at: string;
  type: string;
  text?: string;
  status?: string;
  code?: number | null;
};

const rootDir = process.cwd();
const agentBusDir = path.join(rootDir, ".agentbus");
const ccInboxDir = path.join(agentBusDir, "cc-inbox");
const xiaowuInboxDir = path.join(agentBusDir, "xiaowu-inbox");
const runsDir = path.join(agentBusDir, "runs");
const targetRepoDir = path.resolve(rootDir, "../workspaces/smallcalc-app");
let activeWorker: ChildProcessWithoutNullStreams | null = null;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonFiles(dir: string) {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

function appendRunEvent(runDir: string, event: Omit<AgentBusEvent, "at">) {
  ensureDir(runDir);
  fs.appendFileSync(
    path.join(runDir, "events.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
  );
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
    spawn("git", ["init"], { cwd: targetRepoDir });
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

function createTaskSpec(runId: string) {
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
    payload: {
      product: "SmallCalc",
      goal: "验证小五能通过真实 inbox 命令 CC。当前探针不实现 SmallCalc 程序。",
      acceptanceCriteria: ["CC 必须读取 TaskSpec", "CC 必须写回 ImplementationReport", "UI 必须显示执行日志"],
      constraints: {
        doNotImplementSmallCalcYet: true,
        writeReportToXiaowuInbox: true,
      },
    },
  };
}

function buildCcPrompt(taskPath: string, reportPath: string, runId: string) {
  return `你是 CC。你现在被小五通过真实 .agentbus inbox 唤起。

请严格执行这个通信探针，不要实现 SmallCalc 程序，不要创建 PR，不要修改目标仓库业务代码。

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
    "summary": "CC 已通过真实 agentbus 收到并读取 TaskSpec。本轮仅验证通信和执行链路，未实现 SmallCalc。",
    "didImplementSmallCalc": false,
    "next": "等待小五验收通信链路后，再决定是否启动真实 SmallCalc 实现。"
  }
}
`;
}

function startCcWorker(runId: string, taskPath: string, reportPath: string) {
  const runDir = path.join(runsDir, runId);
  const mode = process.env.XIAOWU_CC_MODE ?? "real";

  appendRunEvent(runDir, { type: "status", status: "starting", text: `启动 CC worker，模式：${mode}` });

  if (mode === "test") {
    appendRunEvent(runDir, { type: "stdout", text: "CC test worker received TaskSpec." });
    writeJson(reportPath, {
      id: "report-smallcalc-mvp-001",
      messageId: "MSG-002",
      from: "CC",
      to: "小五",
      type: "ImplementationReport",
      runId,
      status: "submitted",
      payload: {
        summary: "测试模式：CC 已通过 agentbus 收到 TaskSpec。",
        didImplementSmallCalc: false,
      },
    });
    appendRunEvent(runDir, { type: "status", status: "completed", text: "测试模式报告已写回。" });
    return;
  }

  const prompt = buildCcPrompt(taskPath, reportPath, runId);
  activeWorker = spawn("codex", ["-a", "never", "-s", "danger-full-access", "exec", "--cd", targetRepoDir, prompt], {
    cwd: targetRepoDir,
  });
  activeWorker.stdin.end();

  activeWorker.stdout.on("data", (chunk) => {
    appendRunEvent(runDir, { type: "stdout", text: chunk.toString() });
  });
  activeWorker.stderr.on("data", (chunk) => {
    appendRunEvent(runDir, { type: "stderr", text: chunk.toString() });
  });
  activeWorker.on("error", (error) => {
    appendRunEvent(runDir, { type: "error", status: "failed", text: error.message });
  });
  activeWorker.on("close", (code) => {
    appendRunEvent(runDir, {
      type: "exit",
      status: code === 0 ? "completed" : "failed",
      code,
      text: `CC worker exited with code ${code}`,
    });
    activeWorker = null;
  });
}

function agentBusPlugin() {
  return {
    name: "xiaowu-agentbus-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/agentbus")) {
          next();
          return;
        }

        ensureDir(ccInboxDir);
        ensureDir(xiaowuInboxDir);
        ensureDir(runsDir);

        if (req.method === "GET" && req.url === "/api/agentbus/state") {
          const tasks = readJsonFiles(ccInboxDir);
          const reports = readJsonFiles(xiaowuInboxDir);
          const runIds = fs
            .readdirSync(runsDir)
            .filter((name) => name !== ".gitkeep")
            .sort();
          const latestRunId = runIds.at(-1);
          const runDir = latestRunId ? path.join(runsDir, latestRunId) : null;
          const events = runDir ? readRunEvents(runDir) : [];
          const latestExit = [...events].reverse().find((event) => event.type === "exit" || event.type === "error");

          sendJson(res, {
            tasks,
            reports,
            messages: [
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
                  events,
                }
              : null,
          });
          return;
        }

        if (req.method === "POST" && req.url === "/api/agentbus/reset") {
          activeWorker?.kill();
          activeWorker = null;
          fs.rmSync(ccInboxDir, { recursive: true, force: true });
          fs.rmSync(xiaowuInboxDir, { recursive: true, force: true });
          fs.rmSync(runsDir, { recursive: true, force: true });
          ensureDir(ccInboxDir);
          ensureDir(xiaowuInboxDir);
          ensureDir(runsDir);
          fs.writeFileSync(path.join(runsDir, ".gitkeep"), "");
          sendJson(res, { ok: true });
          return;
        }

        if (req.method === "POST" && req.url === "/api/agentbus/tasks/smallcalc") {
          await readBody(req);
          ensureTargetRepo();
          const runId = `run-${Date.now()}`;
          const runDir = path.join(runsDir, runId);
          const task = createTaskSpec(runId);
          const taskPath = path.join(ccInboxDir, `${task.id}.json`);
          const reportPath = path.join(xiaowuInboxDir, "report-smallcalc-mvp-001.json");

          writeJson(taskPath, task);
          appendRunEvent(runDir, { type: "status", status: "queued", text: `小五写入 TaskSpec：${taskPath}` });
          startCcWorker(runId, taskPath, reportPath);
          sendJson(res, { ok: true, runId, task });
          return;
        }

        sendJson(res, { error: "Not found" }, 404);
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
