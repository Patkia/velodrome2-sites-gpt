import { createMonitorResponse } from "@/lib/server/monitor";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return createMonitorResponse({
    optimismRpcUrl: process.env.OPTIMISM_RPC_URL,
    walletAddress: process.env.WALLET_ADDRESS,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    testNotification: url.searchParams.get("testNotification") === "1",
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, HEAD, OPTIONS", "Cache-Control": "no-store" },
  });
}
