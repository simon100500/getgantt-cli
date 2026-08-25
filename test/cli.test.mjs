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
        && !error.message.includes('ggt_pat_secret'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
