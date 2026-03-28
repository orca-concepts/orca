/**
 * Seed script: Flip View Shared Path Highlighting test data
 * 
 * Creates concepts prefixed with "ZFlip_" so they sort to the bottom
 * and are easy to identify. Places a single "target" concept in
 * multiple parent contexts with overlapping paths so that Flip View
 * shows cards with shared path segments.
 * 
 * Usage:
 *   node seed-flip-test.js            # Insert test data
 *   node seed-flip-test.js --cleanup  # Remove test data
 * 
 * Run from: backend/src/config/
 * (same directory as your other seed scripts)
 */

const pool = require('./database');

const CLEANUP = process.argv.includes('--cleanup');

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find all ZFlip_ concept IDs
    const { rows: concepts } = await client.query(
      `SELECT id FROM concepts WHERE name LIKE 'ZFlip_%'`
    );
    const ids = concepts.map(c => c.id);

    if (ids.length === 0) {
      console.log('No ZFlip_ test data found. Nothing to clean up.');
      await client.query('COMMIT');
      return;
    }

    // Delete edges referencing these concepts (as parent or child)
    const edgeResult = await client.query(
      `DELETE FROM edges WHERE parent_id = ANY($1) OR child_id = ANY($1)`,
      [ids]
    );
    console.log(`Deleted ${edgeResult.rowCount} edges.`);

    // Delete the concepts themselves
    const conceptResult = await client.query(
      `DELETE FROM concepts WHERE id = ANY($1)`,
      [ids]
    );
    console.log(`Deleted ${conceptResult.rowCount} concepts.`);

    await client.query('COMMIT');
    console.log('Cleanup complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Helper: create a concept and return its ID
    async function createConcept(name) {
      const { rows } = await client.query(
        `INSERT INTO concepts (name, created_by) VALUES ($1, 1) RETURNING id`,
        [name]
      );
      return rows[0].id;
    }

    // Helper: create an edge and return its ID
    async function createEdge(parentId, childId, graphPath, attributeId) {
      const { rows } = await client.query(
        `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by)
         VALUES ($1, $2, $3, $4, 1) RETURNING id`,
        [parentId, childId, graphPath, attributeId]
      );
      return rows[0].id;
    }

    // Attribute IDs: 1=action, 2=tool, 3=value

    // =========================================================
    // Create new concepts (all prefixed ZFlip_)
    // =========================================================

    // Shared path building blocks
    const research    = await createConcept('ZFlip_Research');
    const methods     = await createConcept('ZFlip_Methods');
    const analysis    = await createConcept('ZFlip_Analysis');
    const fieldwork   = await createConcept('ZFlip_Fieldwork');
    const labwork     = await createConcept('ZFlip_Lab Work');
    const writing2    = await createConcept('ZFlip_Writing');
    const peerReview  = await createConcept('ZFlip_Peer Review');

    // Branch-specific concepts
    const biology     = await createConcept('ZFlip_Biology');
    const chemistry   = await createConcept('ZFlip_Chemistry');
    const physics     = await createConcept('ZFlip_Physics');
    const social      = await createConcept('ZFlip_Social Science');

    // The TARGET concept — this is what we'll view in Flip View
    const target      = await createConcept('ZFlip_Target');

    // Leaf children of target (so Jaccard similarity has something to work with)
    const leafA       = await createConcept('ZFlip_Observation');
    const leafB       = await createConcept('ZFlip_Measurement');
    const leafC       = await createConcept('ZFlip_Interview');
    const leafD       = await createConcept('ZFlip_Survey');

    console.log(`Created concepts. Target concept ID: ${target}`);

    // =========================================================
    // Build tree structures with overlapping paths
    // =========================================================

    // --- Root edges for top-level concepts ---
    await createEdge(null, research, '{}', 1);
    await createEdge(null, biology, '{}', 1);
    await createEdge(null, chemistry, '{}', 1);
    await createEdge(null, physics, '{}', 1);
    await createEdge(null, social, '{}', 1);

    // --- PATH A: Research → Methods → Analysis → Target ---
    // Path shares "Research → Methods" with Path B
    // Path shares "Research → Methods → Analysis" with Path C
    await createEdge(research, methods, `{${research}}`, 1);
    const methodsInResearch = methods; // concept ID stays the same
    await createEdge(methods, analysis, `{${research},${methods}}`, 1);
    await createEdge(analysis, target, `{${research},${methods},${analysis}}`, 1);

    // --- PATH B: Research → Methods → Fieldwork → Target ---
    // Shares "Research → Methods" with Path A
    await createEdge(methods, fieldwork, `{${research},${methods}}`, 1);
    await createEdge(fieldwork, target, `{${research},${methods},${fieldwork}}`, 1);

    // --- PATH C: Biology → Research → Methods → Analysis → Target ---
    // Shares "Research → Methods → Analysis" with Path A (3-segment shared!)
    // Shares "Research → Methods" with Path B
    await createEdge(biology, research, `{${biology}}`, 1);
    await createEdge(research, methods, `{${biology},${research}}`, 1);
    await createEdge(methods, analysis, `{${biology},${research},${methods}}`, 1);
    await createEdge(analysis, target, `{${biology},${research},${methods},${analysis}}`, 1);

    // --- PATH D: Chemistry → Lab Work → Analysis → Target ---
    // Shares only "Analysis" with Paths A and C (single-concept match)
    await createEdge(chemistry, labwork, `{${chemistry}}`, 1);
    await createEdge(labwork, analysis, `{${chemistry},${labwork}}`, 1);
    await createEdge(analysis, target, `{${chemistry},${labwork},${analysis}}`, 1);

    // --- PATH E: Social Science → Research → Fieldwork → Target ---
    // Shares "Research" with Paths A, B, C (single concept)
    // Shares "Research → Fieldwork" — wait, Fieldwork is under Methods in B
    // So this is a different structure: Research → Fieldwork directly
    await createEdge(social, research, `{${social}}`, 1);
    await createEdge(research, fieldwork, `{${social},${research}}`, 1);
    await createEdge(fieldwork, target, `{${social},${research},${fieldwork}}`, 1);

    // --- PATH F: Physics → Methods → Target ---
    // Shares only "Methods" with Paths A, B, C (single concept in different position)
    await createEdge(physics, methods, `{${physics}}`, 1);
    await createEdge(methods, target, `{${physics},${methods}}`, 2);  // tool attribute

    // --- PATH G: Research → Writing → Peer Review → Target ---
    // Shares only "Research" with Paths A, B, C, E
    // No overlap with D or F beyond that
    await createEdge(research, writing2, `{${research}}`, 1);
    await createEdge(writing2, peerReview, `{${research},${writing2}}`, 1);
    await createEdge(peerReview, target, `{${research},${writing2},${peerReview}}`, 1);

    // =========================================================
    // Add some children to Target in different contexts
    // (so Jaccard similarity % shows up on Flip View cards)
    // =========================================================

    // Path A context: Observation + Measurement
    const pathA = `{${research},${methods},${analysis},${target}}`;
    await createEdge(target, leafA, pathA, 1);
    await createEdge(target, leafB, pathA, 2);

    // Path B context: Observation + Interview
    const pathB = `{${research},${methods},${fieldwork},${target}}`;
    await createEdge(target, leafA, pathB, 1);
    await createEdge(target, leafC, pathB, 1);

    // Path D context: Measurement + Survey
    const pathD = `{${chemistry},${labwork},${analysis},${target}}`;
    await createEdge(target, leafB, pathD, 2);
    await createEdge(target, leafD, pathD, 1);

    // Path E context: Interview + Survey
    const pathE = `{${social},${research},${fieldwork},${target}}`;
    await createEdge(target, leafC, pathE, 1);
    await createEdge(target, leafD, pathE, 1);

    await client.query('COMMIT');

    console.log('\n=== Seed complete! ===\n');
    console.log(`Target concept ID: ${target}`);
    console.log(`\nTo test Flip View path highlighting:`);
    console.log(`1. Log in as any test user`);
    console.log(`2. Search for "ZFlip_Target" in the search field`);
    console.log(`3. Click the search result to open decontextualized Flip View`);
    console.log(`4. You should see 7 parent context cards`);
    console.log(`\nExpected hover behavior:`);
    console.log(`- Hover "ZFlip_Research" on Card A → highlights "ZFlip_Research" on Cards B, C, E, G`);
    console.log(`- Hover "ZFlip_Methods" on Card A → highlights "ZFlip_Research → ZFlip_Methods" on Card A AND Card B (shared 2-segment)`);
    console.log(`  Also highlights "ZFlip_Research → ZFlip_Methods" on Card C (same 2-segment shared)`);
    console.log(`  Also highlights just "ZFlip_Methods" on Card F (only single concept match)`);
    console.log(`- Hover "ZFlip_Analysis" on Card A → highlights "ZFlip_Research → ZFlip_Methods → ZFlip_Analysis" on Card C (3-segment shared!)`);
    console.log(`  Also highlights just "ZFlip_Analysis" on Card D (single concept, different path around it)`);
    console.log(`- Hover "ZFlip_Fieldwork" on Card B → highlights "ZFlip_Research → ZFlip_Fieldwork" on Card E`);
    console.log(`  But NOT the full "Research → Methods → Fieldwork" because Card E doesn't have Methods`);
    console.log(`\nCleanup: node seed-flip-test.js --cleanup`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    pool.end();
  }
}

if (CLEANUP) {
  cleanup();
} else {
  seed();
}
