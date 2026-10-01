const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { extractApiKey, createRemoteMcpApp } = require('../dist/http-server.js');

test('extractApiKey reads bearer and x-api-key', () => {
  assert.equal(
    extractApiKey({ headers: { authorization: 'Bearer wc_test' } }),
    'wc_test',
  );
  assert.equal(
    extractApiKey({ headers: { 'x-api-key': 'wc_header' } }),
    'wc_header',
  );
  assert.equal(extractApiKey({ headers: {} }), undefined);
});

test('health endpoint does not require auth', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'core' });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.service, 'webcite-mcp');
  assert.equal(body.mcpPath, '/mcp');
  assert.ok(body.toolCount >= 1);
  await new Promise((resolve) => server.close(resolve));
});

test('mcp without key returns 401', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'core' });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(res.status, 401);
  // Must not advertise Bearer WWW-Authenticate — Claude OAuth auto-detect
  assert.equal(res.headers.get('www-authenticate'), null);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  assert.match(String(body.claude || ''), /No sign-in/);
  await new Promise((resolve) => server.close(resolve));
});

test('stateless hosted tools recover missing and obsolete IDs and isolate request keys', async () => {
  const seen=[];
  const backend=http.createServer((req,res)=>{
    const key=req.headers['x-api-key'];seen.push(key);
    if(!['account-a','account-b'].includes(key)) {res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({message:'Invalid key'}));return;}
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({credits:{remaining:key==='account-a'?11:22,used:0,total:100}}));
  });
  await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
  const {handler}=createRemoteMcpApp({profile:'public',apiBaseUrl:`http://127.0.0.1:${backend.address().port}`});
  const server=http.createServer((req,res)=>void handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}/mcp`;
  const post=(id,method,params,key='account-a',session)=>fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json',accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params})});
  const payload=async response=>JSON.parse((await response.text()).split('\n').find(line=>line.startsWith('data: ')).slice(6));
  try {
    const init=await post(1,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'stateless-test',version:'1'}});
    assert.equal(init.status,200);assert.equal(init.headers.get('mcp-session-id'),null);assert.ok((await payload(init)).result.capabilities.tools);
    const notification=await post(undefined,'notifications/initialized',{});assert.equal(notification.status,202);
    const listed=await post(2,'tools/list',{},'account-a','obsolete-before-restart');assert.equal(listed.status,200);assert.equal((await payload(listed)).result.tools.length,33);
    for(const [id,key,session,remaining] of [[3,'account-a',undefined,11],[4,'account-b','obsolete-before-restart',22]]) {
      const response=await post(id,'tools/call',{name:'get_credit_balance',arguments:{}},key,session);
      assert.equal(response.status,200);const result=(await payload(response)).result;
      assert.notEqual(result.isError,true,JSON.stringify(result));assert.match(result.content[0].text,new RegExp(String(remaining)));
    }
    assert.deepEqual(seen,['account-a','account-b']);
    const invalid=await post(5,'tools/call',{name:'get_credit_balance',arguments:{}},'invalid-key','obsolete-before-restart');assert.equal((await payload(invalid)).result.isError,true);
    const conflicting=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer account-a','x-api-key':'account-b','content-type':'application/json'},body:'{}'});assert.equal(conflicting.status,400);assert.equal((await conflicting.json()).error,'conflicting_api_keys');
    for(const method of ['GET','DELETE']) {const response=await fetch(endpoint,{method,headers:{authorization:'Bearer account-a',accept:'text/event-stream','mcp-session-id':'obsolete-before-restart'}});assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');}
    const bad=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer account-a'},body:'{'});assert.equal(bad.status,400);assert.equal((await bad.json()).error,'invalid_json');
  } finally {await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>backend.close(resolve));}
});

test('hosted upload advertises bytes and refuses server file paths', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: 'http://127.0.0.1:1' });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const rpc = async (id, method, params, session) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    return { response, body: JSON.parse(data.slice(6)) };
  };
  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const session = init.response.headers.get('mcp-session-id');
    assert.equal(session, null);
    const listed = await rpc(2, 'tools/list', {}, session);
    const upload = listed.body.result.tools.find((tool) => tool.name === 'upload_file');
    assert.deepEqual(upload.inputSchema.required, ['filename', 'file_base64']);
    assert.equal(upload.inputSchema.properties.file_path, undefined);
    assert.match(upload.description, /attachment is not automatically sent/);
    assert.match(upload.description, /Playground or HTTP multipart/);
    assert.match(upload.description, /Do not generate base64 from document text/);
    const rejected = await rpc(3, 'tools/call', { name: 'upload_file', arguments: { file_path: '/etc/passwd' } }, session);
    assert.equal(rejected.body.result.isError, true);
    assert.match(rejected.body.result.content[0].text, /not file_path/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hosted upload accepts explicit raw bytes and returns an asset ID', async () => {
  let uploadedBytes = false;
  const originalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    uploadedBytes = Buffer.concat(chunks).includes(originalPng);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ successCode: 200, data: { asset_id: 'asset-1' } }));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: `http://127.0.0.1:${backend.address().port}` });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const headers = { authorization: 'Bearer account-a', 'content-type': 'application/json',
    accept: 'application/json, text/event-stream' };
  const rpc = async (id, method, params, session) => {
    const response = await fetch(endpoint, { method: 'POST',
      headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await response.text();
    return { response, body: JSON.parse(text.split('\n').find((line) => line.startsWith('data: ')).slice(6)) };
  };
  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'hosted-bytes-test', version: '1' } });
    const session = init.response.headers.get('mcp-session-id');
    const upload = await rpc(2, 'tools/call', { name: 'upload_file', arguments: {
      filename: 'slide.png', file_base64: originalPng.toString('base64'),
    } }, session);
    assert.equal(upload.body.result.structuredContent.asset_id, 'asset-1');
    assert.equal(uploadedBytes, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => backend.close(resolve));
  }
});

test('actual StreamableHTTP client keeps read-only tools working across app restart', async () => {
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  let calls=0;
  const backend=http.createServer((req,res)=>{assert.equal(req.headers['x-api-key'],'account-a');calls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({credits:{remaining:11,used:0,total:100}}));});
  await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
  const options={profile:'public',apiBaseUrl:`http://127.0.0.1:${backend.address().port}`};
  let app=createRemoteMcpApp(options);
  const server=http.createServer((req,res)=>void app.handler(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new Client({name:'actual-stateless-client',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`),{requestInit:{headers:{authorization:'Bearer account-a','mcp-session-id':'legacy-before-deployment'}}}));
    assert.equal((await client.listTools()).tools.length,33);
    assert.notEqual((await client.callTool({name:'get_credit_balance',arguments:{}})).isError,true);
    app=createRemoteMcpApp(options);
    assert.equal((await client.listTools()).tools.length,33);
    assert.notEqual((await client.callTool({name:'get_credit_balance',arguments:{}})).isError,true);
    assert.equal(calls,2);
  } finally {await client.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>backend.close(resolve));}
});
