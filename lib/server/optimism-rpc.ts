const OPTIMISM_CHAIN_ID = 10;
const RPC_METHOD = "eth_chainId";
const DEFAULT_TIMEOUT_MS = 5_000;

export type OptimismProbeErrorCode =
  | "CONFIGURATION_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "INVALID_UPSTREAM_RESPONSE";

interface ProbeOptions {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

class OptimismProbeError extends Error {
  readonly code: OptimismProbeErrorCode;

  constructor(code: OptimismProbeErrorCode) {
    super(code);
    this.name = "OptimismProbeError";
    this.code = code;
  }
}

export async function probeOptimismChainId({
  rpcUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ProbeOptions): Promise<number> {
  const endpoint = parseRpcEndpoint(rpcUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: RPC_METHOD,
        params: [],
      }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new OptimismProbeError("UPSTREAM_UNAVAILABLE");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
    }

    const chainId = parseChainId(payload);
    if (chainId !== OPTIMISM_CHAIN_ID) {
      throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
    }

    return chainId;
  } catch (error) {
    if (error instanceof OptimismProbeError) throw error;
    if (controller.signal.aborted) {
      throw new OptimismProbeError("UPSTREAM_TIMEOUT");
    }
    throw new OptimismProbeError("UPSTREAM_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export async function createOptimismHealthResponse(options: ProbeOptions): Promise<Response> {
  try {
    const chainId = await probeOptimismChainId(options);
    return jsonResponse({ status: "ok", chain: "Optimism", chainId }, 200);
  } catch (error) {
    const code = error instanceof OptimismProbeError
      ? error.code
      : "UPSTREAM_UNAVAILABLE";
    const status = code === "CONFIGURATION_UNAVAILABLE" || code === "UPSTREAM_TIMEOUT"
      ? 503
      : 502;

    return jsonResponse({ status: "error", error: { code } }, status);
  }
}

function parseRpcEndpoint(rpcUrl?: string): string {
  if (!rpcUrl) {
    throw new OptimismProbeError("CONFIGURATION_UNAVAILABLE");
  }

  try {
    const endpoint = new URL(rpcUrl);
    if (endpoint.protocol !== "https:") {
      throw new OptimismProbeError("CONFIGURATION_UNAVAILABLE");
    }
    return endpoint.toString();
  } catch (error) {
    if (error instanceof OptimismProbeError) throw error;
    throw new OptimismProbeError("CONFIGURATION_UNAVAILABLE");
  }
}

function parseChainId(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
  }

  const response = payload as {
    jsonrpc?: unknown;
    id?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (response.jsonrpc !== "2.0" || response.id !== 1 || "error" in response) {
    throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
  }

  const result = response.result;
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
  }

  const chainId = Number.parseInt(result.slice(2), 16);
  if (!Number.isSafeInteger(chainId)) {
    throw new OptimismProbeError("INVALID_UPSTREAM_RESPONSE");
  }
  return chainId;
}

function jsonResponse(payload: unknown, status: number): Response {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
