const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteMcpApp, clientIp } = require('../dist/http-server.js');
const { startAuthBackend } = require('./fixtures/auth-backend.js');
const { createCredentialCheck } = require('../dist/credential-check.js');

// Security audit 2026-11-26 (lane 4) M6 and L1: junk keys could flush the credential cache, nothing
// limited failed credential checks per client, and an undecided credential let tools/call through.

const BALANCE = '/api/v1/payment/credits/balance';
const VERIFY = '/api/v1/verify';

async function withApp(apiBaseUrl, fn, options = {}) {
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl, ...options });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = (key, { method = 'tools/list', params = {}, ip, body } = {}) => fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body ?? { jsonrpc: '2.0', id: 1, method, params }),
  });
  try { return await fn(post); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function quiet(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

const live = (validKeys) => (req) => (validKeys.includes(req.headers['x-api-key'])
  ? [200, { credits: { remaining: 5 } }] : [401, { message: 'Invalid API key' }]);

const verifyCall = { method: 'tools/call', params: { name: 'verify_claim', arguments: { claim: 'Water boils at 100 C at sea level.' } } };

test('M6c: a flood of invalid keys never evicts a cached valid key', async () => {
  const backend = await startAuthBackend(live(['webcite_valid']));
  try {
    const check = createCredentialCheck(backend.url, { maxCacheEntries: 5 });
    assert.deepEqual(await check('webcite_valid'), { status: 'valid' });
    for (let i = 0; i < 20; i += 1) assert.deepEqual(await check(`webcite_junk_${i}`), { status: 'invalid' });
    assert.deepEqual(await check('webcite_valid'), { status: 'valid' });
    assert.equal(backend.calls.filter((c) => c.key === 'webcite_valid').length, 1, 'the valid answer stayed cached');
    // Control: the invalid side is bounded, so the oldest junk answer was dropped and is asked again.
    assert.deepEqual(await check('webcite_junk_0'), { status: 'invalid' });
    assert.equal(backend.calls.filter((c) => c.key === 'webcite_junk_0').length, 2);
  } finally { await backend.close(); }
});

test('M6c: the valid side is bounded too, oldest first', async () => {
  const backend = await startAuthBackend(() => [200, { credits: {} }]);
  try {
    const check = createCredentialCheck(backend.url, { maxCacheEntries: 3 });
    for (const key of ['k1', 'k2', 'k3', 'k4']) await check(key);
    await check('k4');
    await check('k1');
    assert.equal(backend.calls.filter((c) => c.key === 'k4').length, 1);
    assert.equal(backend.calls.filter((c) => c.key === 'k1').length, 2, 'k1 was the oldest and was evicted');
  } finally { await backend.close(); }
});

test('M6a: the credential check tells the API the request comes from the MCP surface', async () => {
  const seen = [];
  const backend = await startAuthBackend((req) => { seen.push(req.headers['x-webcite-surface']); return [200, { credits: {} }]; });
  try {
    await createCredentialCheck(backend.url)('webcite_any');
    assert.deepEqual(seen, ['mcp']);
  } finally { await backend.close(); }
});

test('M6d: failed credential checks are limited per client IP; other IPs and cached valid keys still pass', async () => {
  const backend = await startAuthBackend(live(['webcite_valid']));
  try {
    await withApp(backend.url, async (post) => {
      const attacker = '198.51.100.7';
      assert.equal((await post('webcite_valid', { ip: attacker })).status, 200);
      for (let i = 0; i < 3; i += 1) assert.equal((await post(`webcite_junk_${i}`, { ip: attacker })).status, 401);
      const checksBefore = backend.calls.length;
      const limited = await post('webcite_junk_next', { ip: attacker });
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get('retry-after')) > 0);
      assert.equal((await limited.json()).error, 'too_many_failed_auth');
      assert.equal(backend.calls.length, checksBefore, 'the limited request never reached the API');
      // A valid key cached before the limit is still served from this IP.
      assert.equal((await post('webcite_valid', { ip: attacker })).status, 200);
      // Another client IP is not affected.
      assert.equal((await post('webcite_junk_other', { ip: '203.0.113.20' })).status, 401);
      assert.equal(backend.calls.at(-1).key, 'webcite_junk_other');
    }, { failedAuthLimit: { limit: 3, windowMs: 60_000 } });
  } finally { await backend.close(); }
});

test('M6d: a valid key does not use up its IP failure allowance', async () => {
  const keysOk = ['a', 'b', 'c', 'd', 'e'].map((k) => `webcite_valid_${k}`);
  const backend = await startAuthBackend(live(keysOk));
  try {
    await withApp(backend.url, async (post) => {
      for (const key of keysOk) assert.equal((await post(key, { ip: '198.51.100.8' })).status, 200, key);
    }, { failedAuthLimit: { limit: 2, windowMs: 60_000 } });
  } finally { await backend.close(); }
});

test('M6d: with no forwarded client address (a direct loopback peer) nothing is limited, so one bucket is never shared by everyone', async () => {
  const backend = await startAuthBackend(live([]));
  try {
    await withApp(backend.url, async (post) => {
      for (let i = 0; i < 5; i += 1) assert.equal((await post(`webcite_junk_${i}`)).status, 401);
    }, { failedAuthLimit: { limit: 2, windowMs: 60_000 } });
  } finally { await backend.close(); }
});

test('clientIp trusts X-Forwarded-For only from a loopback peer and takes the address nginx appended', () => {
  const req = (remoteAddress, xff) => ({ socket: { remoteAddress }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(req('127.0.0.1', '10.9.9.9, 198.51.100.7')), '198.51.100.7');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '198.51.100.7, 127.0.0.1')), '198.51.100.7');
  assert.equal(clientIp(req('203.0.113.5', '198.51.100.7')), '203.0.113.5', 'a public peer cannot choose its address');
  assert.equal(clientIp(req('127.0.0.1')), undefined, 'no forwarded address: unknown, not 127.0.0.1');
});

test('L1: with the API answering 429, tools/list is served but tools/call never runs on the undecided credential', async () => {
  const backend = await startAuthBackend((req) => (req.url === BALANCE ? [429, { message: 'Too many requests' }] : [200, {}]));
  try {
    await quiet(() => withApp(backend.url, async (post) => {
      const list = await post('webcite_undecided');
      assert.equal(list.status, 200);
      assert.match(await list.text(), /"tools":\[/);
      const call = await post('webcite_undecided', verifyCall);
      assert.equal(call.status, 503);
      assert.ok(Number(call.headers.get('retry-after')) > 0);
      assert.equal((await call.json()).error, 'credential_check_unavailable');
      assert.equal(backend.calls.filter((c) => c.path === VERIFY).length, 0, 'the tool call never reached the API');
    }));
  } finally { await backend.close(); }
});

test('L1: a batch that hides tools/call behind tools/list is also held', async () => {
  const backend = await startAuthBackend((req) => (req.url === BALANCE ? [503, { message: 'down' }] : [200, {}]));
  try {
    await quiet(() => withApp(backend.url, async (post) => {
      const res = await post('webcite_undecided', { body: [
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2, ...verifyCall },
      ] });
      assert.equal(res.status, 503);
      assert.equal(backend.calls.filter((c) => c.path === VERIFY).length, 0);
    }));
  } finally { await backend.close(); }
});

test('L1 and #487: a valid key whose check misses the 5 s deadline still gets its tool call (waits for the answer, no 503)', async () => {
  const backend = await startAuthBackend(async (req) => {
    if (req.url === BALANCE) { await new Promise((resolve) => setTimeout(resolve, 300)); return [200, { credits: {} }]; }
    return [500, { message: 'stub' }];
  });
  try {
    await quiet(() => withApp(backend.url, async (post) => {
      const call = await post('webcite_valid_slow', verifyCall);
      assert.equal(call.status, 200);
      assert.match(await call.text(), /"result"/);
      assert.equal(backend.calls.filter((c) => c.path === VERIFY).length, 1, 'the tool call ran after the check said valid');
    }, { credentialCheckDeadlineMs: 50 }));
  } finally { await backend.close(); }
});

test('L1: a slow invalid key on tools/call gets 401 once the check answers', async () => {
  const backend = await startAuthBackend(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return [401, { message: 'Invalid API key' }];
  });
  try {
    await quiet(() => withApp(backend.url, async (post) => {
      const call = await post('webcite_invalid_slow', verifyCall);
      assert.equal(call.status, 401);
      assert.equal(backend.calls.filter((c) => c.path === VERIFY).length, 0);
    }, { credentialCheckDeadlineMs: 50 }));
  } finally { await backend.close(); }
});
