import type {
  LambdaAgentEvent,
  LambdaAgentResponse,
} from "./types.js";
import { request as httpsRequest } from "node:https";
import { resolveProviderConfig } from "@serverless-openclaw/shared";
import { initConfig } from "./config-init.js";
import { SessionSync } from "./session-sync.js";
import { SessionLock } from "./session-lock.js";
import { resolveSecrets } from "./secrets.js";
import { runAgent } from "./agent-runner.js";

const providerConfig = resolveProviderConfig();

let initialized = false;

export async function handler(
  event: LambdaAgentEvent,
): Promise<LambdaAgentResponse> {
  const startTime = Date.now();

  process.env.HOME = "/tmp";

  const bucket = process.env.SESSION_BUCKET;
  if (!bucket) {
    return {
      success: false,
      error: "SESSION_BUCKET environment variable not set",
    };
  }

  const lock = new SessionLock(event.userId);
  const acquired = await lock.acquire();
  if (!acquired) {
    return {
      success: false,
      error: "Session is already being processed",
    };
  }

  if (!initialized) {
    let apiKey: string | undefined;

    if (providerConfig.provider === "anthropic") {
      const ssmKeyPath =
        process.env.SSM_ANTHROPIC_API_KEY ??
        "/serverless-openclaw/secrets/anthropic-api-key";

      const secrets = await resolveSecrets([ssmKeyPath]);
      apiKey = secrets.get(ssmKeyPath);
    } else if (providerConfig.provider === "google") {
      const ssmKeyPath =
        process.env.SSM_GEMINI_API_KEY ??
        "/serverless-openclaw/secrets/gemini-api-key";

      const secrets = await resolveSecrets([ssmKeyPath]);
      apiKey = secrets.get(ssmKeyPath);
    }

    await initConfig({
      anthropicApiKey: providerConfig.provider === "anthropic" ? apiKey : undefined,
      googleApiKey: providerConfig.provider === "google" ? apiKey : undefined,
      provider: providerConfig.provider,
      awsRegion: process.env.AWS_REGION,
    });
    initialized = true;
  }

  const sync = new SessionSync(bucket, "/tmp/.openclaw");
  const sessionFile = await sync.download(event.userId, event.sessionId);

  try {
    try {
      const result = await runAgent({
        sessionId: event.sessionId,
        sessionFile,
        workspaceDir: "/tmp/workspace",
        message: event.message,
        model: event.model ?? providerConfig.defaultModel,
        provider: providerConfig.openclawProvider,
        api: providerConfig.openclawApi,
        disableTools: event.disableTools,
        channel: event.channel,
      });

      await sync.upload(event.userId, event.sessionId);

      if (event.channel === "telegram" && event.telegramChatId) {
        await sendTelegramResponse(event.telegramChatId, result.payloads);
      }

      return {
        success: true,
        payloads: result.payloads,
        durationMs: Date.now() - startTime,
        provider: result.meta.agentMeta.provider,
        model: result.meta.agentMeta.model,
      };
    } catch (err: unknown) {
      await sync.upload(event.userId, event.sessionId);

      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  } finally {
    await lock.release();
  }
}

async function sendTelegramResponse(
  chatId: string,
  payloads?: Array<{ text?: string; mediaUrl?: string; isError?: boolean }>,
): Promise<void> {
  const botTokenSsmPath =
    process.env.SSM_TELEGRAM_BOT_TOKEN ??
    "/serverless-openclaw/secrets/telegram-bot-token";

  const secrets = await resolveSecrets([botTokenSsmPath]);
  const botToken = secrets.get(botTokenSsmPath);

  if (!botToken) {
    throw new Error("Telegram bot token not found at " + botTokenSsmPath);
  }

  for (const payload of payloads ?? []) {
    if (payload.text) {
      await httpPost(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: Number(chatId), text: payload.text },
      );
    }
  }
}

/** Minimal HTTPS POST using Node built-in modules (more reliable in Lambda containers than global fetch). */
async function httpPost(url: string, body: Record<string, unknown>): Promise<void> {
  const u = new URL(url);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(u, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let respBody = "";
      res.on("data", (chunk: Buffer) => { respBody += chunk.toString(); });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Telegram API error ${res.statusCode}: ${respBody.slice(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
