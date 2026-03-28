// ============================================================
// seed-diff-test-clean.js — Phase 14a Test Data (Clean)
//
// Creates two FRESH root concept trees with unique names that
// won't collide with any existing data. Also provides a
// --cleanup flag to remove all test data afterward.
//
// SEED:    node src/config/seed-diff-test-clean.js
// CLEANUP: node src/config/seed-diff-test-clean.js --cleanup
// ============================================================

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'concept_hierarchy',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// All concept names used by this script — prefixed with "ZDiff_" to avoid collisions
const TEST_CONCEPTS = [
  // Roots
  'ZDiff_WoodShop', 'ZDiff_MetalShop',
  // Shared child (same name in both)
  'ZDiff_Safety',
  // WoodShop children
  'ZDiff_Cutting', 'ZDiff_Joining', 'ZDiff_Finishing', 'ZDiff_Carving',
  // MetalShop children
  'ZDiff_Welding', 'ZDiff_Grinding', 'ZDiff_Tempering', 'ZDiff_Polishing',
  // Grandchildren of ZDiff_Cutting (WoodShop)
  'ZDiff_Measuring', 'ZDiff_Marking', 'ZDiff_SawSetup', 'ZDiff_DustCollection',
  // Grandchildren of ZDiff_Grinding (MetalShop) — 3 of 4 overlap with Cutting!
  // ZDiff_Measuring, ZDiff_Marking, ZDiff_SawSetup are shared, plus one unique:
  'ZDiff_SparkGuard',
  // Grandchildren of ZDiff_Joining (WoodShop)
  'ZDiff_GluePrep', 'ZDiff_Clamping', 'ZDiff_Alignment',
  // Grandchildren of ZDiff_Welding (MetalShop) — 2 of 3 overlap with Joining
  // ZDiff_Clamping, ZDiff_Alignment are shared, plus one unique:
  'ZDiff_FluxApplication',
];

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get all concept IDs for our test concepts
    const res = await client.query(
      'SELECT id FROM concepts WHERE name = ANY($1::text[])',
      [TEST_CONCEPTS]
    );
    const conceptIds = res.rows.map(r => r.id);

    if (conceptIds.length === 0) {
      console.log('No test data found to clean up.');
      await client.query('COMMIT');
      return;
    }

    // Delete edges where child_id is one of our test concepts
    const edgeRes = await client.query(
      'DELETE FROM edges WHERE child_id = ANY($1::int[]) RETURNING id',
      [conceptIds]
    );
    console.log(`Deleted ${edgeRes.rowCount} edges`);

    // Delete any votes on those edges (cascade should handle this, but just in case)
    // Votes FK to edges with CASCADE, so they should be gone already

    // Delete the concepts themselves
    const conceptRes = await client.query(
      'DELETE FROM concepts WHERE id = ANY($1::int[]) RETURNING id',
      [conceptIds]
    );
    console.log(`Deleted ${conceptRes.rowCount} concepts`);

    await client.query('COMMIT');
    console.log('\n✅ Test data cleaned up successfully!\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if test data already exists
    const existing = await client.query(
      "SELECT COUNT(*) as cnt FROM concepts WHERE name LIKE 'ZDiff_%'"
    );
    if (parseInt(existing.rows[0].cnt) > 0) {
      console.log('⚠️  Test data already exists. Run with --cleanup first to remove it.');
      console.log('   node src/config/seed-diff-test-clean.js --cleanup');
      await client.query('ROLLBACK');
      return;
    }

    // Helper: create concept, return id
    async function createConcept(name) {
      const res = await client.query(
        'INSERT INTO concepts (name) VALUES ($1) RETURNING id',
        [name]
      );
      return res.rows[0].id;
    }

    // Helper: create edge, return id
    async function createEdge(parentId, childId, graphPath, attributeId) {
      const pathStr = `{${graphPath.join(',')}}`;
      const res = await client.query(
        'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [parentId, childId, pathStr, attributeId]
      );
      return res.rows[0].id;
    }

    const ACTION = 1; // attribute_id for "action"

    console.log('Creating test concepts...\n');

    // ─── ROOT CONCEPTS ───────────────────────────────
    const woodShopId = await createConcept('ZDiff_WoodShop');
    const metalShopId = await createConcept('ZDiff_MetalShop');

    // Root edges (parent_id = NULL)
    await createEdge(null, woodShopId, [], ACTION);
    await createEdge(null, metalShopId, [], ACTION);

    // ─── SHARED CHILD ────────────────────────────────
    const safetyId = await createConcept('ZDiff_Safety');

    // ─── WOODSHOP CHILDREN ───────────────────────────
    const cuttingId = await createConcept('ZDiff_Cutting');
    const joiningId = await createConcept('ZDiff_Joining');
    const finishingId = await createConcept('ZDiff_Finishing');
    const carvingId = await createConcept('ZDiff_Carving');

    const wsPath = [woodShopId]; // graph_path for WoodShop's children
    await createEdge(woodShopId, safetyId, wsPath, ACTION);     // SHARED
    await createEdge(woodShopId, cuttingId, wsPath, ACTION);    // will be SIMILAR to Grinding
    await createEdge(woodShopId, joiningId, wsPath, ACTION);    // will be SIMILAR to Welding
    await createEdge(woodShopId, finishingId, wsPath, ACTION);  // UNIQUE
    await createEdge(woodShopId, carvingId, wsPath, ACTION);    // UNIQUE

    // ─── METALSHOP CHILDREN ──────────────────────────
    const weldingId = await createConcept('ZDiff_Welding');
    const grindingId = await createConcept('ZDiff_Grinding');
    const temperingId = await createConcept('ZDiff_Tempering');
    const polishingId = await createConcept('ZDiff_Polishing');

    const msPath = [metalShopId]; // graph_path for MetalShop's children
    await createEdge(metalShopId, safetyId, msPath, ACTION);     // SHARED
    await createEdge(metalShopId, weldingId, msPath, ACTION);    // will be SIMILAR to Joining
    await createEdge(metalShopId, grindingId, msPath, ACTION);   // will be SIMILAR to Cutting
    await createEdge(metalShopId, temperingId, msPath, ACTION);  // UNIQUE
    await createEdge(metalShopId, polishingId, msPath, ACTION);  // UNIQUE

    // ─── GRANDCHILDREN: Make Cutting ≈ Grinding (75% Jaccard) ───
    const measuringId = await createConcept('ZDiff_Measuring');
    const markingId = await createConcept('ZDiff_Marking');
    const sawSetupId = await createConcept('ZDiff_SawSetup');
    const dustCollId = await createConcept('ZDiff_DustCollection');
    const sparkGuardId = await createConcept('ZDiff_SparkGuard');

    // Cutting's grandchildren: Measuring, Marking, SawSetup, DustCollection
    const cutPath = [woodShopId, cuttingId];
    await createEdge(cuttingId, measuringId, cutPath, ACTION);
    await createEdge(cuttingId, markingId, cutPath, ACTION);
    await createEdge(cuttingId, sawSetupId, cutPath, ACTION);
    await createEdge(cuttingId, dustCollId, cutPath, ACTION);

    // Grinding's grandchildren: Measuring, Marking, SawSetup, SparkGuard
    // 3 shared + 1 unique each = 3/5 = 60% Jaccard
    const grindPath = [metalShopId, grindingId];
    await createEdge(grindingId, measuringId, grindPath, ACTION);
    await createEdge(grindingId, markingId, grindPath, ACTION);
    await createEdge(grindingId, sawSetupId, grindPath, ACTION);
    await createEdge(grindingId, sparkGuardId, grindPath, ACTION);

    // ─── GRANDCHILDREN: Make Joining ≈ Welding (67% Jaccard) ───
    const gluePrepId = await createConcept('ZDiff_GluePrep');
    const clampingId = await createConcept('ZDiff_Clamping');
    const alignmentId = await createConcept('ZDiff_Alignment');
    const fluxAppId = await createConcept('ZDiff_FluxApplication');

    // Joining's grandchildren: GluePrep, Clamping, Alignment
    const joinPath = [woodShopId, joiningId];
    await createEdge(joiningId, gluePrepId, joinPath, ACTION);
    await createEdge(joiningId, clampingId, joinPath, ACTION);
    await createEdge(joiningId, alignmentId, joinPath, ACTION);

    // Welding's grandchildren: Clamping, Alignment, FluxApplication
    // 2 shared + 1 unique each = 2/4 = 50% Jaccard
    const weldPath = [metalShopId, weldingId];
    await createEdge(weldingId, clampingId, weldPath, ACTION);
    await createEdge(weldingId, alignmentId, weldPath, ACTION);
    await createEdge(weldingId, fluxAppId, weldPath, ACTION);

    await client.query('COMMIT');

    console.log('✅ Test data seeded successfully!\n');
    console.log('Two new root concepts: "ZDiff_WoodShop" and "ZDiff_MetalShop"\n');
    console.log('─── TEST PLAN ──────────────────────────────────────────────\n');
    console.log('TEST 1: Grandchild-level comparison (Shared + Unique only)');
    console.log('  1. Root page → click ZDiff_WoodShop → click ZDiff_Cutting');
    console.log('     You see 4 children: Measuring, Marking, SawSetup, DustCollection');
    console.log('  2. Go back to ZDiff_WoodShop children view');
    console.log('  3. Right-click "ZDiff_Cutting" → "Compare children…"');
    console.log('  4. + Add concept → search "ZDiff_Grinding" → pick MetalShop context');
    console.log('  5. Expected:');
    console.log('     SHARED: Measuring, Marking, SawSetup');
    console.log('     UNIQUE: DustCollection (Cutting only), SparkGuard (Grinding only)\n');
    console.log('TEST 2: Parent-level comparison (Shared + Similar + Unique)');
    console.log('  1. Root page → right-click "ZDiff_WoodShop" → "Compare children…"');
    console.log('  2. + Add concept → search "ZDiff_MetalShop" → pick (root) context');
    console.log('  3. Expected:');
    console.log('     SHARED: ZDiff_Safety');
    console.log('     SIMILAR: Cutting ≈ Grinding (60%), Joining ≈ Welding (50%)');
    console.log('     UNIQUE: Finishing, Carving (WoodShop) / Tempering, Polishing (MetalShop)\n');
    console.log('TEST 3: Threshold adjustment');
    console.log('  1. Still in the modal from Test 2');
    console.log('  2. Change Similarity to 70% → Similar group empties (60% and 50% < 70%)');
    console.log('  3. Change to 50% → Joining≈Welding reappears but Cutting≈Grinding still gone');
    console.log('  4. Change to 40% → both Similar pairs reappear\n');
    console.log('CLEANUP: node src/config/seed-diff-test-clean.js --cleanup\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

// Entry point
const args = process.argv.slice(2);
if (args.includes('--cleanup')) {
  cleanup();
} else {
  seed();
}
