const test = require('node:test');
const assert = require('node:assert/strict');
const root = process.env.WEBCITE_BOUNDARY_SDK_ROOT || require('node:path').resolve(__dirname, '..');
const { WebCiteApiClient } = require(`${root}/dist/api-client.js`);
const { handlers } = require(`${root}/dist/handlers.js`);
const { collectStreamEvents } = require(`${root}/dist/stream.js`);
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require(`${root}/dist/index.js`);
const receipt = { credits_used: 4, credits_remaining: 791, monthly_allocation: null,
  overage_enabled: null, operation_id: 'synthetic-operation' };
const headers = { 'X-Credits-Used': '4', 'X-Credits-Remaining': '791',
  'X-Credits-Operation-Id': 'synthetic-operation' };
const api = () => new WebCiteApiClient('synthetic-only', 'https://offline.invalid');

async function withFetch(fetch, run) {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = (...args) => { calls++; return fetch(...args); };
  try { await run(api()); assert.equal(calls, 1); } finally { global.fetch = previous; }
}

test('actual direct saved read cancellation preserves its original reason', async () => {
  const controller = new AbortController(), reason = new Error('Controlled read cancellation');
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    assert.equal(options.signal, controller.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(reason);
  }), async client => {
    await assert.rejects(client.getDocumentReview('review', 0, 50, 0, 20, 0, 20, 0, 20, controller.signal),
      error => error === reason);
  });
});

test('actual public MCP cancellation aborts the saved read HTTP request', async () => {
  let started, resolveFetch, requestSignal;
  const pending = new Promise(resolve => { started = resolve; });
  await withFetch((_url, options) => new Promise((resolve, reject) => {
    resolveFetch = resolve; requestSignal = options.signal;
    options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    started();
  }), async apiClient => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(apiClient, 'public');
    const client = new Client({ name: 'saved-read-cancel-control', version: '1' }, { capabilities: {} });
    try {
      await server.connect(st); await client.connect(ct);
      const controller = new AbortController();
      const request = client.callTool({ name: 'get_document_review', arguments: { review_id: 'review' } },
        undefined, { signal: controller.signal });
      await pending; controller.abort(new Error('Caller cancelled saved read'));
      await assert.rejects(request, error => error.code === -32001);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(requestSignal instanceof AbortSignal);
      assert.equal(requestSignal.aborted, true);
    } finally {
      resolveFetch(Response.json({}));
      await client.close(); await server.close();
    }
  });
});

test('valid JSON and HTTP503 retain known header receipts', async () => {
  await withFetch(async () => Response.json({ retained: true }, { headers }), async client => {
    assert.deepEqual((await client.getDocumentReview('review')).credit_usage, receipt);
  });
  await withFetch(async () => new Response('Unavailable', { status: 503, headers }), async client => {
    await assert.rejects(client.getDocumentReview('review'), error => {
      assert.equal(error.status, 503); assert.deepEqual(error.credit_usage, receipt); return true;
    });
  });
});

for (const body of ['', 'not-json']) {
  test(`malformed successful JSON (${body || 'empty'}) fails with its known receipt`, async () => {
    await withFetch(async () => new Response(body, { headers }), async client => {
      await assert.rejects(handlers.verify_claim({ claim: 'Synthetic assertion' }, client), error => {
        assert.equal(error.code, 'api_error'); assert.deepEqual(error.toPayload().credit_usage, receipt);
        assert.match(error.message, /JSON/i); return true;
      });
    });
  });
}

test('multipart JSON failure uses the same receipt-preserving boundary', async () => {
  await withFetch(async () => new Response('not-json', { headers }), async client => {
    await assert.rejects(client.uploadBytes(new Uint8Array([1]), 'fixture.txt'), error => {
      assert.deepEqual(error.credit_usage, receipt); assert.match(error.message, /JSON/i); return true;
    });
  });
});

test('malformed JSON without headers remains unknown, never a free successful result', async () => {
  await withFetch(async () => new Response('not-json'), async client => {
    await assert.rejects(handlers.verify_claim({ claim: 'Synthetic assertion' }, client), error => {
      assert.equal(error.code, 'api_error'); assert.equal(error.toPayload().credit_usage, undefined); return true;
    });
  });
});

for (const credited of [true, false]) {
  test(`missing streaming body retains ${credited ? 'known receipt' : 'unknown credit state'}`, async () => {
    await withFetch(async () => new Response(null, { headers: credited ? headers : {} }), async client => {
      await assert.rejects(handlers.verify_claim_stream({ claim: 'Synthetic assertion' }, client), error => {
        assert.equal(error.code, 'api_error'); assert.match(error.message, /body/i);
        assert.deepEqual(error.toPayload().credit_usage, credited ? receipt : undefined); return true;
      });
    });
  });
  test(`truncated streaming result remains unconfirmed, credits ${credited ? 'known' : 'unknown'}`, async () => {
    const frame = 'data: {"type":"result","data":{"citations":[],"request_id":"retained"}}\n\n';
    await withFetch(async () => new Response(frame, { headers: credited ? headers : {} }), async client => {
      await assert.rejects(collectStreamEvents(client.verifyClaimStream({ claim: 'Synthetic assertion' })), error => {
        assert.equal(error.code, 'partial_result');
        assert.equal(error.details.unconfirmed_result.request_id, 'retained');
        assert.equal(error.details.partial_events.length, 1);
        assert.deepEqual(error.toPayload().credit_usage, credited ? receipt : undefined); return true;
      });
    });
  });
  test(`empty stream without complete frames fails with ${credited ? 'known' : 'unknown'} credits`, async () => {
    for (const body of ['', 'data: {"type":"done"}']) {
      await withFetch(async () => new Response(body, { headers: credited ? headers : {} }), async client => {
        await assert.rejects(handlers.verify_claim_stream({ claim: 'Synthetic assertion' }, client), error => {
          assert.equal(error.code, 'api_error'); assert.match(error.message, /complete events/i);
          assert.deepEqual(error.toPayload().credit_usage, credited ? receipt : undefined); return true;
        });
      });
    }
  });
}

const frame = data => `data: ${JSON.stringify(data)}\n\n`;
test('explicit valid stream receipt wins over headers and result, without changing event data', async () => {
  const explicit = { ...receipt, credits_used: 0, operation_id: 'stream-operation' };
  const result = { citations: [], credit_usage: { ...receipt, operation_id: 'result-operation' } };
  const frames = [{ type: 'result', data: result }, { type: 'usage', credit_usage: explicit }, { type: 'done' }];
  await withFetch(async () => new Response(frames.map(frame).join(''), { headers }), async client => {
    const output = await collectStreamEvents(client.verifyClaimStream({ claim: 'Synthetic assertion' }));
    assert.deepEqual(output.result.credit_usage, explicit);
    assert.deepEqual(output.events.map(event => event.data), frames);
  });
});

test('valid result receipt wins over fallback headers', async () => {
  const canonical = { ...receipt, credits_used: 0, operation_id: 'result-operation' };
  const frames = [{ type: 'result', data: { citations: [], credit_usage: canonical } }, { type: 'done' }];
  await withFetch(async () => new Response(frames.map(frame).join(''), { headers }), async client => {
    assert.deepEqual((await collectStreamEvents(client.verifyClaimStream({ claim: 'Synthetic assertion' }))).result.credit_usage, canonical);
  });
});

test('invalid explicit stream receipt remains a failure with known HTTP receipt', async () => {
  const frames = [{ type: 'usage', credit_usage: { credits_used: -1, credits_remaining: 1 } }];
  for (const credited of [true, false]) {
    await withFetch(async () => new Response(frames.map(frame).join(''), { headers: credited ? headers : {} }), async client => {
      await assert.rejects(collectStreamEvents(client.verifyClaimStream({ claim: 'Synthetic assertion' })), error => {
        assert.equal(error.code, 'invalid_api_output');
        assert.deepEqual(error.toPayload().credit_usage, credited ? receipt : undefined); return true;
      });
    });
  }
});

test('invalid numeric headers stay unknown and explicit valid zero headers remain zero', async () => {
  for (const [used, expected] of [['nonsense', null], ['0', 0]]) {
    await withFetch(async () => new Response('not-json', { headers: { 'X-Credits-Used': used } }), async client => {
      await assert.rejects(client.getDocumentReview('review'), error => {
        assert.equal(error.credit_usage.credits_used, expected); assert.equal(error.credit_usage.credits_remaining, null);
        assert.equal(error.credit_usage.operation_id, null); return true;
      });
    });
  }
});

test('concurrent streams keep distinct HTTP receipts and retain failure after done', async () => {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++; const claim = JSON.parse(options.body).claim;
    const frames = [{ type: 'result', data: { citations: [] } }, { type: 'done' }, { type: 'accounting_error' }];
    await new Promise(resolve => setImmediate(resolve));
    return new Response(frames.map(frame).join(''), { headers: { ...headers, 'X-Credits-Operation-Id': claim } });
  };
  try {
    const client = api();
    const outputs = await Promise.allSettled(['stream-A', 'stream-B'].map(claim =>
      collectStreamEvents(client.verifyClaimStream({ claim }))));
    assert.equal(calls, 2);
    outputs.forEach((output, index) => {
      assert.equal(output.status, 'rejected'); assert.equal(output.reason.code, 'partial_result');
      assert.equal(output.reason.toPayload().credit_usage.operation_id, ['stream-A', 'stream-B'][index]);
      assert.equal(output.reason.details.partial_events.length, 3);
    });
  } finally { global.fetch = previous; }
});

test('JSON body read cancellation preserves original error identity', async () => {
  const controller = new AbortController(), reason = new SyntaxError('Original body cancellation');
  await withFetch(async () => ({ ok: true, status: 200, headers: new Headers(headers),
    json: async () => { controller.abort(reason); throw reason; } }), async client => {
    await assert.rejects(client.getDocumentReview('review', 0, 50, 0, 20, 0, 20, 0, 20, controller.signal),
      error => error === reason);
  });
});

test('actual public MCP malformed JSON failure retains known receipt and never claims success', async () => {
  await withFetch(async () => new Response('not-json', { headers }), async apiClient => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(apiClient, 'public');
    const client = new Client({ name: 'parse-receipt-control', version: '1' }, { capabilities: {} });
    try {
      await server.connect(st); await client.connect(ct);
      const output = await client.callTool({ name: 'verify_claim', arguments: { claim: 'Synthetic assertion' } });
      assert.equal(output.isError, true); assert.equal(output.structuredContent.code, 'api_error');
      assert.deepEqual(output.structuredContent.credit_usage, receipt);
      assert.match(output.content[0].text, /credits used: 4/i);
    } finally { await client.close(); await server.close(); }
  });
});

test('shared guide explains retained receipts and saved-read cancellation without a refund claim', () => {
  const { renderWebciteGuide } = require(`${root}/dist/guide.js`);
  for (const workflow of ['document_review', 'billing']) {
    const guide = renderWebciteGuide({ workflow });
    assert.match(guide, /Cancelling a get_document_review MCP request forwards cancellation/);
    assert.match(guide, /Missing receipt fields remain unknown/);
    assert.match(guide, /do not confirm a result, a zero charge or a refund/);
  }
});
