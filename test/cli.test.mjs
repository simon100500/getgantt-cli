import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, GetGanttApiClient } from '../dist/api-client.js';

test('API client sends the PAT and parses the me response', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ user: { id: 'u1', email: 'user@example.com' }, token: { id: 't1', scopes: ['projects:read'], projectIds: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await new GetGanttApiClient('https://example.test/', 'ggt_pat_secret').me();
    assert.equal(result.user.email, 'user@example.com');
    assert.equal(request.input, 'https://example.test/api/cli/v1/me');
    assert.equal(request.init.headers.Authorization, 'Bearer ggt_pat_secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client exposes the server error code without exposing credentials', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: 'scope_required', message: 'The token requires the schedule:read scope', requestId: 'req-1' },
  }), { status: 403, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => new GetGanttApiClient('https://example.test', 'ggt_pat_secret').projects(),
      (error) => error instanceof ApiError
        && error.code === 'scope_required'
        && error.requestId === 'req-1'
        && !error.message.includes('ggt_pat_secret'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client sends a typed tool call with graph version and idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      catalogVersion: '1',
      tool: 'shift_project',
      projectId: 'p1',
      data: { status: 'accepted', baseVersion: 4, newVersion: 5 },
      receipt: { idempotencyKey: 'idem-1', baseVersion: 4, newVersion: 5, status: 'accepted', changedTaskIds: [], changedDependencyIds: [] },
      requestId: 'req-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const response = await new GetGanttApiClient('https://example.test', 'ggt_pat_secret').toolCall({
      projectId: 'p1',
      tool: 'shift_project',
      arguments: { deltaDays: 3 },
      baseVersion: 4,
      idempotencyKey: 'idem-1',
    });
    assert.equal(response.receipt.newVersion, 5);
    assert.equal(request.input, 'https://example.test/api/cli/v1/tool-calls');
    assert.equal(request.init.headers['Idempotency-Key'], 'idem-1');
    assert.deepEqual(JSON.parse(request.init.body), {
      catalogVersion: '1',
      projectId: 'p1',
      tool: 'shift_project',
      arguments: { deltaDays: 3 },
      baseVersion: 4,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client sends server-owned dry-run requests without changing the auth envelope', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      catalogVersion: '1',
      tool: 'shift_project',
      projectId: 'p1',
      dryRun: true,
      data: { status: 'accepted', baseVersion: 4, newVersion: 5 },
      requestId: 'req-preview',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await new GetGanttApiClient('https://example.test', 'ggt_pat_secret').toolCall({
      projectId: 'p1',
      tool: 'shift_project',
      arguments: { deltaDays: 3 },
      baseVersion: 4,
      idempotencyKey: 'idem-preview',
      dryRun: true,
    });
    assert.equal(request.init.headers.Authorization, 'Bearer ggt_pat_secret');
    assert.equal(JSON.parse(request.init.body).dryRun, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API client discovers the server-owned public tool catalog', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      version: '1',
      operations: [{ name: 'shift_tasks', description: 'Shift tasks', inputSchema: { type: 'object' }, mutating: true, scope: 'schedule:write' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const catalog = await new GetGanttApiClient('https://example.test', 'ggt_pat_secret').toolCatalog();
    assert.equal(catalog.operations[0].name, 'shift_tasks');
    assert.equal(request.input, 'https://example.test/api/cli/v1/tool-catalog');
    assert.equal(request.init.headers.Authorization, 'Bearer ggt_pat_secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
