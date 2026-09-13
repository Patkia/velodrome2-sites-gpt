import { authorizeCronRequest } from "./cron-auth.ts";
import { createMonitorResponse } from "./monitor.ts";

type MonitorRunner = typeof createMonitorResponse;

type CronMonitorRouteOptions = {
  cronSecret?: string;
  optimismRpcUrl?: string;
  walletAddress?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  upstashRestUrl?: string;
  upstashRestToken?: string;
  runMonitor?: MonitorRunner;
};

export async function handleCronMonitorGet(
  request: Request,
  options: CronMonitorRouteOptions,
): Promise<Response> {
  const auth = await authorizeCronRequest(
    options.cronSecret,
    request.headers.get("authorization"),
  );
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const runMonitor = options.runMonitor ?? createMonitorResponse;
  return runMonitor({
    optimismRpcUrl: options.optimismRpcUrl,
    walletAddress: options.walletAddress,
    telegramBotToken: options.telegramBotToken,
    telegramChatId: options.telegramChatId,
    upstashRestUrl: options.upstashRestUrl,
    upstashRestToken: options.upstashRestToken,
    testNotification: url.searchParams.get("testNotification") === "1",
  });
}
