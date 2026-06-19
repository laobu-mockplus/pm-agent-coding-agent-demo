/* eslint-disable no-unused-vars */
import { spawn } from "node:child_process";
import readline from "node:readline";

export type AgentBusEvent = {
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

export type CcRunnerStatus = "queued" | "starting" | "ready" | "running" | "completed" | "failed" | "cancelled";

export type CcRunnerSnapshot = {
  provider: string;
  adapter: string;
  protocol: string;
  mode: string;
  status: CcRunnerStatus;
  threadId?: string;
  turnId?: string;
  pid?: number;
};

export type CcRunnerTask = {
  runId: string;
  targetRepoDir: string;
  taskPath: string;
  reportPath: string;
  prompt: string;
};

export type CcRunnerContext = {
  appendEvent: (event: Omit<AgentBusEvent, "at">) => void;
  writeReport: (value: unknown) => void;
  updateSnapshot: (snapshot: Partial<CcRunnerSnapshot>) => void;
};

export type CcRunnerHandle = {
  cancel: () => void;
};

export interface CcAgentRunner {
  readonly provider: string;
  readonly adapter: string;
  readonly protocol: string;
  start(task: CcRunnerTask, context: CcRunnerContext): CcRunnerHandle;
}

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function messageText(message: JsonRpcMessage) {
  if (message.error) {
    return message.error.message ?? JSON.stringify(message.error);
  }

  if (message.method) {
    return message.method;
  }

  return "json-rpc response";
}

function summarizeNotification(message: JsonRpcMessage) {
  const params = message.params ?? {};
  const item = (params as { item?: { type?: string; command?: string; status?: string; text?: string } }).item;
  const turn = (params as { turn?: { id?: string; status?: string } }).turn;
  const thread = (params as { thread?: { id?: string; status?: unknown } }).thread;
  const method = message.method ?? "notification";

  if (method === "item/commandExecution/outputDelta") {
    const delta = params as { delta?: string; chunk?: string; text?: string; itemId?: string };
    return {
      text: delta.delta ?? delta.chunk ?? delta.text ?? "command output delta",
      itemType: "commandExecution",
    };
  }

  if (item?.type === "commandExecution") {
    return {
      text: item.command ? `${item.status ?? "command"}: ${item.command}` : `${item.type}: ${item.status ?? ""}`,
      itemType: item.type,
    };
  }

  if (item?.type === "fileChange") {
    const changes = (item as unknown as { changes?: Array<{ path?: string; kind?: unknown }> }).changes ?? [];
    return {
      text: `fileChange ${item.status ?? ""}: ${changes.map((change) => change.path).filter(Boolean).join(", ")}`,
      itemType: item.type,
    };
  }

  if (item?.type === "agentMessage") {
    return {
      text: item.text ?? "agent message",
      itemType: item.type,
    };
  }

  if (item?.type) {
    return {
      text: `${item.type}: ${item.status ?? "updated"}`,
      itemType: item.type,
    };
  }

  if (turn?.id) {
    return { text: `turn ${turn.id}: ${turn.status ?? "updated"}` };
  }

  if (thread?.id) {
    return { text: `thread ${thread.id}` };
  }

  if (method === "turn/diff/updated") {
    return { text: "diff updated" };
  }

  return { text: messageText(message) };
}

// CC 调用器的第一版真实实现：通过官方 `codex app-server` JSON-RPC 协议管理 Codex。
// 这里故意只暴露 runner 接口，避免小五业务层直接依赖 Codex 专有协议；未来接 Qoder、
// Claude、Cursor 时应新增同接口实现，而不是改动 agentbus 的业务消息模型。
export class CodexAppServerRunner implements CcAgentRunner {
  readonly provider = "codex";
  readonly adapter = "Codex App Server";
  readonly protocol = "json-rpc/stdio";

  start(task: CcRunnerTask, context: CcRunnerContext): CcRunnerHandle {
    const proc = spawn("codex", ["app-server"], {
      cwd: task.targetRepoDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map<number, PendingRequest>();
    const output = readline.createInterface({ input: proc.stdout });
    let nextId = 1;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let terminalStatus: CcRunnerStatus | null = null;

    const update = (snapshot: Partial<CcRunnerSnapshot>) => {
      context.updateSnapshot({
        provider: this.provider,
        adapter: this.adapter,
        protocol: this.protocol,
        mode: "real",
        pid: proc.pid,
        ...snapshot,
      });
    };

    const send = (method: string, params: Record<string, unknown>, timeoutMs = 30_000) => {
      const id = nextId;
      nextId += 1;
      const request = { method, id, params };
      proc.stdin.write(`${JSON.stringify(request)}\n`);
      context.appendEvent({
        type: "codex-request",
        status: "sent",
        method,
        text: method,
        threadId,
        turnId,
      });

      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`codex app-server request timeout: ${method}`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
      });
    };

    const notify = (method: string, params: Record<string, unknown>) => {
      proc.stdin.write(`${JSON.stringify({ method, params })}\n`);
      context.appendEvent({ type: "codex-notification", status: "sent", method, text: method, threadId, turnId });
    };

    const fail = (error: Error) => {
      if (terminalStatus) {
        return;
      }

      terminalStatus = "failed";
      update({ status: "failed", threadId, turnId });
      context.appendEvent({ type: "error", status: "failed", text: error.message, threadId, turnId });
    };

    output.on("line", (line) => {
      let message: JsonRpcMessage;

      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        context.appendEvent({ type: "codex-raw", text: line, threadId, turnId });
        return;
      }

      if (typeof message.id === "number" && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (request) {
          clearTimeout(request.timer);
        }

        if (message.error) {
          request?.reject(new Error(messageText(message)));
        } else {
          request?.resolve(message.result);
        }
        return;
      }

      if (!message.method) {
        return;
      }

      const params = message.params ?? {};
      const eventThreadId =
        (params as { threadId?: string }).threadId ?? (params as { thread?: { id?: string } }).thread?.id ?? threadId;
      const eventTurnId = (params as { turnId?: string }).turnId ?? (params as { turn?: { id?: string } }).turn?.id ?? turnId;
      const summary = summarizeNotification(message);

      if (message.method === "thread/started" && eventThreadId) {
        threadId = eventThreadId;
        update({ status: "ready", threadId, turnId });
      }

      if (message.method === "turn/started" && eventTurnId) {
        turnId = eventTurnId;
        update({ status: "running", threadId, turnId });
      }

      if (message.method === "turn/completed") {
        const turnStatus = (params as { turn?: { status?: string } }).turn?.status;
        terminalStatus = turnStatus === "failed" ? "failed" : "completed";
        update({ status: terminalStatus, threadId, turnId });
        setTimeout(() => proc.kill(), 500);
      }

      context.appendEvent({
        type: "codex-event",
        status: message.method === "turn/completed" ? terminalStatus ?? "completed" : undefined,
        method: message.method,
        text: summary.text,
        threadId: eventThreadId,
        turnId: eventTurnId,
        itemType: summary.itemType,
      });
    });

    proc.stderr.on("data", (chunk) => {
      context.appendEvent({ type: "stderr", text: chunk.toString(), threadId, turnId });
    });

    proc.on("error", fail);

    proc.on("close", (code) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(`codex app-server exited before response, code ${code}`));
      }
      pending.clear();
      output.close();

      const status = terminalStatus ?? (code === 0 ? "completed" : "failed");
      terminalStatus = status;
      update({ status, threadId, turnId });
      context.appendEvent({
        type: "exit",
        status,
        code,
        text: `Codex app-server exited with code ${code}`,
        threadId,
        turnId,
      });
    });

    void (async () => {
      try {
        update({ status: "starting" });
        context.appendEvent({ type: "status", status: "starting", text: "启动 Codex App Server。" });

        await send("initialize", {
          clientInfo: {
            name: "xiaowu-pm-agent",
            title: "小五 PM Agent",
            version: "0.1.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        });
        notify("initialized", {});

        const threadResponse = (await send("thread/start", {
          cwd: task.targetRepoDir,
          approvalPolicy: "never",
          sandbox: "danger-full-access",
        })) as { thread?: { id?: string } };
        threadId = threadResponse.thread?.id;
        if (!threadId) {
          throw new Error("codex app-server did not return thread id");
        }
        update({ status: "ready", threadId });

        const turnResponse = (await send(
          "turn/start",
          {
            threadId,
            input: [{ type: "text", text: task.prompt }],
            cwd: task.targetRepoDir,
            approvalPolicy: "never",
            sandboxPolicy: { type: "dangerFullAccess" },
          },
          60_000,
        )) as { turn?: { id?: string } };
        turnId = turnResponse.turn?.id;
        update({ status: "running", threadId, turnId });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        proc.kill();
      }
    })();

    return {
      cancel: () => {
        terminalStatus = "cancelled";
        update({ status: "cancelled", threadId, turnId });
        proc.kill();
      },
    };
  }
}

export class CodexAppServerTestRunner implements CcAgentRunner {
  readonly provider = "codex";
  readonly adapter = "Codex App Server";
  readonly protocol = "json-rpc/stdio";

  start(task: CcRunnerTask, context: CcRunnerContext): CcRunnerHandle {
    const threadId = `thread-test-${task.runId}`;
    const turnId = `turn-test-${task.runId}`;

    context.updateSnapshot({
      provider: this.provider,
      adapter: this.adapter,
      protocol: this.protocol,
      mode: "test",
      status: "running",
      threadId,
      turnId,
    });
    context.appendEvent({ type: "status", status: "starting", text: "测试模式：模拟 Codex App Server 启动。" });
    context.appendEvent({ type: "codex-event", method: "thread/started", threadId, text: `thread ${threadId}` });
    context.appendEvent({ type: "codex-event", method: "turn/started", threadId, turnId, text: `turn ${turnId}: inProgress` });
    context.appendEvent({
      type: "codex-event",
      method: "item/started",
      threadId,
      turnId,
      itemType: "agentMessage",
      text: "CC test worker received TaskSpec through Codex App Server.",
    });
    context.writeReport({
      id: "report-smallcalc-mvp-001",
      messageId: "MSG-002",
      from: "CC",
      to: "小五",
      type: "ImplementationReport",
      runId: task.runId,
      status: "submitted",
      payload: {
        summary: "测试模式：CC 已通过 Codex App Server 调用器收到 TaskSpec。",
        didImplementSmallCalc: false,
      },
    });
    context.updateSnapshot({
      provider: this.provider,
      adapter: this.adapter,
      protocol: this.protocol,
      mode: "test",
      status: "completed",
      threadId,
      turnId,
    });
    context.appendEvent({ type: "codex-event", method: "turn/completed", status: "completed", threadId, turnId, text: "turn completed" });
    context.appendEvent({ type: "exit", status: "completed", code: 0, text: "Codex App Server test runner completed.", threadId, turnId });

    return {
      cancel: () => undefined,
    };
  }
}
