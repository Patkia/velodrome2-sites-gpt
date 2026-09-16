import { readLivePositions } from "./live-positions.ts";
import { isTelegramConfigured, sendTelegramMessage } from "./telegram.ts";
import {
  StateStoreError,
  UpstashStateStore,
  isStateConfigured,
  type StateStore,
} from "./upstash-state.ts";
import type { DashboardPosition, PositionsResponse } from "../shared/positions-schema.ts";

type LiveReader = typeof readLivePositions;
type TelegramSender = typeof sendTelegramMessage;
type InternalPosition = DashboardPosition & { positionManager?: string };

type MonitorOptions = {
  optimismRpcUrl?: string;
  walletAddress?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  upstashRestUrl?: string;
  upstashRestToken?: string;
  testNotification?: boolean;
  fetchImpl?: typeof fetch;
  readLive?: LiveReader;
  sendTelegram?: TelegramSender;
  stateStore?: StateStore;
};

type MonitorPosition = {
  chain: string;
  chainId: number;
  positionId: string;
  pair: string;
  inRange: boolean;
  initialValueUsd: number | null;
  currentValueUsd: number | null;
  profitLossUsd: number | null;
  profitLossPercent: number | null;
  token0Symbol: string | null;
  token0Amount: number | null;
  token0ValueUsd: number | null;
  token1Symbol: string | null;
  token1Amount: number | null;
  token1ValueUsd: number | null;
  rewardSymbol: string | null;
  rewardAmount: number | null;
  rewardValueUsd: number | null;
};

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function pairLabel(position: DashboardPosition): string {
  return `${position.token0Symbol ?? shortAddress(position.token0)}/${position.token1Symbol ?? shortAddress(position.token1)}`;
}

function sanitizePosition(position: DashboardPosition): MonitorPosition {
  return {
    chain: position.chain,
    chainId: position.chainId,
    positionId: position.positionId,
    pair: pairLabel(position),
    inRange: position.inRange,
    initialValueUsd: position.initialValueUsd,
    currentValueUsd: position.currentValueUsd,
    profitLossUsd: position.profitLossUsd,
    profitLossPercent: position.profitLossPercent,
    token0Symbol: position.token0Symbol,
    token0Amount: position.token0Amount,
    token0ValueUsd: position.token0ValueUsd,
    token1Symbol: position.token1Symbol,
    token1Amount: position.token1Amount,
    token1ValueUsd: position.token1ValueUsd,
    rewardSymbol: position.rewardSymbol,
    rewardAmount: position.rewardAmount,
    rewardValueUsd: position.rewardValueUsd,
  };
}

function usd(value: number | null | undefined): string {
  return value == null ? "unavailable" : `~$${value.toFixed(2)}`;
}

function amount(value: number | null | undefined): string {
  return value == null ? "unavailable" : value.toFixed(2);
}

function pnl(position: MonitorPosition): string {
  if (position.profitLossUsd == null || position.profitLossPercent == null) return "unavailable";
  const sign = position.profitLossUsd >= 0 ? "+" : "-";
  const percentSign = position.profitLossPercent >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(position.profitLossUsd).toFixed(2)} (${percentSign}${Math.abs(position.profitLossPercent).toFixed(2)}%)`;
}

function tokenLine(symbol: string | null, tokenAmount: number | null, valueUsd: number | null): string {
  return `${amount(tokenAmount)} ${symbol ?? "Token"} (${usd(valueUsd)})`;
}

function rewardLine(position: MonitorPosition): string {
  if (position.rewardAmount == null) return "Reward unavailable";
  return `Reward ${amount(position.rewardAmount)} ${position.rewardSymbol ?? "Token"} (${usd(position.rewardValueUsd)})`;
}

function outOfRangeMessage(position: MonitorPosition): string {
  return [
    `Out of range: [${position.chain.toUpperCase()}] ${position.pair}`,
    `Initial Value: ${usd(position.initialValueUsd)}`,
    `Current Value: ${usd(position.currentValueUsd)}`,
    `P/L: ${pnl(position)}`,
    tokenLine(position.token0Symbol, position.token0Amount, position.token0ValueUsd),
    tokenLine(position.token1Symbol, position.token1Amount, position.token1ValueUsd),
    rewardLine(position),
  ].join("\n");
}

function testPreviewMessage(position: MonitorPosition | undefined): string {
  if (!position) return "Velodrome2 Sites test notification\nNo active position available for preview";
  return [
    "TEST — Velodrome2 Sites alert preview",
    `[${position.chain.toUpperCase()}] ${position.pair}`,
    `Initial Value: ${usd(position.initialValueUsd)}`,
    `Current Value: ${usd(position.currentValueUsd)}`,
    `P/L: ${pnl(position)}`,
    tokenLine(position.token0Symbol, position.token0Amount, position.token0ValueUsd),
    tokenLine(position.token1Symbol, position.token1Amount, position.token1ValueUsd),
    rewardLine(position),
  ].join("\n");
}

function positionStateKey(position: InternalPosition): string | null {
  if (!position.positionManager) return null;
  const manager = position.positionManager.toLowerCase().replace(/^0x/, "");
  return `${position.chainId}-${manager}-${position.positionId}.out-of-range`;
}

function hasIncompleteBlockchainCoverage(live: PositionsResponse): boolean {
  if (live.unavailableChains.length > 0) return true;
  return live.warnings.some((warning) => (
    warning.includes("CHAIN_UNAVAILABLE")
    || warning.includes("MULTICHAIN_UNAVAILABLE")
    || warning.includes("GAUGE_READ_PARTIAL")
    || warning.includes("POSITION_READ_PARTIAL")
  ));
}

function stateErrorCode(error: unknown): string {
  return error instanceof StateStoreError ? error.code : "STATE_BACKEND_FAILED";
}

async function readLive(options: MonitorOptions): Promise<PositionsResponse> {
  const reader = options.readLive ?? readLivePositions;
  return reader({
    optimismRpcUrl: options.optimismRpcUrl,
    walletAddress: options.walletAddress,
    fetchImpl: options.fetchImpl,
    includeStateIdentity: true,
    includeFinancialData: true,
  });
}

function telegramOptions(options: MonitorOptions) {
  return {
    botToken: options.telegramBotToken,
    chatId: options.telegramChatId,
    fetchImpl: options.fetchImpl,
  };
}

export async function readMonitorStateful(options: MonitorOptions) {
  const live = await readLive(options);
  const internalPositions = live.positions as InternalPosition[];
  const positions = internalPositions.map(sanitizePosition);
  const outOfRangePositions = positions.filter((position) => !position.inRange);
  const inRange = positions.length - outOfRangePositions.length;
  const warnings = [...live.warnings];
  const sender = options.sendTelegram ?? sendTelegramMessage;
  const tgOptions = telegramOptions(options);
  const telegramAvailable = isTelegramConfigured(tgOptions);
  let notificationsAttempted = 0;
  let notificationsSent = 0;
  let notificationsSuppressed = 0;
  let stateWrites = 0;
  let stateDeletes = 0;

  if (options.testNotification) {
    notificationsAttempted = 1;
    const result = await sender(testPreviewMessage(positions[0]), tgOptions);
    if (result.sent) notificationsSent = 1;
    else if (result.errorCode) warnings.push(result.errorCode);
    return {
      schemaVersion: 1,
      status: result.sent && live.status === "ok" ? "ok" as const : "partial" as const,
      mode: "manual-test" as const,
      sideEffects: true,
      persistentDeduplication: false,
      testNotification: true,
      generatedAt: live.generatedAt,
      positionsChecked: positions.length,
      inRange,
      outOfRange: outOfRangePositions.length,
      positionsByChain: live.chainCounts,
      currentOutOfRangePositions: outOfRangePositions,
      positions,
      unavailableChains: live.unavailableChains,
      warnings: [...new Set(warnings)],
      telegramAvailable,
      notificationsAttempted,
      notificationsSent,
      notificationsSuppressed,
      stateWrites,
      stateDeletes,
    };
  }

  const configured = options.stateStore !== undefined || isStateConfigured({
    restUrl: options.upstashRestUrl,
    restToken: options.upstashRestToken,
  });

  if (!configured) {
    warnings.push("STATE_UNAVAILABLE");
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: false,
    });
  }

  if (hasIncompleteBlockchainCoverage(live)) {
    warnings.push("STATE_PROCESSING_SKIPPED_INCOMPLETE_COVERAGE");
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: true,
    });
  }

  const keyed = internalPositions.map((position, index) => ({
    position,
    publicPosition: positions[index],
    key: positionStateKey(position),
  }));
  if (keyed.some((item) => item.key === null)) {
    warnings.push("STATE_IDENTITY_UNAVAILABLE");
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: true,
    });
  }

  const store = options.stateStore ?? new UpstashStateStore({
    restUrl: options.upstashRestUrl,
    restToken: options.upstashRestToken,
    fetchImpl: options.fetchImpl,
  });
  const existing = new Map<string, boolean>();
  try {
    for (const item of keyed) existing.set(item.key!, await store.exists(item.key!));
  } catch (error) {
    warnings.push(stateErrorCode(error));
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: true,
    });
  }

  const recovery = keyed.filter((item) => item.position.inRange && existing.get(item.key!) === true);
  const pending = keyed.filter((item) => !item.position.inRange && existing.get(item.key!) === false);
  notificationsSuppressed = keyed.filter((item) => !item.position.inRange && existing.get(item.key!) === true).length;

  try {
    for (const item of recovery) {
      await store.delete(item.key!);
      stateDeletes++;
    }
  } catch (error) {
    warnings.push(stateErrorCode(error));
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: true,
    });
  }

  try {
    for (const item of pending) {
      await store.write(item.key!, `pair=${item.publicPosition.pair}\nsource=chatgpt-sites`);
      stateWrites++;
    }
  } catch (error) {
    warnings.push(stateErrorCode(error));
    return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
      notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
      persistentDeduplication: true,
    });
  }

  for (const item of pending) {
    notificationsAttempted++;
    const result = await sender(outOfRangeMessage(item.publicPosition), tgOptions);
    if (result.sent) {
      notificationsSent++;
      continue;
    }
    if (result.errorCode) warnings.push(result.errorCode);
    try {
      await store.delete(item.key!);
      stateDeletes++;
    } catch (error) {
      warnings.push(stateErrorCode(error));
    }
    break;
  }

  return statefulResult(live, positions, outOfRangePositions, warnings, telegramAvailable, {
    notificationsAttempted, notificationsSent, notificationsSuppressed, stateWrites, stateDeletes,
    persistentDeduplication: true,
  });
}

function statefulResult(
  live: PositionsResponse,
  positions: MonitorPosition[],
  outOfRangePositions: MonitorPosition[],
  warnings: string[],
  telegramAvailable: boolean,
  counters: {
    notificationsAttempted: number;
    notificationsSent: number;
    notificationsSuppressed: number;
    stateWrites: number;
    stateDeletes: number;
    persistentDeduplication: boolean;
  },
) {
  const uniqueWarnings = [...new Set(warnings)];
  return {
    schemaVersion: 1,
    status: live.status === "partial" || uniqueWarnings.length > live.warnings.length ? "partial" as const : "ok" as const,
    mode: "stateful" as const,
    sideEffects: counters.notificationsAttempted > 0 || counters.stateWrites > 0 || counters.stateDeletes > 0,
    persistentDeduplication: counters.persistentDeduplication,
    testNotification: false,
    generatedAt: live.generatedAt,
    positionsChecked: positions.length,
    inRange: positions.length - outOfRangePositions.length,
    outOfRange: outOfRangePositions.length,
    positionsByChain: live.chainCounts,
    currentOutOfRangePositions: outOfRangePositions,
    positions,
    unavailableChains: live.unavailableChains,
    warnings: uniqueWarnings,
    telegramAvailable,
    notificationsAttempted: counters.notificationsAttempted,
    notificationsSent: counters.notificationsSent,
    notificationsSuppressed: counters.notificationsSuppressed,
    stateWrites: counters.stateWrites,
    stateDeletes: counters.stateDeletes,
  };
}

export async function readMonitorStateless(options: MonitorOptions) {
  return readMonitorStateful({ ...options, stateStore: undefined, upstashRestUrl: undefined, upstashRestToken: undefined });
}

export async function createMonitorResponse(options: MonitorOptions): Promise<Response> {
  try {
    return Response.json(await readMonitorStateful(options), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        schemaVersion: 1,
        status: "error",
        mode: options.testNotification ? "manual-test" : "stateful",
        persistentDeduplication: false,
        testNotification: options.testNotification === true,
        notificationsAttempted: 0,
        notificationsSent: 0,
        notificationsSuppressed: 0,
        stateWrites: 0,
        stateDeletes: 0,
        error: { code: "MONITOR_UNAVAILABLE" },
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
