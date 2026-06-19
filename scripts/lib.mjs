import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const agentbusDir = join(rootDir, ".agentbus");
export const latestPath = join(agentbusDir, "latest.json");

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function runInteractive(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

export function ensureAgentbus() {
  mkdirSync(agentbusDir, { recursive: true });
  mkdirSync(join(agentbusDir, "runs"), { recursive: true });
}

export function readLatest() {
  return JSON.parse(readFileSync(latestPath, "utf8"));
}

export function writeLatest(next) {
  ensureAgentbus();
  writeFileSync(latestPath, `${JSON.stringify(next, null, 2)}\n`);
}

export function appendEvent(type, payload) {
  ensureAgentbus();
  const latest = existsLatest();
  const runId = latest?.runId ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = join(agentbusDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const line = JSON.stringify({ type, at: new Date().toISOString(), ...payload });
  writeFileSync(join(runDir, "events.jsonl"), `${line}\n`, { flag: "a" });
}

export function existsLatest() {
  try {
    return readLatest();
  } catch {
    return null;
  }
}

export function getRepo() {
  return JSON.parse(run("gh", ["repo", "view", "--json", "nameWithOwner,url"]));
}

export function getOpenPr() {
  const json = run("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    "cc/smallcalc-mvp",
    "--json",
    "number,url,headRefName,title,body",
    "--limit",
    "1",
  ]);
  const prs = JSON.parse(json);
  if (!prs[0]) {
    throw new Error("No open PR found for cc/smallcalc-mvp");
  }
  return prs[0];
}

export function writeTempFile(name, content) {
  ensureAgentbus();
  const path = join(agentbusDir, name);
  writeFileSync(path, content);
  return path;
}
