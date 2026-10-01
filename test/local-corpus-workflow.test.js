const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { handlers } = require('../dist/handlers.js');

const catalogPath = process.env.WEBCITE_LOCAL_CORPUS_CATALOG;
test('local corpus original bytes pass upload without a server filesystem path', { skip: !catalogPath }, async () => {
  const documents = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).documents;
  const selected = new Map();
  for (const row of documents) {
    if (!['.pdf', '.docx', '.xlsx', '.csv'].includes(row.format) || !fs.existsSync(row.path)) continue;
    const size = fs.statSync(row.path).size;
    const bucket = size === 0 ? 'empty' : size > 20_000_000 ? 'oversized' : size > 1_000_000 ? 'large' : 'small';
    const key = row.format + ':' + bucket;
    const list = selected.get(key) ?? [];
    if (list.length < (bucket === 'oversized' ? 1 : 8)) selected.set(key, [...list, row.path]);
  }
  let forwarded = 0, rejected = 0; const evidence = [];
  for (const paths of selected.values()) for (const path of paths) {
    const size = fs.statSync(path).size;
    // Oversized files are represented by their exact encoded length, without loading large personal files.
    const encoded = size > 20_000_000 ? 'A'.repeat(4 * Math.ceil(size / 3)) : fs.readFileSync(path).toString('base64');
    evidence.push({ path, size, encoded_length: encoded.length, format: path.split('.').pop(),
      basis: size > 20_000_000 ? 'synthetic_exact_encoded_length' : 'original_bytes',
      ...(size <= 20_000_000 ? { sha256: createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex') } : {}) });
    const args = { filename: path.split('/').pop(), file_base64: encoded };
    let calls = 0;
    const client = { uploadBytes: async (bytes, filename) => {
      calls++; assert.equal(bytes.length, size); assert.equal(filename, args.filename);
      assert.deepEqual(bytes, fs.readFileSync(path));
      return { asset_id: 'owned-asset', filename, file_size: size };
    } };
    const extension = args.filename.toLowerCase().split('.').pop();
    const bytes = size <= 20_000_000 ? Buffer.from(encoded, 'base64') : null;
    const invalidSignature = bytes && (extension === 'pdf' ? !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
      : ['docx', 'xlsx'].includes(extension) ? !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])) : false);
    if (size === 0 || size > 20_000_000 || invalidSignature) {
      await assert.rejects(() => handlers.upload_file(args, client));
      assert.equal(calls, 0); rejected++;
    } else {
      await handlers.upload_file(args, client); assert.equal(calls, 1); forwarded++;
    }
  }
  assert.ok(forwarded >= 16); assert.ok(rejected >= 2);
  if (process.env.WEBCITE_CORPUS_RECEIPT) fs.writeFileSync(process.env.WEBCITE_CORPUS_RECEIPT, JSON.stringify({ evidence, forwarded, rejected }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ catalog_documents: documents.length, selected: forwarded + rejected, forwarded, rejected }));
});
