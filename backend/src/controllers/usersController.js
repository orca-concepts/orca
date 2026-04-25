const pool = require('../config/database');
const { PRIVACY_CONTACT_EMAIL } = require('../config/constants');

const ORCID_PATTERN = /^\d{4}(-\d{4}){0,2}(-\d{3}[\dX])?$/;

const usersController = {
  // GET /api/users/search?q=... — search by username or ORCID
  searchUsers: async (req, res) => {
    try {
      const query = (req.query.q || '').trim();
      const userId = req.user.userId;

      if (query.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
      }

      let result;
      if (ORCID_PATTERN.test(query)) {
        // ORCID search — exact or prefix match
        if (query.length === 19) {
          result = await pool.query(
            'SELECT id, username, orcid_id FROM users WHERE orcid_id = $1 AND id != $2 LIMIT 10',
            [query, userId]
          );
        } else {
          result = await pool.query(
            'SELECT id, username, orcid_id FROM users WHERE orcid_id LIKE $1 AND id != $2 LIMIT 10',
            [query + '%', userId]
          );
        }
      } else {
        result = await pool.query(
          'SELECT id, username, orcid_id FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 10',
          [query + '%', userId]
        );
      }

      res.json({
        users: result.rows.map(r => ({
          id: r.id,
          username: r.username,
          orcidId: r.orcid_id || null,
        })),
      });
    } catch (error) {
      console.error('Search users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // GET /api/users/:id/profile — public profile data
  getUserProfile: async (req, res) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }

      const userResult = await pool.query(
        'SELECT id, username, orcid_id, created_at FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResult.rows[0];

      // Get counts in parallel
      const [corpusResult, documentResult] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM corpuses WHERE created_by = $1', [userId]),
        pool.query('SELECT COUNT(*) FROM documents WHERE uploaded_by = $1', [userId]),
      ]);

      res.json({
        id: user.id,
        username: user.username,
        orcidId: user.orcid_id || null,
        createdAt: user.created_at,
        corpusCount: Number(corpusResult.rows[0].count),
        documentCount: Number(documentResult.rows[0].count),
      });
    } catch (error) {
      console.error('Get user profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // GET /api/users/me/export — self-service data export (Phase 52a)
  // Colorado Privacy Act: max 2 exports per rolling 12-month period
  exportMyData: async (req, res) => {
    try {
      const userId = req.user.userId;

      // Rate limit check — 2 per rolling 12 months
      const rateLimitResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM data_export_requests
         WHERE user_id = $1 AND requested_at > NOW() - INTERVAL '1 year'`,
        [userId]
      );
      const exportsUsed = rateLimitResult.rows[0].count;
      if (exportsUsed >= 2) {
        return res.status(429).json({
          error: `You have reached the maximum of 2 data exports per 12-month period under the Colorado Privacy Act. Please contact ${PRIVACY_CONTACT_EMAIL} if you need additional access.`,
          exports_used: exportsUsed,
          limit: 2,
        });
      }

      // Fetch account info (never include password_hash, phone_hash, phone_lookup)
      const accountResult = await pool.query(
        `SELECT username, email, created_at, age_verified_at, tos_accepted_at, tos_version_accepted, orcid_id
         FROM users WHERE id = $1`,
        [userId]
      );
      if (accountResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const acct = accountResult.rows[0];

      // Run all data queries in parallel with .catch fallbacks
      const [
        annotations, webLinks, pageComments, moderationComments,
        documentsUploaded, corpusesOwned, superconcepts, coauthorships,
        graphVotes, swapVotes, linkVotes, annotationVotes,
        webLinkVotes, flagVotes, tunnelVotes, pageCommentVotes,
        comboSubs, corpusSubs, savedTabs, graphTabs,
      ] = await Promise.all([
        // Annotations created by user
        pool.query(
          `SELECT da.id, da.document_id, d.title AS document_title, d.version_number AS document_version_number,
                  array_agg(DISTINCT cor.name) FILTER (WHERE cor.id IS NOT NULL) AS corpus_names,
                  e.child_id AS concept_id, c.name AS concept_name, e.graph_path AS edge_graph_path,
                  da.quote_text, da.comment, da.created_at
           FROM document_annotations da
           LEFT JOIN documents d ON d.id = da.document_id
           LEFT JOIN edges e ON e.id = da.edge_id
           LEFT JOIN concepts c ON c.id = e.child_id
           LEFT JOIN corpus_documents cd ON cd.document_id = da.document_id
           LEFT JOIN corpuses cor ON cor.id = da.corpus_id
           WHERE da.created_by = $1
           GROUP BY da.id, d.title, d.version_number, e.child_id, c.name, e.graph_path`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: annotations failed:', e.message); return []; }),

        // Web links added by user
        pool.query(
          `SELECT cl.id, e.child_id AS concept_id, c.name AS concept_name, cl.url, cl.created_at
           FROM concept_links cl
           LEFT JOIN edges e ON e.id = cl.edge_id
           LEFT JOIN concepts c ON c.id = e.child_id
           WHERE cl.added_by = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: web_links failed:', e.message); return []; }),

        // Page comments
        pool.query(
          `SELECT id, page_slug, body, parent_comment_id, created_at
           FROM page_comments WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: page_comments failed:', e.message); return []; }),

        // Moderation comments
        pool.query(
          `SELECT id, edge_id AS target_id, 'edge' AS target_type, body, created_at
           FROM moderation_comments WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: moderation_comments failed:', e.message); return []; }),

        // Documents uploaded
        pool.query(
          `SELECT d.id, d.title,
                  array_agg(DISTINCT cor.name) FILTER (WHERE cor.id IS NOT NULL) AS corpus_names,
                  d.version_number, d.source_document_id AS lineage_id, d.created_at, d.copyright_confirmed_at
           FROM documents d
           LEFT JOIN corpus_documents cd ON cd.document_id = d.id
           LEFT JOIN corpuses cor ON cor.id = cd.corpus_id
           WHERE d.uploaded_by = $1
           GROUP BY d.id`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: documents failed:', e.message); return []; }),

        // Corpuses owned
        pool.query(
          `SELECT co.id, co.name, co.created_at,
                  (SELECT COUNT(*)::int FROM corpus_allowed_users cau WHERE cau.corpus_id = co.id) + 1 AS member_count
           FROM corpuses co WHERE co.created_by = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: corpuses failed:', e.message); return []; }),

        // Superconcepts (combos) owned
        pool.query(
          `SELECT cb.id, cb.name, cb.created_at,
                  (SELECT COUNT(*)::int FROM combo_subscriptions cs WHERE cs.combo_id = cb.id) AS subscriber_count
           FROM combos cb WHERE cb.created_by = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: superconcepts failed:', e.message); return []; }),

        // Document coauthorships
        pool.query(
          `SELECT da.document_id, d.title AS document_title, 'coauthor' AS role
           FROM document_authors da
           LEFT JOIN documents d ON d.id = da.document_id
           WHERE da.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: coauthorships failed:', e.message); return []; }),

        // Graph votes (saves)
        pool.query(
          `SELECT v.edge_id, e.graph_path AS edge_graph_path, c.name AS edge_concept_name, v.created_at
           FROM votes v
           LEFT JOIN edges e ON e.id = v.edge_id
           LEFT JOIN concepts c ON c.id = e.child_id
           WHERE v.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: graph_votes failed:', e.message); return []; }),

        // Swap votes
        pool.query(
          `SELECT edge_id, replacement_edge_id, created_at
           FROM replace_votes WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: swap_votes failed:', e.message); return []; }),

        // Link votes (similarity votes)
        pool.query(
          `SELECT sv.id, sv.origin_edge_id, sv.similar_edge_id, sv.created_at
           FROM similarity_votes sv WHERE sv.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: link_votes failed:', e.message); return []; }),

        // Annotation votes
        pool.query(
          `SELECT annotation_id, created_at
           FROM annotation_votes WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: annotation_votes failed:', e.message); return []; }),

        // Web link votes
        pool.query(
          `SELECT concept_link_id, created_at
           FROM concept_link_votes WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: web_link_votes failed:', e.message); return []; }),

        // Flag votes (concept_flags)
        pool.query(
          `SELECT id AS flag_id, edge_id AS target_id, 'edge' AS target_type, created_at
           FROM concept_flags WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: flag_votes failed:', e.message); return []; }),

        // Tunnel votes
        pool.query(
          `SELECT tv.tunnel_link_id, tl.origin_edge_id AS source_edge_id, tl.linked_edge_id AS target_edge_id, tv.created_at
           FROM tunnel_votes tv
           LEFT JOIN tunnel_links tl ON tl.id = tv.tunnel_link_id
           WHERE tv.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: tunnel_votes failed:', e.message); return []; }),

        // Page comment votes
        pool.query(
          `SELECT comment_id, created_at
           FROM page_comment_votes WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: page_comment_votes failed:', e.message); return []; }),

        // Combo subscriptions
        pool.query(
          `SELECT cs.combo_id, cb.name AS combo_name, cs.created_at
           FROM combo_subscriptions cs
           LEFT JOIN combos cb ON cb.id = cs.combo_id
           WHERE cs.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: combo_subs failed:', e.message); return []; }),

        // Corpus subscriptions
        pool.query(
          `SELECT cs.corpus_id, cor.name AS corpus_name, cs.created_at
           FROM corpus_subscriptions cs
           LEFT JOIN corpuses cor ON cor.id = cs.corpus_id
           WHERE cs.user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: corpus_subs failed:', e.message); return []; }),

        // Saved tabs
        pool.query(
          `SELECT id, name, 'saved_tab' AS type, created_at
           FROM saved_tabs WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: saved_tabs failed:', e.message); return []; }),

        // Graph tabs
        pool.query(
          `SELECT id, label AS name, 'graph_tab' AS type, created_at
           FROM graph_tabs WHERE user_id = $1`,
          [userId]
        ).then(r => r.rows).catch(e => { console.error('export: graph_tabs failed:', e.message); return []; }),
      ]);

      // Record the export request (after successful data collection)
      await pool.query(
        'INSERT INTO data_export_requests (user_id) VALUES ($1)',
        [userId]
      );

      const exportObj = {
        exported_at: new Date().toISOString(),
        export_version: '1.0',
        account: {
          username: acct.username,
          email: acct.email,
          created_at: acct.created_at,
          age_verified_at: acct.age_verified_at,
          tos_accepted_at: acct.tos_accepted_at,
          tos_version_accepted: acct.tos_version_accepted,
          orcid_id: acct.orcid_id || null,
        },
        contributions: {
          annotations,
          web_links: webLinks,
          page_comments: pageComments,
          moderation_comments: moderationComments,
          documents_uploaded: documentsUploaded,
          corpuses_owned: corpusesOwned,
          superconcepts_owned: superconcepts,
          document_coauthorships: coauthorships,
        },
        votes_and_subscriptions: {
          graph_votes: graphVotes,
          swap_votes: swapVotes,
          link_votes: linkVotes,
          annotation_votes: annotationVotes,
          web_link_votes: webLinkVotes,
          flag_votes: flagVotes,
          tunnel_votes: tunnelVotes,
          page_comment_votes: pageCommentVotes,
          combo_subscriptions: comboSubs,
          corpus_subscriptions: corpusSubs,
          saved_tabs_and_graph_tabs: [...savedTabs, ...graphTabs],
        },
      };

      const isoDate = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="orca-export-${acct.username}-${isoDate}.json"`);
      res.send(JSON.stringify(exportObj, null, 2));
    } catch (error) {
      console.error('Export my data error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = usersController;
