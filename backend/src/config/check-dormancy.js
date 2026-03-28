/**
 * check-dormancy.js — Phase 8 Background Job
 * 
 * Checks all saved_page_tab_activity rows and marks tabs as dormant
 * when last_opened_at is older than the dormancy threshold (30 days).
 * 
 * This script is meant to be run periodically (e.g., daily via cron, 
 * Task Scheduler, or manually). It does NOT run as part of the main
 * Express server.
 * 
 * Usage:
 *   cd backend
 *   node src/config/check-dormancy.js
 * 
 * To set up automatic daily runs:
 * 
 *   WINDOWS (Task Scheduler):
 *     1. Open Task Scheduler (search for it in Start menu)
 *     2. Click "Create Basic Task"
 *     3. Name it "ORCA Dormancy Check"
 *     4. Trigger: Daily, pick a time (e.g., 3:00 AM)
 *     5. Action: Start a program
 *        Program: node
 *        Arguments: src/config/check-dormancy.js
 *        Start in: C:\path\to\your\orca\backend
 *     6. Finish
 *
 *   LINUX/MAC (cron):
 *     Run: crontab -e
 *     Add this line (runs daily at 3 AM):
 *     0 3 * * * cd /path/to/orca/backend && node src/config/check-dormancy.js
 */

require('dotenv').config();
const pool = require('./database');

const DORMANCY_THRESHOLD_DAYS = 30;

const checkDormancy = async () => {
  const client = await pool.connect();

  try {
    console.log(`[Dormancy Check] Starting — threshold: ${DORMANCY_THRESHOLD_DAYS} days`);

    // Mark tabs as dormant where last_opened_at is older than the threshold
    // and they are not already dormant
    const result = await client.query(`
      UPDATE saved_page_tab_activity
      SET is_dormant = true
      WHERE is_dormant = false
        AND last_opened_at < CURRENT_TIMESTAMP - INTERVAL '${DORMANCY_THRESHOLD_DAYS} days'
      RETURNING id, user_id, corpus_id
    `);

    const newlyDormant = result.rows.length;
    console.log(`[Dormancy Check] Marked ${newlyDormant} tab(s) as dormant.`);

    if (newlyDormant > 0) {
      result.rows.forEach(row => {
        const tabLabel = row.corpus_id ? `corpus ${row.corpus_id}` : 'Uncategorized';
        console.log(`  - User ${row.user_id}, tab: ${tabLabel}`);
      });
    }

    // Also report how many tabs are currently dormant in total
    const totalResult = await client.query(`
      SELECT COUNT(*) AS total_dormant FROM saved_page_tab_activity WHERE is_dormant = true
    `);
    console.log(`[Dormancy Check] Total dormant tabs: ${totalResult.rows[0].total_dormant}`);

    console.log('[Dormancy Check] Complete.');
  } catch (error) {
    console.error('[Dormancy Check] Error:', error);
    throw error;
  } finally {
    client.release();
  }
};

checkDormancy()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Dormancy Check] Failed:', error);
    process.exit(1);
  });
