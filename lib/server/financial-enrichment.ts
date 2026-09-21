import { readTokenMetadata } from "./token-metadata.ts";

const EARNED_SELECTOR = "3e491d47";
const REWARD_TOKEN_SELECTOR = "f7c618c1";
const OPTIMISM_VELO = "0x9560e827af36c94d2ac33a39bce1fe78631088db";
const INCREASE_LIQUIDITY_EVENT_TOPIC = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ADDRESS_TOPIC = `0x${"0".repeat(64)}`;
const RECENT_MINT_LOOKBACK_BLOCKS = 5_000;
const RECENT_MINT_LOOKBACK_WINDOWS = 4;
const HISTORY_URLS: Record<number, string> = {
  10: "https://optimism.blockscout.com",
  42220: "https://celo.blockscout.com",
  1868: "https://soneium.blockscout.com",
};
const CELO_VELO = "0x7f9adfbd38b669f03d1d11000bc76b9aaea28a81";

export type FinancialInputPosition = {
  chain: string;
  chainId: number;
  positionId: string;
  liquidity: string;
  token0: string;
  token0Symbol: string | null;
  token0Decimals: number | null;
  token1: string;
  token1Symbol: string | null;
  token1Decimals: number | null;
  tickLower: number;
  tickUpper: number;
  sqrtPriceX96?: string;
  gaugeAddressRaw?: string;
  positionManager?: string;
};

export type FinancialData = {
  token0Amount: number | null;
  token0ValueUsd: number | null;
  token1Amount: number | null;
  token1ValueUsd: number | null;
  currentValueUsd: number | null;
  initialValueUsd: number | null;
  profitLossUsd: number | null;
  profitLossPercent: number | null;
  rewardSymbol: string | null;
  rewardAmount: number | null;
  rewardValueUsd: number | null;
};

type Options = {
  position: FinancialInputPosition;
  rpcUrl?: string;
  walletAddress?: string;
  fetchImpl?: typeof fetch;
};

function priceChain(chain: string): string {
  return chain.toLowerCase();
}

function encodeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeUint(value: string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

async function ethCall(rpcUrl: string, to: string, data: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const payload = await response.json() as { result?: unknown };
  if (typeof payload.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(payload.result)) throw new Error("RPC_INVALID");
  return payload.result;
}

function decodeAddress(value: string): string {
  const hex = value.replace(/^0x/, "");
  if (hex.length < 64) throw new Error("RPC_INVALID");
  return `0x${hex.slice(-40)}`.toLowerCase();
}

function decodeUint(value: string): bigint {
  return BigInt(value);
}

async function getPrices(chain: string, addresses: string[], fetchImpl: typeof fetch): Promise<Map<string, number>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  if (unique.length === 0) return new Map();
  const coins = unique.map((address) => `${chain}:${address}`).join(",");
  try {
    const response = await fetchImpl(`https://coins.llama.fi/prices/current/${coins}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return new Map();
    const payload = await response.json() as { coins?: Record<string, { price?: unknown }> };
    const result = new Map<string, number>();
    for (const address of unique) {
      const price = payload.coins?.[`${chain}:${address}`]?.price;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) result.set(address, price);
    }
    return result;
  } catch {
    return new Map();
  }
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const payload = await response.json() as { result?: unknown };
  return payload.result;
}

async function getHistoricalPrices(chain: string, timestamp: number, addresses: string[], fetchImpl: typeof fetch): Promise<Map<string, number>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const coins = unique.map((address) => `${chain}:${address}`).join(",");
  try {
    const response = await fetchImpl(`https://coins.llama.fi/prices/historical/${timestamp}/${coins}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return new Map();
    const payload = await response.json() as { coins?: Record<string, { price?: unknown }> };
    const result = new Map<string, number>();
    for (const address of unique) {
      const price = payload.coins?.[`${chain}:${address}`]?.price;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) result.set(address, price);
    }
    return result;
  } catch {
    return new Map();
  }
}

function tokenIdTopic(positionId: string): string {
  return `0x${BigInt(positionId).toString(16).padStart(64, "0")}`.toLowerCase();
}

function isMintReceipt(receipt: { logs?: unknown }, positionManager: string, positionId: string): boolean {
  if (!Array.isArray(receipt.logs)) return false;
  const expectedTokenId = tokenIdTopic(positionId);
  return receipt.logs.some((entry) => {
    const log = entry as { address?: unknown; topics?: unknown };
    const topics = Array.isArray(log.topics) ? log.topics : [];
    return String(log.address ?? "").toLowerCase() === positionManager.toLowerCase()
      && String(topics[0] ?? "").toLowerCase() === TRANSFER_EVENT_TOPIC
      && String(topics[1] ?? "").toLowerCase() === ZERO_ADDRESS_TOPIC
      && String(topics[3] ?? "").toLowerCase() === expectedTokenId;
  });
}

async function readRecentMintTransactionHash(
  position: FinancialInputPosition,
  rpcUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (!position.positionManager) return null;
  const head = await rpcCall(rpcUrl, "eth_blockNumber", [], fetchImpl);
  if (typeof head !== "string" || !/^0x[0-9a-fA-F]+$/.test(head)) return null;
  const latestBlock = Number(BigInt(head));
  if (!Number.isSafeInteger(latestBlock)) return null;
  const expectedTokenIdTopic = tokenIdTopic(position.positionId);

  for (let window = 0; window < RECENT_MINT_LOOKBACK_WINDOWS; window++) {
    const toBlock = latestBlock - (window * RECENT_MINT_LOOKBACK_BLOCKS);
    if (toBlock < 0) break;
    const fromBlock = Math.max(0, toBlock - RECENT_MINT_LOOKBACK_BLOCKS + 1);
    const logs = await rpcCall(rpcUrl, "eth_getLogs", [{
      address: position.positionManager,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [INCREASE_LIQUIDITY_EVENT_TOPIC, expectedTokenIdTopic],
    }], fetchImpl);
    if (!Array.isArray(logs)) continue;

    for (const entry of logs) {
      const transactionHash = (entry as { transactionHash?: unknown }).transactionHash;
      if (typeof transactionHash !== "string") continue;
      const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [transactionHash], fetchImpl) as { logs?: unknown } | null;
      if (receipt && isMintReceipt(receipt, position.positionManager, position.positionId)) return transactionHash;
    }

    if (fromBlock === 0) break;
  }

  return null;
}

async function readInitialValue(position: FinancialInputPosition, rpcUrl: string, fetchImpl: typeof fetch): Promise<number | null> {
  if (!position.positionManager || position.token0Decimals === null || position.token1Decimals === null) return null;
  const historyUrl = HISTORY_URLS[position.chainId];
  if (!historyUrl) return null;
  try {
    const transferResponse = await fetchImpl(`${historyUrl}/api/v2/tokens/${position.positionManager}/instances/${position.positionId}/transfers`, {
      headers: { Accept: "application/json" },
    });
    const transferPayload = transferResponse.ok
      ? await transferResponse.json() as { items?: Array<{ from?: { hash?: unknown }; transaction_hash?: unknown }> }
      : undefined;
    const mint = transferPayload?.items?.find((item) => String(item.from?.hash ?? "").toLowerCase() === ZERO_ADDRESS && typeof item.transaction_hash === "string");
    const transactionHash = typeof mint?.transaction_hash === "string"
      ? mint.transaction_hash
      : await readRecentMintTransactionHash(position, rpcUrl, fetchImpl);
    if (!transactionHash) return null;

    const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [transactionHash], fetchImpl) as { blockNumber?: unknown; logs?: unknown } | null;
    if (!receipt || typeof receipt.blockNumber !== "string" || !Array.isArray(receipt.logs)) return null;
    const expectedTokenIdTopic = tokenIdTopic(position.positionId);
    let amount0: bigint | null = null;
    let amount1: bigint | null = null;
    for (const entry of receipt.logs as Array<{ address?: unknown; topics?: unknown; data?: unknown }>) {
      const topics = Array.isArray(entry.topics) ? entry.topics : [];
      if (String(entry.address ?? "").toLowerCase() !== position.positionManager.toLowerCase()) continue;
      if (String(topics[0] ?? "").toLowerCase() !== INCREASE_LIQUIDITY_EVENT_TOPIC) continue;
      if (String(topics[1] ?? "").toLowerCase() !== expectedTokenIdTopic) continue;
      const data = String(entry.data ?? "").replace(/^0x/, "");
      if (data.length !== 192) return null;
      amount0 = BigInt(`0x${data.slice(64, 128)}`);
      amount1 = BigInt(`0x${data.slice(128, 192)}`);
      break;
    }
    if (amount0 === null || amount1 === null) return null;

    const block = await rpcCall(rpcUrl, "eth_getBlockByNumber", [receipt.blockNumber, false], fetchImpl) as { timestamp?: unknown } | null;
    if (!block || typeof block.timestamp !== "string") return null;
    const timestamp = Number(BigInt(block.timestamp));
    const prices = await getHistoricalPrices(priceChain(position.chain), timestamp, [position.token0, position.token1], fetchImpl);
    const price0 = prices.get(position.token0.toLowerCase());
    const price1 = prices.get(position.token1.toLowerCase());
    if (price0 === undefined || price1 === undefined) return null;
    const value = Number(amount0) / 10 ** position.token0Decimals * price0
      + Number(amount1) / 10 ** position.token1Decimals * price1;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function calculateAmounts(position: FinancialInputPosition): { token0: number; token1: number } | null {
  if (!position.sqrtPriceX96 || position.token0Decimals === null || position.token1Decimals === null) return null;
  const liquidity = Number(position.liquidity);
  const sqrtCurrent = Number(BigInt(position.sqrtPriceX96)) / 2 ** 96;
  const sqrtLower = 1.0001 ** (position.tickLower / 2);
  const sqrtUpper = 1.0001 ** (position.tickUpper / 2);
  if (![liquidity, sqrtCurrent, sqrtLower, sqrtUpper].every(Number.isFinite)) return null;
  let amount0 = 0;
  let amount1 = 0;
  if (sqrtCurrent <= sqrtLower) {
    amount0 = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  } else if (sqrtCurrent < sqrtUpper) {
    amount0 = liquidity * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    amount1 = liquidity * (sqrtCurrent - sqrtLower);
  } else {
    amount1 = liquidity * (sqrtUpper - sqrtLower);
  }
  return { token0: amount0 / 10 ** position.token0Decimals, token1: amount1 / 10 ** position.token1Decimals };
}

export async function readFinancialData(options: Options): Promise<{ data: FinancialData; warnings: string[] }> {
  const { position } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const base: FinancialData = {
    token0Amount: null, token0ValueUsd: null, token1Amount: null, token1ValueUsd: null,
    currentValueUsd: null, initialValueUsd: null, profitLossUsd: null, profitLossPercent: null,
    rewardSymbol: null, rewardAmount: null, rewardValueUsd: null,
  };

  const amounts = calculateAmounts(position);
  if (amounts) {
    base.token0Amount = amounts.token0;
    base.token1Amount = amounts.token1;
    const prices = await getPrices(priceChain(position.chain), [position.token0, position.token1], fetchImpl);
    const price0 = prices.get(position.token0.toLowerCase());
    const price1 = prices.get(position.token1.toLowerCase());
    base.token0ValueUsd = price0 === undefined ? null : amounts.token0 * price0;
    base.token1ValueUsd = price1 === undefined ? null : amounts.token1 * price1;
    base.currentValueUsd = base.token0ValueUsd !== null && base.token1ValueUsd !== null
      ? base.token0ValueUsd + base.token1ValueUsd
      : null;
    if (base.currentValueUsd === null) warnings.push(`${position.chain.toUpperCase()}_PRICE_PARTIAL`);
  } else {
    warnings.push(`${position.chain.toUpperCase()}_AMOUNTS_UNAVAILABLE`);
  }

  if (options.rpcUrl) {
    base.initialValueUsd = await readInitialValue(position, options.rpcUrl, fetchImpl);
    if (base.initialValueUsd !== null && base.currentValueUsd !== null) {
      base.profitLossUsd = base.currentValueUsd - base.initialValueUsd;
      base.profitLossPercent = base.initialValueUsd > 0 ? base.profitLossUsd / base.initialValueUsd * 100 : null;
    }
  }

  if (options.rpcUrl && options.walletAddress && position.gaugeAddressRaw && /^0x[0-9a-fA-F]{40}$/.test(options.walletAddress)) {
    try {
      const rewardToken = decodeAddress(await ethCall(options.rpcUrl, position.gaugeAddressRaw, `0x${REWARD_TOKEN_SELECTOR}`, fetchImpl));
      const metadata = await readTokenMetadata({
        tokens: [{ chain: position.chain, chainId: position.chainId, rpcUrl: options.rpcUrl, address: rewardToken }],
        fetchImpl,
      });
      const rewardMeta = metadata.metadata.get(`${position.chainId}:${rewardToken.toLowerCase()}`);
      const earned = decodeUint(await ethCall(
        options.rpcUrl,
        position.gaugeAddressRaw,
        `0x${EARNED_SELECTOR}${encodeAddress(options.walletAddress)}${encodeUint(position.positionId)}`,
        fetchImpl,
      ));
      if (rewardMeta?.decimals !== null && rewardMeta?.decimals !== undefined) {
        const isCeloVelo = rewardToken === CELO_VELO;
        base.rewardSymbol = isCeloVelo ? "VELO" : rewardMeta.symbol;
        base.rewardAmount = Number(earned) / 10 ** rewardMeta.decimals;
        let rewardPrices = await getPrices(priceChain(position.chain), [rewardToken], fetchImpl);
        let rewardPrice = rewardPrices.get(rewardToken);
        if (rewardPrice === undefined && (rewardMeta.symbol === "VELO" || isCeloVelo)) {
          rewardPrices = await getPrices("optimism", [OPTIMISM_VELO], fetchImpl);
          rewardPrice = rewardPrices.get(OPTIMISM_VELO);
        }
        base.rewardValueUsd = rewardPrice === undefined ? null : base.rewardAmount * rewardPrice;
      }
    } catch {
      warnings.push(`${position.chain.toUpperCase()}_REWARD_UNAVAILABLE`);
    }
  }

  return { data: base, warnings };
}
