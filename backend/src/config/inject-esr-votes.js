// ============================================================
// inject-esr-votes.js — Inject demo votes for Effect Size Reporting children
//
// Creates 4 vote sets to demonstrate the color palette:
//   Indigo  (alice, bob)   — all 4 children
//   Teal    (carol, dave)  — C, S, T (skip Pre-registration)
//   Crimson (frank)        — S, T + swap Pre-registration → Standardization
//   Goldenrod (eve)        — P, T
//
// RUN: node backend/src/config/inject-esr-votes.js
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'concept_hierarchy',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Look up users ──────────────────────────────────
    const userNames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
    const users = {};
    const savedTabs = {};
    for (const name of userNames) {
      const res = await client.query('SELECT id FROM users WHERE username = $1', [name]);
      if (res.rows.length === 0) throw new Error(`User "${name}" not found`);
      users[name] = res.rows[0].id;

      // Get their default saved tab
      const tabRes = await client.query(
        'SELECT id FROM saved_tabs WHERE user_id = $1 ORDER BY display_order LIMIT 1',
        [users[name]]
      );
      if (tabRes.rows.length > 0) savedTabs[name] = tabRes.rows[0].id;
    }
    console.log('Users:', users);

    // ── Find "Effect Size Reporting" concept and its parent edge ──
    const esrConcept = await client.query(
      "SELECT id FROM concepts WHERE name = 'Effect Size Reporting'"
    );
    if (esrConcept.rows.length === 0) throw new Error('Concept "Effect Size Reporting" not found');
    const esrConceptId = esrConcept.rows[0].id;

    // Find the edge for Effect Size Reporting (child of Statistical Rigor)
    const esrEdge = await client.query(
      'SELECT id, graph_path FROM edges WHERE child_id = $1 AND is_hidden = false',
      [esrConceptId]
    );
    if (esrEdge.rows.length === 0) throw new Error('Edge for "Effect Size Reporting" not found');
    const esrEdgeId = esrEdge.rows[0].id;
    const esrGraphPath = esrEdge.rows[0].graph_path; // path from root to parent (Statistical Rigor)
    console.log(`Effect Size Reporting edge: id=${esrEdgeId}, graph_path=${JSON.stringify(esrGraphPath)}`);

    // ── Find ancestor edges (for path voting) ──────────
    // graph_path for ESR children = esrGraphPath + [esrConceptId]
    // We need to vote on all ancestors too: root edge, level-1 edge, level-2 edge (ESR itself)

    // Find all ancestor edges by walking the graph_path
    const ancestorEdges = [];

    // Root edge: parent_id IS NULL, child_id = first element of esrGraphPath
    if (esrGraphPath.length > 0) {
      const rootRes = await client.query(
        'SELECT id FROM edges WHERE child_id = $1 AND parent_id IS NULL AND is_hidden = false',
        [esrGraphPath[0]]
      );
      if (rootRes.rows.length > 0) ancestorEdges.push(rootRes.rows[0].id);
    }

    // Intermediate edges along the path
    for (let i = 1; i < esrGraphPath.length; i++) {
      const childId = esrGraphPath[i];
      const parentPath = esrGraphPath.slice(0, i);
      const pathStr = `{${parentPath.join(',')}}`;
      const edgeRes = await client.query(
        'SELECT id FROM edges WHERE child_id = $1 AND graph_path = $2 AND is_hidden = false',
        [childId, pathStr]
      );
      if (edgeRes.rows.length > 0) ancestorEdges.push(edgeRes.rows[0].id);
    }

    // ESR edge itself is also an ancestor for its children
    ancestorEdges.push(esrEdgeId);
    console.log('Ancestor edges (root to ESR):', ancestorEdges);

    // ── Find the 4 children edges ──────────────────────
    const childNames = ['Contextualization', 'Pre-registration', 'Standardization', 'Transparency'];
    const childEdges = {};

    // Children of ESR have graph_path = esrGraphPath + [esrConceptId]
    const childGraphPath = [...esrGraphPath, esrConceptId];
    const childPathStr = `{${childGraphPath.join(',')}}`;

    for (const name of childNames) {
      const conceptRes = await client.query('SELECT id FROM concepts WHERE name = $1', [name]);
      if (conceptRes.rows.length === 0) throw new Error(`Concept "${name}" not found`);
      const conceptId = conceptRes.rows[0].id;

      const edgeRes = await client.query(
        'SELECT id FROM edges WHERE child_id = $1 AND graph_path = $2 AND is_hidden = false',
        [conceptId, childPathStr]
      );
      if (edgeRes.rows.length === 0) throw new Error(`Edge for "${name}" under ESR not found`);
      childEdges[name] = edgeRes.rows[0].id;
    }
    console.log('Child edges:', childEdges);

    // ── Vote pattern ───────────────────────────────────
    const votePattern = {
      alice: ['Contextualization', 'Pre-registration', 'Standardization', 'Transparency'],
      bob:   ['Contextualization', 'Pre-registration', 'Standardization', 'Transparency'],
      carol: ['Contextualization', 'Standardization', 'Transparency'],
      dave:  ['Contextualization', 'Standardization', 'Transparency'],
      eve:   ['Pre-registration', 'Transparency'],
      frank: ['Standardization', 'Transparency'],
    };

    // ── Insert votes ───────────────────────────────────
    let voteCount = 0;

    for (const [userName, children] of Object.entries(votePattern)) {
      const userId = users[userName];
      const tabId = savedTabs[userName];

      // Vote on ancestor edges first (path voting)
      for (const ancestorEdgeId of ancestorEdges) {
        const res = await client.query(
          'INSERT INTO votes (user_id, edge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
          [userId, ancestorEdgeId]
        );
        if (res.rows.length > 0) {
          voteCount++;
          if (tabId) {
            await client.query(
              'INSERT INTO vote_tab_links (vote_id, saved_tab_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [res.rows[0].id, tabId]
            );
          }
        }
      }

      // Vote on each child edge
      for (const childName of children) {
        const edgeId = childEdges[childName];
        const res = await client.query(
          'INSERT INTO votes (user_id, edge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
          [userId, edgeId]
        );
        if (res.rows.length > 0) {
          voteCount++;
          if (tabId) {
            await client.query(
              'INSERT INTO vote_tab_links (vote_id, saved_tab_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [res.rows[0].id, tabId]
            );
          }
          // Record vote_set_change
          await client.query(
            `INSERT INTO vote_set_changes (user_id, parent_edge_id, child_edge_id, action) VALUES ($1, $2, $3, 'save')`,
            [userId, esrEdgeId, edgeId]
          );
        }
      }

      console.log(`  ${userName}: voted on ${children.length} children + ${ancestorEdges.length} ancestors`);
    }

    console.log(`\nInserted ${voteCount} votes total`);

    // ── Swap vote: frank swaps Pre-registration → Standardization ──
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.frank, childEdges['Pre-registration'], childEdges['Standardization']]
    );
    console.log('Inserted swap vote: frank swaps Pre-registration → Standardization');

    await client.query('COMMIT');
    console.log('\nDone! Navigate to Effect Size Reporting to see the vote set colors.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
