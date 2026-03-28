// ============================================================
// seed-test-scenarios.js — Test data for 5 UI scenarios
//
// Scenario 1: Concept Diffing (Shared / Similar / Unique)
// Scenario 2: Flip View with 5+ alt parents, varied link votes + Jaccard
// Scenarios 3-5: Vote Set Swatches (13 patterns, tiered view, similarity ordering)
//
// SEED:    node backend/src/config/seed-test-scenarios.js
// CLEANUP: node backend/src/config/seed-test-scenarios.js --cleanup
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'concept_hierarchy',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Extra users created ONLY by this script (for cleanup).
const SCRIPT_USERS = ['grace', 'heidi', 'ivan', 'judy', 'karl', 'liam', 'mallory'];

// Concepts created ONLY by this script (for cleanup).
// Does NOT include existing concepts we attach to (Statistical Rigor, etc.)
const SCRIPT_CONCEPTS = [
  // Scenario 1
  'Research Design', 'Experimental Design', 'Observational Design',
  'Sample Size Planning', 'Bias Mitigation', 'Variable Control',
  'Randomization Methods', 'Block Randomization', 'Stratified Allocation', 'Adaptive Randomization',
  'Outcome Measurement', 'Primary Endpoints', 'Surrogate Markers', 'Composite Outcomes',
  'Blinding Procedures', 'Placebo Design',
  'Sampling Strategies', 'Cluster Sampling',
  'Endpoint Selection', 'Secondary Endpoints',
  'Cohort Selection', 'Case Matching',
  // Scenario 2
  'Confidence Intervals',
  'Inferential Statistics', 'Hypothesis Testing', 'P-Value Interpretation', 'Significance Thresholds',
  'Research Synthesis', 'Forest Plots', 'Heterogeneity Assessment', 'Publication Bias Detection',
  'Study Reporting Standards', 'Effect Transparency', 'Sample Description', 'Limitation Disclosure',
  // Scenario 2b — children of CI across contexts (Flip View Jaccard)
  'Coverage Probability', 'Bayesian Credible Intervals', 'Bootstrap Confidence Intervals',
  'Confidence Level Selection', 'Sample Size Requirements', 'Margin of Error',
  'Interval Width Interpretation', 'Confidence Bands for Regression',
  'Asymptotic Normality Assumptions', 'Multiple Comparisons Adjustment',
  'Profile Likelihood Intervals', 'Exact vs Approximate Intervals',
  'Jeffreys Interval', 'Nonparametric Confidence Intervals', 'Confidence Distribution Theory',
  // Scenarios 3-5
  'Measurement Validity',
  'Construct Validity', 'Content Validity', 'Criterion Validity', 'Face Validity',
  'Convergent Validity', 'Discriminant Validity', 'Ecological Validity', 'External Validity',
  'Internal Validity', 'Statistical Conclusion Validity', 'Predictive Validity', 'Concurrent Validity',
  'Incremental Validity', 'Cross-Cultural Validity', 'Test-Retest Reliability', 'Inter-Rater Reliability',
];

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      'SELECT id, name FROM concepts WHERE name = ANY($1::text[])',
      [SCRIPT_CONCEPTS]
    );
    const conceptIds = res.rows.map(r => r.id);

    if (conceptIds.length === 0) {
      console.log('No test data found to clean up.');
      await client.query('COMMIT');
      return;
    }

    // Delete edges referencing these concepts (CASCADE handles votes, similarity_votes, etc.)
    const edgeDel = await client.query(
      'DELETE FROM edges WHERE child_id = ANY($1::int[]) RETURNING id',
      [conceptIds]
    );
    console.log(`Deleted ${edgeDel.rowCount} edges`);

    // Also delete edges where these concepts are parents (for Scenario 2 cross-references)
    const edgeDel2 = await client.query(
      'DELETE FROM edges WHERE parent_id = ANY($1::int[]) RETURNING id',
      [conceptIds]
    );
    console.log(`Deleted ${edgeDel2.rowCount} additional parent edges`);

    // Delete similarity_votes that reference deleted edges (should cascade, but be safe)

    const conceptDel = await client.query(
      'DELETE FROM concepts WHERE id = ANY($1::int[]) RETURNING id',
      [conceptIds]
    );
    console.log(`Deleted ${conceptDel.rowCount} concepts`);

    // Delete extra users created by this script
    const userDel = await client.query(
      'DELETE FROM users WHERE username = ANY($1::text[]) RETURNING id',
      [SCRIPT_USERS]
    );
    console.log(`Deleted ${userDel.rowCount} extra users`);

    await client.query('COMMIT');
    console.log('\nCleanup complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Look up existing users and saved tabs ────────
    const existingUserNames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
    const users = {};
    const savedTabs = {};
    for (const name of existingUserNames) {
      const res = await client.query('SELECT id FROM users WHERE username = $1', [name]);
      if (res.rows.length === 0) throw new Error(`User "${name}" not found`);
      users[name] = res.rows[0].id;
      const tabRes = await client.query(
        'SELECT id FROM saved_tabs WHERE user_id = $1 ORDER BY display_order LIMIT 1',
        [users[name]]
      );
      if (tabRes.rows.length > 0) savedTabs[name] = tabRes.rows[0].id;
    }

    // ── Create extra users for 13+ vote patterns ────
    const passwordHash = await bcrypt.hash('test123', 10);
    for (const name of SCRIPT_USERS) {
      const existing = await client.query('SELECT id FROM users WHERE username = $1', [name]);
      if (existing.rows.length > 0) {
        users[name] = existing.rows[0].id;
      } else {
        const res = await client.query(
          'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
          [name, `${name}@test.com`, passwordHash]
        );
        users[name] = res.rows[0].id;
      }
      // Create saved tab if needed
      const tabRes = await client.query(
        'SELECT id FROM saved_tabs WHERE user_id = $1 ORDER BY display_order LIMIT 1',
        [users[name]]
      );
      if (tabRes.rows.length > 0) {
        savedTabs[name] = tabRes.rows[0].id;
      } else {
        const newTab = await client.query(
          'INSERT INTO saved_tabs (user_id, name, display_order) VALUES ($1, $2, 0) RETURNING id',
          [users[name], 'Saved']
        );
        savedTabs[name] = newTab.rows[0].id;
      }
    }
    console.log('Users:', users);

    // ── Look up value attribute ──────────────────────
    const attrRes = await client.query("SELECT id FROM attributes WHERE name = 'value'");
    const VALUE = attrRes.rows[0].id;
    console.log('Value attribute ID:', VALUE);

    // ── Helpers ──────────────────────────────────────
    async function getOrCreateConcept(name) {
      const existing = await client.query('SELECT id FROM concepts WHERE name = $1', [name]);
      if (existing.rows.length > 0) return existing.rows[0].id;
      const res = await client.query(
        'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING id',
        [name, users.alice]
      );
      return res.rows[0].id;
    }

    async function getOrCreateEdge(parentId, childId, graphPath, attrId) {
      const pathStr = `{${graphPath.join(',')}}`;
      let existing;
      if (parentId === null) {
        existing = await client.query(
          'SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = $2 AND attribute_id = $3',
          [childId, pathStr, attrId]
        );
      } else {
        existing = await client.query(
          'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 AND attribute_id = $4',
          [parentId, childId, pathStr, attrId]
        );
      }
      if (existing.rows.length > 0) return existing.rows[0].id;
      const res = await client.query(
        'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [parentId, childId, pathStr, attrId, users.alice]
      );
      return res.rows[0].id;
    }

    async function saveVote(userName, edgeId, parentEdgeId) {
      const userId = users[userName];
      const tabId = savedTabs[userName];
      const res = await client.query(
        'INSERT INTO votes (user_id, edge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
        [userId, edgeId]
      );
      if (res.rows.length > 0) {
        if (tabId) {
          await client.query(
            'INSERT INTO vote_tab_links (vote_id, saved_tab_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [res.rows[0].id, tabId]
          );
        }
        if (parentEdgeId !== undefined) {
          await client.query(
            "INSERT INTO vote_set_changes (user_id, parent_edge_id, child_edge_id, action) VALUES ($1, $2, $3, 'save')",
            [userId, parentEdgeId, edgeId]
          );
        }
      }
    }

    async function addSimVote(userName, originEdgeId, similarEdgeId) {
      await client.query(
        'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [users[userName], originEdgeId, similarEdgeId]
      );
    }

    // Find an existing edge by concept name and parent concept name
    async function findEdge(childName, parentName) {
      if (parentName === null) {
        const res = await client.query(
          `SELECT e.id FROM edges e JOIN concepts c ON c.id = e.child_id
           WHERE c.name = $1 AND e.parent_id IS NULL AND e.is_hidden = false`,
          [childName]
        );
        return res.rows[0]?.id;
      }
      const res = await client.query(
        `SELECT e.id FROM edges e
         JOIN concepts c ON c.id = e.child_id
         JOIN concepts p ON p.id = e.parent_id
         WHERE c.name = $1 AND p.name = $2 AND e.is_hidden = false`,
        [childName, parentName]
      );
      return res.rows[0]?.id;
    }

    // ================================================================
    // SCENARIO 1: Concept Diffing — "Research Design" hierarchy
    // ================================================================
    console.log('\n=== SCENARIO 1: Concept Diffing ===');

    const resDesignId = await getOrCreateConcept('Research Design');
    const resDesignEdge = await getOrCreateEdge(null, resDesignId, [], VALUE);

    const expDesignId = await getOrCreateConcept('Experimental Design');
    const obsDesignId = await getOrCreateConcept('Observational Design');
    const expEdge = await getOrCreateEdge(resDesignId, expDesignId, [resDesignId], VALUE);
    const obsEdge = await getOrCreateEdge(resDesignId, obsDesignId, [resDesignId], VALUE);

    // Shared grandchildren (same concept under both parents)
    const sharedNames = ['Sample Size Planning', 'Bias Mitigation', 'Variable Control'];
    for (const name of sharedNames) {
      const cId = await getOrCreateConcept(name);
      await getOrCreateEdge(expDesignId, cId, [resDesignId, expDesignId], VALUE);
      await getOrCreateEdge(obsDesignId, cId, [resDesignId, obsDesignId], VALUE);
    }
    console.log('  Shared grandchildren:', sharedNames.join(', '));

    // Similar pair 1: Randomization Methods vs Sampling Strategies
    // Great-grandchildren overlap: "Stratified Allocation" and "Adaptive Randomization" appear under both
    const randMethodsId = await getOrCreateConcept('Randomization Methods');
    const sampStrategiesId = await getOrCreateConcept('Sampling Strategies');
    await getOrCreateEdge(expDesignId, randMethodsId, [resDesignId, expDesignId], VALUE);
    await getOrCreateEdge(obsDesignId, sampStrategiesId, [resDesignId, obsDesignId], VALUE);

    // Great-grandchildren of Randomization Methods
    const blockRandId = await getOrCreateConcept('Block Randomization');
    const stratAllocId = await getOrCreateConcept('Stratified Allocation');
    const adaptRandId = await getOrCreateConcept('Adaptive Randomization');
    await getOrCreateEdge(randMethodsId, blockRandId, [resDesignId, expDesignId, randMethodsId], VALUE);
    await getOrCreateEdge(randMethodsId, stratAllocId, [resDesignId, expDesignId, randMethodsId], VALUE);
    await getOrCreateEdge(randMethodsId, adaptRandId, [resDesignId, expDesignId, randMethodsId], VALUE);

    // Great-grandchildren of Sampling Strategies — 2 shared with Randomization Methods
    const clusterSampId = await getOrCreateConcept('Cluster Sampling');
    await getOrCreateEdge(sampStrategiesId, stratAllocId, [resDesignId, obsDesignId, sampStrategiesId], VALUE);
    await getOrCreateEdge(sampStrategiesId, clusterSampId, [resDesignId, obsDesignId, sampStrategiesId], VALUE);
    await getOrCreateEdge(sampStrategiesId, adaptRandId, [resDesignId, obsDesignId, sampStrategiesId], VALUE);
    console.log('  Similar pair 1: Randomization Methods vs Sampling Strategies (Jaccard 2/4 = 50%)');

    // Similar pair 2: Outcome Measurement vs Endpoint Selection
    const outcomeMeasId = await getOrCreateConcept('Outcome Measurement');
    const endpointSelId = await getOrCreateConcept('Endpoint Selection');
    await getOrCreateEdge(expDesignId, outcomeMeasId, [resDesignId, expDesignId], VALUE);
    await getOrCreateEdge(obsDesignId, endpointSelId, [resDesignId, obsDesignId], VALUE);

    const primaryEpId = await getOrCreateConcept('Primary Endpoints');
    const surrogateId = await getOrCreateConcept('Surrogate Markers');
    const compositeId = await getOrCreateConcept('Composite Outcomes');
    const secondaryEpId = await getOrCreateConcept('Secondary Endpoints');

    await getOrCreateEdge(outcomeMeasId, primaryEpId, [resDesignId, expDesignId, outcomeMeasId], VALUE);
    await getOrCreateEdge(outcomeMeasId, surrogateId, [resDesignId, expDesignId, outcomeMeasId], VALUE);
    await getOrCreateEdge(outcomeMeasId, compositeId, [resDesignId, expDesignId, outcomeMeasId], VALUE);

    await getOrCreateEdge(endpointSelId, primaryEpId, [resDesignId, obsDesignId, endpointSelId], VALUE);
    await getOrCreateEdge(endpointSelId, secondaryEpId, [resDesignId, obsDesignId, endpointSelId], VALUE);
    await getOrCreateEdge(endpointSelId, compositeId, [resDesignId, obsDesignId, endpointSelId], VALUE);
    console.log('  Similar pair 2: Outcome Measurement vs Endpoint Selection (Jaccard 2/4 = 50%)');

    // Unique grandchildren
    const blindProcId = await getOrCreateConcept('Blinding Procedures');
    const placeboId = await getOrCreateConcept('Placebo Design');
    await getOrCreateEdge(expDesignId, blindProcId, [resDesignId, expDesignId], VALUE);
    await getOrCreateEdge(expDesignId, placeboId, [resDesignId, expDesignId], VALUE);

    const cohortSelId = await getOrCreateConcept('Cohort Selection');
    const caseMatchId = await getOrCreateConcept('Case Matching');
    await getOrCreateEdge(obsDesignId, cohortSelId, [resDesignId, obsDesignId], VALUE);
    await getOrCreateEdge(obsDesignId, caseMatchId, [resDesignId, obsDesignId], VALUE);
    console.log('  Unique: Blinding Procedures, Placebo Design (Experimental); Cohort Selection, Case Matching (Observational)');

    // ================================================================
    // SCENARIO 2: Flip View — "Confidence Intervals" under 5 parents
    // ================================================================
    console.log('\n=== SCENARIO 2: Flip View ===');

    const ciId = await getOrCreateConcept('Confidence Intervals');

    // Look up existing concepts for reuse
    const reproId = (await client.query("SELECT id FROM concepts WHERE name = 'Reproducibility'")).rows[0].id;
    const statRigorId = (await client.query("SELECT id FROM concepts WHERE name = 'Statistical Rigor'")).rows[0].id;
    const esrId = (await client.query("SELECT id FROM concepts WHERE name = 'Effect Size Reporting'")).rows[0].id;
    const powerAnalId = (await client.query("SELECT id FROM concepts WHERE name = 'Power Analysis'")).rows[0].id;

    // Parent 1: Statistical Rigor (existing, path {reproId})
    const ciEdge1 = await getOrCreateEdge(statRigorId, ciId, [reproId, statRigorId], VALUE);
    console.log(`  Parent 1: Statistical Rigor -> Confidence Intervals (edge ${ciEdge1})`);

    // Parent 2: Effect Size Reporting (existing, path {reproId, statRigorId})
    const ciEdge2 = await getOrCreateEdge(esrId, ciId, [reproId, statRigorId, esrId], VALUE);
    console.log(`  Parent 2: Effect Size Reporting -> Confidence Intervals (edge ${ciEdge2})`);

    // Parent 3: Inferential Statistics (new root)
    const inferStatId = await getOrCreateConcept('Inferential Statistics');
    const inferStatEdge = await getOrCreateEdge(null, inferStatId, [], VALUE);
    const ciEdge3 = await getOrCreateEdge(inferStatId, ciId, [inferStatId], VALUE);
    // Siblings under Inferential Statistics (for Jaccard)
    const hypTestId = await getOrCreateConcept('Hypothesis Testing');
    const pvalInterpId = await getOrCreateConcept('P-Value Interpretation');
    const sigThreshId = await getOrCreateConcept('Significance Thresholds');
    await getOrCreateEdge(inferStatId, hypTestId, [inferStatId], VALUE);
    await getOrCreateEdge(inferStatId, pvalInterpId, [inferStatId], VALUE);
    await getOrCreateEdge(inferStatId, sigThreshId, [inferStatId], VALUE);
    // Add shared siblings with Statistical Rigor for Jaccard overlap
    await getOrCreateEdge(inferStatId, powerAnalId, [inferStatId], VALUE);
    await getOrCreateEdge(inferStatId, esrId, [inferStatId], VALUE);
    console.log(`  Parent 3: Inferential Statistics -> Confidence Intervals (edge ${ciEdge3})`);
    console.log('    Siblings: Hypothesis Testing, P-Value Interpretation, Significance Thresholds, Power Analysis, Effect Size Reporting');

    // Parent 4: Study Reporting Standards (new root)
    const studyRepId = await getOrCreateConcept('Study Reporting Standards');
    const studyRepEdge = await getOrCreateEdge(null, studyRepId, [], VALUE);
    const ciEdge4 = await getOrCreateEdge(studyRepId, ciId, [studyRepId], VALUE);
    const effTransId = await getOrCreateConcept('Effect Transparency');
    const sampDescId = await getOrCreateConcept('Sample Description');
    const limDiscId = await getOrCreateConcept('Limitation Disclosure');
    await getOrCreateEdge(studyRepId, effTransId, [studyRepId], VALUE);
    await getOrCreateEdge(studyRepId, sampDescId, [studyRepId], VALUE);
    await getOrCreateEdge(studyRepId, limDiscId, [studyRepId], VALUE);
    // Add shared sibling with Inferential Statistics for Jaccard
    await getOrCreateEdge(studyRepId, pvalInterpId, [studyRepId], VALUE);
    console.log(`  Parent 4: Study Reporting Standards -> Confidence Intervals (edge ${ciEdge4})`);

    // Parent 5: Meta-Analysis under Research Synthesis (new root)
    const resSynthId = await getOrCreateConcept('Research Synthesis');
    const resSynthEdge = await getOrCreateEdge(null, resSynthId, [], VALUE);
    const metaAnalId = (await client.query("SELECT id FROM concepts WHERE name = 'Meta-Analysis'")).rows.length > 0
      ? (await client.query("SELECT id FROM concepts WHERE name = 'Meta-Analysis'")).rows[0].id
      : await getOrCreateConcept('Meta-Analysis');
    // Meta-Analysis is not an existing concept, so let's ensure it:
    const metaAnalEdge = await getOrCreateEdge(resSynthId, metaAnalId, [resSynthId], VALUE);
    const ciEdge5 = await getOrCreateEdge(metaAnalId, ciId, [resSynthId, metaAnalId], VALUE);
    const forestPlotsId = await getOrCreateConcept('Forest Plots');
    const heteroAssessId = await getOrCreateConcept('Heterogeneity Assessment');
    const pubBiasId = await getOrCreateConcept('Publication Bias Detection');
    await getOrCreateEdge(metaAnalId, forestPlotsId, [resSynthId, metaAnalId], VALUE);
    await getOrCreateEdge(metaAnalId, heteroAssessId, [resSynthId, metaAnalId], VALUE);
    await getOrCreateEdge(metaAnalId, pubBiasId, [resSynthId, metaAnalId], VALUE);
    // Add shared sibling with Inferential Statistics
    await getOrCreateEdge(metaAnalId, hypTestId, [resSynthId, metaAnalId], VALUE);
    console.log(`  Parent 5: Meta-Analysis -> Confidence Intervals (edge ${ciEdge5})`);

    // Jaccard summary:
    // StatRigor siblings: Power Analysis, Effect Size Reporting, Multiple Comparisons, Running the Stats
    // InferStat siblings: Hypothesis Testing, P-Value Interpretation, Significance Thresholds, Power Analysis, Effect Size Reporting
    // Overlap StatRigor<->InferStat: {Power Analysis, Effect Size Reporting} = 2, Union = 4+5-2 = 7, J = 29%
    // InferStat<->StudyRep: {P-Value Interpretation} = 1, Union = 5+4-1 = 8, J = 12.5%
    // InferStat<->MetaAnal: {Hypothesis Testing} = 1, Union = 5+4-1 = 8, J = 12.5%
    // All others: 0%

    // Similarity votes (link votes) — varied counts so link-sort != Jaccard-sort
    // From Statistical Rigor context:
    const statRigorCiEdge = ciEdge1; // edge for CI under Stat Rigor
    // Votes FROM context 1 (StatRigor) TO other contexts
    await addSimVote('alice', statRigorCiEdge, ciEdge3);  // -> InferStat
    await addSimVote('bob', statRigorCiEdge, ciEdge3);
    await addSimVote('carol', statRigorCiEdge, ciEdge3);
    await addSimVote('dave', statRigorCiEdge, ciEdge3);   // 4 votes to InferStat (highest Jaccard too)

    await addSimVote('alice', statRigorCiEdge, ciEdge5);  // -> MetaAnalysis
    await addSimVote('eve', statRigorCiEdge, ciEdge5);    // 2 votes to MetaAnal (low Jaccard)

    await addSimVote('frank', statRigorCiEdge, ciEdge4);  // 1 vote to StudyRep

    // From Inferential Statistics context:
    await addSimVote('alice', ciEdge3, ciEdge1);  // -> StatRigor
    await addSimVote('bob', ciEdge3, ciEdge1);
    await addSimVote('carol', ciEdge3, ciEdge1);  // 3 votes

    await addSimVote('alice', ciEdge3, ciEdge5);  // -> MetaAnal
    await addSimVote('bob', ciEdge3, ciEdge5);
    await addSimVote('carol', ciEdge3, ciEdge5);
    await addSimVote('dave', ciEdge3, ciEdge5);
    await addSimVote('eve', ciEdge3, ciEdge5);    // 5 votes to MetaAnal (highest link votes, low Jaccard!)

    await addSimVote('frank', ciEdge3, ciEdge4);
    await addSimVote('dave', ciEdge3, ciEdge4);   // 2 votes to StudyRep

    console.log('  Similarity votes inserted');
    console.log('  From StatRigor: InferStat=4, MetaAnal=2, StudyRep=1');
    console.log('  From InferStat: StatRigor=3, MetaAnal=5, StudyRep=2');

    // ================================================================
    // SCENARIO 2b: Children of CI across contexts (Flip View Jaccard)
    // ================================================================
    console.log('\n=== SCENARIO 2b: Children of Confidence Intervals ===');

    // CI child concept names (realistic CI subtopics)
    const ciChildNames = [
      'Coverage Probability',              // 0
      'Bayesian Credible Intervals',       // 1
      'Bootstrap Confidence Intervals',    // 2
      'Confidence Level Selection',        // 3
      'Sample Size Requirements',          // 4
      'Margin of Error',                   // 5
      'Interval Width Interpretation',     // 6
      'Confidence Bands for Regression',   // 7
      'Asymptotic Normality Assumptions',  // 8
      'Multiple Comparisons Adjustment',   // 9
      'Profile Likelihood Intervals',      // 10
      'Exact vs Approximate Intervals',    // 11
      'Jeffreys Interval',                // 12
      'Nonparametric Confidence Intervals',// 13
      'Confidence Distribution Theory',    // 14
    ];

    // Create all child concepts
    const ciChildIds = [];
    for (const name of ciChildNames) {
      ciChildIds.push(await getOrCreateConcept(name));
    }

    // Look up the actual CI edges from the DB to get correct graph_paths
    const ciEdgesFromDb = await client.query(
      `SELECT e.id, e.parent_id, e.graph_path, e.attribute_id, p.name as parent_name
       FROM edges e JOIN concepts p ON p.id = e.parent_id
       WHERE e.child_id = $1 ORDER BY e.id`,
      [ciId]
    );

    // 5 contexts with varying child overlap for Jaccard diversity
    // A vs B: 6 shared / 8 union = 75%
    // A vs C: 4 shared / 10 union = 40%
    // A vs D: 1 shared / 10 union = 10%
    // A vs E: 0 shared / 12 union = 0%
    const ciContextChildren = [
      [0,1,2,3,4,5,6],       // A: 7 children
      [0,1,2,3,4,5,7],       // B: 7 children — shares 6 with A
      [0,1,2,3,8,9,10],      // C: 7 children — shares 4 with A
      [0,11,12,13],           // D: 4 children — shares 1 with A
      [10,11,12,13,14],       // E: 5 children — shares 0 with A
    ];

    for (let i = 0; i < ciEdgesFromDb.rows.length && i < ciContextChildren.length; i++) {
      const edge = ciEdgesFromDb.rows[i];
      const childIndices = ciContextChildren[i];
      // graph_path for children under CI = edge's graph_path + CI's id
      const childGraphPath = [...edge.graph_path, ciId];
      const attrId = edge.attribute_id;

      console.log(`  Context ${String.fromCharCode(65 + i)}: ${edge.parent_name} (edge ${edge.id}), child graph_path=[${childGraphPath}], attr=${attrId}`);

      for (const idx of childIndices) {
        const childConceptId = ciChildIds[idx];
        const childName = ciChildNames[idx];
        const edgeId = await getOrCreateEdge(ciId, childConceptId, childGraphPath, attrId);
        console.log(`    Added: "${childName}" (concept=${childConceptId}, edge=${edgeId})`);
      }
    }

    // Print Jaccard summary
    console.log('\n  Expected Jaccard similarities (vs Context A):');
    const setA = new Set(ciContextChildren[0]);
    const labels = ciEdgesFromDb.rows.map(r => r.parent_name);
    for (let i = 1; i < ciContextChildren.length; i++) {
      const setX = new Set(ciContextChildren[i]);
      const intersection = [...setA].filter(x => setX.has(x)).length;
      const union = new Set([...setA, ...setX]).size;
      const jaccard = union === 0 ? 0 : intersection / union;
      console.log(`    A (${labels[0]}) vs ${String.fromCharCode(65 + i)} (${labels[i]}): ${intersection}/${union} = ${(jaccard * 100).toFixed(0)}%`);
    }

    // ================================================================
    // SCENARIOS 3-5: Vote Set Swatches — "Measurement Validity"
    // ================================================================
    console.log('\n=== SCENARIOS 3-5: Vote Set Swatches ===');

    const measValId = await getOrCreateConcept('Measurement Validity');
    const measValEdge = await getOrCreateEdge(null, measValId, [], VALUE);

    const childNames = [
      'Construct Validity', 'Content Validity', 'Criterion Validity', 'Face Validity',
      'Convergent Validity', 'Discriminant Validity', 'Ecological Validity', 'External Validity',
      'Internal Validity', 'Statistical Conclusion Validity', 'Predictive Validity', 'Concurrent Validity',
      'Incremental Validity', 'Cross-Cultural Validity', 'Test-Retest Reliability', 'Inter-Rater Reliability',
    ];

    const childEdges = [];
    for (const name of childNames) {
      const cId = await getOrCreateConcept(name);
      const eId = await getOrCreateEdge(measValId, cId, [measValId], VALUE);
      childEdges.push({ name, edgeId: eId });
    }

    console.log('  Created 16 children under Measurement Validity:');
    childEdges.forEach((c, i) => console.log(`    ${i + 1}. ${c.name} (edge ${c.edgeId})`));

    // Vote patterns (1-indexed child numbers) — 13 distinct patterns
    const votePatterns = {
      alice:   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],           // broad coverage
      bob:     [1, 2, 3, 4, 5, 6, 7, 8, 11, 12],           // similar to alice, diverges on 9,10
      carol:   [1, 2, 3, 4, 5, 6, 13, 14, 15, 16],         // overlaps first 6 then unique
      dave:    [3, 5, 7, 9, 11, 13, 15],                    // odd-numbered, sparse
      eve:     [1, 2, 3, 4, 5, 8, 9, 10, 11, 12],          // overlaps heavily with alice & bob
      frank:   [7, 8, 9, 10, 14, 15, 16],                   // bottom-heavy
      grace:   [1, 3, 5, 7, 9, 11, 13, 15],                 // all odd-indexed
      heidi:   [2, 4, 6, 8, 10, 12, 14, 16],                // all even-indexed
      ivan:    [1, 2, 3, 4],                                 // top-4 only, minimal
      judy:    [13, 14, 15, 16],                             // bottom-4 only, minimal
      karl:    [1, 4, 7, 10, 13, 16],                        // every-3rd, diagonal
      liam:    [2, 3, 5, 8, 13],                             // Fibonacci-indexed, sparse
      mallory: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], // completionist
    };

    // Insert votes
    let voteCount = 0;
    for (const [userName, indices] of Object.entries(votePatterns)) {
      // Vote on root edge (ancestor)
      await saveVote(userName, measValEdge, undefined);

      for (const idx of indices) {
        const childEdge = childEdges[idx - 1];
        await saveVote(userName, childEdge.edgeId, measValEdge);
        voteCount++;
      }
      console.log(`  ${userName}: saved ${indices.length} children`);
    }
    console.log(`  Total child votes: ${voteCount}`);

    // 13 distinct vote patterns — exercises color wrapping (pattern 13 reuses Indigo as "IndigoA")
    // Key similarity clusters:
    // alice(1-10) vs bob(1-8,11,12): J=67% | alice vs eve(1-5,8-12): J=67%
    // grace(odd) vs dave(odd subset): J=88% | heidi(even) vs karl(1,4,7,10,13,16): J=33%
    // mallory(all 16) has highest overlap with everyone

    await client.query('COMMIT');

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('\n' + '='.repeat(70));
    console.log('SEED COMPLETE — Navigation Guide');
    console.log('='.repeat(70));

    console.log('\nSCENARIO 1: Concept Diffing');
    console.log('  Navigate to: Root page -> "Research Design"');
    console.log('  Right-click "Experimental Design" -> "Compare children..."');
    console.log('  Add "Observational Design" (Research Design context) as second pane');
    console.log('  Expected groupings:');
    console.log('    SHARED (green): Sample Size Planning, Bias Mitigation, Variable Control');
    console.log('    SIMILAR (amber): Randomization Methods ~ Sampling Strategies (50%)');
    console.log('                     Outcome Measurement ~ Endpoint Selection (50%)');
    console.log('    UNIQUE (gray): Blinding Procedures, Placebo Design (Experimental)');
    console.log('                   Cohort Selection, Case Matching (Observational)');
    console.log('  Try adjusting threshold: 40% shows both similar pairs, 60% hides them');

    console.log('\nSCENARIO 2: Flip View with Multiple Alt Parents');
    console.log('  Navigate to: Reproducibility -> Statistical Rigor -> Confidence Intervals');
    console.log('  Toggle to Flip View (right-click or view toggle)');
    console.log('  You should see 4 alternate parents with varied Jaccard similarities:');
    console.log('    From Statistical Rigor context (A):');
    console.log('    - Effect Size Reporting (B): Jaccard ~75%, link votes: 0');
    console.log('    - Inferential Statistics (C): Jaccard ~40%, link votes: 4');
    console.log('    - Study Reporting Standards (D): Jaccard ~10%, link votes: 1');
    console.log('    - Meta-Analysis (E): Jaccard ~0%, link votes: 2');
    console.log('  Sort by Links: C(4) > E(2) > D(1) > B(0)');
    console.log('  Sort by Similarity: B(75%) > C(40%) > D(10%) > E(0%)');
    console.log('  These orderings are clearly different — validates sort toggle');
    console.log('  Also try from Inferential Statistics context (C):');
    console.log('    - Meta-Analysis gets 5 link votes (top by links) but low Jaccard');
    console.log('    - Statistical Rigor gets 3 link votes but higher Jaccard');

    console.log('\nSCENARIOS 3-5: Vote Set Swatches');
    console.log('  Navigate to: Root page -> "Measurement Validity"');
    console.log('  You should see 13 color swatches (exercises color wrapping):');
    console.log('    alice:   children 1-10 (broad)');
    console.log('    bob:     children 1-8, 11-12 (similar to alice)');
    console.log('    eve:     children 1-5, 8-12 (similar to alice & bob)');
    console.log('    carol:   children 1-6, 13-16 (moderate overlap)');
    console.log('    frank:   children 7-10, 14-16 (bottom-heavy)');
    console.log('    dave:    children 3,5,7,9,11,13,15 (sparse, odd-numbered)');
    console.log('    grace:   children 1,3,5,7,9,11,13,15 (all odd-indexed)');
    console.log('    heidi:   children 2,4,6,8,10,12,14,16 (all even-indexed)');
    console.log('    ivan:    children 1-4 (top-4 only)');
    console.log('    judy:    children 13-16 (bottom-4 only)');
    console.log('    karl:    children 1,4,7,10,13,16 (every-3rd)');
    console.log('    liam:    children 2,3,5,8,13 (Fibonacci-indexed)');
    console.log('    mallory: children 1-16 (completionist)');
    console.log('');
    console.log('  Scenario 3 (swatches): 13th swatch should show "IndigoA" in tooltip (color wrapping)');
    console.log('  Scenario 4 (tiered): Select alice + bob + carol swatches, enable tiered view');
    console.log('  Scenario 5 (similarity clustering): alice/bob/eve cluster (67% Jaccard)');
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    console.error(err.stack);
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
