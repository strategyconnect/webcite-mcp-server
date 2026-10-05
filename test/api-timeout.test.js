const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebCiteApiClient, DEFAULT_API_TIMEOUT_MS, resolveApiTimeoutMs } = require('../dist/api-client.js');

function slowServer(delayMs) {
  const timers = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    const timer = setTimeout(() => {
      timers.delete(timer);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, delayMs);
    timers.add(timer);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const t of timers) clearTimeout(t); server.closeAllConnections(); return new Promise(r => server.close(r)); },
  })));
}

async function withTimeoutEnv(value, run) {
  const previous = process.env.WEBCITE_API_TIMEOUT_MS;
  if (value === undefined) delete process.env.WEBCITE_API_TIMEOUT_MS;
  else process.env.WEBCITE_API_TIMEOUT_MS = value;
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.WEBCITE_API_TIMEOUT_MS;
    else process.env.WEBCITE_API_TIMEOUT_MS = previous;
  }
}

test('API timeout defaults to 15 minutes', async () => {
  assert.equal(DEFAULT_API_TIMEOUT_MS, 900000);
  await withTimeoutEnv(undefined, () => assert.equal(resolveApiTimeoutMs(), 900000));
});

test('WEBCITE_API_TIMEOUT_MS overrides the default', async () => {
  await withTimeoutEnv('1200000', () => assert.equal(resolveApiTimeoutMs(), 1200000));
});

test('invalid WEBCITE_API_TIMEOUT_MS falls back to the default with a warning', async () => {
  const write = process.stderr.write;
  for (const value of ['0', '-5', 'abc', '1.5', 'NaN', '', '  ', 'Infinity', '1e400']) {
    const warnings = [];
    process.stderr.write = chunk => { warnings.push(String(chunk)); return true; };
    try {
      await withTimeoutEnv(value, () => assert.equal(resolveApiTimeoutMs(), 900000, `value ${JSON.stringify(value)}`));
    } finally { process.stderr.write = write; }
    assert.ok(warnings.some(line => line.includes('WEBCITE_API_TIMEOUT_MS')), `warning for ${JSON.stringify(value)}`);
  }
});

test('requests honour the configured header timeout instead of the undici default', async () => {
  const server = await slowServer(1500);
  try {
    await withTimeoutEnv('300', async () => {
      const client = new WebCiteApiClient('test-key', server.url);
      const started = Date.now();
      await assert.rejects(client.getCitation('x'), error => {
        const codes = [error?.code, error?.cause?.code];
        assert.ok(codes.includes('UND_ERR_HEADERS_TIMEOUT'), `unexpected error ${error?.cause?.code ?? error}`);
        return true;
      });
      assert.ok(Date.now() - started < 1400, 'timed out at the configured value, not the server delay');
    });
  } finally { await server.close(); }
});

test('a response slower than the old limit but within the configured limit succeeds', async () => {
  const server = await slowServer(400);
  try {
    await withTimeoutEnv('2000', async () => {
      const client = new WebCiteApiClient('test-key', server.url);
      assert.deepEqual(await client.getCitation('x'), { ok: true });
    });
  } finally { await server.close(); }
});

test('AbortSignal still cancels a request on the dispatcher', async () => {
  const server = await slowServer(5000);
  try {
    await withTimeoutEnv('10000', async () => {
      const client = new WebCiteApiClient('test-key', server.url);
      const controller = new AbortController();
      const reason = new Error('caller cancelled');
      setTimeout(() => controller.abort(reason), 100);
      const started = Date.now();
      await assert.rejects(client.getDocumentReview('r1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, controller.signal), error => error === reason);
      assert.ok(Date.now() - started < 2000);
    });
  } finally { await server.close(); }
});

test('streaming requests use the configured dispatcher timeout', async () => {
  const server = await slowServer(1500);
  try {
    await withTimeoutEnv('300', async () => {
      const client = new WebCiteApiClient('test-key', server.url);
      await assert.rejects((async () => { for await (const _ of client.verifyClaimStream({ claim: 'c' })) {} })(),
        error => [error?.code, error?.cause?.code].includes('UND_ERR_HEADERS_TIMEOUT'));
    });
  } finally { await server.close(); }
});

test('file uploads use the configured dispatcher timeout', async () => {
  const server = await slowServer(1500);
  try {
    await withTimeoutEnv('300', async () => {
      const client = new WebCiteApiClient('test-key', server.url);
      await assert.rejects(client.uploadBytes(new Uint8Array([1, 2, 3]), 'a.txt'),
        error => [error?.code, error?.cause?.code].includes('UND_ERR_HEADERS_TIMEOUT'));
    });
  } finally { await server.close(); }
});
