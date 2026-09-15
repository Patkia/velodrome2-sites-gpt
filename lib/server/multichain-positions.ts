const JSON_RPC_ID = 1;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTOR = {
  stakedLength: "ae775c32",
  stakedByIndex: "38463937",
  positions: "99fbab88",
  getPool: "28af8d0b",
  slot0: "3850c7bd",
} as const;

export const MULTICHAIN_POSITION_MANAGER = "0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702";
const POSITION_MANAGER = MULTICHAIN_POSITION_MANAGER;
const FACTORY = "0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F";

export const MULTICHAIN_RPC_URLS = {
  Celo: "https://forno.celo.org",
  Soneium: "https://rpc.soneium.org",
} as const;

const CHAINS = [
  {
    chain: "Celo" as const,
    chainId: 42220,
    rpcUrl: MULTICHAIN_RPC_URLS.Celo,
    gauges: [
      "0xff5ec01b541cab692676ac3150d452b3c7fc404d",
      "0x93c77b19cb0024d1d1c10236ad4552f805a27703",
      "0x695eaddc1ffa57c95a8148ead292537a92c718e4",
      "0x9f536e26a6d152543362ed8d15545c11d5970fd1",
      "0x50854a1b57a0238ba2aa5341a8a03fde027bf75d",
      "0x6e754393eeb7c5c52b5dbf442e29b70bb009d4d8",
      "0xe9c37ee5c55bf37cd852dfbfd0b76e9a52d6796d",
    ],
  },
  {
    chain: "Soneium" as const,
    chainId: 1868,
    rpcUrl: MULTICHAIN_RPC_URLS.Soneium,
    gauges: [
      "0x10a2bd31da8582231ba355ec7a6d9c2f06932a77",
      "0xf7b979caf782dd3456e4d0f4ec185dd7207b44e9",
    ],
  },
] as const;

const RPC_METHODS = new Set(["eth_chainId", "eth_call"]);

type RpcMethod = "eth_chainId" | "eth_call";
type FetchImpl = typeof fetch;
type RpcReader = (method: RpcMethod, params: unknown[]) => Promise<string>;
type Options = { walletAddress?: string; fetchImpl?: FetchImpl; includeFinancialIdentity?: boolean };

type Position = {
  chain: "Celo" | "Soneium";
  chainId: number;
  gaugeIndex: number;
  gaugeAddress: string;
  gaugeAddressRaw?: string;
  sqrtPriceX96?: string;
  positionId: string;
  liquidity: string;
  token0: string;
  token1: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
};

type ChainResult = {
  chain: "Celo" | "Soneium";
  chainId: number;
  status: "ok" | "partial" | "unavailable";
  positions: Position[];
  unavailablePositionIds: string[];
  warnings: string[];
};

class DiagnosticError extends Error {
  readonly code: "CONFIGURATION_UNAVAILABLE" | "INVALID_RESPONSE";

  constructor(code: "CONFIGURATION_UNAVAILABLE" | "INVALID_RESPONSE") {
    super(code);
    this.code = code;
  }
}

function validateWallet(value: string | undefined): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new DiagnosticError("CONFIGURATION_UNAVAILABLE");
  return value.toLowerCase();
}

function maskAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function stripHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function encodeAddress(value: string): string {
  return stripHex(value.toLowerCase()).padStart(64, "0");
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeSigned(value: number): string {
  const numeric = BigInt(value);
  const normalized = numeric < 0 ? (BigInt(1) << BigInt(256)) + numeric : numeric;
  return normalized.toString(16).padStart(64, "0");
}

function decodeUint(value: string): bigint {
  const raw = stripHex(value);
  if (raw === "" || raw.length > 64) throw new DiagnosticError("INVALID_RESPONSE");
  return BigInt(`0x${raw}`);
}

function splitWords(value: string, minimumWords: number): string[] {
  const raw = stripHex(value);
  if (raw.length < minimumWords * 64 || raw.length % 64 !== 0) throw new DiagnosticError("INVALID_RESPONSE");
  return Array.from({ length: raw.length / 64 }, (_, index) => raw.slice(index * 64, (index + 1) * 64));
}

function decodeAddress(word: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) throw new DiagnosticError("INVALID_RESPONSE");
  return `0x${word.slice(24).toLowerCase()}`;
}

function decodeInt24(word: string): number {
  const raw = Number(BigInt(`0x${word.slice(-6)}`));
  return raw >= 0x800000 ? raw - 0x1000000 : raw;
}

function createRpc(rpcUrl: string, fetchImpl: FetchImpl): RpcReader {
  return async (method, params) => {
    if (!RPC_METHODS.has(method)) throw new DiagnosticError("INVALID_RESPONSE");
    let response: Response;
    try {
      response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: JSON_RPC_ID, method, params }),
      });
    } catch {
      throw new DiagnosticError("INVALID_RESPONSE");
    }
    if (!response.ok) throw new DiagnosticError("INVALID_RESPONSE");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DiagnosticError("INVALID_RESPONSE");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new DiagnosticError("INVALID_RESPONSE");
    const parsed = payload as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (parsed.jsonrpc !== "2.0" || parsed.id !== JSON_RPC_ID || parsed.error || !isHex(parsed.result)) {
      throw new DiagnosticError("INVALID_RESPONSE");
    }
    return parsed.result;
  };
}

async function ethCall(rpc: RpcReader, to: string, data: string): Promise<string> {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

async function hydratePosition(
  rpc: RpcReader,
  config: (typeof CHAINS)[number],
  gaugeIndex: number,
  gaugeAddress: string,
  walletAddress: string,
  index: number,
  includeFinancialIdentity = false,
): Promise<Position> {
  const tokenIdHex = await ethCall(
    rpc,
    gaugeAddress,
    `0x${SELECTOR.stakedByIndex}${encodeAddress(walletAddress)}${encodeUint(BigInt(index))}`,
  );
  const positionId = decodeUint(tokenIdHex);

  const positionHex = await ethCall(rpc, POSITION_MANAGER, `0x${SELECTOR.positions}${encodeUint(positionId)}`);
  const words = splitWords(positionHex, 8);
  const token0 = decodeAddress(words[2]);
  const token1 = decodeAddress(words[3]);
  const tickSpacing = decodeInt24(words[4]);
  const tickLower = decodeInt24(words[5]);
  const tickUpper = decodeInt24(words[6]);
  const liquidity = decodeUint(`0x${words[7]}`).toString();

  const poolHex = await ethCall(
    rpc,
    FACTORY,
    `0x${SELECTOR.getPool}${encodeAddress(token0)}${encodeAddress(token1)}${encodeSigned(tickSpacing)}`,
  );
  const poolAddress = decodeAddress(splitWords(poolHex, 1)[0]);
  if (poolAddress === ZERO_ADDRESS) throw new DiagnosticError("INVALID_RESPONSE");

  const slot0Hex = await ethCall(rpc, poolAddress, `0x${SELECTOR.slot0}`);
  const slot0Words = splitWords(slot0Hex, 2);
  const sqrtPriceX96 = decodeUint(`0x${slot0Words[0]}`).toString();
  const currentTick = decodeInt24(slot0Words[1]);

  return {
    chain: config.chain,
    chainId: config.chainId,
    gaugeIndex,
    gaugeAddress: maskAddress(gaugeAddress),
    ...(includeFinancialIdentity ? { gaugeAddressRaw: gaugeAddress, sqrtPriceX96 } : {}),
    positionId: positionId.toString(),
    liquidity,
    token0,
    token1,
    tickLower,
    tickUpper,
    currentTick,
    inRange: currentTick >= tickLower && currentTick <= tickUpper,
  };
}

async function readChain(
  config: (typeof CHAINS)[number],
  walletAddress: string,
  fetchImpl: FetchImpl,
  includeFinancialIdentity = false,
): Promise<ChainResult> {
  const rpc = createRpc(config.rpcUrl, fetchImpl);
  try {
    const chainId = Number(decodeUint(await rpc("eth_chainId", [])));
    if (chainId !== config.chainId) throw new DiagnosticError("INVALID_RESPONSE");
  } catch {
    return {
      chain: config.chain,
      chainId: config.chainId,
      status: "unavailable",
      positions: [],
      unavailablePositionIds: [],
      warnings: ["CHAIN_UNAVAILABLE"],
    };
  }

  const positions: Position[] = [];
  const unavailablePositionIds: string[] = [];
  let gaugeReadFailed = false;
  let positionReadFailed = false;

  for (let gaugeIndex = 0; gaugeIndex < config.gauges.length; gaugeIndex++) {
    const gaugeAddress = config.gauges[gaugeIndex];
    let count: number;
    try {
      const countHex = await ethCall(
        rpc,
        gaugeAddress,
        `0x${SELECTOR.stakedLength}${encodeAddress(walletAddress)}`,
      );
      const countValue = decodeUint(countHex);
      if (countValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new DiagnosticError("INVALID_RESPONSE");
      count = Number(countValue);
    } catch {
      gaugeReadFailed = true;
      continue;
    }

    for (let index = 0; index < count; index++) {
      try {
        positions.push(await hydratePosition(
          rpc,
          config,
          gaugeIndex,
          gaugeAddress,
          walletAddress,
          index,
          includeFinancialIdentity,
        ));
      } catch {
        positionReadFailed = true;
        unavailablePositionIds.push(`${config.chain}:${gaugeIndex}:${index}`);
      }
    }
  }

  const warnings = [
    ...(gaugeReadFailed ? ["GAUGE_READ_PARTIAL"] : []),
    ...(positionReadFailed ? ["POSITION_READ_PARTIAL"] : []),
  ];

  return {
    chain: config.chain,
    chainId: config.chainId,
    status: warnings.length === 0 ? "ok" : "partial",
    positions,
    unavailablePositionIds,
    warnings,
  };
}

export async function readMultichainPositionsDiagnostics(options: Options) {
  const walletAddress = validateWallet(options.walletAddress);
  const fetchImpl = options.fetchImpl ?? fetch;
  const chains: ChainResult[] = [];
  for (const config of CHAINS) {
    chains.push(await readChain(config, walletAddress, fetchImpl, options.includeFinancialIdentity === true));
  }
  return {
    schemaVersion: 1,
    status: "ok" as const,
    walletAddress: maskAddress(walletAddress),
    chains,
  };
}

export async function createMultichainPositionsDiagnosticsResponse(options: Options): Promise<Response> {
  try {
    return Response.json(await readMultichainPositionsDiagnostics(options), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof DiagnosticError ? error.code : "INVALID_RESPONSE";
    return Response.json(
      { schemaVersion: 1, status: "error", error: { code } },
      { status: code === "CONFIGURATION_UNAVAILABLE" ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
