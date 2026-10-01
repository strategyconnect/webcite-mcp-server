const test=require('node:test');const assert=require('node:assert/strict');
const {WebCiteApiClient}=require('../dist/api-client.js');const {handlers}=require('../dist/handlers.js');
const {SERVER_INSTRUCTIONS}=require('../dist/profiles.js');
const {creditUsage}=require('../dist/credit-usage.js');const {renderWebciteGuide}=require('../dist/guide.js');
const receipt={credits_used:0,credits_remaining:174,monthly_allocation:600,overage_enabled:false,operation_id:null};
test('native client retains inline request headers without a hidden balance request',async()=>{
 const original=global.fetch;const calls=[];global.fetch=async(url)=>{calls.push(url);return new Response(JSON.stringify({format:'txt',markdown:'Exact content',units:[]}),{headers:{'Content-Type':'application/json','X-Credits-Used':'1','X-Credits-Remaining':'173','X-Credits-Monthly-Allocation':'600','X-Credits-Overage-Enabled':'false'}})};
 try{const result=await new WebCiteApiClient('test','http://localhost').extractDocument({asset_id:'owned'});assert.deepEqual(result.credit_usage,{...receipt,credits_used:1,credits_remaining:173});assert.equal(calls.length,1);assert.match(calls[0],/\/extract$/)}finally{global.fetch=original}
});
test('unknown queued request cost remains null and canonical native receipt wins over headers',async()=>{
 const original=global.fetch;let body={job_id:'a'.repeat(64),status:'queued'};global.fetch=async()=>new Response(JSON.stringify(body),{headers:{'X-Credits-Remaining':'174','X-Credits-Used':'999'}});
 try{const client=new WebCiteApiClient('test','http://localhost');body.credit_usage={...receipt,credits_used:null};assert.deepEqual((await client.startDocumentReviewJob({prompt:'review',thread_id:'t',asset_ids:['a']},'k')).credit_usage,body.credit_usage);delete body.credit_usage;global.fetch=async()=>new Response(JSON.stringify(body),{headers:{'X-Credits-Remaining':'174'}});assert.equal((await client.startDocumentReviewJob({prompt:'review',thread_id:'t',asset_ids:['a']},'k')).credit_usage.credits_used,null)}finally{global.fetch=original}
});
test('paid and free handlers expose request receipts in text and structured output',async()=>{
 const verify={citations:[],credit_usage:{...receipt,credits_used:2,operation_id:'actual-operation'}};
 const result=await handlers.verify_claim({claim:'A material assertion'},{verifyClaim:async()=>verify});assert.deepEqual(result.structuredContent.credit_usage,verify.credit_usage);assert.match(result.text,/Request credits used: 2; remaining: 174/);
 const job=await handlers.get_document_review_job({job_id:'a'.repeat(64)},{getDocumentReviewJob:async()=>({job_id:'a'.repeat(64),status:'running',credit_usage:receipt})});assert.deepEqual(job.structuredContent.credit_usage,receipt);assert.match(job.text,/Request credits used: 0/);
});
test('missing receipts are not inferred zero and malformed native receipts fail closed',async()=>{
 const missing=await handlers.verify_claim({claim:'A material assertion'},{verifyClaim:async()=>({citations:[]})});assert.equal(missing.structuredContent.credit_usage,undefined);assert.doesNotMatch(missing.text,/Request credits used/);
 for(const usage of [{...receipt,credits_used:-1},{...receipt,credits_remaining:'174'},{...receipt,overage_enabled:'false'}])assert.throws(()=>creditUsage({credit_usage:usage}),/credit receipt/);
});
test('document workflow does not mandate balance or paid extraction preflights',()=>{
 assert.doesNotMatch(SERVER_INSTRUCTIONS,/review_document after extract_document/);assert.match(SERVER_INSTRUCTIONS,/no mandatory balance or extraction preflight/);
 const guide=renderWebciteGuide({workflow:'document_review'});assert.doesNotMatch(guide,/Call `get_credit_balance`/);assert.match(guide,/No balance preflight is required/);assert.match(guide,/proceed directly to review_document/);assert.match(guide,/Do not pay for extract_document merely as a review prerequisite/);assert.match(guide,/coverage_complete or source_read_complete is missing or false/);
});

test('compact pages retain independent request receipt and review ledger usage within byte budget',async()=>{
 const totals={basis:'operation_ledger',settled_credits:12,reserved_credits:0,released_operations:1,reconciliation_operations:0,current_attempt:null};
 const row={id:'one',claim:'A material assertion',result:'unverified',summary:'Reason'.repeat(3000),citations:[{url:'https://example.org/exact-long-path',snippet:'Evidence '.repeat(3000)}]};
 const result=await handlers.get_document_review({review_id:'a'.repeat(64),limit:1},{getDocumentReview:async()=>({review_id:'a'.repeat(64),status:'complete',prompt:'Review',thread_id:'t',asset_ids:['asset'],total_claims:1,completed_claims:1,pending_claims:0,claims:[row],credit_usage:receipt,review_usage:totals})});
 assert.deepEqual(result.structuredContent.credit_usage,receipt);assert.deepEqual(result.structuredContent.review_usage,totals);assert.match(result.text,/Request credits used: 0/);assert.match(result.text,/accumulated review totals/);assert.ok(Buffer.byteLength(JSON.stringify(result))<=20000);assert.equal(result.structuredContent.claims[0].citation_urls[0],row.citations[0].url);
});

test('failure request receipts preserve native HTTP error and survive actual MCP output',async()=>{
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');const {createMcpServer}=require('../dist/index.js');
 const original=global.fetch;global.fetch=async()=>new Response(JSON.stringify({message:'Provider unavailable',credit_usage:receipt}),{status:503});const backend=new WebCiteApiClient('test','http://localhost');const server=createMcpServer(backend,'public',true),client=new Client({name:'receipt-error-proof',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
 try{const result=await client.callTool({name:'verify_claim',arguments:{claim:'Material assertion'}});assert.equal(result.isError,true);assert.equal(result.structuredContent.details.status,503);assert.deepEqual(result.structuredContent.credit_usage,receipt);assert.match(result.content[0].text,/Request credits used: 0/)}finally{global.fetch=original;await client.close();await server.close()}
});
test('native usage events survive stream normalization without replacing legacy usage',async()=>{
 const result=await handlers.verify_claim_stream({claim:'Material assertion'},{verifyClaimStream:async function*(){yield {event:'message',data:{type:'result',data:{citations:[]}}};yield {event:'message',data:{type:'usage',credit_usage:receipt,usage:{credits:0},operation_id:'stream-operation'}};yield {event:'message',data:{type:'done'}};}});
 assert.deepEqual(result.structuredContent.credit_usage,receipt);assert.deepEqual(result.structuredContent.stream_usage.usage,{credits:0});assert.match(result.text,/Request credits used: 0/);
});
test('batch header receipt is promoted without modifying individual item records',async()=>{
 const items=[{quote:'Exact quote',source:'https://example.org'}];const rows=[{quote:'Exact quote',binding:{grounded:true},verification:{grounded:true}}];const original=global.fetch;global.fetch=async()=>new Response(JSON.stringify(rows),{headers:{'X-Credits-Used':'2','X-Credits-Remaining':'172'}});
 try{const result=await handlers.verify_batch({items},new WebCiteApiClient('test','http://localhost'));assert.equal(result.structuredContent.credit_usage.credits_used,2);assert.deepEqual(result.structuredContent.results[0],rows[0]);assert.match(result.text,/Request credits used: 2/)}finally{global.fetch=original}
});
