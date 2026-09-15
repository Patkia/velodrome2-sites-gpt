import { OPTIMISM_POSITION_MANAGERS, readOptimismPositions } from "./optimism-positions.ts";
import {
  MULTICHAIN_POSITION_MANAGER,
  MULTICHAIN_RPC_URLS,
  readMultichainPositionsDiagnostics,
} from "./multichain-positions.ts";
import { readTokenMetadata } from "./token-metadata.ts";
import { enrichPositionFinancials } from "./position-financials.ts";
import type { DashboardPosition, PositionsResponse } from "../shared/positions-schema.ts";

type OptimismReader = typeof readOptimismPositions;
type MultichainReader = typeof readMultichainPositionsDiagnostics;
type MetadataReader = typeof readTokenMetadata;

type Options = {
  optimismRpcUrl?: string;
  walletAddress?: string;
  fetchImpl?: typeof fetch;
  readOptimism?: OptimismReader;
  readMultichain?: MultichainReader;
  readMetadata?: MetadataReader;
  includeStateIdentity?: boolean;
};

type InternalDashboardPosition = DashboardPosition & {
  positionManager?: string;
  gaugeAddress?: string;
};

function normalizePosition(position: {
  chain: string;
  chainId: number;
  positionId: string;
  source: "staked" | "unstaked";
  liquidity: string;
  token0: string;
  token1: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
  positionManager?: string;
  gaugeAddress?: string;
}): InternalDashboardPosition {
  const { positionManager, gaugeAddress, ...publicPosition } = position;
  return {
    ...publicPosition,
    ...(positionManager ? { positionManager } : {}),
    ...(gaugeAddress ? { gaugeAddress } : {}),
    token0Symbol: null,
    token0Decimals: null,
    token1Symbol: null,
    token1Decimals: null,
    status: position.inRange ? "in-range" : "out-of-range",
  };
}

export async function readLivePositions(options: Options): Promise<PositionsResponse> {
  const optimismReader = options.readOptimism ?? readOptimismPositions;
  const multichainReader = options.readMultichain ?? readMultichainPositionsDiagnostics;
  const metadataReader = options.readMetadata ?? readTokenMetadata;
  const unavailableChains: string[] = [];
  const warnings: string[] = [];
  const positions: InternalDashboardPosition[] = [];
  let walletAddress = "unavailable";

  const [optimismResult, multichainResult] = await Promise.allSettled([
    optimismReader({
      rpcUrl: options.optimismRpcUrl,
      walletAddress: options.walletAddress,
      fetchImpl: options.fetchImpl,
    }),
    multichainReader({
      walletAddress: options.walletAddress,
      fetchImpl: options.fetchImpl,
    }),
  ]);

  if (optimismResult.status === "fulfilled") {
    walletAddress = optimismResult.value.walletAddress;
    warnings.push(...optimismResult.value.warnings.map((warning) => `OPTIMISM_${warning}`));
    positions.push(...optimismResult.value.positions.map((position) => normalizePosition({
      chain: "Optimism",
      chainId: optimismResult.value.chainId,
      positionId: position.positionId,
      source: position.source,
      liquidity: position.liquidity,
      token0: position.token0,
      token1: position.token1,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      currentTick: position.currentTick,
      inRange: position.inRange,
      positionManager: OPTIMISM_POSITION_MANAGERS[position.version],
      gaugeAddress: position.gaugeAddress,
    })));
  } else {
    unavailableChains.push("Optimism");
    warnings.push("OPTIMISM_UNAVAILABLE");
  }

  if (multichainResult.status === "fulfilled") {
    if (walletAddress === "unavailable") walletAddress = multichainResult.value.walletAddress;
    for (const chain of multichainResult.value.chains) {
      if (chain.status === "unavailable") unavailableChains.push(chain.chain);
      warnings.push(...chain.warnings.map((warning) => `${chain.chain.toUpperCase()}_${warning}`));
      positions.push(...chain.positions.map((position) => normalizePosition({
        chain: position.chain,
        chainId: position.chainId,
        positionId: position.positionId,
        source: "staked",
        liquidity: position.liquidity,
        token0: position.token0,
        token1: position.token1,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        currentTick: position.currentTick,
        inRange: position.inRange,
        positionManager: MULTICHAIN_POSITION_MANAGER,
        gaugeAddress: position.gaugeContractAddress,
      })));
    }
  } else {
    unavailableChains.push("Celo", "Soneium");
    warnings.push("MULTICHAIN_UNAVAILABLE");
  }

  const rpcUrls = new Map<number, string>();
  if (options.optimismRpcUrl) rpcUrls.set(10, options.optimismRpcUrl);
  rpcUrls.set(42220, MULTICHAIN_RPC_URLS.Celo);
  rpcUrls.set(1868, MULTICHAIN_RPC_URLS.Soneium);

  let enrichedPositions = positions;
  if (positions.length > 0) {
    try {
      const metadataResult = await metadataReader({
        tokens: positions.flatMap((position) => {
          const rpcUrl = rpcUrls.get(position.chainId);
          if (!rpcUrl) return [];
          return [
            { chain: position.chain, chainId: position.chainId, rpcUrl, address: position.token0 },
            { chain: position.chain, chainId: position.chainId, rpcUrl, address: position.token1 },
          ];
        }),
        fetchImpl: options.fetchImpl,
      });
      warnings.push(...metadataResult.warnings);
      enrichedPositions = positions.map((position) => {
        const token0 = metadataResult.metadata.get(`${position.chainId}:${position.token0.toLowerCase()}`);
        const token1 = metadataResult.metadata.get(`${position.chainId}:${position.token1.toLowerCase()}`);
        return {
          ...position,
          token0Symbol: token0?.symbol ?? null,
          token0Decimals: token0?.decimals ?? null,
          token1Symbol: token1?.symbol ?? null,
          token1Decimals: token1?.decimals ?? null,
        };
      });
    } catch {
      warnings.push("TOKEN_METADATA_UNAVAILABLE");
    }
  }

  try {
    enrichedPositions = await enrichPositionFinancials({
      positions: enrichedPositions,
      walletAddress: options.walletAddress,
      rpcUrls,
      fetchImpl: options.fetchImpl,
    });
  } catch {
    warnings.push("POSITION_FINANCIALS_UNAVAILABLE");
  }

  enrichedPositions = enrichedPositions.map(({ gaugeAddress: _gaugeAddress, positionManager, ...position }) => ({
    ...position,
    ...(options.includeStateIdentity && positionManager ? { positionManager } : {}),
  }));

  const uniqueUnavailable = [...new Set(unavailableChains)];
  const uniqueWarnings = [...new Set(warnings)];

  return {
    schemaVersion: 1,
    status: uniqueUnavailable.length > 0 || uniqueWarnings.length > 0 ? "partial" : "ok",
    generatedAt: new Date().toISOString(),
    walletAddress,
    positionsChecked: enrichedPositions.length,
    positions: enrichedPositions,
    chainCounts: {
      Optimism: enrichedPositions.filter((position) => position.chain === "Optimism").length,
      Celo: enrichedPositions.filter((position) => position.chain === "Celo").length,
      Soneium: enrichedPositions.filter((position) => position.chain === "Soneium").length,
    },
    unavailableChains: uniqueUnavailable,
    warnings: uniqueWarnings,
  };
}

export async function createLivePositionsResponse(options: Options): Promise<Response> {
  try {
    const payload = await readLivePositions(options);
    return Response.json(payload, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { schemaVersion: 1, status: "error", error: { code: "POSITIONS_UNAVAILABLE" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
