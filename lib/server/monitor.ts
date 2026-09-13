import { readLivePositions } from "./live-positions.ts";
import { isTelegramConfigured, sendTelegramMessage } from "./telegram.ts";
import type { DashboardPosition, PositionsResponse } from "../shared/positions-schema.ts";

type LiveReader = typeof readLivePositions;
type TelegramSender = typeof sendTelegramMessage;

type MonitorOptions = {
  optimismRpcUrl?: string;
  walletAddress?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  testNotification?: boolean;
  fetchImpl?: typeof fetch;
  readLive?: LiveReader;
  sendTelegram?: TelegramSender;
};

type MonitorPosition = {
  chain: string;
  chainId: number;
  positionId: string;
  pair: string;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  inRange: boolean;
};

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function pairLabel(position: DashboardPosition): string {
  return `${position.token0Symbol ?? shortAddress(position.token0)} / ${position.token1Symbol ?? shortAddress(position.token1)}`;
}

function sanitizePosition(position: DashboardPosition): MonitorPosition {
  return {
    chain: position.chain,
    chainId: position.chainId,
    positionId: position.positionId,
    pair: pairLabel(position),
    currentTick: position.currentTick,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    inRange: position.inRange,
  };
}

function outOfRangeMessage(position: MonitorPosition): string {
  return [
    `Out of range: [${position.chain.toUpperCase()}] ${position.pair}`,
    `Position #${position.positionId}`,
    `Tick: ${position.currentTick} (${position.tickLower} → ${position.tickUpper})`,
    "Source: ChatGPT Sites stateless test",
  ].join("\n");
}

const TEST_MESSAGE = "Velodrome2 Sites test notification\nSource: ChatGPT Sites owner-only manual test";

export async function readMonitorStateless(options: MonitorOptions) {
  const reader = options.readLive ?? readLivePositions;
  const sender = options.sendTelegram ?? sendTelegramMessage;
  const live: PositionsResponse = await reader({
    optimismRpcUrl: options.optimismRpcUrl,
    walletAddress: options.walletAddress,
    fetchImpl: options.fetchImpl,
  });

  const positions = live.positions.map(sanitizePosition);
  const outOfRangePositions = positions.filter((position) => !position.inRange);
  const inRange = positions.length - outOfRangePositions.length;
  const warnings = [...live.warnings];
  const telegramOptions = {
    botToken: options.telegramBotToken,
    chatId: options.telegramChatId,
    fetchImpl: options.fetchImpl,
  };
  const telegramAvailable = isTelegramConfigured(telegramOptions);
  let notificationsAttempted = 0;
  let notificationsSent = 0;

  const messages = options.testNotification
    ? [TEST_MESSAGE]
    : outOfRangePositions.map(outOfRangeMessage);

  for (const message of messages) {
    notificationsAttempted++;
    const result = await sender(message, telegramOptions);
    if (result.sent) {
      notificationsSent++;
    } else if (result.errorCode) {
      warnings.push(result.errorCode);
    }
  }

  const uniqueWarnings = [...new Set(warnings)];

  return {
    schemaVersion: 1,
    status: live.status === "partial" || uniqueWarnings.length > live.warnings.length ? "partial" as const : "ok" as const,
    mode: "stateless-test" as const,
    sideEffects: notificationsAttempted > 0,
    persistentDeduplication: false,
    testNotification: options.testNotification === true,
    generatedAt: live.generatedAt,
    positionsChecked: positions.length,
    inRange,
    outOfRange: outOfRangePositions.length,
    positionsByChain: live.chainCounts,
    currentOutOfRangePositions: outOfRangePositions,
    positions,
    unavailableChains: live.unavailableChains,
    warnings: uniqueWarnings,
    telegramAvailable,
    notificationsAttempted,
    notificationsSent,
    notificationEvaluation: {
      currentStateEvaluated: true,
      persistentStateAvailable: false,
      productionEquivalentDeduplication: false,
    },
  };
}

export async function createMonitorResponse(options: MonitorOptions): Promise<Response> {
  try {
    return Response.json(await readMonitorStateless(options), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        schemaVersion: 1,
        status: "error",
        mode: "stateless-test",
        persistentDeduplication: false,
        testNotification: options.testNotification === true,
        notificationsAttempted: 0,
        notificationsSent: 0,
        error: { code: "MONITOR_UNAVAILABLE" },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
