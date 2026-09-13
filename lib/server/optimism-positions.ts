const OPTIMISM_CHAIN_ID = 10;
const JSON_RPC_ID = 1;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTOR = {
  stakedLength: "ae775c32",
  stakedByIndex: "38463937",
  positions: "99fbab88",
  getPool: "28af8d0b",
  slot0: "3850c7bd",
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

export async function readOptimismPositions(options: ReaderOptions) {
  const rpcUrl = validateRpcUrl(options.rpcUrl);
  const walletAddress = validateWallet(options.walletAddress);
  const requestFetch = options.fetchImpl ?? fetch;
  if (typeof requestFetch !== "function") throw new PositionsError("RPC_UNAVAILABLE");

  const rpc = async (method: "eth_chainId" | "eth_call", params: unknown[]): Promise<string> => {
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

  const positions: Position[] = [];
  for (const gauge of OPTIMISM_GAUGES) {
    const countHex = await ethCall(rpc, gauge.address, `0x${SELECTOR.stakedLength}${encodeAddress(walletAddress)}`);
    const count = toSafeCount(decodeUint(countHex));

    for (let index = 0; index < count; index++) {
      const positionIdHex = await ethCall(
        rpc,
        gauge.address,
        `0x${SELECTOR.stakedByIndex}${encodeAddress(walletAddress)}${encodeUint(BigInt(index))}`,
      );
      const positionId = decodeUint(positionIdHex);
      const positionHex = await ethCall(
        rpc,
        gauge.positionManager,
        `0x${SELECTOR.positions}${encodeUint(positionId)}`,
      );
      const positionWords = splitWords(positionHex, 8);
      const token0 = decodeAddress(positionWords[2]);
      const token1 = decodeAddress(positionWords[3]);
      const tickSpacing = decodeInt24(positionWords[4]);
      const tickLower = decodeInt24(positionWords[5]);
      const tickUpper = decodeInt24(positionWords[6]);
      const liquidity = decodeUintWord(positionWords[7]).toString();
      const poolHex = await ethCall(
        rpc,
        gauge.factory,
        `0x${SELECTOR.getPool}${encodeAddress(token0)}${encodeAddress(token1)}${encodeSigned(tickSpacing)}`,
      );
      const poolAddress = decodeAddress(splitWords(poolHex, 1)[0]);
      if (poolAddress === ZERO_ADDRESS) throw new PositionsError("CONTRACT_READ_FAILED");

      const slot0Hex = await ethCall(rpc, poolAddress, `0x${SELECTOR.slot0}`);
      const slot0Words = splitWords(slot0Hex, 2);
      const currentTick = decodeInt24(slot0Words[1]);

      positions.push({
        positionId: positionId.toString(),
        liquidity,
        token0,
        token1,
        token0Symbol: null,
        token1Symbol: null,
        tickLower,
        currentTick,
        tickUpper,
        inRange: currentTick >= tickLower && currentTick <= tickUpper,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: "ok" as const,
    chain: "Optimism" as const,
    chainId,
    walletAddress: maskWallet(walletAddress),
    positionsChecked: positions.length,
    positions,
  };
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
