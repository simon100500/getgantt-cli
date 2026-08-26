// FILE: src/api-client.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Call the versioned GetGantt CLI API with a personal access token.
//   SCOPE: Normalize base URLs, send authenticated requests, expose typed reads, discover the public tool catalog, and call the public tool gateway.
//   DEPENDS: Node fetch
//   LINKS: M-CLI-API, M-CLI-AUTH
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//

export type MeResponse = {
  user: { id: string; email: string };
  token: { id: string; scopes: string[]; projectIds: string[] };
};

export type Project = {
  id: string;
  name: string;
  status: string;
  taskCount?: number;
  version?: number | null;
  accessRole?: string;
  permissions?: Record<string, string>;
  [key: string]: unknown;
};

export type ToolCallResponse<T = unknown> = {
  catalogVersion: string;
  tool: string;
  projectId: string | null;
  data: T;
  dryRun?: boolean;
  receipt?: {
    idempotencyKey?: string;
    baseVersion?: number;
    newVersion?: number;
    status?: string;
    changedTaskIds: string[];
    changedDependencyIds: string[];
  };
  requestId: string;
};

export type ToolCatalogOperation = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutating: boolean;
  scope: string;
};

export type ToolCatalogResponse = {
  version: string;
  operations: ToolCatalogOperation[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class GetGanttApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string, private readonly timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async me(): Promise<MeResponse> {
    return this.get<MeResponse>('/me');
  }

  async projects(): Promise<{ items: Project[]; nextCursor: string | null }> {
    const items: Project[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: '200' });
      if (cursor) query.set('cursor', cursor);
      const page = await this.get<{ items: Project[]; nextCursor: string | null }>(`/projects?${query}`);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { items, nextCursor: null };
  }

  async project(id: string): Promise<{ project: Project }> {
    return this.get<{ project: Project }>(`/projects/${encodeURIComponent(id)}`);
  }

  async tasks(projectId: string, limit = 500): Promise<{ projectId: string; version: number; items: unknown[]; nextCursor: string | null }> {
    const items: unknown[] = [];
    let cursor: string | undefined;
    let version = 0;
    do {
      const query = new URLSearchParams({ limit: String(Math.min(limit, 500)) });
      if (cursor) query.set('cursor', cursor);
      const page = await this.get<{ projectId: string; version: number; items: unknown[]; nextCursor: string | null }>(`/projects/${encodeURIComponent(projectId)}/tasks?${query}`);
      items.push(...page.items);
      version = page.version;
      cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length < limit);
    return { projectId, version, items: items.slice(0, limit), nextCursor: cursor ?? null };
  }

  async toolCatalog(): Promise<ToolCatalogResponse> {
    return this.get<ToolCatalogResponse>('/tool-catalog');
  }

  async toolCall<T = unknown>(params: {
    projectId?: string;
    tool: string;
    arguments?: Record<string, unknown>;
    baseVersion?: number;
    idempotencyKey?: string;
    dryRun?: boolean;
  }): Promise<ToolCallResponse<T>> {
    return this.post<ToolCallResponse<T>>('/tool-calls', {
      catalogVersion: '1',
      ...(params.projectId ? { projectId: params.projectId } : {}),
      tool: params.tool,
      arguments: params.arguments ?? {},
      ...(params.baseVersion === undefined ? {} : { baseVersion: params.baseVersion }),
      ...(params.dryRun === undefined ? {} : { dryRun: params.dryRun }),
    }, params.idempotencyKey);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = this.timeoutMs > 0 ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/cli/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(`GetGantt API request timed out after ${this.timeoutMs} ms`, 503, 'request_timeout');
      }
      if (error instanceof TypeError) {
        throw new ApiError('Unable to reach the GetGantt API', 503, 'network_error');
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new ApiError(
        body?.error?.message ?? `GetGantt API returned HTTP ${response.status}`,
        response.status,
        body?.error?.code,
        body?.error?.details,
        body?.error?.requestId,
      );
    }
    return body as T;
  }
}
