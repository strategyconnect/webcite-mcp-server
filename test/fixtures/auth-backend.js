const http = require('node:http');

/**
 * A stand-in Webcite API for hosted MCP tests. `answer(req)` returns [status, body] for each request;
 * the default accepts every credential, so tests that are not about auth keep working.
 */
async function startAuthBackend(answer = () => [200, { credits: { remaining: 5, used: 0, total: 100 } }]) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url, key: req.headers['x-api-key'], body: raw });
    const [status, body] = await answer(req, raw);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startAuthBackend };
