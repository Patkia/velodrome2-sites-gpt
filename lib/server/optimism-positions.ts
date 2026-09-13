const OPTIMISM_CHAIN_ID = 10;
const JSON_RPC_ID = 1;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTOR = {
  stakedLength: "ae775c32",
  stakedByIndex: "38463937",
  positions: "99fbab88",
  getPool: "28af8d0b",
  slot0: "3850c7bd",
  balanceOf: "70a08231",
  tokenOfOwnerByIndex: "2f745c59",
} as const;

const POSITION_MANAGER_V1 = "0xf7f8ccce99ca2896ec75d3a399d152db96808399";
const POSITION_MANAGER_V2 = "0x416b433906b1b72fa758e166e239c43d68dC6F29";
const FACTORY_V1 = "0xe13dd1fba721aa81a1826d9523ac9bc7d260c879";
const FACTORY_V2 = "0xcc0bddb707055e04e497ab22a59c2af4391cd12f";

const OPTIMISM_GAUGES = [
  { address: "0x65759f7f8bc7c1aac4fa57099e6f7a7a1da9b407", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0xb2ba81a92768a980a72d4900a377ea2fca7b2394", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0x656c74cb96b612072d01bec52172abb2e41e4321", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0xfb3df761042b957b375aa417336997272f4b32cc", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0x7888c54b5ce4909c485f477a9631fadf60d8ac5b", positionManager: POSITION_MANAGER_V2, factory: FACTORY_V2 },
  { address: "0xc8c7b5ae61d97be7d02d606629059487066dc9cf", positionManager: POSITION_MANAGER_V2, factory: FACTORY_V2 },
  { address: "0x41160e66fcaa10cbb148ace60bc2a22d609ec519", positionManager: POSITION_MANAGER_V2, factory: FACTORY_V2 },
  { address: "0xa18911b77e905602b7cb3824c3712cbb7e1a3534", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0xa6d2a82e14774916574dcca3ac92b33b1b64552b", positionManager: POSITION_MANAGER_V1, factory: FACTORY_V1 },
  { address: "0x71794455ddfa1c17dd62310d6de0bb1f14c69699", positionManager: POSITION_MANAGER_V2, factory: FACTORY_V2 },
] as const;

const RPC_METHODS = new Set(["eth_chainId", "eth_call"]);
const MAX_RPC_CONCURRENCY = 6;

export type OptimismPositionsErrorCode =
  | "CONFIGURATION_UNAVAILABLE"
  | "WRONG_CHAIN"
  | "RPC_UNAVAILABLE"
  | "CONTRACT_READ_FAILED"
  | "INVALID_RESPONSE";

type ReaderOptions = {
  rpcUrl?: string;
  walletAddress?: string;
  fetchImpl?: typeof fetch;
};

type RpcErrorPayload = { code?: unknown };

type Position = {
  positionId: string;
  source: "staked" | "unstaked";
  version: "V1" | "V2";
  liquidity: string;
  token0: string;
  token1: string;
  token0Symbol: null;
  token1Symbol: null;
  tickLower: number;
  currentTick: number;
  tickUpper: number;
  inRange: boolean;
};

class PositionsError extends Error {
  readonly code: OptimismPositionsErrorCode;

  constructor(code: OptimismPositionsErrorCode) {
    super(code);
    this.name = "PositionsError";
    this.code = code;
  }
}

type PositionCandidate = {
  positionId: bigint;
  source: "staked" | "unstaked";
  version: "V1" | "V2";
  positionManager: string;
  factory: string;
};

type PositionReadDiagnostics = {
  unstakedPositionsHydrated: number;
  liquidityZeroExcluded: number;
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function positionVersion(positionManager: string): "V1" | "V2" {
  return positionManager.toLowerCase() === POSITION_MANAGER_V1.toLowerCase() ? "V1" : "V2";
}

async function readPositionCandidate(
  rpc: RpcReader,
  candidate: PositionCandidate,
  diagnostics?: PositionReadDiagnostics,
): Promise<Position | null> {
  const positionHex = await ethCall(
    rpc,
    candidate.positionManager,
    `0x${SELECTOR.positions}${encodeUint(candidate.positionId)}`,
  );
  const positionWords = splitWords(positionHex, 8);
  const token0 = decodeAddress(positionWords[2]);
  const token1 = decodeAddress(positionWords[3]);
  const tickSpacing = decodeInt24(positionWords[4]);
  const tickLower = decodeInt24(positionWords[5]);
  const tickUpper = decodeInt24(positionWords[6]);
  const liquidityValue = decodeUintWord(positionWords[7]);

  if (candidate.source === "unstaked" && diagnostics) diagnostics.unstakedPositionsHydrated++;
  if (candidate.source === "unstaked" && liquidityValue === BigInt(0)) {
    if (diagnostics) diagnostics.liquidityZeroExcluded++;
    return null;
  }

  const poolHex = await ethCall(
    rpc,
    candidate.factory,
    `0x${SELECTOR.getPool}${encodeAddress(token0)}${encodeAddress(token1)}${encodeSigned(tickSpacing)}`,
  );
  const poolAddress = decodeAddress(splitWords(poolHex, 1)[0]);
  if (poolAddress === ZERO_ADDRESS) throw new PositionsError("CONTRACT_READ_FAILED");

  const slot0Hex = await ethCall(rpc, poolAddress, `0x${SELECTOR.slot0}`);
  const slot0Words = splitWords(slot0Hex, 2);
  const currentTick = decodeInt24(slot0Words[1]);

  return {
    positionId: candidate.positionId.toString(),
    source: candidate.source,
    version: candidate.version,
    liquidity: liquidityValue.toString(),
    token0,
    token1,
    token0Symbol: null,
    token1Symbol: null,
    tickLower,
    currentTick,
    tickUpper,
    inRange: currentTick >= tickLower && currentTick <= tickUpper,
  };
}

export async function readOptimismPositions(options: ReaderOptions) {
  const { walletAddress, rpc, chainId } = await createRpcContext(options);
  const warnings = new Set<string>();
  const unavailablePositionIds = new Set<string>();
  const candidates = new Map<string, PositionCandidate>();
  const diagnostics: PositionReadDiagnostics = {
    unstakedPositionsHydrated: 0,
    liquidityZeroExcluded: 0,
  };

  const gaugeCounts = await mapWithConcurrency(
    OPTIMISM_GAUGES,
    MAX_RPC_CONCURRENCY,
    async (gauge) => {
      const countHex = await ethCall(
        rpc,
        gauge.address,
        `0x${SELECTOR.stakedLength}${encodeAddress(walletAddress)}`,
      );
      return toSafeCount(decodeUint(countHex));
    },
  );

  const stakedLookups = OPTIMISM_GAUGES.flatMap((gauge, gaugeIndex) =>
    Array.from({ length: gaugeCounts[gaugeIndex] }, (_, index) => ({ gauge, index })),
  );

  const stakedCandidates = await mapWithConcurrency(
    stakedLookups,
    MAX_RPC_CONCURRENCY,
    async ({ gauge, index }): Promise<PositionCandidate | null> => {
      try {
        const positionIdHex = await ethCall(
          rpc,
          gauge.address,
          `0x${SELECTOR.stakedByIndex}${encodeAddress(walletAddress)}${encodeUint(BigInt(index))}`,
        );
        const positionId = decodeUint(positionIdHex);
        return {
          positionId,
          source: "staked",
          version: positionVersion(gauge.positionManager),
          positionManager: gauge.positionManager,
          factory: gauge.factory,
        };
      } catch {
        warnings.add("STAKED_ENUMERATION_PARTIAL");
        return null;
      }
    },
  );

  for (const candidate of stakedCandidates) {
    if (candidate === null) continue;
    candidates.set(`${candidate.positionManager.toLowerCase()}:${candidate.positionId.toString()}`, candidate);
  }

  let v2OwnedCount = 0;
  try {
    const countHex = await ethCall(
      rpc,
      POSITION_MANAGER_V2,
      `0x${SELECTOR.balanceOf}${encodeAddress(walletAddress)}`,
    );
    v2OwnedCount = toSafeCount(decodeUint(countHex));
  } catch {
    warnings.add("UNSTAKED_ENUMERATION_UNAVAILABLE");
  }

  const unstakedCandidates = await mapWithConcurrency(
    Array.from({ length: v2OwnedCount }, (_, index) => index),
    MAX_RPC_CONCURRENCY,
    async (index): Promise<PositionCandidate | null> => {
      try {
        const tokenIdHex = await ethCall(
          rpc,
          POSITION_MANAGER_V2,
          `0x${SELECTOR.tokenOfOwnerByIndex}${encodeAddress(walletAddress)}${encodeUint(BigInt(index))}`,
        );
        return {
          positionId: decodeUint(tokenIdHex),
          source: "unstaked",
          version: "V2",
          positionManager: POSITION_MANAGER_V2,
          factory: FACTORY_V2,
        };
      } catch {
        warnings.add("UNSTAKED_ENUMERATION_PARTIAL");
        return null;
      }
    },
  );

  let unstakedTokenIdsEnumerated = 0;
  for (const candidate of unstakedCandidates) {
    if (candidate === null) continue;
    unstakedTokenIdsEnumerated++;
    const key = `${candidate.positionManager.toLowerCase()}:${candidate.positionId.toString()}`;
    if (!candidates.has(key)) candidates.set(key, candidate);
  }

  const candidateList = [...candidates.values()];
  const hydrated = await mapWithConcurrency(
    candidateList,
    MAX_RPC_CONCURRENCY,
    async (candidate): Promise<Position | null> => {
      try {
        return await readPositionCandidate(rpc, candidate, diagnostics);
      } catch {
        unavailablePositionIds.add(`${candidate.version}:${candidate.positionId.toString()}`);
        warnings.add("POSITION_READ_PARTIAL");
        return null;
      }
    },
  );
  const positions = hydrated.filter((position): position is Position => position !== null);
  const activeUnstakedPositions = positions.filter((position) => position.source === "unstaked").length;
  const failedUnstakedPositions = candidateList.filter((candidate) =>
    candidate.source === "unstaked" && unavailablePositionIds.has(`${candidate.version}:${candidate.positionId.toString()}`),
  ).length;

  return {
    schemaVersion: 1,
    status: "ok" as const,
    chain: "Optimism" as const,
    chainId,
    walletAddress: maskWallet(walletAddress),
    positionsChecked: positions.length,
    positions,
    unavailablePositionIds: [...unavailablePositionIds],
    warnings: [...warnings],
    diagnostics: {
      v2OwnedCount,
      unstakedTokenIdsEnumerated,
      unstakedPositionsHydrated: diagnostics.unstakedPositionsHydrated,
      liquidityZeroExcluded: diagnostics.liquidityZeroExcluded,
      activeUnstakedPositions,
      failedUnstakedPositions,
      sampleUnstakedTokenIds: unstakedCandidates
        .filter((candidate): candidate is PositionCandidate => candidate !== null)
        .slice(0, 3)
        .map((candidate) => candidate.positionId.toString()),
    },
  };
}

type RpcReader = (method: "eth_chainId" | "eth_call", params: unknown[]) => Promise<string>;

async function createRpcContext(options: ReaderOptions): Promise<{
  walletAddress: string;
  chainId: number;
  rpc: RpcReader;
}> {
  const rpcUrl = validateRpcUrl(options.rpcUrl);
  const walletAddress = validateWallet(options.walletAddress);
  const requestFetch = options.fetchImpl ?? fetch;
  if (typeof requestFetch !== "function") throw new PositionsError("RPC_UNAVAILABLE");

  const rpc: RpcReader = async (method, params) => {
    if (!RPC_METHODS.has(method)) throw new PositionsError("RPC_UNAVAILABLE");

    let response: Response;
    try {
      response = await requestFetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: JSON_RPC_ID, method, params }),
      });
    } catch {
      throw new PositionsError("RPC_UNAVAILABLE");
    }

    if (!response.ok) throw new PositionsError("RPC_UNAVAILABLE");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PositionsError("INVALID_RESPONSE");
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new PositionsError("INVALID_RESPONSE");
    }
    const result = payload as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: RpcErrorPayload };
    if (result.jsonrpc !== "2.0" || result.id !== JSON_RPC_ID || result.error || !isHex(result.result)) {
      throw new PositionsError(method === "eth_call" ? "CONTRACT_READ_FAILED" : "INVALID_RESPONSE");
    }
    return result.result;
  };

  const chainId = Number(decodeUint(await rpc("eth_chainId", [])));
  if (chainId !== OPTIMISM_CHAIN_ID) throw new PositionsError("WRONG_CHAIN");
  return { walletAddress, chainId, rpc };
}

export async function readOptimismStakeDiagnostics(options: ReaderOptions) {
  const { walletAddress, rpc, chainId } = await createRpcContext(options);
  const gauges = [] as Array<{
    index: number;
    version: "V1" | "V2";
    address: string;
    stakedCount: number;
  }>;
  let totalStakedAcrossConfiguredGauges = 0;

  for (let index = 0; index < OPTIMISM_GAUGES.length; index++) {
    const gauge = OPTIMISM_GAUGES[index];
    const countHex = await ethCall(rpc, gauge.address, `0x${SELECTOR.stakedLength}${encodeAddress(walletAddress)}`);
    const stakedCount = toSafeCount(decodeUint(countHex));
    totalStakedAcrossConfiguredGauges += stakedCount;
    gauges.push({
      index,
      version: gauge.positionManager.toLowerCase() === POSITION_MANAGER_V1.toLowerCase() ? "V1" : "V2",
      address: maskAddress(gauge.address),
      stakedCount,
    });
  }

  const positionManagers = [] as Array<{
    version: "V1" | "V2";
    address: string;
    enumerationSupported: boolean;
    ownedCount: number | null;
  }>;

  for (const manager of [
    { version: "V1" as const, address: POSITION_MANAGER_V1 },
    { version: "V2" as const, address: POSITION_MANAGER_V2 },
  ]) {
    try {
      const countHex = await ethCall(rpc, manager.address, `0x${SELECTOR.balanceOf}${encodeAddress(walletAddress)}`);
      const ownedCount = toSafeCount(decodeUint(countHex));
      let enumerationSupported = true;
      if (ownedCount > 0) {
        try {
          const tokenHex = await ethCall(
            rpc,
            manager.address,
            `0x${SELECTOR.tokenOfOwnerByIndex}${encodeAddress(walletAddress)}${encodeUint(BigInt(0))}`,
          );
          decodeUint(tokenHex);
        } catch (error) {
          if (!(error instanceof PositionsError) || error.code !== "CONTRACT_READ_FAILED") throw error;
          enumerationSupported = false;
        }
      }
      positionManagers.push({
        version: manager.version,
        address: maskAddress(manager.address),
        enumerationSupported,
        ownedCount,
      });
    } catch (error) {
      if (!(error instanceof PositionsError) || error.code !== "CONTRACT_READ_FAILED") throw error;
      positionManagers.push({
        version: manager.version,
        address: maskAddress(manager.address),
        enumerationSupported: false,
        ownedCount: null,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: "ok" as const,
    chain: "Optimism" as const,
    chainId,
    walletAddress: maskWallet(walletAddress),
    configuredGaugeCount: OPTIMISM_GAUGES.length,
    gauges,
    totalStakedAcrossConfiguredGauges,
    positionManagers,
  };
}

export async function createOptimismStakeDiagnosticsResponse(options: ReaderOptions): Promise<Response> {
  try {
    return Response.json(await readOptimismStakeDiagnostics(options), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof PositionsError ? error.code : "INVALID_RESPONSE";
    const status = code === "CONFIGURATION_UNAVAILABLE" ? 503 : 502;
    return Response.json({ schemaVersion: 1, status: "error", error: { code } }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function createOptimismPositionsResponse(options: ReaderOptions): Promise<Response> {
  try {
    return Response.json(await readOptimismPositions(options), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof PositionsError ? error.code : "INVALID_RESPONSE";
    const status = code === "CONFIGURATION_UNAVAILABLE" ? 503 : 502;
    return Response.json({ schemaVersion: 1, status: "error", error: { code } }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

async function ethCall(
  rpc: (method: "eth_chainId" | "eth_call", params: unknown[]) => Promise<string>,
  to: string,
  data: string,
): Promise<string> {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

function validateRpcUrl(value?: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new PositionsError("CONFIGURATION_UNAVAILABLE");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new PositionsError("CONFIGURATION_UNAVAILABLE");
    return url.toString();
  } catch (error) {
    if (error instanceof PositionsError) throw error;
    throw new PositionsError("CONFIGURATION_UNAVAILABLE");
  }
}

function validateWallet(value?: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value)) {
    throw new PositionsError("CONFIGURATION_UNAVAILABLE");
  }
  return value.toLowerCase();
}

function maskWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`.toLowerCase();
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]*$/i.test(value);
}

function stripHex(value: string): string {
  if (!isHex(value) || value.length < 3) throw new PositionsError("INVALID_RESPONSE");
  return value.slice(2);
}

function splitWords(value: string, minimumWords: number): string[] {
  const hex = stripHex(value);
  if (hex.length % 64 !== 0 || hex.length < minimumWords * 64) throw new PositionsError("INVALID_RESPONSE");
  return hex.match(/.{64}/g) ?? [];
}

function decodeUint(value: string): bigint {
  const hex = stripHex(value);
  if (hex.length === 0 || hex.length > 64) throw new PositionsError("INVALID_RESPONSE");
  return BigInt(`0x${hex}`);
}

function decodeUintWord(word: string): bigint {
  if (!/^[0-9a-f]{64}$/i.test(word)) throw new PositionsError("INVALID_RESPONSE");
  return BigInt(`0x${word}`);
}

function decodeAddress(word: string): string {
  if (!/^[0-9a-f]{64}$/i.test(word) || !/^0{24}/i.test(word)) throw new PositionsError("INVALID_RESPONSE");
  return `0x${word.slice(24).toLowerCase()}`;
}

function decodeInt24(word: string): number {
  const value = Number(decodeUintWord(word) & BigInt("0xffffff"));
  return (value & 0x800000) !== 0 ? value - 0x1000000 : value;
}

function encodeAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint(value: bigint): string {
  if (value < BigInt(0)) throw new PositionsError("INVALID_RESPONSE");
  return value.toString(16).padStart(64, "0");
}

function encodeSigned(value: number): string {
  const encoded = value < 0 ? (BigInt(1) << BigInt(256)) + BigInt(value) : BigInt(value);
  return encoded.toString(16).padStart(64, "0");
}

function toSafeCount(value: bigint): number {
  if (value > BigInt(1_000)) throw new PositionsError("INVALID_RESPONSE");
  return Number(value);
}
