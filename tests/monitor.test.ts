import assert from "node:assert/strict";
import fs from "node:fs";
import { createMonitorResponse, readMonitorStateful } from "../lib/server/monitor.ts";
import { StateStoreError, type StateStore } from "../lib/server/upstash-state.ts";
import type { PositionsResponse } from "../lib/shared/positions-schema.ts";

const POSITION_MANAGER = "0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702";

function live(inRange: boolean, overrides: Partial<PositionsResponse> = {}): PositionsResponse {
  return {
    schemaVersion: 1,
    status: "ok",
    generatedAt: "2026-09-13T12:00:00.000Z",
    walletAddress: "0x1234...abcd",
    positionsChecked: 1,
    positions: [{
      chain: "Celo", chainId: 42220, positionId: "66532", source: "staked", liquidity: "200",
      token0: "0x0000000000000000000000000000000000000003", token0Symbol: "CELO", token0Decimals: 18,
      token1: "0x0000000000000000000000000000000000000004", token1Symbol: "USDC", token1Decimals: 6,
      token0Amount: 0, token0ValueUsd: 0, token1Amount: 208.22, token1ValueUsd: 208.19,
      currentValueUsd: 208.19, initialValueUsd: 207.47, profitLossUsd: 0.72, profitLossPercent: 0.35,
      rewardSymbol: "VELO", rewardAmount: 202.68, rewardValueUsd: 4.9,
      tickLower: -50, tickUpper: 50, currentTick: inRange ? 0 : 100, inRange,
      status: inRange ? "in-range" : "out-of-range",
      positionManager: POSITION_MANAGER,
    } as never],
    chainCounts: { Optimism: 0, Celo: 1, Soneium: 0 },
    unavailableChains: [],
    warnings: [],
    ...overrides,
  };
}

class MemoryStateStore implements StateStore {
  keys = new Set<string>();
  existsCalls = 0;
  writeCalls = 0;
  deleteCalls = 0;
  failExists = false;
  failWrite = false;
  failDelete = false;

  async exists(key: string) {
    this.existsCalls++;
    if (this.failExists) throw new StateStoreError("STATE_READ_FAILED");
    return this.keys.has(key);
  }
  async write(key: string) {
    this.writeCalls++;
    if (this.failWrite) throw new StateStoreError("STATE_WRITE_FAILED");
    this.keys.add(key);
  }
  async delete(key: string) {
    this.deleteCalls++;
    if (this.failDelete) throw new StateStoreError("STATE_DELETE_FAILED");
    this.keys.delete(key);
  }
}

const sent: string[] = [];
const sender = async (message: string) => {
  sent.push(message);
  return { sent: true as const };
};
const store = new MemoryStateStore();

const first = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: store,
  sendTelegram: sender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(first.mode, "stateful");
assert.equal(first.persistentDeduplication, true);
assert.equal(first.notificationsAttempted, 1);
assert.equal(first.notificationsSent, 1);
assert.equal(first.notificationsSuppressed, 0);
assert.equal(first.stateWrites, 1);
assert.equal(sent.length, 1);
assert.match(sent[0], /Out of range: \[CELO\] CELO\/USDC/);
assert.match(sent[0], /Initial Value: ~\$207\.47/);
assert.match(sent[0], /Current Value: ~\$208\.19/);
assert.match(sent[0], /P\/L: \+\$0\.72 \(\+0\.35%\)/);
assert.match(sent[0], /0\.00 CELO \(~\$0\.00\)/);
assert.match(sent[0], /208\.22 USDC \(~\$208\.19\)/);
assert.match(sent[0], /Reward 202\.68 VELO \(~\$4\.90\)/);

const repeated = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: store,
  sendTelegram: sender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(repeated.notificationsAttempted, 0);
assert.equal(repeated.notificationsSent, 0);
assert.equal(repeated.notificationsSuppressed, 1);
assert.equal(sent.length, 1);

const recovered = await readMonitorStateful({
  readLive: (async () => live(true)) as never,
  stateStore: store,
  sendTelegram: sender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(recovered.stateDeletes, 1);
assert.equal(recovered.notificationsAttempted, 0);
assert.equal(store.keys.size, 0);

const again = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: store,
  sendTelegram: sender as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
});
assert.equal(again.notificationsSent, 1);
assert.equal(sent.length, 2);

const rollbackStore = new MemoryStateStore();
const telegramFailure = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: rollbackStore,
  sendTelegram: (async () => ({ sent: false as const, errorCode: "TELEGRAM_SEND_FAILED" as const })) as never,
  telegramBotToken: "hidden-token",
  telegramChatId: "hidden-chat",
});
assert.equal(telegramFailure.notificationsAttempted, 1);
assert.equal(telegramFailure.notificationsSent, 0);
assert.equal(telegramFailure.stateWrites, 1);
assert.equal(telegramFailure.stateDeletes, 1);
assert.equal(rollbackStore.keys.size, 0);
assert.equal(telegramFailure.warnings.includes("TELEGRAM_SEND_FAILED"), true);
assert.equal(JSON.stringify(telegramFailure).includes("hidden-token"), false);

const readFailStore = new MemoryStateStore();
readFailStore.failExists = true;
let readFailSends = 0;
const readFailure = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: readFailStore,
  sendTelegram: (async () => { readFailSends++; return { sent: true as const }; }) as never,
});
assert.equal(readFailure.warnings.includes("STATE_READ_FAILED"), true);
assert.equal(readFailSends, 0);
assert.equal(readFailStore.writeCalls, 0);
assert.equal(readFailStore.deleteCalls, 0);

const writeFailStore = new MemoryStateStore();
writeFailStore.failWrite = true;
let writeFailSends = 0;
const writeFailure = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: writeFailStore,
  sendTelegram: (async () => { writeFailSends++; return { sent: true as const }; }) as never,
});
assert.equal(writeFailure.warnings.includes("STATE_WRITE_FAILED"), true);
assert.equal(writeFailSends, 0);

const deleteFailStore = new MemoryStateStore();
deleteFailStore.keys.add("42220-991d5546c4b442b4c5fdc4c8b8b8d131deb24702-66532.out-of-range");
deleteFailStore.failDelete = true;
const deleteFailure = await readMonitorStateful({
  readLive: (async () => live(true)) as never,
  stateStore: deleteFailStore,
  sendTelegram: sender as never,
});
assert.equal(deleteFailure.warnings.includes("STATE_DELETE_FAILED"), true);

const partialStore = new MemoryStateStore();
let partialSends = 0;
const partial = await readMonitorStateful({
  readLive: (async () => live(false, {
    status: "partial",
    unavailableChains: ["Optimism"],
    warnings: ["OPTIMISM_UNAVAILABLE"],
  })) as never,
  stateStore: partialStore,
  sendTelegram: (async () => { partialSends++; return { sent: true as const }; }) as never,
});
assert.equal(partial.status, "partial");
assert.equal(partial.warnings.includes("STATE_PROCESSING_SKIPPED_INCOMPLETE_COVERAGE"), true);
assert.equal(partialStore.existsCalls, 0);
assert.equal(partialStore.writeCalls, 0);
assert.equal(partialStore.deleteCalls, 0);
assert.equal(partialSends, 0);

const manualStore = new MemoryStateStore();
const manualMessages: string[] = [];
const manual = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  stateStore: manualStore,
  sendTelegram: (async (message: string) => { manualMessages.push(message); return { sent: true as const }; }) as never,
  telegramBotToken: "fake-token",
  telegramChatId: "fake-chat",
  testNotification: true,
});
assert.equal(manual.mode, "manual-test");
assert.equal(manual.notificationsAttempted, 1);
assert.equal(manual.notificationsSent, 1);
assert.equal(manualStore.existsCalls, 0);
assert.equal(manualStore.writeCalls, 0);
assert.equal(manualStore.deleteCalls, 0);
assert.match(manualMessages[0], /TEST — Velodrome2 Sites alert preview/);
assert.match(manualMessages[0], /Initial Value: ~\$207\.47/);
assert.match(manualMessages[0], /Current Value: ~\$208\.19/);
assert.match(manualMessages[0], /P\/L: \+\$0\.72 \(\+0\.35%\)/);
assert.match(manualMessages[0], /0\.00 CELO \(~\$0\.00\)/);
assert.match(manualMessages[0], /208\.22 USDC \(~\$208\.19\)/);
assert.match(manualMessages[0], /Reward 202\.68 VELO \(~\$4\.90\)/);
assert.doesNotMatch(manualMessages[0], /Out of range:/);

let missingStateSends = 0;
const missingState = await readMonitorStateful({
  readLive: (async () => live(false)) as never,
  sendTelegram: (async () => { missingStateSends++; return { sent: true as const }; }) as never,
});
assert.equal(missingState.mode, "stateful");
assert.equal(missingState.persistentDeduplication, false);
assert.equal(missingState.warnings.includes("STATE_UNAVAILABLE"), true);
assert.equal(missingState.notificationsAttempted, 0);
assert.equal(missingStateSends, 0);

const errorResponse = await createMonitorResponse({ readLive: (async () => { throw new Error("private rpc detail"); }) as never });
assert.equal(errorResponse.status, 502);
const errorBody = await errorResponse.json() as Record<string, unknown>;
assert.equal(errorBody.status, "error");
assert.equal(errorBody.mode, "stateful");
assert.equal(JSON.stringify(errorBody).includes("private rpc detail"), false);

const routeSource = fs.readFileSync("app/api/cron/monitor/route.ts", "utf8");
const handlerSource = fs.readFileSync("lib/server/cron-monitor-route.ts", "utf8");
const source = fs.readFileSync("lib/server/monitor.ts", "utf8");
assert.match(handlerSource, /testNotification/);
assert.match(routeSource, /process\.env\.UPSTASH_REDIS_REST_URL/);
assert.match(routeSource, /process\.env\.UPSTASH_REDIS_REST_TOKEN/);
assert.match(routeSource, /export async function GET/);
assert.match(routeSource, /export async function HEAD/);
assert.match(routeSource, /export async function OPTIONS/);
assert.doesNotMatch(routeSource, /export async function (POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(source, /vercel\.app|github/i);
assert.doesNotMatch(source, /writeFile|appendFile|file_put_contents|eth_sendTransaction|eth_sendRawTransaction|personal_sign|eth_sign/);

console.log("monitor.test: PASS");
