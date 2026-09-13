const JSON_RPC_ID = 1;
const STAKED_LENGTH_SELECTOR = "ae775c32";
const RPC_METHODS = new Set(["eth_chainId", "eth_call"]);

const CHAINS = [
  {
    chain: "Celo" as const,
    chainId: 42220,
    rpcUrl: "https://forno.celo.org",
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
    rpcUrl: "https://rpc.soneium.org",
    gauges: [
      "0x10a2bd31da8582231ba355ec7a6d9c2f06932a77",
      "0xf7b979caf782dd3456e4d0f4ec185dd7207b44e9",
    ],
  },
] as const;

type FetchImpl = typeof fetch;
type RpcMethod = "eth_chainId" | "eth_call";
type RpcReader = (method: RpcMethod, params: unknown[]) => Promise<string>;

type GaugeResult = {
  index: number;
  version: "default";
  address: string;
  stakedCount: number | null;
};

type ChainResult = {
  chain: "Celo" | "Soneium";
  chainId: number;
  status: "ok" | "partial" | "unavailable";
  configuredGaugeCount: number;
  totalStaked: number | null;
  gauges: GaugeResult[];
  warnings: string[];
};

type Options = {
  walletAddress?: string;
  fetchImpl?: FetchImpl;
};

class DiagnosticError extends Error {
  readonly code: "CONFIGURATION_UNAVAILABLE" | "INVALID_RESPONSE";

  constructor(code: DiagnosticError["code"]) {
    super(code);
    this.code = code;
  }
}

function validateWallet(value: string | undefined): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new DiagnosticError("CONFIGURATION_UNAVAILABLE");
  }
  return value.toLowerCase();
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6).toLowerCase()}...${address.slice(-4).toLowerCase()}`;
}

function encodeAddress(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function decodeUint(value: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new DiagnosticError("INVALID_RESPONSE");
  return BigInt(value);
}

function toSafeCount(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DiagnosticError("INVALID_RESPONSE");
  }
  return Number(value);
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

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DiagnosticError("INVALID_RESPONSE");
    }
    const result = payload as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (result.jsonrpc !== "2.0" || result.id !== JSON_RPC_ID || result.error || !isHex(result.result)) {
      throw new DiagnosticError("INVALID_RESPONSE");
    }
    return result.result;
  };
}

async function readChain(
  config: (typeof CHAINS)[number],
  walletAddress: string,
  fetchImpl: FetchImpl,
): Promise<ChainResult> {
  const maskedGauges = config.gauges.map((address, index): GaugeResult => ({
    index,
    version: "default",
    address: maskAddress(address),
    stakedCount: null,
  }));
  const rpc = createRpc(config.rpcUrl, fetchImpl);

  try {
    const chainId = Number(decodeUint(await rpc("eth_chainId", [])));
    if (chainId !== config.chainId) {
      return {
        chain: config.chain,
        chainId: config.chainId,
        status: "unavailable",
        configuredGaugeCount: config.gauges.length,
        totalStaked: null,
        gauges: maskedGauges,
        warnings: ["CHAIN_UNAVAILABLE"],
      };
    }
  } catch {
    return {
      chain: config.chain,
      chainId: config.chainId,
      status: "unavailable",
      configuredGaugeCount: config.gauges.length,
      totalStaked: null,
      gauges: maskedGauges,
      warnings: ["CHAIN_UNAVAILABLE"],
    };
  }

  let totalStaked = 0;
  let failedGaugeCount = 0;
  const gauges: GaugeResult[] = [];

  for (let index = 0; index < config.gauges.length; index++) {
    const address = config.gauges[index];
    try {
      const result = await rpc("eth_call", [
        { to: address, data: `0x${STAKED_LENGTH_SELECTOR}${encodeAddress(walletAddress)}` },
        "latest",
      ]);
      const stakedCount = toSafeCount(decodeUint(result));
      totalStaked += stakedCount;
      gauges.push({ index, version: "default", address: maskAddress(address), stakedCount });
    } catch {
      failedGaugeCount++;
      gauges.push({ index, version: "default", address: maskAddress(address), stakedCount: null });
    }
  }

  return {
    chain: config.chain,
    chainId: config.chainId,
    status: failedGaugeCount === 0 ? "ok" : "partial",
    configuredGaugeCount: config.gauges.length,
    totalStaked,
    gauges,
    warnings: failedGaugeCount === 0 ? [] : ["GAUGE_READ_PARTIAL"],
  };
}

export async function readMultichainStakeDiagnostics(options: Options) {
  const walletAddress = validateWallet(options.walletAddress);
  const fetchImpl = options.fetchImpl ?? fetch;
  const chains: ChainResult[] = [];

  for (const config of CHAINS) {
    chains.push(await readChain(config, walletAddress, fetchImpl));
  }

  return {
    schemaVersion: 1,
    status: "ok" as const,
    walletAddress: maskAddress(walletAddress),
    chains,
  };
}

export async function createMultichainStakeDiagnosticsResponse(options: Options): Promise<Response> {
  try {
    return Response.json(await readMultichainStakeDiagnostics(options), {
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
