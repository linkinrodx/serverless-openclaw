import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { LambdaAgentEvent } from "@serverless-openclaw/shared";

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
 * Invoke the Lambda agent function asynchronously (fire-and-forget).
 * The agent itself is responsible for sending any response via Telegram.
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

  await lambda.send(
    new InvokeCommand({
      FunctionName: params.functionArn,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
}
