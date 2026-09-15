import { readTokenMetadata } from "./token-metadata.ts";

const EARNED_SELECTOR = "3e491d47";
const REWARD_TOKEN_SELECTOR = "f7c618c1";
const OPTIMISM_VELO = "0x9560e827af36c94d2ac33a39bce1fe78631088db";

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
};

export type FinancialData = {
  token0Amount: number | null;
  token0ValueUsd: number | null;
  token1Amount: number | null;
  token1ValueUsd: number | null;
  currentValueUsd: number | null;
  initialValueUsd: null;
  profitLossUsd: null;
  profitLossPercent: null;
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
        base.rewardSymbol = rewardMeta.symbol;
        base.rewardAmount = Number(earned) / 10 ** rewardMeta.decimals;
        let rewardPrices = await getPrices(priceChain(position.chain), [rewardToken], fetchImpl);
        let rewardPrice = rewardPrices.get(rewardToken);
        if (rewardPrice === undefined && rewardMeta.symbol === "VELO") {
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
