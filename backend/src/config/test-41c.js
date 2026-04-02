/**
 * Phase 41c: Document External Links — Verification Script
 *
 * Tests the document_external_links table, add/remove/get endpoints,
 * duplicate rejection, permission checks, version chain sharing,
 * and core regression.
 *
 * Usage: node src/config/test-41c.js
 * Requires: backend running on port 5000, test users seeded
 */

const http = require('http');
const pool = require('../config/database');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 5000,
      path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}

async function run() {
  console.log('=== Phase 41c Verification (multi-link) ===\n');

  // 1. Table exists
  console.log('1. Database schema');
  const tblCheck = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name = 'document_external_links'"
  );
  assert('document_external_links table exists', tblCheck.rows.length === 1);

  const colGone = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'external_url'"
  );
  assert('external_url column removed from documents', colGone.rows.length === 0);

  // 2. Login
  console.log('\n2. Auth');
  const aliceLogin = await request('POST', '/api/auth/login', { identifier: 'alice', password: 'testpass123!' });
  assert('Alice login succeeds', aliceLogin.status === 200);
  const aliceToken = aliceLogin.data.token;

  const bobLogin = await request('POST', '/api/auth/login', { identifier: 'bob', password: 'testpass123!' });
  assert('Bob login succeeds', bobLogin.status === 200);
  const bobToken = bobLogin.data.token;

  // Find a doc uploaded by alice
  const aliceDocRow = await pool.query('SELECT id FROM documents WHERE uploaded_by = 1 LIMIT 1');
  if (aliceDocRow.rows.length === 0) {
    console.log('\n  SKIP: No documents uploaded by alice');
    process.exit(1);
  }
  const docId = aliceDocRow.rows[0].id;

  // 3. Add external link
  console.log('\n3. Add external link');
  const addRes = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'https://arxiv.org/abs/2301.12345' }, aliceToken);
  assert('Add link returns 200', addRes.status === 200);
  assert('Response has success: true', addRes.data.success === true);
  assert('Response returns link object', addRes.data.link && addRes.data.link.url === 'https://arxiv.org/abs/2301.12345');
  const linkId1 = addRes.data.link.id;

  // 4. Add second link
  console.log('\n4. Add second link');
  const addRes2 = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'https://doi.org/10.1234/test' }, aliceToken);
  assert('Second link added successfully', addRes2.status === 200);
  const linkId2 = addRes2.data.link.id;

  // 5. Get all links
  console.log('\n5. Get external links');
  const getRes = await request('GET', `/api/documents/${docId}/external-links`);
  assert('GET returns 200', getRes.status === 200);
  assert('Returns 2 links', getRes.data.links && getRes.data.links.length === 2);

  // 6. Duplicate URL rejected
  console.log('\n6. Duplicate URL rejected');
  const dupRes = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'https://arxiv.org/abs/2301.12345' }, aliceToken);
  assert('Duplicate URL returns 409', dupRes.status === 409);

  // 7. Invalid URL rejected
  console.log('\n7. Validation');
  const badRes = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'not-a-url' }, aliceToken);
  assert('Non-http URL rejected with 400', badRes.status === 400);

  const emptyRes = await request('POST', `/api/documents/${docId}/external-links/add`, { url: '' }, aliceToken);
  assert('Empty URL rejected with 400', emptyRes.status === 400);

  // 8. Non-author rejected
  console.log('\n8. Permission check');
  const forbidAdd = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'https://example.com' }, bobToken);
  assert('Non-author add returns 403', forbidAdd.status === 403);

  const forbidRemove = await request('POST', `/api/documents/${docId}/external-links/${linkId1}/remove`, null, bobToken);
  assert('Non-author remove returns 403', forbidRemove.status === 403);

  const noAuth = await request('POST', `/api/documents/${docId}/external-links/add`, { url: 'https://example.com' });
  assert('No token returns 401', noAuth.status === 401);

  // 9. Version chain sharing
  console.log('\n9. Version chain sharing');
  const versionedDoc = await pool.query('SELECT id, source_document_id FROM documents WHERE source_document_id IS NOT NULL LIMIT 1');
  if (versionedDoc.rows.length === 0) {
    console.log('  SKIP: No versioned docs in DB');
  } else {
    const vDoc = versionedDoc.rows[0];
    // Get links via the version (should resolve to root and show same links)
    const linksViaVersion = await request('GET', `/api/documents/${vDoc.id}/external-links`);
    const linksViaSource = await request('GET', `/api/documents/${vDoc.source_document_id}/external-links`);
    assert('Version and source show same links', JSON.stringify(linksViaVersion.data) === JSON.stringify(linksViaSource.data));
  }

  // 10. Remove link
  console.log('\n10. Remove external link');
  const removeRes = await request('POST', `/api/documents/${docId}/external-links/${linkId1}/remove`, null, aliceToken);
  assert('Remove returns 200', removeRes.status === 200);

  const afterRemove = await request('GET', `/api/documents/${docId}/external-links`);
  assert('Only 1 link remains after removal', afterRemove.data.links && afterRemove.data.links.length === 1);

  // Clean up - remove second link
  await request('POST', `/api/documents/${docId}/external-links/${linkId2}/remove`, null, aliceToken);

  // 11. Guest access to links
  console.log('\n11. Guest access');
  const guestGet = await request('GET', `/api/documents/${docId}/external-links`);
  assert('Guest can GET external links (200)', guestGet.status === 200);

  // 12-15. Core regression
  console.log('\n12. Core regression: Concepts');
  const rootRes = await request('GET', '/api/concepts/root');
  assert('GET /concepts/root returns 200', rootRes.status === 200);

  console.log('\n13. Core regression: Corpuses');
  const corpusRes = await request('GET', '/api/corpuses/');
  assert('GET /corpuses/ returns 200', corpusRes.status === 200);

  console.log('\n14. Core regression: Saved');
  const savedRes = await request('GET', '/api/votes/saved', null, aliceToken);
  assert('GET /votes/saved returns 200', savedRes.status === 200);

  console.log('\n15. Core regression: Sidebar');
  const sidebarRes = await request('GET', '/api/votes/sidebar-items', null, aliceToken);
  assert('GET /votes/sidebar-items returns 200', sidebarRes.status === 200);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
