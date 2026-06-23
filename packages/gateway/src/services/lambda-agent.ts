import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { LambdaAgentEvent, LambdaAgentResponse } from "@serverless-openclaw/shared";

const lambda = new LambdaClient({});

export interface InvokeLambdaAgentParams {
  functionArn: string;
  userId: string;
  sessionId: string;
  message: string;
  channel: "web" | "telegram";
  connectionId?: string;
  telegramChatId?: string;
  disableTools?: boolean;
}

/**
 * Invoke the Lambda agent function synchronously.
 * Returns the agent response or throws on failure.
 */
export async function invokeLambdaAgent(
  params: InvokeLambdaAgentParams,
): Promise<LambdaAgentResponse> {
  const payload: LambdaAgentEvent = {
    userId: params.userId,
    sessionId: params.sessionId,
    message: params.message,
    channel: params.channel,
    connectionId: params.connectionId,
    telegramChatId: params.telegramChatId,
    disableTools: params.disableTools,
  };

  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: params.functionArn,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (result.FunctionError) {
    const errorPayload = result.Payload
      ? JSON.parse(Buffer.from(result.Payload).toString())
      : { errorMessage: "Lambda function error" };
    throw new Error(errorPayload.errorMessage ?? "Lambda agent invocation failed");
  }

  if (!result.Payload) {
    throw new Error("Lambda agent returned empty payload");
  }

  return JSON.parse(Buffer.from(result.Payload).toString()) as LambdaAgentResponse;
}

/**
 * Invoke the Lambda agent function asynchronously (fire-and-forget).
 * The agent itself is responsible for sending any response (e.g. via Telegram API).
 */
export async function invokeLambdaAgentAsync(
  params: InvokeLambdaAgentParams,
): Promise<void> {
  const payload: LambdaAgentEvent = {
    userId: params.userId,
    sessionId: params.sessionId,
    message: params.message,
    channel: params.channel,
    connectionId: params.connectionId,
    telegramChatId: params.telegramChatId,
    disableTools: params.disableTools,
  };

  try {
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: params.functionArn,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );

    if (result.FunctionError) {
      console.warn("[lambda] async invoke had error:", result.FunctionError);
    }
  } catch (err) {
    console.error("[lambda] async invoke failed:", err);
  }
}
