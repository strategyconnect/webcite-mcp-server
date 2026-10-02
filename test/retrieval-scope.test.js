const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatRetrievalScope, formatVerifyResult } = require('../dist/formatters.js');
const { handlers } = require('../dist/handlers.js');
test('reports bounded retrieval without claiming data does not exist', () => {
 const metadata={retrieval_attempts:[{retrieval_status:'supplied_sources_unresolved',search_scope:'supplied_sources',evidence_limitation:'PDF passage not read'}]};
 assert.match(formatVerifyResult('Premium figure', {metadata}), /Supplied sources: supplied sources unresolved.*PDF passage not read/);
 assert.equal(formatRetrievalScope({retrieval_attempts:[{retrieval_status:'verified',search_scope:'supplied_sources'}]}),'');
 assert.equal(formatRetrievalScope(null),'');
});

test('verification and source-search handlers preserve retrieval scope and structured evidence', async () => {
 const metadata = {retrieval_attempts: [
  {retrieval_status:'supplied_sources_unresolved', search_scope:'supplied_sources', evidence_limitation:'PDF passage not read'},
  {retrieval_status:'insufficient_evidence', search_scope:'bounded_web_search', evidence_limitation:'Search was bounded'},
 ]};
 const result = {citations:[], metadata};
 const client = {
  verifyClaim: async () => result,
  searchSources: async () => result,
  verifyClaimStream: async function* () {
   yield {event:'message', data:{type:'result', data:result}};
   yield {event:'message', data:{type:'done'}};
  },
 };
 for (const name of ['verify_claim', 'verify_claim_stream', 'search_sources']) {
  const output = await handlers[name]({claim:'Premium figure', query:'Premium figure'}, client);
  assert.deepEqual(output.structuredContent.metadata, metadata);
  assert.match(output.text, /Supplied sources: supplied sources unresolved.*PDF passage not read/);
  assert.match(output.text, /Bounded web search: insufficient evidence.*Search was bounded/);
  if (name === 'search_sources') assert.match(output.text, /does not establish that the data does not exist/);
 }
 assert.equal(formatRetrievalScope({retrieval_attempts:[null, {retrieval_status:1, search_scope:'supplied_sources'}]}), '');
 assert.match(formatRetrievalScope({retrieval_attempts:[{retrieval_status:'sources_retained', search_scope:'bounded_web_search'}]}), /Bounded web search: sources retained/);
});
