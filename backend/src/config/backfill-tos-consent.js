// ONE-TIME backfill for Phase 51a.
// Do NOT add to migrate.js (Architecture Decision #271).
// Run once with: node backend/src/config/backfill-tos-consent.js

const pool = require('./database');

async function backfill() {
  try {
    const result = await pool.query(`
      UPDATE users
      SET tos_accepted_at = created_at,
          tos_version_accepted = 'pre-launch'
      WHERE tos_accepted_at IS NULL
    `);
    console.log(`Backfilled ${result.rowCount} user(s) with tos_accepted_at = created_at, tos_version_accepted = 'pre-launch'`);
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

backfill();
