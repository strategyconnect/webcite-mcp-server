const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteMcpApp } = require('../dist/http-server.js');
const { startAuthBackend } = require('./fixtures/auth-backend.js');
const { createCredentialCheck } = require('../dist/credential-check.js');

// Prod, hosted MCP bda77022: a deleted API key got HTTP 200 at the transport and only the tool call
// failed with the backend's 401, so MCP clients never re-authenticated.

const BALANCE = '/api/v1/payment/credits/balance';
const CHALLENGE = /^Bearer error="invalid_token", .*resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp", scope="webcite:mcp"$/;

async function withApp(apiBaseUrl, fn) {
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = (key, method = 'tools/list', params = {}) => fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  try { return await fn(post); } finally { await new Promise((resolve) => server.close(resolve)); }
}

/** Collects console.error lines for the duration of fn. */
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  try { await fn(); } finally { console.error = original; }
  return lines;
}

const keys = (answers) => (req) => [answers[req.headers['x-api-key']] ?? 401, answers[req.headers['x-api-key']] === undefined ? { message: 'Invalid API key' } : { credits: { remaining: 5 } }];

test('a revoked API key gets 401 with WWW-Authenticate and no JSON-RPC handling; a valid key gets 200 (positive control)', async () => {
  const backend = await startAuthBackend(keys({ wc_live: 200 }));
  try {
    await withApp(backend.url, async (post) => {
      const revoked = await post('wc_revoked', 'tools/call', { name: 'get_credit_balance', arguments: {} });
      assert.equal(revoked.status, 401);
      assert.match(revoked.headers.get('www-authenticate'), CHALLENGE);
      const body = await revoked.json();
      assert.equal(body.error, 'invalid_token');
      assert.equal(body.result, undefined);
      // Only the credential check reached the API: the tool call never ran.
      assert.deepEqual(backend.calls.map((c) => [c.path, c.key]), [[BALANCE, 'wc_revoked']]);

      // Positive control: the same app and backend let a live key through to the MCP handler.
      const live = await post('wc_live');
      assert.equal(live.status, 200);
      assert.match(await live.text(), /"tools":\[/);
    });
  } finally { await backend.close(); }
});

test('a valid credential is cached: repeated requests make one validation call', async () => {
  const backend = await startAuthBackend(keys({ wc_live: 200 }));
  try {
    await withApp(backend.url, async (post) => {
      for (let i = 0; i < 4; i += 1) assert.equal((await post('wc_live')).status, 200);
      assert.equal(backend.calls.filter((c) => c.path === BALANCE).length, 1);
    });
  } finally { await backend.close(); }
});

test('a key with no active subscription (404 from the balance route) is still a valid credential', async () => {
  const backend = await startAuthBackend(() => [404, { message: 'No active subscription found' }]);
  try {
    await withApp(backend.url, async (post) => assert.equal((await post('wc_unsubscribed')).status, 200));
  } finally { await backend.close(); }
});

test('a revocation takes effect once the 60 s cache window ends', async (t) => {
  let revoked = false;
  const backend = await startAuthBackend((req) => (revoked ? [401, { message: 'Invalid API key' }] : [200, { credits: {} }]));
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    await withApp(backend.url, async (post) => {
      assert.equal((await post('wc_key')).status, 200);
      revoked = true;
      t.mock.timers.tick(59_000);
      assert.equal((await post('wc_key')).status, 200, 'inside the window the cached answer stands');
      t.mock.timers.tick(2_000);
      const after = await post('wc_key');
      assert.equal(after.status, 401);
      assert.match(after.headers.get('www-authenticate'), CHALLENGE);
    });
  } finally { await backend.close(); }
});

test('outage: a credential validated inside the cache window is still served when the API returns 5xx', async () => {
  let down = false;
  const backend = await startAuthBackend(() => (down ? [502, { message: 'bad gateway' }] : [200, { credits: {} }]));
  try {
    await withApp(backend.url, async (post) => {
      assert.equal((await post('wc_live')).status, 200);
      down = true;
      assert.equal((await post('wc_live')).status, 200);
    });
  } finally { await backend.close(); }
});

test('outage: a credential whose last check was revoked still gets 401 while the API returns 5xx', async () => {
  let down = false;
  const backend = await startAuthBackend(() => (down ? [503, { message: 'down' }] : [401, { message: 'Invalid API key' }]));
  try {
    await withApp(backend.url, async (post) => {
      assert.equal((await post('wc_revoked')).status, 401);
      down = true;
      const again = await post('wc_revoked');
      assert.equal(again.status, 401);
      assert.match(again.headers.get('www-authenticate'), CHALLENGE);
      assert.equal(backend.calls.length, 1, 'the negative answer is cached');
    });
  } finally { await backend.close(); }
});

// DEV and PROD 513b9cfe: a valid, just-created key got 503 "Authentication is temporarily unavailable"
// because the balance check took longer than 5 s (DEV API event-loop lag up to 68 s). A check that cannot
// decide must not refuse a request that worked before #486; only a definitive invalid answer is a 401.

test('outage: an unknown credential is passed to the MCP handler when the API returns 5xx, logged without the credential', async () => {
  const backend = await startAuthBackend(() => [500, { message: 'database pool exhausted' }]);
  try {
    const lines = await captureErrors(() => withApp(backend.url, async (post) => {
      const res = await post('wc_secret_never_logged');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('www-authenticate'), null);
      assert.match(await res.text(), /"tools":\[/);
    }));
    assert.equal(lines.filter((l) => /credential check skipped/.test(l)).length, 1, lines.join('\n'));
    assert.ok(lines.every((l) => !l.includes('wc_secret_never_logged')), lines.join('\n'));
  } finally { await backend.close(); }
});

test('outage: unknown credentials are passed through when the API is unreachable, and are checked again next time', async () => {
  const lines = await captureErrors(() => withApp('http://127.0.0.1:9', async (post) => {
    for (const key of ['wc_unknown', 'webcite_oat_unknown']) assert.equal((await post(key)).status, 200, key);
    assert.equal((await post('wc_unknown')).status, 200);
  }));
  assert.equal(lines.filter((l) => /credential check skipped/.test(l)).length, 3, lines.join('\n'));
  assert.ok(lines.every((l) => !l.includes('wc_unknown') && !l.includes('webcite_oat_unknown')), lines.join('\n'));
});

test('a check slower than the deadline lets a valid key through; the same key answered in time also passes (control)', async () => {
  let delayMs = 0;
  const backend = await startAuthBackend(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return [200, { credits: {} }];
  });
  try {
    const check = createCredentialCheck(backend.url, { deadlineMs: 100 });
    delayMs = 400;
    const slow = await check('wc_slow_valid');
    assert.equal(slow.status, 'unavailable');
    assert.match(slow.reason, /did not answer within 100 ms/);
    assert.ok(!slow.reason.includes('wc_slow_valid'));
    delayMs = 0;
    assert.deepEqual(await check('wc_fast_valid'), { status: 'valid' });
  } finally { await backend.close(); }
});

test('a slow 401 is not answered in time, but its late answer is cached so the next request gets 401 (revocation within one check)', async () => {
  let delayMs = 300;
  const backend = await startAuthBackend(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return [401, { message: 'Invalid API key' }];
  });
  try {
    const check = createCredentialCheck(backend.url, { deadlineMs: 50 });
    assert.equal((await check('wc_revoked_slow')).status, 'unavailable');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.deepEqual(await check('wc_revoked_slow'), { status: 'invalid' });
    assert.equal(backend.calls.length, 1, 'the late answer was cached, not asked again');
    // Negative control: a fast 401 is a 401 on the first request.
    delayMs = 0;
    assert.deepEqual(await check('wc_revoked_fast'), { status: 'invalid' });
  } finally { await backend.close(); }
});

test('concurrent requests for one credential share a single in-flight check', async () => {
  const backend = await startAuthBackend(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return [200, { credits: {} }];
  });
  try {
    const check = createCredentialCheck(backend.url);
    const answers = await Promise.all([1, 2, 3, 4].map(() => check('wc_burst')));
    assert.ok(answers.every((a) => a.status === 'valid'));
    assert.equal(backend.calls.length, 1);
  } finally { await backend.close(); }
});
