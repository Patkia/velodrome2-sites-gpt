const OPTIMISM_CHAIN_ID = 10;
const RPC_METHOD = "eth_chainId";

export type OptimismProbeErrorCode =
  | "CONFIGURATION_UNAVAILABLE"
  | "RUNTIME_SETUP_FAILED"
  | "FETCH_FAILED"
  | "UPSTREAM_HTTP_ERROR"
  | "INVALID_JSON"
  | "RPC_ERROR"
  | "INVALID_CHAIN_ID";

type OptimismProbeErrorDetails = {
  httpStatus?: number;
  contentType?: string;
  rpcCode?: number;
};

interface ProbeOptions {
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
}

class OptimismProbeError extends Error {
  readonly code: OptimismProbeErrorCode;
  readonly details: OptimismProbeErrorDetails;

  constructor(code: OptimismProbeErrorCode, details: OptimismProbeErrorDetails = {}) {
    super(code);
    this.name = "OptimismProbeError";
    this.code = code;
    this.details = details;
  }
}

export async function probeOptimismChainId({
  rpcUrl,
  fetchImpl,
}: ProbeOptions): Promise<number> {
  try {
    if (typeof fetch !== "function" || (fetchImpl !== undefined && typeof fetchImpl !== "function")) {
      throw new OptimismProbeError("RUNTIME_SETUP_FAILED");
    }

    const endpoint = parseRpcEndpoint(rpcUrl);
    const requestFetch = fetchImpl ?? fetch;
    const response = await requestFetch(endpoint, {
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
    });

    if (!response.ok) {
      throw new OptimismProbeError("UPSTREAM_HTTP_ERROR", {
        httpStatus: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OptimismProbeError("INVALID_JSON");
    }

    const chainId = parseChainId(payload);
    if (chainId !== OPTIMISM_CHAIN_ID) {
      throw new OptimismProbeError("INVALID_CHAIN_ID");
    }

    return chainId;
  } catch (error) {
    if (error instanceof OptimismProbeError) throw error;
    throw new OptimismProbeError("FETCH_FAILED");
  }
}

export async function createOptimismHealthResponse(options: ProbeOptions): Promise<Response> {
  const startedAt = Date.now();
  try {
    const chainId = await probeOptimismChainId(options);
    return jsonResponse({ status: "ok", chain: "Optimism", chainId }, 200);
  } catch (error) {
    const code = error instanceof OptimismProbeError
      ? error.code
      : "FETCH_FAILED";
    const status = code === "CONFIGURATION_UNAVAILABLE" || code === "RUNTIME_SETUP_FAILED"
      ? 503
      : 502;
    const details = error instanceof OptimismProbeError ? error.details : {};

    return jsonResponse({
      status: "error",
      error: {
        code,
        ...details,
        durationMs: Math.max(0, Date.now() - startedAt),
      },
    }, status);
  }
}

function parseRpcEndpoint(rpcUrl?: string): string {
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") {
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
    throw new OptimismProbeError("INVALID_JSON");
  }

  const response = payload as {
    jsonrpc?: unknown;
    id?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (response.jsonrpc !== "2.0" || response.id !== 1) {
    throw new OptimismProbeError("INVALID_JSON");
  }

  if ("error" in response) {
    const rpcError = response.error;
    if (typeof rpcError === "object" && rpcError !== null && !Array.isArray(rpcError)) {
      const rpcCode = (rpcError as { code?: unknown }).code;
      if (typeof rpcCode === "number" && Number.isSafeInteger(rpcCode)) {
        throw new OptimismProbeError("RPC_ERROR", { rpcCode });
      }
    }
    throw new OptimismProbeError("INVALID_JSON");
  }

  const result = response.result;
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new OptimismProbeError("INVALID_JSON");
  }

  const chainId = Number.parseInt(result.slice(2), 16);
  if (!Number.isSafeInteger(chainId)) {
    throw new OptimismProbeError("INVALID_JSON");
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
