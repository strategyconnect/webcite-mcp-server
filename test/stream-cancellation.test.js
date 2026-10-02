const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { createMcpServer } = require('../dist/index.js');
const { collectStreamEvents } = require('../dist/stream.js');
const frame = data => new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);

async function withStream(frames, run, cleanupError) {
  const previous = global.fetch;
  let controller, options, cancelled = 0, aborted = 0, errored = false;
  let start;
  const started = new Promise(resolve => { start = resolve; });
  global.fetch = async (_url, request) => {
    options = request;
    request.signal?.throwIfAborted();
    const body = new ReadableStream({
      start(value) { controller = value; for (const data of frames) value.enqueue(frame(data)); },
      cancel() { cancelled++; if (cleanupError) throw cleanupError; },
    });
    if (cleanupError) {
      const getReader = body.getReader.bind(body);
      body.getReader = () => {
        const reader = getReader();
        return { read: reader.read.bind(reader), releaseLock: reader.releaseLock.bind(reader),
          cancel: async () => { cancelled++; throw cleanupError; } };
      };
    }
    request.signal?.addEventListener('abort', () => {
      aborted++; errored = true; controller.error(request.signal.reason);
    }, { once: true });
    start();
    return new Response(body);
  };
  try {
    await run(new WebCiteApiClient('controlled-only', 'https://example.invalid'), {
      started, state: () => ({ signal: options?.signal, cancelled, aborted, body_created: Boolean(controller) }),
      close: () => controller.close(),
      fail: error => { errored = true; controller.error(error); },
    });
  } finally {
    global.fetch = previous;
    if (controller && !cancelled && !errored) { try { controller.close(); } catch { /* Already closed. */ } }
  }
}

test('body cancellation instrument reaches a real underlying stream', async () => {
  let calls = 0;
  const body = new ReadableStream({ cancel() { calls++; } });
  const reader = body.getReader();
  await reader.cancel(); reader.releaseLock();
  assert.equal(calls, 1);
});

test('actual MCP cancellation aborts a pending backend stream without another request', async () => {
  await withStream([{ type: 'progress', data: { step: 'controlled' } }], async (api, source) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(api, 'public');
    const client = new Client({ name: 'stream-cancellation-control', version: '1' }, { capabilities: {} });
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const controller = new AbortController(), reason = new Error('Controlled caller cancellation');
      const request = client.callTool({ name: 'verify_claim_stream', arguments: { claim: 'Controlled assertion' } },
        undefined, { signal: controller.signal });
      await source.started;
      controller.abort(reason);
      await assert.rejects(request, error => error.code === -32001 && error.message.includes(reason.message));
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(source.state().signal instanceof AbortSignal);
      assert.equal(source.state().signal.aborted, true);
      assert.equal(source.state().aborted, 1);
    } finally { await client.close(); await server.close(); }
  });
});

test('an already-aborted direct stream preserves its reason before creating a body', async () => {
  await withStream([], async (api, source) => {
    const controller = new AbortController(), reason = new Error('Already cancelled');
    controller.abort(reason);
    const settled = api.verifyClaimStream({ claim: 'Controlled assertion' }, controller.signal).next()
      .then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setImmediate(resolve));
    if (source.state().body_created) source.close();
    assert.equal((await settled).error, reason);
    assert.equal(source.state().cancelled, 0);
  });
});

test('early iterator return cancels the unfinished body exactly once', async () => {
  await withStream([{ type: 'progress' }], async (api, source) => {
    const stream = api.verifyClaimStream({ claim: 'Controlled assertion' });
    assert.equal((await stream.next()).value.data.type, 'progress');
    await stream.return();
    assert.equal(source.state().cancelled, 1);
  });
});

test('terminal stream error cancels its body and preserves preceding partial events', async () => {
  await withStream([{ type: 'progress' }, { type: 'error', message: 'Controlled failure' }], async (api, source) => {
    await assert.rejects(collectStreamEvents(api.verifyClaimStream({ claim: 'Controlled assertion' })), error => {
      assert.equal(error.code, 'partial_result');
      assert.match(error.message, /Controlled failure/);
      assert.equal(error.details.partial_events.length, 2);
      return true;
    });
    assert.equal(source.state().cancelled, 1);
  });
});

test('an early-return cleanup failure is visible when there is no earlier failure', async () => {
  const reason = new Error('Controlled cleanup failure');
  await withStream([{ type: 'progress' }], async (api, source) => {
    const stream = api.verifyClaimStream({ claim: 'Controlled assertion' });
    await stream.next();
    await assert.rejects(stream.return(), error => error === reason);
    assert.equal(source.state().cancelled, 1);
  }, reason);
});

test('cleanup failure does not mask the original reader error', async () => {
  await withStream([{ type: 'progress' }], async (api, source) => {
    const stream = api.verifyClaimStream({ claim: 'Controlled assertion' });
    await stream.next();
    const reason = new Error('Original reader failure'); source.fail(reason);
    await assert.rejects(stream.next(), error => error === reason);
    assert.equal(source.state().cancelled, 1);
  }, new Error('Controlled cleanup failure'));
});

test('cleanup failure does not replace a terminal partial-result error', async () => {
  await withStream([{ type: 'error', message: 'Original terminal failure' }], async (api) => {
    await assert.rejects(collectStreamEvents(api.verifyClaimStream({ claim: 'Controlled assertion' })), error => {
      assert.equal(error.code, 'partial_result');
      assert.match(error.message, /Original terminal failure/);
      assert.equal(error.details.partial_events.length, 1);
      return true;
    });
  }, new Error('Controlled cleanup failure'));
});

test('complete result and done consume EOF without extra body cancellation', async () => {
  await withStream([{ type: 'result', data: { citations: [], request_id: 'retained' } }, { type: 'done' }], async (api, source) => {
    const pending = collectStreamEvents(api.verifyClaimStream({ claim: 'Controlled assertion' }));
    await source.started; source.close();
    const output = await pending;
    assert.equal(output.result.request_id, 'retained');
    assert.equal(output.events.length, 2);
    assert.equal(source.state().cancelled, 0);
  });
});

test('an accounting error after done remains failure with its unconfirmed result', async () => {
  await withStream([{ type: 'result', data: { citations: [] } }, { type: 'done' },
    { type: 'accounting_error', message: 'Controlled settlement failure' }], async (api, source) => {
    await assert.rejects(collectStreamEvents(api.verifyClaimStream({ claim: 'Controlled assertion' })), error => {
      assert.equal(error.code, 'partial_result');
      assert.deepEqual(error.details.unconfirmed_result.citations, []);
      assert.equal(error.details.partial_events.length, 3);
      return true;
    });
    assert.equal(source.state().cancelled, 1);
  });
});

test('stream cancellation guidance preserves failure and paid-work uncertainty', async () => {
  const { handlers } = require('../dist/handlers.js');
  const guide = await handlers.webcite_guide({ workflow: 'quick_verify' }, {});
  assert.match(guide.text, /Cancelling a verify_claim_stream MCP request forwards cancellation to its backend HTTP request/);
  assert.match(guide.text, /Cancellation does not establish completion, rollback or a credit refund/);
});
