import fs from "node:fs";
import path from "node:path";

type EnvMap = Record<string, string>;

export type LlmProviderInfo = {
  provider: "openai" | "azure-openai";
  baseUrl: string;
  model: string;
  configured: boolean;
  candidates: Array<{
    provider: "openai" | "azure-openai";
    baseUrl: string;
    model: string;
  }>;
  lastUsed?: "openai" | "azure-openai";
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type LlmCandidate = {
  provider: "openai" | "azure-openai";
  baseUrl: string;
  model: string;
  apiKey: string;
};

function parseEnvFile(filePath: string) {
  const env: EnvMap = {};

  if (!fs.existsSync(filePath)) {
    return env;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }

  return env;
}

function readLocalEnv(rootDir: string) {
  return {
    ...parseEnvFile(path.resolve(rootDir, "../.env.local")),
    ...parseEnvFile(path.resolve(rootDir, ".env.local")),
  };
}

function trimBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

// 小五自己的 LLM Provider：读取工作区 `.env.local`，使用 OpenAI-compatible chat completions。
// 这里不把密钥暴露给前端；前端只能看到 provider、baseUrl、model 的非敏感摘要。
export class XiaowuLlmProvider {
  private readonly env: EnvMap;
  private readonly candidates: LlmCandidate[];
  readonly info: LlmProviderInfo;

  constructor(rootDir: string) {
    this.env = readLocalEnv(rootDir);
    this.candidates = [
      this.env.OPENAI_API_KEY && this.env.OPENAI_BASE_URL && this.env.OPENAI_MODEL
        ? {
            provider: "openai" as const,
            baseUrl: trimBaseUrl(this.env.OPENAI_BASE_URL),
            model: this.env.OPENAI_MODEL,
            apiKey: this.env.OPENAI_API_KEY,
          }
        : null,
      this.env.AZURE_OPENAI_API_KEY && this.env.AZURE_OPENAI_BASE_URL && this.env.AZURE_OPENAI_MODEL
        ? {
            provider: "azure-openai" as const,
            baseUrl: trimBaseUrl(this.env.AZURE_OPENAI_BASE_URL),
            model: this.env.AZURE_OPENAI_MODEL,
            apiKey: this.env.AZURE_OPENAI_API_KEY,
          }
        : null,
    ].filter((candidate): candidate is LlmCandidate => Boolean(candidate));

    const primary = this.candidates[0];

    this.info = {
      provider: primary?.provider ?? "openai",
      baseUrl: primary?.baseUrl ?? "",
      model: primary?.model ?? "",
      configured: this.candidates.length > 0,
      candidates: this.candidates.map(({ provider, baseUrl, model }) => ({ provider, baseUrl, model })),
    };
  }

  async complete(messages: ChatMessage[]) {
    if (!this.info.configured) {
      throw new Error("LLM provider is not configured. Expected OPENAI_* or AZURE_OPENAI_* in .env.local.");
    }

    const failures: string[] = [];

    for (const candidate of this.candidates) {
      try {
        const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${candidate.apiKey}`,
            "Content-Type": "application/json",
            ...(candidate.provider === "azure-openai" ? { "api-key": candidate.apiKey } : {}),
          },
          body: JSON.stringify({
            model: candidate.model,
            messages,
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`${response.status} ${detail.slice(0, 500)}`);
        }

        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content?.trim();

        if (!content) {
          throw new Error("empty content");
        }

        this.info.lastUsed = candidate.provider;
        return content;
      } catch (error) {
        const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
        const message = error instanceof Error ? `${error.message}${cause?.code ? ` (${cause.code})` : ""}` : "unknown error";
        failures.push(`${candidate.provider}: ${message}`);
      }
    }

    throw new Error(`All configured LLM providers failed. ${failures.join(" | ")}`);
  }
}
