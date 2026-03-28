// ============================================================
// seed-test-data.js — Comprehensive Test Seed Script
//
// Populates full-stack test data for manual QA of every feature.
// Clears ALL data first, re-runs migrations, then seeds.
//
// SEED:    node backend/src/config/seed-test-data.js
// CLEANUP: node backend/src/config/seed-test-data.js --cleanup
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { execSync } = require('child_process');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'concept_hierarchy',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// ──────────────────────────────────────────────────────────────
// DELETE ORDER — respects FK constraints
// ──────────────────────────────────────────────────────────────
const DELETE_TABLES = [
  'annotation_color_set_votes', 'annotation_votes', 'annotation_removal_log',
  'document_annotations', 'document_concept_links_cache', 'document_favorites',
  'document_invite_tokens', 'document_authors', 'corpus_documents',
  'corpus_invite_tokens', 'corpus_allowed_users', 'corpus_subscriptions',
  'vote_set_changes', 'child_rankings', 'concept_link_votes', 'concept_links',
  'moderation_comments', 'concept_flag_votes', 'concept_flags',
  'similarity_votes', 'replace_votes', 'vote_tab_links', 'votes',
  'saved_tree_order_v2', 'saved_page_tab_activity',
  'user_corpus_tab_placements', 'sidebar_items', 'graph_tabs', 'tab_groups',
  'saved_tabs', 'edges', 'concepts', 'document_tags', 'documents', 'corpuses', 'users',
];

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────
async function clearAll(client) {
  console.log('\n=== Phase A: Clear all data ===');
  for (const table of DELETE_TABLES) {
    await client.query(`DELETE FROM ${table}`);
    console.log(`  Cleared ${table}`);
  }
  // Reset sequences
  const seqRes = await client.query(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname = 'public'
  `);
  for (const row of seqRes.rows) {
    await client.query(`ALTER SEQUENCE ${row.relname} RESTART WITH 1`);
  }
  console.log(`  Reset ${seqRes.rows.length} sequences`);
}

function runMigrations() {
  console.log('\n=== Running migrations ===');
  const migrateFile = path.join(__dirname, 'migrate.js');
  execSync(`node "${migrateFile}"`, { stdio: 'inherit' });
  console.log('  Migrations complete');
}

// ──────────────────────────────────────────────────────────────
// DOCUMENT BODIES
// ──────────────────────────────────────────────────────────────
const DOC_BODIES = {
  1: `Why Most Published Research Findings Are False

It can be proven that most claimed research findings are false. The probability that a research finding is true depends on the prior probability of it being true, the statistical power of the study, and the level of statistical significance. Simulations show that for most study designs and settings, it is more likely for a research claim to be false than true.

Moreover, for many current scientific fields, claimed research findings may often be simply accurate measures of the prevailing bias. The process of replication is essential for establishing truth in scientific research. Factors such as small sample sizes, small effect sizes, and financial interests can make false findings more likely.

Research is not most appropriately represented and summarized by p-values, but by the totality of evidence. Investigators should consider the pre-study odds of the relationship being true before conducting the study. We should acknowledge that most research findings are likely to be false, and design our research enterprise accordingly.

The replication crisis has shown that many published results fail to reproduce when tested independently. Understanding the statistical foundations of this problem is crucial for improving the reliability of the scientific record. Better study design, pre-registration, and transparent reporting are all necessary steps forward.

Scientific journals must also adapt their incentive structures to reward rigorous methodology rather than novel or surprising findings. The publish-or-perish culture contributes significantly to the proliferation of irreproducible results.`,

  2: `The Replication Crisis in Psychology

The replication crisis represents one of the most significant challenges facing modern psychological science. Beginning with a series of high-profile failures to replicate, the field has undergone substantial introspection about its methods and practices. The crisis revealed that many classic findings could not be reproduced when tested with larger samples and pre-registered protocols.

Several factors contributed to this state of affairs. Publication bias meant that journals preferentially published positive results, creating a distorted literature. Questionable research practices, including p-hacking and HARKing (Hypothesizing After Results are Known), inflated the rate of false positives.

The crisis has led to important reforms. Pre-registration of studies has become increasingly common, allowing researchers to commit to their analyses before seeing the data. Registered reports, where journals accept papers based on the methodology before results are known, help eliminate publication bias.

Open science practices have proliferated as a response. Data sharing, code availability, and transparent methods sections are now expected by many journals. Large-scale collaborative replication projects have provided important data on which findings are robust.

Psychology has arguably led the way among the sciences in addressing these issues. The reforms spurred by the replication crisis are spreading to other fields, including medicine, economics, and neuroscience. Transparent research methods are now the standard.`,

  3: `The Replication Crisis in Psychology v2

The replication crisis represents one of the most significant challenges facing modern psychological science. This updated review incorporates findings from the latest large-scale replication efforts and meta-scientific studies conducted since the original publication.

Beginning with the Reproducibility Project Psychology in 2015, followed by Many Labs 2 and subsequent collaborative efforts, the field now has substantial empirical data on replication rates. The overall picture confirms that roughly 50-60% of published findings replicate successfully, though this varies considerably by subfield.

New evidence suggests that the replication rate is strongly predicted by the original effect size and sample size, rather than by the prestige of the journal or institution. This finding has important implications for how we evaluate the credibility of published research.

Methodological reforms have accelerated since the original review. Pre-registration is now commonplace, with platforms like AsPredicted and the Open Science Framework hosting hundreds of thousands of pre-registrations. Multi-site replication studies have become a standard tool for establishing the robustness of findings.

The incentive structure of academia has begun shifting, with many institutions now valuing rigorous methodology over publication quantity. However, progress remains uneven across departments and countries. The publish-or-perish culture continues to shape behavior in many academic settings.

Statistical education has improved substantially, with growing emphasis on effect sizes, confidence intervals, and Bayesian approaches alongside traditional null hypothesis significance testing. The field benefits from continued vigilance about methodology.`,

  4: `Estimating the Reproducibility of Psychological Science

## Overview

This landmark collaborative effort attempted to replicate 100 studies published in three prominent psychology journals. The results provided the first large-scale empirical estimate of the reproducibility of psychological research.

## Methods

Teams of researchers independently replicated each original study, closely following the original methods while using adequately powered sample sizes. Each replication was pre-registered, and materials were shared openly.

## Key Findings

Only 36% of replications produced statistically significant results in the same direction as the original study. The mean effect size of replications was approximately half the magnitude of the original effects. Cognitive psychology studies replicated at a higher rate (50%) than social psychology studies (25%).

## Moderating Factors

Studies with stronger original evidence (larger effect sizes, lower p-values) were more likely to replicate successfully. The expertise of the replication team and the precision of the methodology also played important roles. Surprising or counterintuitive findings were less likely to replicate.

## Implications

These findings underscore the need for methodological reform in psychology. Pre-registration, larger sample sizes, and multi-site collaborations are essential tools for improving reproducibility. The field must balance innovation with rigor to maintain scientific credibility.`,

  5: `An Introduction to Power Analysis

Statistical power is the probability that a study will detect a true effect when one exists. Power analysis is a critical component of study design that is often overlooked or inadequately performed. Understanding power helps researchers design studies that are capable of providing informative results.

The four components of power analysis are sample size, effect size, significance level (alpha), and statistical power (1 minus beta). These four quantities are mathematically related, so knowing any three allows calculation of the fourth. Most commonly, researchers specify the expected effect size, desired power level, and significance criterion to determine the required sample size.

Effect sizes can be estimated from prior research, pilot studies, or theoretical considerations. Cohen provided conventional benchmarks (small, medium, large) for common statistical tests, though these should be used cautiously. The most informative power analyses use effect sizes derived from meta-analyses of related phenomena.

Underpowered studies are problematic for multiple reasons. They have a low probability of detecting true effects, and when they do find statistically significant results, those results are more likely to overestimate the true effect size. This contributes to the replication crisis by populating the literature with inflated effect sizes.

A priori power analysis should be conducted before data collection begins. Sensitivity analysis examines what effect sizes can be detected given fixed resources. Post-hoc power analysis based on observed data is generally discouraged as it provides no additional information beyond the p-value itself.

Modern tools like G*Power, R packages, and simulation-based approaches make power analysis accessible to all researchers. These tools support a wide range of statistical tests and study designs.`,

  6: `Bayesian Data Analysis for the Sciences

Bayesian statistics provides an alternative framework for data analysis that offers several advantages over traditional frequentist methods. The Bayesian approach explicitly incorporates prior knowledge and provides direct probability statements about hypotheses and parameters.

The foundation of Bayesian inference is Bayes theorem, which describes how to update beliefs in light of new evidence. The prior distribution represents what is known before collecting data, the likelihood represents the information in the data, and the posterior distribution represents updated knowledge after observing the data.

One key advantage of Bayesian methods is the ability to quantify evidence for or against hypotheses using Bayes factors. Unlike p-values, Bayes factors can provide evidence in favor of the null hypothesis, addressing a fundamental limitation of frequentist testing. This distinction is particularly important in replication research.

Bayesian credible intervals have a more intuitive interpretation than frequentist confidence intervals. A 95% credible interval contains the true parameter value with 95% probability, given the data and prior. This is the interpretation many researchers incorrectly assign to confidence intervals.

Modern computational methods, particularly Markov Chain Monte Carlo (MCMC) sampling, have made Bayesian analysis practical for complex models. Software packages like Stan, JAGS, and brms provide accessible interfaces for fitting Bayesian models. The choice between Bayesian and frequentist methods should be guided by the research question.

Bayesian methods are particularly valuable for sequential analysis, hierarchical modeling, and incorporating domain expertise. Prior sensitivity analysis ensures that conclusions are robust to reasonable variations in prior beliefs.`,

  7: `The FAIR Guiding Principles for Scientific Data Management

The FAIR principles provide guidelines to improve the Findability, Accessibility, Interoperability, and Reusability of digital assets. These principles emphasize the capacity of computational systems to find, access, interoperate, and reuse data with none or minimal human intervention.

Findability requires that data and metadata are assigned globally unique and persistent identifiers. Rich metadata should describe the data, and metadata should be registered or indexed in a searchable resource. Without findability, data cannot be discovered by either humans or machines.

Accessibility means that data and metadata are retrievable by their identifier using a standardized communications protocol. The protocol should be open, free, and universally implementable. Even when the data itself is not openly accessible, the metadata should be accessible.

Interoperability requires that data use a formal, accessible, shared, and broadly applicable language for knowledge representation. Data should use vocabularies that follow FAIR principles and include qualified references to other data or metadata.

Reusability means that data and metadata are richly described with a plurality of accurate and relevant attributes. Data should be released with a clear and accessible data usage license and associated with detailed provenance information.

Implementation of FAIR principles is an ongoing effort across the scientific community. Research institutions, funding agencies, and publishers are increasingly requiring FAIR compliance for publicly funded research data.`,

  8: `The Belmont Report Summary

The Belmont Report, published in 1979 by the National Commission for the Protection of Human Subjects of Biomedical and Behavioral Research, established the foundational ethical principles for research involving human subjects. It remains a cornerstone of research ethics training and institutional review board oversight.

The report identifies three basic ethical principles. Respect for persons incorporates two ethical convictions: individuals should be treated as autonomous agents, and persons with diminished autonomy are entitled to protection. This principle underlies the requirement for informed consent.

Beneficence refers to the obligation to protect the welfare of research subjects. Researchers must not only refrain from harming subjects but also must maximize possible benefits and minimize possible harms. Risk-benefit assessment is a key application of this principle in research design and review.

Justice addresses the fair distribution of the burdens and benefits of research. The selection of research subjects must be equitable, and vulnerable populations should not bear a disproportionate share of research burdens. Historical abuses, such as the Tuskegee Syphilis Study, powerfully illustrate the consequences of ignoring this principle.

These three principles are applied through informed consent procedures, risk-benefit assessment, and fair subject selection. Institutional review boards use these principles as the framework for evaluating research protocols. The principles continue to be relevant as new research methodologies and technologies emerge.`,

  9: `Responsible Conduct of Research Guidelines

These guidelines outline the standards expected of all researchers at the institution. Adherence to these principles ensures the integrity of the research enterprise and maintains public trust in scientific findings.

Data management practices must ensure the integrity and reproducibility of research. All primary data should be recorded in permanent formats and retained for a minimum period as specified by institutional and funding agency policies. Data fabrication, falsification, and inappropriate manipulation are strictly prohibited.

Authorship should be assigned based on substantial intellectual contributions. All authors should approve the final version and agree to be accountable for the work. Ghost authorship and honorary authorship violate accepted standards and undermine the attribution system.

Conflicts of interest, whether financial, personal, or professional, must be disclosed to relevant parties. Researchers should not participate in decisions where their judgment may be compromised by competing interests. Institutional conflict of interest committees provide guidance on managing identified conflicts.

Mentorship responsibilities include training junior researchers in ethical conduct, providing constructive feedback, and creating an environment that supports responsible research practices. Mentors serve as role models and should demonstrate the values they expect from their trainees.

Collaborative research requires clear agreements about roles, responsibilities, data sharing, and intellectual property. International collaborations must respect the ethical standards and regulations of all participating countries.`,

  10: `Preprints in Biology: The Future of Scientific Communication

The preprint movement in biology has transformed how researchers share and discuss scientific findings. Preprint servers like bioRxiv and medRxiv allow researchers to make their work publicly available before formal peer review, accelerating the pace of scientific communication.

The COVID-19 pandemic dramatically accelerated preprint adoption in the biomedical sciences. The urgency of the situation demanded rapid sharing of results, and preprints provided the mechanism. This experience demonstrated both the benefits and risks of pre-peer-review dissemination.

Benefits of preprints include establishing priority, receiving early feedback, and increasing the visibility of research. Preprints are freely accessible, removing barriers imposed by journal paywalls. They also provide a timestamp that can protect against being scooped by competitors.

Concerns about preprints center on the lack of peer review and the potential for misinformation. Media coverage of unvetted findings can mislead the public, particularly for health-related claims. The scientific community continues to develop norms for responsible preprint communication.

Many journals now accept submissions that have been posted as preprints, and some funding agencies recognize preprints in grant applications. The relationship between preprints and traditional journal publication continues to evolve as the scholarly communication ecosystem adapts.

The future likely involves integration of preprints with overlay journals, post-publication review platforms, and enhanced metadata standards. These developments promise a more transparent and efficient scientific communication system.`,
};

// ──────────────────────────────────────────────────────────────
// ANNOTATION DEFINITIONS (20)
// ──────────────────────────────────────────────────────────────
// [corpusIdx(0-based), docIdx(0-based), edgeKey, quoteText, comment, creator]
const ANNOTATION_DEFS = [
  // Corpus 1 (Reproducibility Crisis Readings) — Docs 1-4
  [0, 0, 'Reproducibility_root', 'most claimed research findings are false', 'Core thesis of Ioannidis paper', 'alice'],
  [0, 0, 'Reproducibility>MethTransparency', 'pre-study odds of the relationship being true', 'Bayesian framing of reproducibility', 'alice'],
  [0, 0, 'Reproducibility>StatisticalRigor', 'small sample sizes, small effect sizes', 'Key factors reducing statistical rigor', 'bob'],
  [0, 1, 'Reproducibility>ReplicationStudies', 'failures to replicate', 'Documents the scope of the problem', 'carol'],
  [0, 1, 'MethTransparency>ProtocolSharing', 'Pre-registration of studies has become increasingly common', 'Protocol sharing as reform', 'alice'],
  [0, 1, 'MethTransparency>CodeAvailability', 'Data sharing, code availability, and transparent methods', 'Links code availability to open science reform', 'bob'],
  [0, 2, 'Reproducibility>ReplicationStudies', 'roughly 50-60% of published findings replicate', 'Updated replication rate estimate', 'carol'],
  [0, 2, 'StatisticalRigor>PowerAnalysis', 'original effect size and sample size', 'Power analysis relevance to replication', 'alice'],
  [0, 3, 'ReplicationStudies>DirectReplication', 'independently replicated each original study', 'Exemplar of direct replication methodology', 'bob'],
  [0, 3, 'ReplicationStudies>ConceptualReplication', 'Cognitive psychology studies replicated at a higher rate', 'Subfield differences in replication', 'dave'],
  // Corpus 2 (Methods & Statistics) — Docs 5-7
  [1, 0, 'StatisticalRigor>PowerAnalysis', 'probability that a study will detect a true effect', 'Foundational definition of statistical power', 'bob'],
  [1, 0, 'StatisticalRigor>EffectSizeReporting', 'inflated effect sizes', 'Link between underpowered studies and effect size inflation', 'eve'],
  [1, 1, 'DataAnalysis>BayesianMethods', 'update beliefs in light of new evidence', 'Core Bayesian principle', 'dave'],
  [1, 1, 'DataAnalysis>QuantitativeMethods', 'Markov Chain Monte Carlo', 'Modern computational methods for quantitative analysis', 'dave'],
  [1, 2, 'OpenScience>OpenData', 'Findability, Accessibility, Interoperability, and Reusability', 'FAIR principles definition', 'dave'],
  // Corpus 3 (Ethics in Research) — Docs 8-9
  [2, 0, 'ResearchEthics>InformedConsent', 'individuals should be treated as autonomous agents', 'Respect for persons principle', 'carol'],
  [2, 0, 'InformedConsent>VulnerablePopulations', 'persons with diminished autonomy are entitled to protection', 'Protection of vulnerable subjects', 'carol'],
  [2, 1, 'ResearchEthics>ResearchMisconduct', 'Data fabrication, falsification, and inappropriate manipulation', 'Clear definition of research misconduct', 'carol'],
  [2, 1, 'ResearchEthics>ConflictOfInterest', 'Conflicts of interest, whether financial, personal, or professional', 'Broad definition of COI', 'eve'],
  // Corpus 4 (Open Science Toolkit) — Doc 10
  [3, 0, 'OpenScience>OpenAccess', 'freely accessible, removing barriers imposed by journal paywalls', 'Open access benefits via preprints', 'dave'],
];

// ──────────────────────────────────────────────────────────────
// MAIN SEED FUNCTION
// ──────────────────────────────────────────────────────────────
async function seed() {
  // Phase A: Clear with a temporary connection, then close pool for migrations
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearAll(client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.end();
  }

  // Run migrations (needs exclusive DB access)
  runMigrations();

  // Reconnect with a fresh pool
  const pool2 = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'concept_hierarchy',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  const client = await pool2.connect();
  try {
    await client.query('BEGIN');

    // ── Phase B: Users ──────────────────────────────────
    console.log('\n=== Phase B: Users ===');
    const passwordHash = await bcrypt.hash('test123', 10);
    const userNames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
    const users = {};
    const savedTabs = {};

    for (const name of userNames) {
      const res = await client.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, `${name}@test.com`, passwordHash]
      );
      users[name] = res.rows[0].id;
      // Create default saved tab
      const tabRes = await client.query(
        'INSERT INTO saved_tabs (user_id, name, display_order) VALUES ($1, $2, 0) RETURNING id',
        [users[name], 'Saved']
      );
      savedTabs[name] = tabRes.rows[0].id;
      console.log(`  Created user ${name} (id=${users[name]}, tab=${savedTabs[name]})`);
    }

    // ── Phase C: Attributes + Document Tags ─────────────
    console.log('\n=== Phase C: Attributes + Document Tags ===');
    // Migrations seed action, tool, value. We need to add question.
    await client.query(
      `INSERT INTO attributes (name, created_by) VALUES ('question', $1) ON CONFLICT (name) DO NOTHING`,
      [users.alice]
    );
    const attrRes = await client.query('SELECT id, name FROM attributes');
    const attrs = {};
    for (const row of attrRes.rows) {
      attrs[row.name] = row.id;
      console.log(`  Attribute "${row.name}" id=${row.id}`);
    }

    // Document tags — check if seeded by migrations
    const tagCheck = await client.query('SELECT COUNT(*) as cnt FROM document_tags');
    const tagNames = ['preprint', 'protocol', 'grant application', 'review article', 'dataset',
                      'thesis', 'textbook', 'lecture notes', 'commentary'];
    if (parseInt(tagCheck.rows[0].cnt) === 0) {
      for (const t of tagNames) {
        await client.query(
          'INSERT INTO document_tags (name, created_by) VALUES ($1, $2)',
          [t, users.alice]
        );
      }
      console.log('  Inserted 9 document tags');
    } else {
      console.log(`  Document tags already exist (${tagCheck.rows[0].cnt})`);
    }
    // Build tag lookup
    const tagRes = await client.query('SELECT id, name FROM document_tags');
    const tags = {};
    for (const row of tagRes.rows) tags[row.name] = row.id;

    // ── Phase D: Concepts ───────────────────────────────
    console.log('\n=== Phase D: Concepts ===');
    const concepts = {};
    async function cc(name, creator = 'alice') {
      if (concepts[name]) return concepts[name];
      const res = await client.query(
        'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING id',
        [name, users[creator]]
      );
      concepts[name] = res.rows[0].id;
      return res.rows[0].id;
    }

    // Graph 1 — Reproducibility [value] (alice, 4 levels)
    await cc('Reproducibility', 'alice');
    await cc('Methodological Transparency', 'alice');
    await cc('Protocol Sharing', 'alice');
    await cc('Open Notebooks', 'alice');
    await cc('Registered Reports', 'alice');
    await cc('Code Availability', 'alice');
    await cc('Version Control', 'alice');
    await cc('Dependency Management', 'alice');
    await cc('Statistical Rigor', 'alice');
    await cc('Power Analysis', 'alice');
    await cc('Effect Size Reporting', 'alice');
    await cc('Multiple Comparisons', 'alice');
    await cc('Bonferroni Correction', 'alice');
    await cc('Replication Studies', 'alice');
    await cc('Direct Replication', 'alice');
    await cc('Conceptual Replication', 'alice');

    // Graph 2 — Open Science [value] (bob, 3 levels)
    await cc('Open Science', 'bob');
    await cc('Open Access', 'bob');
    await cc('Preprint Servers', 'bob');
    await cc('Gold Open Access', 'bob');
    await cc('Open Data', 'bob');
    await cc('Data Repositories', 'bob');
    await cc('FAIR Principles', 'bob');
    await cc('Open Source', 'bob');
    await cc('Community Standards', 'bob');
    await cc('Citizen Science', 'bob');
    // Code Availability already created

    // Graph 3 — Peer Review [action] (carol, 3 levels)
    await cc('Peer Review', 'carol');
    await cc('Blind Review', 'carol');
    await cc('Single Blind', 'carol');
    await cc('Double Blind', 'carol');
    await cc('Open Peer Review', 'carol');
    await cc('Signed Reviews', 'carol');
    await cc('Published Reviews', 'carol');
    await cc('Post Publication Review', 'carol');
    await cc('Editorial Standards', 'carol');
    // Community Standards already created

    // Graph 4 — Research Ethics [value] (dave, 3 levels)
    await cc('Research Ethics', 'dave');
    await cc('Informed Consent', 'dave');
    await cc('Vulnerable Populations', 'dave');
    await cc('Data Privacy', 'dave');
    await cc('Conflict of Interest', 'dave');
    await cc('Funding Disclosure', 'dave');
    await cc('Research Misconduct', 'dave');
    await cc('Fabrication', 'dave');
    await cc('Plagiarism', 'dave');
    await cc('Animal Welfare', 'dave');

    // Graph 5 — Data Analysis [tool] (eve, 4 levels)
    await cc('Data Analysis', 'eve');
    await cc('Qualitative Methods', 'eve');
    await cc('Thematic Analysis', 'eve');
    await cc('Grounded Theory', 'eve');
    await cc('Quantitative Methods', 'eve');
    await cc('Regression Analysis', 'eve');
    await cc('Linear Regression', 'eve');
    await cc('Logistic Regression', 'eve');
    await cc('Bayesian Methods', 'eve');
    await cc('Machine Learning', 'eve');
    await cc('Neural Networks', 'eve');
    await cc('Random Forests', 'eve');
    await cc('Mixed Methods', 'eve');

    // Graph 6 — Scientific Communication [action] (frank, 2 levels)
    await cc('Scientific Communication', 'frank');
    await cc('Academic Writing', 'frank');
    await cc('Data Visualization', 'frank');
    await cc('Conference Presentations', 'frank');
    await cc('Public Engagement', 'frank');

    // Graph 7 — Lab Management [tool] (frank, 2 levels)
    await cc('Lab Management', 'frank');
    await cc('Mentorship', 'frank');
    await cc('Resource Allocation', 'frank');
    await cc('Safety Protocols', 'frank');

    // Graph 8 — Hypothesis Formation [question] (alice, 2 levels)
    await cc('Hypothesis Formation', 'alice');
    await cc('Falsifiability', 'alice');
    await cc('Operationalization', 'alice');
    await cc('Scope Conditions', 'alice');
    await cc('Null Hypothesis', 'alice');
    // Long name concept for testing 255-char limit
    await cc('How does institutional review board design influence reproducibility?', 'alice');

    // Graph 9 — Ethical Dilemmas [question] (carol, 2 levels)
    await cc('Ethical Dilemmas', 'carol');
    await cc('Dual Use Research', 'carol');
    await cc('Consent Ambiguity', 'carol');
    await cc('Resource Prioritization', 'carol');

    console.log(`  Created ${Object.keys(concepts).length} concepts`);

    // ── Phase E: Edges ──────────────────────────────────
    console.log('\n=== Phase E: Edges ===');
    const edges = {};

    async function makeEdge(key, parentConceptName, childConceptName, graphPath, attrId, creator) {
      const parentId = parentConceptName ? concepts[parentConceptName] : null;
      const childId = concepts[childConceptName];
      const pathStr = `{${graphPath.join(',')}}`;
      const res = await client.query(
        'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [parentId, childId, pathStr, attrId, users[creator]]
      );
      edges[key] = res.rows[0].id;
      return res.rows[0].id;
    }

    const V = attrs.value, A = attrs.action, T = attrs.tool, Q = attrs.question;
    const c = concepts; // shorthand

    // Graph 1 — Reproducibility [value]
    await makeEdge('Reproducibility_root', null, 'Reproducibility', [], V, 'alice');
    await makeEdge('Reproducibility>MethTransparency', 'Reproducibility', 'Methodological Transparency', [c['Reproducibility']], V, 'alice');
    await makeEdge('Reproducibility>StatisticalRigor', 'Reproducibility', 'Statistical Rigor', [c['Reproducibility']], V, 'alice');
    await makeEdge('Reproducibility>ReplicationStudies', 'Reproducibility', 'Replication Studies', [c['Reproducibility']], V, 'alice');
    // Level 2 under MethTransparency
    const mtPath = [c['Reproducibility'], c['Methodological Transparency']];
    await makeEdge('MethTransparency>ProtocolSharing', 'Methodological Transparency', 'Protocol Sharing', mtPath, V, 'alice');
    await makeEdge('MethTransparency>OpenNotebooks', 'Methodological Transparency', 'Open Notebooks', mtPath, V, 'alice');
    await makeEdge('MethTransparency>RegisteredReports', 'Methodological Transparency', 'Registered Reports', mtPath, V, 'alice');
    await makeEdge('MethTransparency>CodeAvailability', 'Methodological Transparency', 'Code Availability', mtPath, V, 'alice');
    // Level 2 under StatisticalRigor
    const srPath = [c['Reproducibility'], c['Statistical Rigor']];
    await makeEdge('StatisticalRigor>PowerAnalysis', 'Statistical Rigor', 'Power Analysis', srPath, V, 'alice');
    await makeEdge('StatisticalRigor>EffectSizeReporting', 'Statistical Rigor', 'Effect Size Reporting', srPath, V, 'alice');
    await makeEdge('StatisticalRigor>MultipleComparisons', 'Statistical Rigor', 'Multiple Comparisons', srPath, V, 'alice');
    // Level 3 under MultipleComparisons
    const mcPath = [c['Reproducibility'], c['Statistical Rigor'], c['Multiple Comparisons']];
    await makeEdge('MultipleComparisons>BonferroniCorrection', 'Multiple Comparisons', 'Bonferroni Correction', mcPath, V, 'alice');
    // Level 2 under ReplicationStudies
    const rsPath = [c['Reproducibility'], c['Replication Studies']];
    await makeEdge('ReplicationStudies>DirectReplication', 'Replication Studies', 'Direct Replication', rsPath, V, 'alice');
    await makeEdge('ReplicationStudies>ConceptualReplication', 'Replication Studies', 'Conceptual Replication', rsPath, V, 'alice');
    // Level 3 under CodeAvailability
    const caPath = [c['Reproducibility'], c['Methodological Transparency'], c['Code Availability']];
    await makeEdge('CodeAvailability>VersionControl', 'Code Availability', 'Version Control', caPath, V, 'alice');
    await makeEdge('CodeAvailability>DependencyManagement', 'Code Availability', 'Dependency Management', caPath, V, 'alice');

    // Graph 2 — Open Science [value]
    await makeEdge('OpenScience_root', null, 'Open Science', [], V, 'bob');
    await makeEdge('OpenScience>OpenAccess', 'Open Science', 'Open Access', [c['Open Science']], V, 'bob');
    await makeEdge('OpenScience>OpenData', 'Open Science', 'Open Data', [c['Open Science']], V, 'bob');
    await makeEdge('OpenScience>OpenSource', 'Open Science', 'Open Source', [c['Open Science']], V, 'bob');
    await makeEdge('OpenScience>CitizenScience', 'Open Science', 'Citizen Science', [c['Open Science']], V, 'bob');
    // Level 2
    const oaPath = [c['Open Science'], c['Open Access']];
    await makeEdge('OpenAccess>PreprintServers', 'Open Access', 'Preprint Servers', oaPath, V, 'bob');
    await makeEdge('OpenAccess>GoldOpenAccess', 'Open Access', 'Gold Open Access', oaPath, V, 'bob');
    const odPath = [c['Open Science'], c['Open Data']];
    await makeEdge('OpenData>DataRepositories', 'Open Data', 'Data Repositories', odPath, V, 'bob');
    await makeEdge('OpenData>FAIRPrinciples', 'Open Data', 'FAIR Principles', odPath, V, 'bob');
    const osPath = [c['Open Science'], c['Open Source']];
    // Code Availability reused in Graph 2 (same value attr)
    await makeEdge('OpenSource>CodeAvailability', 'Open Source', 'Code Availability', osPath, V, 'bob');
    await makeEdge('OpenSource>CommunityStandards', 'Open Source', 'Community Standards', osPath, V, 'bob');

    // Graph 3 — Peer Review [action]
    await makeEdge('PeerReview_root', null, 'Peer Review', [], A, 'carol');
    await makeEdge('PeerReview>BlindReview', 'Peer Review', 'Blind Review', [c['Peer Review']], A, 'carol');
    await makeEdge('PeerReview>OpenPeerReview', 'Peer Review', 'Open Peer Review', [c['Peer Review']], A, 'carol');
    await makeEdge('PeerReview>PostPubReview', 'Peer Review', 'Post Publication Review', [c['Peer Review']], A, 'carol');
    await makeEdge('PeerReview>EditorialStandards', 'Peer Review', 'Editorial Standards', [c['Peer Review']], A, 'carol');
    // Community Standards reused in Graph 3 (different action attr)
    await makeEdge('PeerReview>CommunityStandards', 'Peer Review', 'Community Standards', [c['Peer Review']], A, 'carol');
    // Level 2
    const brPath = [c['Peer Review'], c['Blind Review']];
    await makeEdge('BlindReview>SingleBlind', 'Blind Review', 'Single Blind', brPath, A, 'carol');
    await makeEdge('BlindReview>DoubleBlind', 'Blind Review', 'Double Blind', brPath, A, 'carol');
    const oprPath = [c['Peer Review'], c['Open Peer Review']];
    await makeEdge('OpenPeerReview>SignedReviews', 'Open Peer Review', 'Signed Reviews', oprPath, A, 'carol');
    await makeEdge('OpenPeerReview>PublishedReviews', 'Open Peer Review', 'Published Reviews', oprPath, A, 'carol');

    // Graph 4 — Research Ethics [value]
    await makeEdge('ResearchEthics_root', null, 'Research Ethics', [], V, 'dave');
    await makeEdge('ResearchEthics>InformedConsent', 'Research Ethics', 'Informed Consent', [c['Research Ethics']], V, 'dave');
    await makeEdge('ResearchEthics>ConflictOfInterest', 'Research Ethics', 'Conflict of Interest', [c['Research Ethics']], V, 'dave');
    await makeEdge('ResearchEthics>ResearchMisconduct', 'Research Ethics', 'Research Misconduct', [c['Research Ethics']], V, 'dave');
    await makeEdge('ResearchEthics>AnimalWelfare', 'Research Ethics', 'Animal Welfare', [c['Research Ethics']], V, 'dave');
    // Level 2
    const icPath = [c['Research Ethics'], c['Informed Consent']];
    await makeEdge('InformedConsent>VulnerablePopulations', 'Informed Consent', 'Vulnerable Populations', icPath, V, 'dave');
    await makeEdge('InformedConsent>DataPrivacy', 'Informed Consent', 'Data Privacy', icPath, V, 'dave');
    const coiPath = [c['Research Ethics'], c['Conflict of Interest']];
    await makeEdge('ConflictOfInterest>FundingDisclosure', 'Conflict of Interest', 'Funding Disclosure', coiPath, V, 'dave');
    const rmPath = [c['Research Ethics'], c['Research Misconduct']];
    await makeEdge('ResearchMisconduct>Fabrication', 'Research Misconduct', 'Fabrication', rmPath, V, 'dave');
    await makeEdge('ResearchMisconduct>Plagiarism', 'Research Misconduct', 'Plagiarism', rmPath, V, 'dave');

    // Graph 5 — Data Analysis [tool]
    await makeEdge('DataAnalysis_root', null, 'Data Analysis', [], T, 'eve');
    await makeEdge('DataAnalysis>QualitativeMethods', 'Data Analysis', 'Qualitative Methods', [c['Data Analysis']], T, 'eve');
    await makeEdge('DataAnalysis>QuantitativeMethods', 'Data Analysis', 'Quantitative Methods', [c['Data Analysis']], T, 'eve');
    await makeEdge('DataAnalysis>BayesianMethods', 'Data Analysis', 'Bayesian Methods', [c['Data Analysis']], T, 'eve');
    await makeEdge('DataAnalysis>MixedMethods', 'Data Analysis', 'Mixed Methods', [c['Data Analysis']], T, 'eve');
    // Level 2
    const qlPath = [c['Data Analysis'], c['Qualitative Methods']];
    await makeEdge('QualitativeMethods>ThematicAnalysis', 'Qualitative Methods', 'Thematic Analysis', qlPath, T, 'eve');
    await makeEdge('QualitativeMethods>GroundedTheory', 'Qualitative Methods', 'Grounded Theory', qlPath, T, 'eve');
    const qnPath = [c['Data Analysis'], c['Quantitative Methods']];
    await makeEdge('QuantitativeMethods>RegressionAnalysis', 'Quantitative Methods', 'Regression Analysis', qnPath, T, 'eve');
    await makeEdge('QuantitativeMethods>MachineLearning', 'Quantitative Methods', 'Machine Learning', qnPath, T, 'eve');
    // Level 3
    const raPath = [c['Data Analysis'], c['Quantitative Methods'], c['Regression Analysis']];
    await makeEdge('RegressionAnalysis>LinearRegression', 'Regression Analysis', 'Linear Regression', raPath, T, 'eve');
    await makeEdge('RegressionAnalysis>LogisticRegression', 'Regression Analysis', 'Logistic Regression', raPath, T, 'eve');
    const mlPath = [c['Data Analysis'], c['Quantitative Methods'], c['Machine Learning']];
    await makeEdge('MachineLearning>NeuralNetworks', 'Machine Learning', 'Neural Networks', mlPath, T, 'eve');
    await makeEdge('MachineLearning>RandomForests', 'Machine Learning', 'Random Forests', mlPath, T, 'eve');

    // Graph 6 — Scientific Communication [action]
    await makeEdge('SciComm_root', null, 'Scientific Communication', [], A, 'frank');
    await makeEdge('SciComm>AcademicWriting', 'Scientific Communication', 'Academic Writing', [c['Scientific Communication']], A, 'frank');
    await makeEdge('SciComm>DataViz', 'Scientific Communication', 'Data Visualization', [c['Scientific Communication']], A, 'frank');
    await makeEdge('SciComm>ConferencePresentations', 'Scientific Communication', 'Conference Presentations', [c['Scientific Communication']], A, 'frank');
    await makeEdge('SciComm>PublicEngagement', 'Scientific Communication', 'Public Engagement', [c['Scientific Communication']], A, 'frank');

    // Graph 7 — Lab Management [tool]
    await makeEdge('LabMgmt_root', null, 'Lab Management', [], T, 'frank');
    await makeEdge('LabMgmt>Mentorship', 'Lab Management', 'Mentorship', [c['Lab Management']], T, 'frank');
    await makeEdge('LabMgmt>ResourceAllocation', 'Lab Management', 'Resource Allocation', [c['Lab Management']], T, 'frank');
    await makeEdge('LabMgmt>SafetyProtocols', 'Lab Management', 'Safety Protocols', [c['Lab Management']], T, 'frank');

    // Graph 8 — Hypothesis Formation [question]
    await makeEdge('HypFormation_root', null, 'Hypothesis Formation', [], Q, 'alice');
    await makeEdge('HypFormation>Falsifiability', 'Hypothesis Formation', 'Falsifiability', [c['Hypothesis Formation']], Q, 'alice');
    await makeEdge('HypFormation>Operationalization', 'Hypothesis Formation', 'Operationalization', [c['Hypothesis Formation']], Q, 'alice');
    await makeEdge('HypFormation>ScopeConditions', 'Hypothesis Formation', 'Scope Conditions', [c['Hypothesis Formation']], Q, 'alice');
    await makeEdge('HypFormation>NullHypothesis', 'Hypothesis Formation', 'Null Hypothesis', [c['Hypothesis Formation']], Q, 'alice');
    await makeEdge('HypFormation>IRBDesign', 'Hypothesis Formation', 'How does institutional review board design influence reproducibility?', [c['Hypothesis Formation']], Q, 'alice');

    // Graph 9 — Ethical Dilemmas [question]
    await makeEdge('EthicalDilemmas_root', null, 'Ethical Dilemmas', [], Q, 'carol');
    await makeEdge('EthicalDilemmas>DualUse', 'Ethical Dilemmas', 'Dual Use Research', [c['Ethical Dilemmas']], Q, 'carol');
    await makeEdge('EthicalDilemmas>ConsentAmbiguity', 'Ethical Dilemmas', 'Consent Ambiguity', [c['Ethical Dilemmas']], Q, 'carol');
    await makeEdge('EthicalDilemmas>ResourcePrioritization', 'Ethical Dilemmas', 'Resource Prioritization', [c['Ethical Dilemmas']], Q, 'carol');

    console.log(`  Created ${Object.keys(edges).length} edges`);

    // ── Phase F: Votes (Saves) ──────────────────────────
    console.log('\n=== Phase F: Votes ===');
    let voteCount = 0;

    async function saveVote(userName, edgeKey) {
      const userId = users[userName];
      const edgeId = edges[edgeKey];
      if (!edgeId) { console.warn(`  WARNING: edge key "${edgeKey}" not found`); return; }
      const res = await client.query(
        'INSERT INTO votes (user_id, edge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
        [userId, edgeId]
      );
      if (res.rows.length > 0) {
        const voteId = res.rows[0].id;
        // Link to user's default saved tab
        await client.query(
          'INSERT INTO vote_tab_links (vote_id, saved_tab_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [voteId, savedTabs[userName]]
        );
        // Record vote_set_change — find parent edge
        // For root edges, parent_edge_id = the root edge itself
        // For child edges, find the parent edge
        const edgeInfo = await client.query('SELECT parent_id, child_id, graph_path FROM edges WHERE id = $1', [edgeId]);
        const row = edgeInfo.rows[0];
        let parentEdgeId = edgeId; // default for roots
        if (row.parent_id) {
          // Find the parent's edge in the same graph path
          const parentPath = row.graph_path.slice(0, -1);
          const pathStr = `{${parentPath.join(',')}}`;
          const parentEdgeRes = await client.query(
            'SELECT id FROM edges WHERE child_id = $1 AND graph_path = $2',
            [row.parent_id, pathStr]
          );
          if (parentEdgeRes.rows.length > 0) {
            parentEdgeId = parentEdgeRes.rows[0].id;
          }
        }
        await client.query(
          `INSERT INTO vote_set_changes (user_id, parent_edge_id, child_edge_id, action) VALUES ($1, $2, $3, 'save')`,
          [userId, parentEdgeId, edgeId]
        );
        voteCount++;
      }
    }

    // Reproducibility root — all 3 level-1 children
    // Set A: alice, bob, carol
    for (const u of ['alice', 'bob', 'carol']) {
      await saveVote(u, 'Reproducibility_root');
      await saveVote(u, 'Reproducibility>MethTransparency');
      await saveVote(u, 'Reproducibility>StatisticalRigor');
      await saveVote(u, 'Reproducibility>ReplicationStudies');
    }
    // Set B: dave, eve — MethTransparency + ReplicationStudies
    for (const u of ['dave', 'eve']) {
      await saveVote(u, 'Reproducibility_root');
      await saveVote(u, 'Reproducibility>MethTransparency');
      await saveVote(u, 'Reproducibility>ReplicationStudies');
    }
    // Set C: frank — StatisticalRigor + ReplicationStudies
    await saveVote('frank', 'Reproducibility_root');
    await saveVote('frank', 'Reproducibility>StatisticalRigor');
    await saveVote('frank', 'Reproducibility>ReplicationStudies');

    // MethTransparency children
    // alice+bob: ProtocolSharing + CodeAvailability
    for (const u of ['alice', 'bob']) {
      await saveVote(u, 'MethTransparency>ProtocolSharing');
      await saveVote(u, 'MethTransparency>CodeAvailability');
    }
    // carol: ProtocolSharing only
    await saveVote('carol', 'MethTransparency>ProtocolSharing');
    // dave: CodeAvailability only
    await saveVote('dave', 'MethTransparency>CodeAvailability');

    // Deep saves
    await saveVote('alice', 'MethTransparency>OpenNotebooks');
    await saveVote('alice', 'MethTransparency>RegisteredReports');
    await saveVote('bob', 'CodeAvailability>VersionControl');

    // Open Science graph votes
    for (const u of ['bob', 'dave', 'eve']) {
      await saveVote(u, 'OpenScience_root');
      await saveVote(u, 'OpenScience>OpenAccess');
      await saveVote(u, 'OpenScience>OpenData');
    }
    await saveVote('bob', 'OpenScience>OpenSource');
    await saveVote('bob', 'OpenAccess>PreprintServers');
    await saveVote('dave', 'OpenData>FAIRPrinciples');
    await saveVote('eve', 'OpenScience>CitizenScience');

    // Peer Review graph votes
    for (const u of ['carol', 'alice', 'frank']) {
      await saveVote(u, 'PeerReview_root');
      await saveVote(u, 'PeerReview>BlindReview');
    }
    await saveVote('carol', 'PeerReview>OpenPeerReview');
    await saveVote('carol', 'PeerReview>PostPubReview');
    await saveVote('alice', 'PeerReview>EditorialStandards');
    await saveVote('frank', 'BlindReview>DoubleBlind');

    // Research Ethics graph votes
    for (const u of ['dave', 'carol', 'bob']) {
      await saveVote(u, 'ResearchEthics_root');
      await saveVote(u, 'ResearchEthics>InformedConsent');
    }
    await saveVote('dave', 'ResearchEthics>ConflictOfInterest');
    await saveVote('dave', 'ResearchEthics>ResearchMisconduct');
    await saveVote('carol', 'ResearchEthics>AnimalWelfare');
    await saveVote('bob', 'InformedConsent>VulnerablePopulations');

    // Data Analysis graph votes
    for (const u of ['eve', 'alice', 'bob']) {
      await saveVote(u, 'DataAnalysis_root');
      await saveVote(u, 'DataAnalysis>QuantitativeMethods');
    }
    await saveVote('eve', 'DataAnalysis>QualitativeMethods');
    await saveVote('eve', 'DataAnalysis>BayesianMethods');
    await saveVote('eve', 'DataAnalysis>MixedMethods');
    await saveVote('alice', 'QuantitativeMethods>RegressionAnalysis');
    await saveVote('bob', 'QuantitativeMethods>MachineLearning');

    // Sci Comm graph votes
    await saveVote('frank', 'SciComm_root');
    await saveVote('frank', 'SciComm>AcademicWriting');
    await saveVote('frank', 'SciComm>DataViz');
    await saveVote('alice', 'SciComm_root');
    await saveVote('alice', 'SciComm>PublicEngagement');

    // Lab Management graph votes
    await saveVote('frank', 'LabMgmt_root');
    await saveVote('frank', 'LabMgmt>Mentorship');
    await saveVote('frank', 'LabMgmt>SafetyProtocols');
    await saveVote('eve', 'LabMgmt_root');
    await saveVote('eve', 'LabMgmt>ResourceAllocation');

    // Hypothesis Formation [question]
    await saveVote('alice', 'HypFormation_root');
    await saveVote('alice', 'HypFormation>Falsifiability');
    await saveVote('alice', 'HypFormation>Operationalization');
    await saveVote('bob', 'HypFormation_root');
    await saveVote('bob', 'HypFormation>Falsifiability');
    await saveVote('bob', 'HypFormation>ScopeConditions');
    await saveVote('carol', 'HypFormation_root');
    await saveVote('carol', 'HypFormation>NullHypothesis');

    // Ethical Dilemmas [question]
    await saveVote('carol', 'EthicalDilemmas_root');
    await saveVote('carol', 'EthicalDilemmas>DualUse');
    await saveVote('carol', 'EthicalDilemmas>ConsentAmbiguity');
    await saveVote('dave', 'EthicalDilemmas_root');
    await saveVote('dave', 'EthicalDilemmas>ResourcePrioritization');
    await saveVote('eve', 'EthicalDilemmas_root');
    await saveVote('eve', 'EthicalDilemmas>ConsentAmbiguity');

    console.log(`  Created ${voteCount} votes with tab links and set changes`);

    // ── Phase G: Swap Votes ─────────────────────────────
    console.log('\n=== Phase G: Swap Votes ===');
    // eve: Statistical Rigor → Replication Studies under Reproducibility
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3)',
      [users.eve, edges['Reproducibility>StatisticalRigor'], edges['Reproducibility>ReplicationStudies']]
    );
    // frank: Fabrication → Plagiarism under Research Misconduct
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3)',
      [users.frank, edges['ResearchMisconduct>Fabrication'], edges['ResearchMisconduct>Plagiarism']]
    );
    console.log('  Created 2 swap votes');

    // ── Phase H: Link Votes (Similarity) ────────────────
    console.log('\n=== Phase H: Link Votes ===');
    // Code Availability (MethTransparency → Open Source): alice + bob
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3)',
      [users.alice, edges['MethTransparency>CodeAvailability'], edges['OpenSource>CodeAvailability']]
    );
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3)',
      [users.bob, edges['MethTransparency>CodeAvailability'], edges['OpenSource>CodeAvailability']]
    );
    console.log('  Created 2 similarity votes');

    // ── Phase I: Documents ──────────────────────────────
    console.log('\n=== Phase I: Documents ===');
    const docs = {};
    const docDefs = [
      { key: 1, title: 'Why Most Published Research Findings Are False', uploader: 'alice', format: 'plain', tag: 'review article' },
      { key: 2, title: 'The Replication Crisis in Psychology', uploader: 'alice', format: 'plain', tag: 'review article' },
      { key: 3, title: 'The Replication Crisis in Psychology v2', uploader: 'alice', format: 'plain', tag: 'review article', source: 2 },
      { key: 4, title: 'Estimating Reproducibility of Psychological Science', uploader: 'bob', format: 'markdown', tag: 'review article' },
      { key: 5, title: 'An Introduction to Power Analysis', uploader: 'bob', format: 'plain', tag: 'textbook' },
      { key: 6, title: 'Bayesian Data Analysis for the Sciences', uploader: 'dave', format: 'plain', tag: 'textbook' },
      { key: 7, title: 'The FAIR Guiding Principles', uploader: 'dave', format: 'plain', tag: 'commentary' },
      { key: 8, title: 'The Belmont Report Summary', uploader: 'carol', format: 'plain', tag: 'commentary' },
      { key: 9, title: 'Responsible Conduct of Research Guidelines', uploader: 'carol', format: 'plain', tag: 'protocol' },
      { key: 10, title: 'Preprints in Biology: The Future', uploader: 'dave', format: 'plain', tag: 'preprint' },
      { key: 11, title: 'placeholder-research-methods.pdf', uploader: 'eve', format: 'pdf', tag: 'protocol' },
      { key: 12, title: 'placeholder-lab-protocol.docx', uploader: 'eve', format: 'docx', tag: 'dataset' },
    ];

    for (const d of docDefs) {
      const body = DOC_BODIES[d.key] || `[Placeholder content for ${d.title}]`;
      const sourceId = d.source ? docs[d.source] : null;
      const versionNumber = d.source ? 2 : 1;
      const res = await client.query(
        `INSERT INTO documents (title, body, format, uploaded_by, tag_id, source_document_id, version_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [d.title, body, d.format, users[d.uploader], tags[d.tag], sourceId, versionNumber]
      );
      docs[d.key] = res.rows[0].id;
      console.log(`  Doc ${d.key}: "${d.title}" (id=${docs[d.key]})`);
    }

    // ── Phase J: Corpuses ───────────────────────────────
    console.log('\n=== Phase J: Corpuses ===');
    const corpuses = {};
    const corpusDefs = [
      { key: 'c1', name: 'Reproducibility Crisis Readings', owner: 'alice', desc: 'Key papers on the reproducibility crisis in science' },
      { key: 'c2', name: 'Methods & Statistics', owner: 'bob', desc: 'Statistical methods and analysis resources' },
      { key: 'c3', name: 'Ethics in Research', owner: 'carol', desc: 'Research ethics guidelines and discussions' },
      { key: 'c4', name: 'Open Science Toolkit', owner: 'dave', desc: 'Resources for open science practices' },
    ];
    for (const cd of corpusDefs) {
      const res = await client.query(
        'INSERT INTO corpuses (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
        [cd.name, cd.desc, users[cd.owner]]
      );
      corpuses[cd.key] = res.rows[0].id;
      console.log(`  Corpus "${cd.name}" (id=${corpuses[cd.key]})`);
    }

    // ── Phase K: Corpus-Document Links ──────────────────
    console.log('\n=== Phase K: Corpus-Document Links ===');
    const corpusDocLinks = [
      ['c1', [1, 2, 3, 4], 'alice'],
      ['c2', [5, 6, 7], 'bob'],
      ['c3', [8, 9], 'carol'],
      ['c4', [7, 10, 11, 12], 'dave'],
    ];
    let cdCount = 0;
    for (const [ck, docKeys, adder] of corpusDocLinks) {
      for (const dk of docKeys) {
        await client.query(
          'INSERT INTO corpus_documents (corpus_id, document_id, added_by) VALUES ($1, $2, $3)',
          [corpuses[ck], docs[dk], users[adder]]
        );
        cdCount++;
      }
    }
    console.log(`  Created ${cdCount} corpus-document links`);

    // ── Phase L: Corpus Members + Document Co-Authors ───
    console.log('\n=== Phase L: Corpus Members + Co-Authors ===');
    // Corpus members
    await client.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2)',
      [corpuses.c1, users.bob]
    );
    await client.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2)',
      [corpuses.c1, users.carol]
    );
    await client.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2)',
      [corpuses.c3, users.eve]
    );
    console.log('  Created 3 corpus members');

    // Document co-authors
    await client.query(
      'INSERT INTO document_authors (document_id, user_id) VALUES ($1, $2)',
      [docs[1], users.bob]
    );
    await client.query(
      'INSERT INTO document_authors (document_id, user_id) VALUES ($1, $2)',
      [docs[2], users.carol]
    );
    await client.query(
      'INSERT INTO document_authors (document_id, user_id) VALUES ($1, $2)',
      [docs[7], users.eve]
    );
    console.log('  Created 3 document co-authors');

    // ── Phase M: Corpus Subscriptions + Sidebar Items ───
    console.log('\n=== Phase M: Corpus Subscriptions + Sidebar ===');
    const subscriptions = [
      ['alice', ['c1', 'c2', 'c4']],
      ['bob', ['c1', 'c2']],
      ['carol', ['c1', 'c3']],
      ['dave', ['c2', 'c4']],
      ['eve', ['c3']],
      ['frank', ['c4']],
    ];
    let subCount = 0;
    for (const [userName, corpusKeys] of subscriptions) {
      let order = 0;
      for (const ck of corpusKeys) {
        await client.query(
          'INSERT INTO corpus_subscriptions (user_id, corpus_id) VALUES ($1, $2)',
          [users[userName], corpuses[ck]]
        );
        await client.query(
          'INSERT INTO sidebar_items (user_id, item_type, item_id, display_order) VALUES ($1, $2, $3, $4)',
          [users[userName], 'corpus', corpuses[ck], order++]
        );
        subCount++;
      }
    }
    console.log(`  Created ${subCount} subscriptions with sidebar items`);

    // ── Phase N: Annotations ────────────────────────────
    console.log('\n=== Phase N: Annotations ===');
    const corpusKeys = ['c1', 'c2', 'c3', 'c4'];
    // Map corpus index to doc keys within that corpus
    const corpusDocMap = {
      0: [1, 2, 3, 4],  // c1
      1: [5, 6, 7],      // c2
      2: [8, 9],          // c3
      3: [10],            // c4 (only doc 10 has text body)
    };

    const annotations = [];
    for (let i = 0; i < ANNOTATION_DEFS.length; i++) {
      const [corpusIdx, docIdxInCorpus, edgeKey, quoteText, comment, creator] = ANNOTATION_DEFS[i];
      const corpusId = corpuses[corpusKeys[corpusIdx]];
      const docKey = corpusDocMap[corpusIdx][docIdxInCorpus];
      const documentId = docs[docKey];
      const edgeId = edges[edgeKey];

      if (!edgeId) { console.warn(`  WARNING: edge "${edgeKey}" not found for annotation ${i}`); continue; }

      const res = await client.query(
        `INSERT INTO document_annotations (corpus_id, document_id, edge_id, quote_text, comment, quote_occurrence, created_by, layer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'public') RETURNING id`,
        [corpusId, documentId, edgeId, quoteText, comment, 1, users[creator]]
      );
      const annId = res.rows[0].id;
      annotations.push({ id: annId, creator });

      // Auto-vote by creator (Phase 26c)
      await client.query(
        'INSERT INTO annotation_votes (user_id, annotation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [users[creator], annId]
      );
    }
    console.log(`  Created ${annotations.length} annotations with auto-votes`);

    // ── Phase O: Additional Annotation Votes ────────────
    console.log('\n=== Phase O: Additional Annotation Votes ===');
    // Annotations are 1-indexed in the spec (ann 1 = index 0)
    const additionalVotes = [
      ['alice', [4, 8, 10]],   // annotations 5,9,11 → 0-indexed: 4,8,10
      ['bob', [0, 4, 14]],     // annotations 1,5,15 → 0-indexed: 0,4,14
      ['carol', [0, 1, 8]],    // annotations 1,2,9 → 0-indexed: 0,1,8
      ['dave', [12, 14, 18]],  // annotations 13,15,19 → 0-indexed: 12,14,18
      ['eve', [0, 10, 14, 15]], // annotations 1,11,15,16 → 0-indexed: 0,10,14,15
    ];
    let annVoteCount = 0;
    for (const [userName, indices] of additionalVotes) {
      for (const idx of indices) {
        if (annotations[idx]) {
          await client.query(
            'INSERT INTO annotation_votes (user_id, annotation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [users[userName], annotations[idx].id]
          );
          annVoteCount++;
        }
      }
    }
    console.log(`  Created ${annVoteCount} additional annotation votes`);

    // ── Phase P: Web Links ──────────────────────────────
    console.log('\n=== Phase P: Web Links ===');
    const webLinks = [
      { edgeKey: 'Reproducibility_root', url: 'https://example.com/reproducibility-project', title: 'Center for Open Science - Reproducibility Project', user: 'alice', comment: 'The main hub for large-scale replication efforts across disciplines' },
      { edgeKey: 'OpenScience>OpenAccess', url: 'https://example.com/open-access-guide', title: 'SPARC Open Access Guide', user: 'dave', comment: null },
      { edgeKey: 'StatisticalRigor>PowerAnalysis', url: 'https://example.com/gpower-tool', title: 'G*Power Statistical Tool', user: 'bob', comment: 'Free tool for computing statistical power — essential for study design' },
      { edgeKey: 'OpenData>FAIRPrinciples', url: 'https://example.com/go-fair', title: 'GO FAIR Initiative', user: 'dave', comment: 'Community-driven initiative for FAIR implementation' },
      { edgeKey: 'QuantitativeMethods>MachineLearning', url: 'https://example.com/ml-research', title: 'Machine Learning in Research: A Primer', user: 'eve', comment: null },
      { edgeKey: 'PeerReview_root', url: 'https://example.com/peer-review-guide', title: 'Nature: Guide to Peer Review', user: 'bob', comment: null },
    ];

    const linkIds = [];
    for (const wl of webLinks) {
      const res = await client.query(
        `INSERT INTO concept_links (edge_id, url, title, added_by, comment)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [edges[wl.edgeKey], wl.url, wl.title, users[wl.user], wl.comment]
      );
      linkIds.push(res.rows[0].id);
      // Auto-vote by creator
      await client.query(
        'INSERT INTO concept_link_votes (user_id, concept_link_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [users[wl.user], res.rows[0].id]
      );
    }

    // Simulate edited comment on first link (offset by 1 hour to ensure updated_at != created_at)
    await client.query(
      `UPDATE concept_links SET comment = $1, updated_at = created_at + INTERVAL '1 hour'
       WHERE url = 'https://example.com/reproducibility-project'`,
      ['Updated: The main hub for large-scale replication efforts — now includes registered reports']
    );

    // Additional link votes
    // alice + bob upvote each other's links
    await client.query(
      'INSERT INTO concept_link_votes (user_id, concept_link_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [users.bob, linkIds[0]]  // bob upvotes alice's reproducibility link
    );
    await client.query(
      'INSERT INTO concept_link_votes (user_id, concept_link_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [users.alice, linkIds[2]]  // alice upvotes bob's G*Power link
    );
    await client.query(
      'INSERT INTO concept_link_votes (user_id, concept_link_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [users.carol, linkIds[0]]  // carol upvotes reproducibility link
    );
    await client.query(
      'INSERT INTO concept_link_votes (user_id, concept_link_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [users.eve, linkIds[3]]  // eve upvotes GO FAIR link
    );
    console.log(`  Created ${webLinks.length} web links with votes, 1 edited`);

    // ── Phase Q: Moderation ─────────────────────────────
    console.log('\n=== Phase Q: Moderation ===');
    // eve flags "Safety Protocols" under Lab Management
    const flagEdgeId = edges['LabMgmt>SafetyProtocols'];
    await client.query(
      'INSERT INTO concept_flags (edge_id, user_id, reason) VALUES ($1, $2, $3)',
      [flagEdgeId, users.eve, 'spam']
    );
    // Hide the edge (first flag hides immediately)
    await client.query('UPDATE edges SET is_hidden = true WHERE id = $1', [flagEdgeId]);
    // frank votes show
    await client.query(
      `INSERT INTO concept_flag_votes (edge_id, user_id, vote_type) VALUES ($1, $2, 'show')`,
      [flagEdgeId, users.frank]
    );
    // alice comments
    await client.query(
      'INSERT INTO moderation_comments (edge_id, user_id, body) VALUES ($1, $2, $3)',
      [flagEdgeId, users.alice, 'This concept seems legitimate — safety protocols are important for lab management.']
    );
    console.log('  Created flag, vote, and comment on Safety Protocols');

    // ── Phase R: Dormancy ───────────────────────────────
    console.log('\n=== Phase R: Dormancy ===');
    // Create saved_page_tab_activity for all users
    for (const name of userNames) {
      const isDormant = name === 'frank';
      const lastOpened = isDormant ? "NOW() - INTERVAL '35 days'" : 'NOW()';
      // Uncategorized tab
      await client.query(
        `INSERT INTO saved_page_tab_activity (user_id, corpus_id, last_opened_at, is_dormant)
         VALUES ($1, NULL, ${lastOpened}, $2)
         ON CONFLICT DO NOTHING`,
        [users[name], isDormant]
      );
    }
    // Corpus-specific activity for subscribed users
    for (const [userName, corpusKeys] of subscriptions) {
      const isDormant = userName === 'frank';
      const lastOpened = isDormant ? "NOW() - INTERVAL '35 days'" : 'NOW()';
      for (const ck of corpusKeys) {
        await client.query(
          `INSERT INTO saved_page_tab_activity (user_id, corpus_id, last_opened_at, is_dormant)
           VALUES ($1, $2, ${lastOpened}, $3)
           ON CONFLICT DO NOTHING`,
          [users[userName], corpuses[ck], isDormant]
        );
      }
    }
    console.log('  frank marked dormant (35 days), others recent');

    // ── Phase S: Vote Set Drift ─────────────────────────
    console.log('\n=== Phase S: Vote Set Drift ===');
    // bob's departure under Data Analysis > Quantitative Methods
    // First record the original save, then the unsave
    await client.query(
      `INSERT INTO vote_set_changes (user_id, parent_edge_id, child_edge_id, action, created_at)
       VALUES ($1, $2, $3, 'unsave', NOW() - INTERVAL '2 days')`,
      [users.bob, edges['DataAnalysis>QuantitativeMethods'], edges['QuantitativeMethods>MachineLearning']]
    );
    // Actually remove the vote
    await client.query(
      'DELETE FROM vote_tab_links WHERE vote_id IN (SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2)',
      [users.bob, edges['QuantitativeMethods>MachineLearning']]
    );
    await client.query(
      'DELETE FROM votes WHERE user_id = $1 AND edge_id = $2',
      [users.bob, edges['QuantitativeMethods>MachineLearning']]
    );
    console.log("  bob's Machine Learning vote removed (drift event logged)");

    // ── Phase T: Graph Tabs ─────────────────────────────
    console.log('\n=== Phase T: Graph Tabs ===');
    // alice: tabs on Reproducibility and Hypothesis Formation
    await client.query(
      `INSERT INTO graph_tabs (user_id, tab_type, concept_id, path, view_mode, display_order, label)
       VALUES ($1, 'root', $2, '{}', 'children', 0, 'Reproducibility')`,
      [users.alice, c['Reproducibility']]
    );
    await client.query(
      `INSERT INTO graph_tabs (user_id, tab_type, concept_id, path, view_mode, display_order, label)
       VALUES ($1, 'root', $2, '{}', 'children', 1, 'Hypothesis Formation')`,
      [users.alice, c['Hypothesis Formation']]
    );
    // bob: tab on Peer Review
    await client.query(
      `INSERT INTO graph_tabs (user_id, tab_type, concept_id, path, view_mode, display_order, label)
       VALUES ($1, 'root', $2, '{}', 'children', 0, 'Peer Review')`,
      [users.bob, c['Peer Review']]
    );
    console.log('  Created 3 graph tabs');

    // ── Phase U: Document Favorites ─────────────────────
    console.log('\n=== Phase U: Document Favorites ===');
    await client.query(
      'INSERT INTO document_favorites (user_id, corpus_id, document_id) VALUES ($1, $2, $3)',
      [users.alice, corpuses.c1, docs[1]]
    );
    await client.query(
      'INSERT INTO document_favorites (user_id, corpus_id, document_id) VALUES ($1, $2, $3)',
      [users.bob, corpuses.c1, docs[4]]
    );
    await client.query(
      'INSERT INTO document_favorites (user_id, corpus_id, document_id) VALUES ($1, $2, $3)',
      [users.dave, corpuses.c2, docs[7]]
    );
    await client.query(
      'INSERT INTO document_favorites (user_id, corpus_id, document_id) VALUES ($1, $2, $3)',
      [users.dave, corpuses.c4, docs[7]]
    );
    console.log('  Created 4 document favorites');

    await client.query('COMMIT');

    // ── Verification ────────────────────────────────────
    console.log('\n=== Verification ===');
    const checks = [
      ['users', 'SELECT COUNT(*) FROM users', 6],
      ['concepts', 'SELECT COUNT(*) FROM concepts', null],
      ['root edges', "SELECT COUNT(*) FROM edges WHERE parent_id IS NULL", 9],
      ['attributes', 'SELECT COUNT(*) FROM attributes', 4],
      ['distinct root attrs', 'SELECT COUNT(DISTINCT attribute_id) FROM edges WHERE parent_id IS NULL', 4],
      ['votes', 'SELECT COUNT(*) FROM votes', null],
      ['corpuses', 'SELECT COUNT(*) FROM corpuses', 4],
      ['documents', 'SELECT COUNT(*) FROM documents', 12],
      ['annotations', 'SELECT COUNT(*) FROM document_annotations', 20],
      ['annotation_votes', 'SELECT COUNT(*) FROM annotation_votes', null],
      ['concept_links', 'SELECT COUNT(*) FROM concept_links', 6],
      ['links with comments', 'SELECT COUNT(*) FROM concept_links WHERE comment IS NOT NULL', null],
      ['edited links', "SELECT COUNT(*) FROM concept_links WHERE updated_at != created_at", 1],
      ['hidden edges', 'SELECT COUNT(*) FROM edges WHERE is_hidden = true', 1],
      ['corpus_allowed_users', 'SELECT COUNT(*) FROM corpus_allowed_users', 3],
      ['document_authors', 'SELECT COUNT(*) FROM document_authors', 3],
      ['document_tags', 'SELECT COUNT(*) FROM document_tags', 9],
      ['child_rankings', 'SELECT COUNT(*) FROM child_rankings', 0],
    ];

    for (const [label, query, expected] of checks) {
      const res = await client.query(query);
      const actual = parseInt(res.rows[0].count);
      const status = expected === null ? '' : (actual === expected ? ' OK' : ` EXPECTED ${expected}`);
      console.log(`  ${label}: ${actual}${status}`);
    }

    // Concept reuse checks
    const codeAvailEdges = await client.query(
      'SELECT COUNT(*) FROM edges WHERE child_id = $1', [c['Code Availability']]
    );
    console.log(`  Code Availability in ${codeAvailEdges.rows[0].count} edges (expect 2+)`);
    const commStdEdges = await client.query(
      'SELECT e.id, a.name as attr FROM edges e JOIN attributes a ON e.attribute_id = a.id WHERE e.child_id = $1',
      [c['Community Standards']]
    );
    console.log(`  Community Standards in ${commStdEdges.rows.length} edges: ${commStdEdges.rows.map(r => r.attr).join(', ')}`);

    console.log('\n=== Seed complete! ===\n');
    console.log('Users: alice, bob, carol, dave, eve, frank (password: test123)');
    console.log('frank is dormant (35 days inactive)');
    console.log('');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nSeed FAILED:', err);
    throw err;
  } finally {
    client.release();
    await pool2.end();
  }
}

// ──────────────────────────────────────────────────────────────
// CLEANUP
// ──────────────────────────────────────────────────────────────
async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await clearAll(client);
    await client.query('COMMIT');
    console.log('\nRunning migrations...');
    runMigrations();
    console.log('\nCleanup complete — database is empty with fresh schema.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup FAILED:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ──────────────────────────────────────────────────────────────
// ENTRY POINT
// ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--cleanup')) {
  cleanup();
} else {
  seed();
}
