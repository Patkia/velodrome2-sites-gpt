export const SITES_STATE_NAMESPACE = "velodrome2-sites-poc:";

type StateStoreOptions = {
  restUrl?: string;
  restToken?: string;
  fetchImpl?: typeof fetch;
};

export class StateStoreError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StateStoreError";
    this.code = code;
  }
}

export function isStateConfigured(options: StateStoreOptions): boolean {
  return Boolean(options.restUrl && options.restToken);
}

export class UpstashStateStore {
  private readonly options: StateStoreOptions;

  constructor(options: StateStoreOptions) {
    if (!isStateConfigured(options)) throw new StateStoreError("STATE_UNAVAILABLE");
    this.options = options;
  }

  private async execute(command: unknown[]): Promise<Record<string, unknown>> {
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.restUrl!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.restToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
      });
      if (!response.ok) throw new StateStoreError("STATE_BACKEND_FAILED");
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new StateStoreError("STATE_BACKEND_FAILED");
      }
      const record = body as Record<string, unknown>;
      if ("error" in record) throw new StateStoreError("STATE_BACKEND_FAILED");
      return record;
    } catch (error) {
      if (error instanceof StateStoreError) throw error;
      throw new StateStoreError("STATE_BACKEND_FAILED");
    }
  }

  private namespaced(key: string): string {
    return `${SITES_STATE_NAMESPACE}${key}`;
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.execute(["GET", this.namespaced(key)]);
    if (!("result" in response)) throw new StateStoreError("STATE_READ_FAILED");
    return response.result !== null;
  }

  async write(key: string, content: string): Promise<void> {
    const response = await this.execute(["SET", this.namespaced(key), content]);
    if (response.result !== "OK") throw new StateStoreError("STATE_WRITE_FAILED");
  }

  async delete(key: string): Promise<void> {
    const response = await this.execute(["DEL", this.namespaced(key)]);
    if (!("result" in response) || typeof response.result !== "number") {
      throw new StateStoreError("STATE_DELETE_FAILED");
    }
  }
}

export type StateStore = Pick<UpstashStateStore, "exists" | "write" | "delete">;
