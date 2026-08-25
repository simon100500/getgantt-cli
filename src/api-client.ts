// FILE: src/api-client.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Call the versioned GetGantt CLI API with a personal access token.
//   SCOPE: Normalize base URLs, send authenticated requests, and expose typed read operations.
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class GetGanttApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string) {
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
    const query = new URLSearchParams({ limit: String(limit) });
    return this.get(`/projects/${encodeURIComponent(projectId)}/tasks?${query}`);
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/cli/v1${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new ApiError(
        body?.error?.message ?? `GetGantt API returned HTTP ${response.status}`,
        response.status,
        body?.error?.code,
        body?.error?.details,
      );
    }
    return body as T;
  }
}

