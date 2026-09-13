const JSON_RPC_ID = 1;
const SYMBOL_SELECTOR = "0x95d89b41";
const DECIMALS_SELECTOR = "0x313ce567";
const MAX_RPC_CONCURRENCY = 6;

type TokenRequest = {
  chain: string;
  chainId: number;
  rpcUrl: string;
  address: string;
};

export type TokenMetadata = {
  chainId: number;
  address: string;
  symbol: string | null;
  decimals: number | null;
};

type Options = {
  tokens: TokenRequest[];
  fetchImpl?: typeof fetch;
};

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function stripHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function splitWords(value: string): string[] {
  const raw = stripHex(value);
  if (raw.length === 0 || raw.length % 64 !== 0) throw new Error("INVALID_RESPONSE");
  return Array.from({ length: raw.length / 64 }, (_, index) => raw.slice(index * 64, (index + 1) * 64));
}

export function decodeTokenSymbol(value: string): string {
  const raw = stripHex(value);
  if (raw.length < 128 || raw.length % 64 !== 0) throw new Error("INVALID_RESPONSE");
  const words = splitWords(value);
  const offsetBytes = Number(BigInt(`0x${words[0]}`));
  if (!Number.isSafeInteger(offsetBytes) || offsetBytes % 32 !== 0) throw new Error("INVALID_RESPONSE");
  const offsetWord = offsetBytes / 32;
  if (offsetWord >= words.length) throw new Error("INVALID_RESPONSE");
  const length = Number(BigInt(`0x${words[offsetWord]}`));
  if (!Number.isSafeInteger(length) || length <= 0 || length > 128) throw new Error("INVALID_RESPONSE");
  const dataStart = (offsetWord + 1) * 64;
  const symbolHex = raw.slice(dataStart, dataStart + length * 2);
  if (symbolHex.length !== length * 2) throw new Error("INVALID_RESPONSE");
  const bytes = Uint8Array.from(symbolHex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
  const symbol = new TextDecoder().decode(bytes).trim();
  if (!symbol || /[\u0000-\u001f\u007f]/.test(symbol)) throw new Error("INVALID_RESPONSE");
  return symbol;
}

export function decodeTokenDecimals(value: string): number {
  const raw = stripHex(value);
  if (raw.length === 0 || raw.length > 64) throw new Error("INVALID_RESPONSE");
  const decimals = Number(BigInt(`0x${raw}`));
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("INVALID_RESPONSE");
  return decimals;
}

async function rpcCall(fetchImpl: typeof fetch, rpcUrl: string, address: string, data: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: JSON_RPC_ID,
        method: "eth_call",
        params: [{ to: address, data }, "latest"],
      }),
    });
  } catch {
    throw new Error("INVALID_RESPONSE");
  }
  if (!response.ok) throw new Error("INVALID_RESPONSE");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("INVALID_RESPONSE");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("INVALID_RESPONSE");
  const parsed = payload as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
  if (parsed.jsonrpc !== "2.0" || parsed.id !== JSON_RPC_ID || parsed.error || !isHex(parsed.result)) {
    throw new Error("INVALID_RESPONSE");
  }
  return parsed.result;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      output[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

export async function readTokenMetadata(options: Options): Promise<{ metadata: Map<string, TokenMetadata>; warnings: string[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const unique = new Map<string, TokenRequest>();
  for (const token of options.tokens) {
    const address = token.address.toLowerCase();
    unique.set(`${token.chainId}:${address}`, { ...token, address });
  }

  const warnings = new Set<string>();
  const entries = await mapWithConcurrency([...unique.values()], MAX_RPC_CONCURRENCY, async (token) => {
    let symbol: string | null = null;
    let decimals: number | null = null;

    try {
      symbol = decodeTokenSymbol(await rpcCall(fetchImpl, token.rpcUrl, token.address, SYMBOL_SELECTOR));
    } catch {
      warnings.add(`${token.chain.toUpperCase()}_TOKEN_SYMBOL_PARTIAL`);
    }

    try {
      decimals = decodeTokenDecimals(await rpcCall(fetchImpl, token.rpcUrl, token.address, DECIMALS_SELECTOR));
    } catch {
      warnings.add(`${token.chain.toUpperCase()}_TOKEN_DECIMALS_PARTIAL`);
    }

    return [`${token.chainId}:${token.address}`, { chainId: token.chainId, address: token.address, symbol, decimals }] as const;
  });

  return { metadata: new Map(entries), warnings: [...warnings] };
}
