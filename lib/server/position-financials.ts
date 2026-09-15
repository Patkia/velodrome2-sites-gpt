import { readTokenMetadata } from "./token-metadata.ts";
import type { DashboardPosition } from "../shared/positions-schema.ts";

const EARNED_SELECTOR = "3e491d47";
const REWARD_TOKEN_SELECTOR = "f7c618c1";
const PRICE_NAMESPACES: Record<number, string> = { 10: "optimism", 42220: "celo", 1868: "soneium" };
export const CELO_VELO_REWARD_ADDRESS = "0x7f9adfbd38b669f03d1d11000bc76b9aaea28a81";
export const OPTIMISM_VELO_ADDRESS = "0x9560e827af36c94d2ac33a39bce1fe78631088db";

type FinancialPosition = DashboardPosition & { gaugeAddress?: string; positionManager?: string };
type Options = {
  positions: FinancialPosition[];
  walletAddress?: string;
  rpcUrls: Map<number, string>;
  fetchImpl?: typeof fetch;
};

function encodeAddress(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeUint(value: string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeUint(value: string): bigint {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error("INVALID_RPC_VALUE");
  return BigInt(value);
}

function decodeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("INVALID_RPC_ADDRESS");
  return `0x${value.slice(-40).toLowerCase()}`;
}

async function ethCall(fetchImpl: typeof fetch, rpcUrl: string, to: string, data: string): Promise<string> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || typeof payload.result !== "string") throw new Error("RPC_UNAVAILABLE");
  return payload.result;
}

async function rpcRequest(fetchImpl: typeof fetch, rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("RPC_UNAVAILABLE");
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || payload.result === undefined) throw new Error("RPC_UNAVAILABLE");
  return payload.result;
}

function word(value: string, index: number): bigint {
  const body = value.replace(/^0x/, "");
  const part = body.slice(index * 64, (index + 1) * 64);
  if (!/^[0-9a-fA-F]{64}$/.test(part)) throw new Error("INVALID_LOG_DATA");
  return BigInt(`0x${part}`);
}

async function readHistoricalPrices(fetchImpl: typeof fetch, timestamp: number, keys: string[]) {
  const response = await fetchImpl(`https://coins.llama.fi/prices/historical/${timestamp}/${keys.join(",")}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("HISTORICAL_PRICE_UNAVAILABLE");
  const payload = await response.json() as { coins?: Record<string, { price?: unknown }> };
  return keys.map((key) => {
    const price = payload.coins?.[key]?.price;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  });
}

async function readInitialValueUsd(fetchImpl: typeof fetch, rpcUrl: string, position: FinancialPosition): Promise<number | null> {
  if (!position.positionManager || position.token0Decimals === null || position.token1Decimals === null) return null;
  const tokenIdTopic = `0x${BigInt(position.positionId).toString(16).padStart(64, "0")}`;
  const result = await rpcRequest(fetchImpl, rpcUrl, "eth_getLogs", [{
    address: position.positionManager,
    fromBlock: "0x0",
    toBlock: "latest",
    topics: [null, tokenIdTopic],
  }]);
  if (!Array.isArray(result)) return null;
  const mintLog = result
    .filter((item): item is { data: string; blockNumber: string } => Boolean(
      item && typeof item === "object"
      && typeof (item as { data?: unknown }).data === "string"
      && /^0x[0-9a-fA-F]{192}$/.test((item as { data: string }).data)
      && typeof (item as { blockNumber?: unknown }).blockNumber === "string",
    ))
    .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)))[0];
  if (!mintLog) return null;
  const block = await rpcRequest(fetchImpl, rpcUrl, "eth_getBlockByNumber", [mintLog.blockNumber, false]);
  if (!block || typeof block !== "object" || typeof (block as { timestamp?: unknown }).timestamp !== "string") return null;
  const namespace = PRICE_NAMESPACES[position.chainId];
  if (!namespace) return null;
  const keys = [
    `${namespace}:${position.token0.toLowerCase()}`,
    `${namespace}:${position.token1.toLowerCase()}`,
  ];
  const [price0, price1] = await readHistoricalPrices(
    fetchImpl,
    Number(BigInt((block as { timestamp: string }).timestamp)),
    keys,
  );
  if (price0 === null || price1 === null) return null;
  const amount0 = Number(word(mintLog.data, 1)) / Math.pow(10, position.token0Decimals);
  const amount1 = Number(word(mintLog.data, 2)) / Math.pow(10, position.token1Decimals);
  const value = amount0 * price0 + amount1 * price1;
  return Number.isFinite(value) ? value : null;
}

function tokenAmounts(position: FinancialPosition): { token0Amount: number; token1Amount: number } | null {
  if (position.token0Decimals === null || position.token1Decimals === null) return null;
  const liquidity = Number(position.liquidity);
  if (!Number.isFinite(liquidity)) return null;
  const sqrtCurrent = Math.pow(1.0001, position.currentTick / 2);
  const sqrtLower = Math.pow(1.0001, position.tickLower / 2);
  const sqrtUpper = Math.pow(1.0001, position.tickUpper / 2);
  let amount0 = 0;
  let amount1 = 0;
  if (sqrtCurrent <= sqrtLower) amount0 = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  else if (sqrtCurrent < sqrtUpper) {
    amount0 = liquidity * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    amount1 = liquidity * (sqrtCurrent - sqrtLower);
  } else amount1 = liquidity * (sqrtUpper - sqrtLower);
  return {
    token0Amount: amount0 / Math.pow(10, position.token0Decimals),
    token1Amount: amount1 / Math.pow(10, position.token1Decimals),
  };
}

function displayAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const maximumFractionDigits = value >= 1000 ? 2 : value >= 1 ? 4 : 8;
  return value.toLocaleString("en-US", { maximumFractionDigits, useGrouping: false });
}

function isCeloVeloReward(chainId: number, address: string): boolean {
  return chainId === 42220 && address.toLowerCase() === CELO_VELO_REWARD_ADDRESS;
}

function rewardDisplaySymbol(chainId: number, address: string, reportedSymbol: string | null | undefined): string | null {
  return isCeloVeloReward(chainId, address) ? "VELO" : reportedSymbol ?? null;
}

async function readPrices(fetchImpl: typeof fetch, tokens: Array<{ chainId: number; address: string }>) {
  const keys = [...new Set(tokens.map(({ chainId, address }) => {
    const namespace = PRICE_NAMESPACES[chainId];
    return namespace ? `${namespace}:${address.toLowerCase()}` : null;
  }).filter((key): key is string => key !== null))];
  if (keys.length === 0) return new Map<string, number>();
  const response = await fetchImpl(`https://coins.llama.fi/prices/current/${keys.join(",")}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("PRICE_UNAVAILABLE");
  const payload = await response.json() as { coins?: Record<string, { price?: unknown }> };
  const prices = new Map<string, number>();
  for (const key of keys) {
    const price = payload.coins?.[key]?.price;
    if (typeof price === "number" && Number.isFinite(price)) prices.set(key, price);
  }
  return prices;
}

export async function enrichPositionFinancials(options: Options): Promise<FinancialPosition[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wallet = options.walletAddress && /^0x[0-9a-fA-F]{40}$/.test(options.walletAddress)
    ? options.walletAddress.toLowerCase()
    : null;
  const rewards = new Map<string, { token: string; amount: bigint }>();

  await Promise.all(options.positions.map(async (position) => {
    const rpcUrl = options.rpcUrls.get(position.chainId);
    if (!wallet || !rpcUrl || !position.gaugeAddress || position.source !== "staked") return;
    try {
      const [rewardTokenHex, earnedHex] = await Promise.all([
        ethCall(fetchImpl, rpcUrl, position.gaugeAddress, `0x${REWARD_TOKEN_SELECTOR}`),
        ethCall(fetchImpl, rpcUrl, position.gaugeAddress, `0x${EARNED_SELECTOR}${encodeAddress(wallet)}${encodeUint(position.positionId)}`),
      ]);
      rewards.set(`${position.chainId}:${position.positionId}`, {
        token: decodeAddress(rewardTokenHex),
        amount: decodeUint(earnedHex),
      });
    } catch {
      // A missing reward read must not hide the live principal position.
    }
  }));

  const rewardTokens = [...rewards.entries()].map(([key, reward]) => {
    const chainId = Number(key.split(":", 1)[0]);
    return { chain: "Reward", chainId, rpcUrl: options.rpcUrls.get(chainId)!, address: reward.token };
  }).filter((token) => Boolean(token.rpcUrl));
  const rewardMetadata = rewardTokens.length > 0
    ? await readTokenMetadata({ tokens: rewardTokens, fetchImpl }).catch(() => ({ metadata: new Map(), warnings: [] }))
    : { metadata: new Map(), warnings: [] };
  const rewardPriceTokens = [...rewards.entries()].flatMap(([key, reward]) => {
    const chainId = Number(key.split(":", 1)[0]);
    return [
      { chainId, address: reward.token },
      ...(isCeloVeloReward(chainId, reward.token) ? [{ chainId: 10, address: OPTIMISM_VELO_ADDRESS }] : []),
    ];
  });
  const priceTokens = options.positions.flatMap((position) => [
    { chainId: position.chainId, address: position.token0 },
    { chainId: position.chainId, address: position.token1 },
  ]).concat(rewardPriceTokens);
  const prices = await readPrices(fetchImpl, priceTokens).catch(() => new Map<string, number>());

  const initialValues = new Map<string, number>();
  await Promise.all(options.positions.map(async (position) => {
    const rpcUrl = options.rpcUrls.get(position.chainId);
    if (!rpcUrl) return;
    try {
      const value = await readInitialValueUsd(fetchImpl, rpcUrl, position);
      if (value !== null) initialValues.set(`${position.chainId}:${position.positionManager}:${position.positionId}`, value);
    } catch {
      // Historical RPC and price coverage are best-effort and read-only.
    }
  }));

  return options.positions.map((position) => {
    const amounts = tokenAmounts(position);
    const namespace = PRICE_NAMESPACES[position.chainId];
    const price0 = namespace ? prices.get(`${namespace}:${position.token0.toLowerCase()}`) : undefined;
    const price1 = namespace ? prices.get(`${namespace}:${position.token1.toLowerCase()}`) : undefined;
    const value0 = amounts && price0 !== undefined ? amounts.token0Amount * price0 : null;
    const value1 = amounts && price1 !== undefined ? amounts.token1Amount * price1 : null;
    const reward = rewards.get(`${position.chainId}:${position.positionId}`);
    const rewardMeta = reward ? rewardMetadata.metadata.get(`${position.chainId}:${reward.token.toLowerCase()}`) : undefined;
    const rewardAmountNumber = reward && rewardMeta?.decimals !== null && rewardMeta?.decimals !== undefined
      ? Number(reward.amount) / Math.pow(10, rewardMeta.decimals)
      : null;
    const rewardPrice = reward && namespace
      ? prices.get(`${namespace}:${reward.token.toLowerCase()}`)
        ?? (isCeloVeloReward(position.chainId, reward.token)
          ? prices.get(`optimism:${OPTIMISM_VELO_ADDRESS}`)
          : undefined)
      : undefined;
    const currentValueUsd = value0 !== null && value1 !== null ? value0 + value1 : null;
    const initialValueUsd = initialValues.get(`${position.chainId}:${position.positionManager}:${position.positionId}`) ?? null;
    return {
      ...position,
      token0Amount: amounts ? displayAmount(amounts.token0Amount) : null,
      token0ValueUsd: value0,
      token1Amount: amounts ? displayAmount(amounts.token1Amount) : null,
      token1ValueUsd: value1,
      currentValueUsd,
      initialValueUsd,
      pnlUsd: currentValueUsd !== null && initialValueUsd !== null ? currentValueUsd - initialValueUsd : null,
      rewardSymbol: reward ? rewardDisplaySymbol(position.chainId, reward.token, rewardMeta?.symbol) : null,
      rewardAmount: rewardAmountNumber === null ? null : displayAmount(rewardAmountNumber),
      rewardValueUsd: rewardAmountNumber !== null && rewardPrice !== undefined ? rewardAmountNumber * rewardPrice : null,
    };
  });
}
