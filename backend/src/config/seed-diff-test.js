// ============================================================
// seed-diff-test.js — Phase 14a Test Data
//
// Creates two parallel concept hierarchies under root concepts
// "Cooking" and "Baking" that share some children, have similar
// children (same grandchildren), and have unique children.
//
// Run from the backend directory:
//   node src/config/seed-diff-test.js
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

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Helper: create concept if not exists, return id ---
    async function getOrCreateConcept(name) {
      let res = await client.query('SELECT id FROM concepts WHERE name = $1', [name]);
      if (res.rows.length > 0) return res.rows[0].id;
      res = await client.query('INSERT INTO concepts (name) VALUES ($1) RETURNING id', [name]);
      return res.rows[0].id;
    }

    // --- Helper: create edge if not exists, return id ---
    async function getOrCreateEdge(parentId, childId, graphPath, attributeId) {
      const pathStr = `{${graphPath.join(',')}}`;
      let res = await client.query(
        `SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 AND attribute_id = $4`,
        [parentId, childId, pathStr, attributeId]
      );
      if (res.rows.length > 0) return res.rows[0].id;
      // Use parentId IS NULL check for root edges
      if (parentId === null) {
        res = await client.query(
          `SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = $2 AND attribute_id = $3`,
          [childId, pathStr, attributeId]
        );
        if (res.rows.length > 0) return res.rows[0].id;
        res = await client.query(
          `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id) VALUES (NULL, $1, $2, $3) RETURNING id`,
          [childId, pathStr, attributeId]
        );
      } else {
        res = await client.query(
          `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [parentId, childId, pathStr, attributeId]
        );
      }
      return res.rows[0].id;
    }

    // Attribute IDs (seeded by migration)
    const ACTION = 1;  // action
    const TOOL = 2;    // tool
    const VALUE = 3;   // value

    console.log('Creating concepts...');

    // ─── ROOT CONCEPTS ───────────────────────────────
    const cookingId = await getOrCreateConcept('Cooking');
    const bakingId = await getOrCreateConcept('Baking');

    // Root edges (parent_id = NULL, graph_path = {})
    await getOrCreateEdge(null, cookingId, [], ACTION);
    await getOrCreateEdge(null, bakingId, [], ACTION);

    // ─── CHILDREN OF COOKING (under path []) ─────────
    // These will be the children we compare in the diff modal
    const prepId = await getOrCreateConcept('Preparation');
    const heatingId = await getOrCreateConcept('Heating');
    const seasoningId = await getOrCreateConcept('Seasoning');
    const platingId = await getOrCreateConcept('Plating');
    const sauteId = await getOrCreateConcept('Sauteing');

    // Cooking's children — path is [cookingId] because parent is cooking which is at path []
    const cookPath = [cookingId];
    await getOrCreateEdge(cookingId, prepId, cookPath, ACTION);       // Preparation [action]
    await getOrCreateEdge(cookingId, heatingId, cookPath, ACTION);    // Heating [action]
    await getOrCreateEdge(cookingId, seasoningId, cookPath, ACTION);  // Seasoning [action] — SHARED with Baking
    await getOrCreateEdge(cookingId, platingId, cookPath, ACTION);    // Plating [action] — UNIQUE to Cooking
    await getOrCreateEdge(cookingId, sauteId, cookPath, ACTION);      // Sauteing [action] — UNIQUE to Cooking

    // ─── CHILDREN OF BAKING (under path []) ──────────
    const mixingId = await getOrCreateConcept('Mixing');
    const ovenWorkId = await getOrCreateConcept('Oven Work');
    // Seasoning already created above — will be SHARED
    const decoratingId = await getOrCreateConcept('Decorating');
    const proofingId = await getOrCreateConcept('Proofing');

    const bakePath = [bakingId];
    await getOrCreateEdge(bakingId, mixingId, bakePath, ACTION);       // Mixing [action]
    await getOrCreateEdge(bakingId, ovenWorkId, bakePath, ACTION);     // Oven Work [action]
    await getOrCreateEdge(bakingId, seasoningId, bakePath, ACTION);    // Seasoning [action] — SHARED with Cooking
    await getOrCreateEdge(bakingId, decoratingId, bakePath, ACTION);   // Decorating [action] — UNIQUE to Baking
    await getOrCreateEdge(bakingId, proofingId, bakePath, ACTION);     // Proofing [action] — UNIQUE to Baking

    // ─── GRANDCHILDREN — to make "Preparation" and "Mixing" SIMILAR ───
    // They share the same grandchildren so Jaccard will be high
    const chopId = await getOrCreateConcept('Chopping');
    const measureId = await getOrCreateConcept('Measuring');
    const washId = await getOrCreateConcept('Washing');
    const gatheringId = await getOrCreateConcept('Gathering Ingredients');

    // Grandchildren of Preparation (under Cooking → Preparation)
    const prepPath = [cookingId, prepId];
    await getOrCreateEdge(prepId, chopId, prepPath, ACTION);
    await getOrCreateEdge(prepId, measureId, prepPath, ACTION);
    await getOrCreateEdge(prepId, washId, prepPath, ACTION);
    await getOrCreateEdge(prepId, gatheringId, prepPath, ACTION);

    // Grandchildren of Mixing (under Baking → Mixing) — 3 of 4 overlap!
    const mixPath = [bakingId, mixingId];
    await getOrCreateEdge(mixingId, measureId, mixPath, ACTION);      // shared with Prep
    await getOrCreateEdge(mixingId, washId, mixPath, ACTION);         // shared with Prep
    await getOrCreateEdge(mixingId, gatheringId, mixPath, ACTION);    // shared with Prep
    const siftId = await getOrCreateConcept('Sifting');
    await getOrCreateEdge(mixingId, siftId, mixPath, ACTION);         // unique to Mixing

    // ─── GRANDCHILDREN — to make "Heating" and "Oven Work" SIMILAR ───
    const preheatId = await getOrCreateConcept('Preheating');
    const tempCheckId = await getOrCreateConcept('Temperature Check');
    const timerSetId = await getOrCreateConcept('Setting Timer');

    // Grandchildren of Heating (under Cooking → Heating)
    const heatPath = [cookingId, heatingId];
    await getOrCreateEdge(heatingId, preheatId, heatPath, ACTION);
    await getOrCreateEdge(heatingId, tempCheckId, heatPath, ACTION);
    await getOrCreateEdge(heatingId, timerSetId, heatPath, ACTION);
    const stirId = await getOrCreateConcept('Stirring');
    await getOrCreateEdge(heatingId, stirId, heatPath, ACTION);       // unique to Heating

    // Grandchildren of Oven Work (under Baking → Oven Work) — 3 of 4 overlap!
    const ovenPath = [bakingId, ovenWorkId];
    await getOrCreateEdge(ovenWorkId, preheatId, ovenPath, ACTION);    // shared with Heating
    await getOrCreateEdge(ovenWorkId, tempCheckId, ovenPath, ACTION);  // shared with Heating
    await getOrCreateEdge(ovenWorkId, timerSetId, ovenPath, ACTION);   // shared with Heating
    const rackPosId = await getOrCreateConcept('Rack Positioning');
    await getOrCreateEdge(ovenWorkId, rackPosId, ovenPath, ACTION);    // unique to Oven Work

    await client.query('COMMIT');

    console.log('');
    console.log('✅ Diff test data seeded successfully!');
    console.log('');
    console.log('Two root concepts created: "Cooking" and "Baking"');
    console.log('');
    console.log('Expected diff results when comparing Cooking vs Baking:');
    console.log('');
    console.log('  SHARED (same name + attribute in both):');
    console.log('    • Seasoning [action]');
    console.log('');
    console.log('  SIMILAR (different name, overlapping grandchildren):');
    console.log('    • Cooking: Preparation ≈ Baking: Mixing (75% Jaccard)');
    console.log('    • Cooking: Heating ≈ Baking: Oven Work (75% Jaccard)');
    console.log('');
    console.log('  UNIQUE (only in one pane):');
    console.log('    • Cooking: Plating, Sauteing');
    console.log('    • Baking: Decorating, Proofing');
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
