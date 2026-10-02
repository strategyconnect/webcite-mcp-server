import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRetrievalScope, formatVerifyResult } from '../dist/formatters.js';
test('reports bounded retrieval without claiming data does not exist', () => {
 const metadata={retrieval_attempts:[{retrieval_status:'supplied_sources_unresolved',search_scope:'supplied_sources',evidence_limitation:'PDF passage not read'}]};
 assert.match(formatVerifyResult('Premium figure', {metadata}), /Supplied sources: supplied sources unresolved.*PDF passage not read/);
 assert.equal(formatRetrievalScope({retrieval_attempts:[{retrieval_status:'verified',search_scope:'supplied_sources'}]}),'');
 assert.equal(formatRetrievalScope(null),'');
});
