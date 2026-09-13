import assert from "node:assert/strict";
import fs from "node:fs";
import { createMonitorResponse, readMonitorStateless } from "../lib/server/monitor.ts";
import type { PositionsResponse } from "../lib/shared/positions-schema.ts";

const base: PositionsResponse = {
  schemaVersion: 1,
  status: "ok",
  generatedAt: "2026-09-13T12:00:00.000Z",
  walletAddress: "0x1234...abcd",
  positionsChecked: 2,
  positions: [
    {
      chain: "Celo", chainId: 42220, positionId: "2", source: "staked", liquidity: "200",
      token0: "0x0000000000000000000000000000000000000003", token0Symbol: "CELO", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000004", token1Symbol: "USDC", token1Decimals: 6,
      tickLower: -50, tickUpper: 50, currentTick: 0, inRange: true, status: "in-range",
    },
    {
      chain: "Soneium", chainId: 1868, positionId: "3", source: "staked", liquidity: "300",
      token0: "0x0000000000000000000000000000000000000005", token0Symbol: "ASTR", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000006", token1Symbol: "WETH", token1Decimals: 18,
      tickLower: -200, tickUpper: -100, currentTick: -150, inRange: true, status: "in-range",
    },
  ],
  chainCounts: { Optimism: 0, Celo: 1, Soneium: 1 },
  unavailableChains: [],
  warnings: [],
};

const successfulSender = async () => ({ sent: true as const });

const allInRange = await readMonitorStateless({
  readLive: (async () => base) as never,
  sendTelegram: successfulSender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(allInRange.mode, "stateless-test");
assert.equal(allInRange.persistentDeduplication, false);
assert.equal(allInRange.positionsChecked, 2);
assert.equal(allInRange.inRange, 2);
assert.equal(allInRange.outOfRange, 0);
assert.equal(allInRange.notificationsAttempted, 0);
assert.equal(allInRange.notificationsSent, 0);

const outOfRangeLive: PositionsResponse = {
  ...base,
  positions: [
    { ...base.positions[0], currentTick: 100, inRange: false, status: "out-of-range" },
    base.positions[1],
  ],
};

const sentMessages: string[] = [];
const recordingSender = async (message: string) => {
  sentMessages.push(message);
  return { sent: true as const };
};
const outOfRange = await readMonitorStateless({
  readLive: (async () => outOfRangeLive) as never,
  sendTelegram: recordingSender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(outOfRange.outOfRange, 1);
assert.equal(outOfRange.notificationsAttempted, 1);
assert.equal(outOfRange.notificationsSent, 1);
assert.equal(sentMessages.length, 1);
assert.match(sentMessages[0], /Out of range: \[CELO\] CELO \/ USDC/);

await readMonitorStateless({
  readLive: (async () => outOfRangeLive) as never,
  sendTelegram: recordingSender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(sentMessages.length, 2, "stateless repeated calls may send duplicate alerts");

const manualMessages: string[] = [];
const manual = await readMonitorStateless({
  readLive: (async () => outOfRangeLive) as never,
  sendTelegram: (async (message: string) => {
    manualMessages.push(message);
    return { sent: true as const };
  }) as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
  testNotification: true,
});
assert.equal(manual.testNotification, true);
assert.equal(manual.notificationsAttempted, 1);
assert.equal(manual.notificationsSent, 1);
assert.equal(manualMessages.length, 1);
assert.match(manualMessages[0], /Velodrome2 Sites test notification/);
assert.doesNotMatch(manualMessages[0], /Out of range/);

const missingEnv = await readMonitorStateless({
  readLive: (async () => outOfRangeLive) as never,
  sendTelegram: (async () => ({ sent: false as const, errorCode: "TELEGRAM_UNAVAILABLE" as const })) as never,
});
assert.equal(missingEnv.positionsChecked, 2);
assert.equal(missingEnv.notificationsAttempted, 1);
assert.equal(missingEnv.notificationsSent, 0);
assert.equal(missingEnv.status, "partial");
assert.equal(missingEnv.warnings.includes("TELEGRAM_UNAVAILABLE"), true);

const telegramFailure = await readMonitorStateless({
  readLive: (async () => outOfRangeLive) as never,
  sendTelegram: (async () => ({ sent: false as const, errorCode: "TELEGRAM_SEND_FAILED" as const })) as never,
  telegramBotToken: "super-secret-token",
  telegramChatId: "secret-chat-id",
});
const failureJson = JSON.stringify(telegramFailure);
assert.equal(telegramFailure.status, "partial");
assert.equal(telegramFailure.notificationsSent, 0);
assert.equal(telegramFailure.warnings.includes("TELEGRAM_SEND_FAILED"), true);
assert.equal(failureJson.includes("super-secret-token"), false);
assert.equal(failureJson.includes("secret-chat-id"), false);

const partial = await readMonitorStateless({
  readLive: (async () => ({ ...base, status: "partial" as const, unavailableChains: ["Optimism"], warnings: ["OPTIMISM_UNAVAILABLE"] })) as never,
  sendTelegram: successfulSender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(partial.status, "partial");
assert.deepEqual(partial.unavailableChains, ["Optimism"]);

const errorResponse = await createMonitorResponse({ readLive: (async () => { throw new Error("secret rpc body"); }) as never });
assert.equal(errorResponse.status, 502);
const errorBody = await errorResponse.json() as Record<string, unknown>;
assert.equal(errorBody.status, "error");
assert.equal(errorBody.mode, "stateless-test");
assert.equal(JSON.stringify(errorBody).includes("secret rpc body"), false);

const routeSource = fs.readFileSync("app/api/cron/monitor/route.ts", "utf8");
const handlerSource = fs.readFileSync("lib/server/cron-monitor-route.ts", "utf8");
const source = fs.readFileSync("lib/server/monitor.ts", "utf8");
assert.match(handlerSource, /testNotification/);
assert.match(routeSource, /process\.env\.TELEGRAM_BOT_TOKEN/);
assert.match(routeSource, /process\.env\.TELEGRAM_CHAT_ID/);
assert.match(routeSource, /export async function GET/);
assert.match(routeSource, /export async function HEAD/);
assert.match(routeSource, /export async function OPTIONS/);
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(source, /upstash|redis|vercel\.app|github/i);
assert.doesNotMatch(source, /writeFile|appendFile|file_put_contents|eth_sendTransaction|eth_sendRawTransaction|personal_sign|eth_sign/);

console.log("monitor.test: PASS");
