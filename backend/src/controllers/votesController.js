const pool = require('../config/database');

const votesController = {
  // Save a concept — creates votes on every edge along the full path.
  // Tab picker removed in Phase 7c Saved Page Overhaul — saves are automatically
  // grouped by corpus on the Saved Page based on annotation membership.
  addVote: async (req, res) => {
    const { edgeId, path } = req.body;

    try {
      // Validate input
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user.userId;

      // path should be an array of concept IDs from root to the current concept
      // e.g. [1, 2, 3] means Root(1) → Child(2) → Child(3)
      // For root concepts, path will be empty [] or not provided
      const conceptPath = Array.isArray(path) ? path : [];

      // Check if the target edge exists (read can use pool)
      const edgeResult = await pool.query(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );

      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }

      if (edgeResult.rows[0].is_hidden) {
        return res.status(400).json({ error: 'Cannot save a hidden concept' });
      }

      // Find all edges along the path from root to this concept
      const edgeIdsToSave = [];

      if (conceptPath.length >= 1) {
        // Step 1: Find the root edge (parent_id IS NULL, child_id = first concept in path)
        const rootEdgeResult = await pool.query(
          'SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = $2',
          [conceptPath[0], '{}']
        );
        if (rootEdgeResult.rows.length > 0) {
          edgeIdsToSave.push(rootEdgeResult.rows[0].id);
        }

        // Step 2: Find each intermediate edge along the path
        for (let i = 0; i < conceptPath.length - 1; i++) {
          const parentId = conceptPath[i];
          const childId = conceptPath[i + 1];
          const graphPath = conceptPath.slice(0, i + 1);

          const edgeResult = await pool.query(
            'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3',
            [parentId, childId, graphPath]
          );
          if (edgeResult.rows.length > 0) {
            edgeIdsToSave.push(edgeResult.rows[0].id);
          }
        }
      }

      // Step 3: Always include the target edge itself
      if (!edgeIdsToSave.includes(edgeId)) {
        edgeIdsToSave.push(edgeId);
      }

      // All writes wrapped in a transaction
      const client = await pool.connect();
      let newVotesCount = 0;
      try {
        await client.query('BEGIN');

        // Phase 20c: Mutual exclusivity — remove any swap vote for this edge before saving
        await client.query(
          'DELETE FROM replace_votes WHERE user_id = $1 AND edge_id = $2',
          [userId, edgeId]
        );

        // Insert votes for all edges the user hasn't already voted on
        for (let i = 0; i < edgeIdsToSave.length; i++) {
          const eid = edgeIdsToSave[i];
          const insertResult = await client.query(
            `INSERT INTO votes (user_id, edge_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, edge_id) DO NOTHING
             RETURNING id`,
            [userId, eid]
          );
          if (insertResult.rows.length > 0) {
            newVotesCount++;
          }
        }

        // Also create vote_tab_links for backwards compatibility with the old saved tabs
        // system (still in the DB). Link new votes to the user's first tab if it exists.
        const defaultTab = await client.query(
          'SELECT id FROM saved_tabs WHERE user_id = $1 ORDER BY display_order ASC LIMIT 1',
          [userId]
        );
        if (defaultTab.rows.length > 0) {
          const savedTabId = defaultTab.rows[0].id;
          for (const eid of edgeIdsToSave) {
            const voteRow = await client.query(
              'SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2',
              [userId, eid]
            );
            if (voteRow.rows.length > 0) {
              await client.query(
                `INSERT INTO vote_tab_links (vote_id, saved_tab_id)
                 VALUES ($1, $2)
                 ON CONFLICT (vote_id, saved_tab_id) DO NOTHING`,
                [voteRow.rows[0].id, savedTabId]
              );
            }
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      // Get updated vote count for the target edge (the one the user clicked)
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.status(201).json({
        message: 'Save applied to full path',
        savedEdgeCount: edgeIdsToSave.length,
        newVotesCreated: newVotesCount,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error saving:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Unsave a concept — removes vote on this edge AND all descendant edges
  removeVote: async (req, res) => {
    const { edgeId } = req.body;

    try {
      // Validate input
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user.userId;

      // Check if the user has a vote on this edge
      const existingVote = await pool.query(
        'SELECT * FROM votes WHERE user_id = $1 AND edge_id = $2',
        [userId, edgeId]
      );

      if (existingVote.rows.length === 0) {
        return res.status(404).json({ error: 'Vote not found' });
      }

      // Get the edge details so we can find descendants
      const edgeResult = await pool.query(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );

      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }

      const edge = edgeResult.rows[0];

      // Build the path that descendants would have as a prefix in their graph_path
      const childId = edge.child_id;
      
      let descendantPathPrefix;
      if (edge.parent_id === null) {
        // Root edge: children of this root have graph_path starting with [childId]
        descendantPathPrefix = [childId];
      } else {
        // Non-root edge: children have graph_path starting with [...graph_path, childId]
        descendantPathPrefix = [...edge.graph_path, childId];
      }

      // Find all descendant edges whose graph_path starts with our prefix
      const prefixLen = descendantPathPrefix.length;
      const descendantEdges = await pool.query(
        `SELECT e.id FROM edges e
         WHERE e.graph_path[1:$1] = $2::integer[]
         AND array_length(e.graph_path, 1) >= $1`,
        [prefixLen, descendantPathPrefix]
      );

      const descendantEdgeIds = descendantEdges.rows.map(r => r.id);

      // Collect all edge IDs to unsave: the target edge + all descendants
      const allEdgeIds = [edgeId, ...descendantEdgeIds];

      // Remove all votes for this user on these edges
      // vote_tab_links will be automatically removed via ON DELETE CASCADE on votes
      const deleteResult = await pool.query(
        'DELETE FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[]) RETURNING edge_id',
        [userId, allEdgeIds]
      );

      if (deleteResult.rows.length > 0) {
        const removedEdgeIds = deleteResult.rows.map(r => r.edge_id);

      }

      // Get updated vote count for the target edge
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: 'Unsave cascaded to descendants',
        removedVoteCount: deleteResult.rows.length,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error unsaving:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Unsave from a specific tab only — removes the vote-tab link, but keeps
  // the vote itself if it's linked to other tabs. If it's the last tab link,
  // the vote itself is also deleted (full unsave with cascade).
  removeVoteFromTab: async (req, res) => {
    const { edgeId, tabId } = req.body;

    try {
      if (!edgeId || !tabId) {
        return res.status(400).json({ error: 'edgeId and tabId are required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid tab' });
      }

      // Get the vote for this edge
      const voteResult = await pool.query(
        'SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2',
        [userId, edgeId]
      );
      if (voteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Vote not found' });
      }
      const voteId = voteResult.rows[0].id;

      // Get the edge details for descendant lookup
      const edgeResult = await pool.query('SELECT * FROM edges WHERE id = $1', [edgeId]);
      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      const edge = edgeResult.rows[0];

      // Find all descendant edges
      const childId = edge.child_id;
      let descendantPathPrefix;
      if (edge.parent_id === null) {
        descendantPathPrefix = [childId];
      } else {
        descendantPathPrefix = [...edge.graph_path, childId];
      }

      const prefixLen = descendantPathPrefix.length;
      const descendantEdges = await pool.query(
        `SELECT e.id FROM edges e
         WHERE e.graph_path[1:$1] = $2::integer[]
         AND array_length(e.graph_path, 1) >= $1`,
        [prefixLen, descendantPathPrefix]
      );
      const descendantEdgeIds = descendantEdges.rows.map(r => r.id);
      const allEdgeIds = [edgeId, ...descendantEdgeIds];

      // Get all vote IDs for these edges
      const votesResult = await pool.query(
        'SELECT id, edge_id FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[])',
        [userId, allEdgeIds]
      );

      let removedLinkCount = 0;
      let removedVoteCount = 0;

      for (const voteRow of votesResult.rows) {
        // Remove the tab link
        const delLink = await pool.query(
          'DELETE FROM vote_tab_links WHERE vote_id = $1 AND saved_tab_id = $2 RETURNING id',
          [voteRow.id, tabId]
        );
        if (delLink.rows.length > 0) removedLinkCount++;

        // Check if the vote still has any tab links remaining
        const remainingLinks = await pool.query(
          'SELECT COUNT(*) as cnt FROM vote_tab_links WHERE vote_id = $1',
          [voteRow.id]
        );

        if (parseInt(remainingLinks.rows[0].cnt) === 0) {
          // No more tab links — delete the vote entirely
          await pool.query('DELETE FROM votes WHERE id = $1', [voteRow.id]);
          removedVoteCount++;
        }
      }

      // Get updated vote count for the target edge
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: 'Removed from tab (cascaded to descendants)',
        removedLinkCount,
        removedVoteCount,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error removing vote from tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all edges the current user has saved for a specific tab (or all tabs)
  // Returns edges with full path info, concept names, attributes, move/swap counts
  getUserSaves: async (req, res) => {
    try {
      const userId = req.user.userId;
      const tabId = req.query.tabId || null;

      let query;
      let params;

      if (tabId) {
        // Filter to a specific tab via vote_tab_links
        query = `
          SELECT 
            e.id AS edge_id,
            e.parent_id,
            e.child_id,
            e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name,
            a.id AS attribute_id,
            a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM votes v
          JOIN vote_tab_links vtl ON vtl.vote_id = v.id AND vtl.saved_tab_id = $2
          JOIN edges e ON v.edge_id = e.id
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE v.user_id = $1
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name
          ORDER BY e.graph_path, c.name`;
        params = [userId, tabId];
      } else {
        // No tab filter — return all saves (backwards compatible)
        query = `
          SELECT 
            e.id AS edge_id,
            e.parent_id,
            e.child_id,
            e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name,
            a.id AS attribute_id,
            a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM votes v
          JOIN edges e ON v.edge_id = e.id
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE v.user_id = $1
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name
          ORDER BY e.graph_path, c.name`;
        params = [userId];
      }

      const result = await pool.query(query, params);

      // Collect all unique concept IDs we need names for (parents in paths)
      const conceptIds = new Set();
      result.rows.forEach(row => {
        if (row.graph_path) {
          row.graph_path.forEach(id => conceptIds.add(id));
        }
        if (row.parent_id) conceptIds.add(row.parent_id);
        conceptIds.add(row.child_id);
      });

      // Fetch all concept names in one query
      let conceptNames = {};
      if (conceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(conceptIds)]
        );
        namesResult.rows.forEach(row => {
          conceptNames[row.id] = row.name;
        });
      }

      // Build the edges array with all info the frontend needs
      const edges = result.rows.map(row => ({
        edgeId: row.edge_id,
        parentId: row.parent_id,
        childId: row.child_id,
        childName: row.child_name,
        graphPath: row.graph_path || [],
        attributeId: row.attribute_id,
        attributeName: row.attribute_name,
        voteCount: parseInt(row.vote_count),
        swapCount: parseInt(row.swap_count),
        edgeCreatedAt: row.edge_created_at,
      }));

      res.json({ edges, conceptNames });
    } catch (error) {
      console.error('Error fetching user saves:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Graph Votes Page — Flat list with corpus badges (Phase 38d)
  // ============================================================

  // Get all user's saves as a flat list with corpus badge metadata.
  // For each concept the user has voted on, finds which subscribed corpuses
  // have annotations referencing that concept (for badge display).
  // Returns: { saves: [...], conceptNames: {...}, conceptCorpusBadges: {...} }
  getUserSavesByCorpus: async (req, res) => {
    try {
      const userId = req.user.userId;

      // Step 1: Get ALL of the user's saved edges (no grouping)
      const savesResult = await pool.query(`
        SELECT
          e.id AS edge_id,
          e.parent_id,
          e.child_id,
          e.graph_path,
          e.created_at AS edge_created_at,
          c.name AS child_name,
          a.id AS attribute_id,
          a.name AS attribute_name,
          COUNT(DISTINCT all_v.user_id) AS vote_count,
          (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
        FROM votes v
        JOIN edges e ON v.edge_id = e.id
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN votes all_v ON all_v.edge_id = e.id
        WHERE v.user_id = $1
        GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                 c.name, a.id, a.name
        ORDER BY e.graph_path, c.name
      `, [userId]);

      const allEdges = savesResult.rows.map(row => ({
        edgeId: row.edge_id,
        parentId: row.parent_id,
        childId: row.child_id,
        childName: row.child_name,
        graphPath: row.graph_path || [],
        attributeId: row.attribute_id,
        attributeName: row.attribute_name,
        voteCount: parseInt(row.vote_count),
        swapCount: parseInt(row.swap_count),
        edgeCreatedAt: row.edge_created_at,
      }));

      if (allEdges.length === 0) {
        return res.json({ saves: [], conceptNames: {}, conceptCorpusBadges: {} });
      }

      // Step 2: For each concept the user has voted on, find which subscribed
      // corpuses have annotations referencing that concept (via any edge).
      // This provides corpus badge data for the flat Graph Votes page.
      const childIds = [...new Set(allEdges.map(e => e.childId))];

      const badgeResult = await pool.query(`
        SELECT DISTINCT e.child_id AS concept_id, cor.id AS corpus_id, cor.name AS corpus_name
        FROM edges e
        JOIN document_annotations da ON da.edge_id = e.id
        JOIN corpus_subscriptions cs ON cs.corpus_id = da.corpus_id AND cs.user_id = $1
        JOIN corpuses cor ON cor.id = da.corpus_id
        WHERE e.child_id = ANY($2::integer[])
      `, [userId, childIds]);

      // Build conceptCorpusBadges lookup: conceptId -> [{corpusId, corpusName}]
      const conceptCorpusBadges = {};
      badgeResult.rows.forEach(row => {
        const cid = row.concept_id;
        if (!conceptCorpusBadges[cid]) conceptCorpusBadges[cid] = [];
        conceptCorpusBadges[cid].push({
          corpusId: row.corpus_id,
          corpusName: row.corpus_name,
        });
      });

      // Step 3: Collect concept names for path display
      const conceptIds = new Set();
      allEdges.forEach(edge => {
        if (edge.graphPath) edge.graphPath.forEach(id => conceptIds.add(id));
        if (edge.parentId) conceptIds.add(edge.parentId);
        conceptIds.add(edge.childId);
      });

      let conceptNames = {};
      if (conceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(conceptIds)]
        );
        namesResult.rows.forEach(row => { conceptNames[row.id] = row.name; });
      }

      res.json({ saves: allEdges, conceptNames, conceptCorpusBadges });
    } catch (error) {
      console.error('Error fetching saves by corpus:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get tree order for corpus-based Saved Page tab (v2)
  getTreeOrderV2: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { corpusId } = req.query; // null/undefined = uncategorized

      let result;
      if (corpusId) {
        result = await pool.query(
          `SELECT root_concept_id, display_order FROM saved_tree_order_v2
           WHERE user_id = $1 AND corpus_id = $2
           ORDER BY display_order ASC`,
          [userId, corpusId]
        );
      } else {
        result = await pool.query(
          `SELECT root_concept_id, display_order FROM saved_tree_order_v2
           WHERE user_id = $1 AND corpus_id IS NULL
           ORDER BY display_order ASC`,
          [userId]
        );
      }

      res.json({ treeOrder: result.rows });
    } catch (error) {
      console.error('Error fetching tree order v2:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update tree order for corpus-based Saved Page tab (v2)
  updateTreeOrderV2: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { corpusId, order } = req.body; // corpusId: number|null, order: [{rootConceptId, displayOrder}]

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      for (const item of order) {
        if (corpusId) {
          await pool.query(
            `INSERT INTO saved_tree_order_v2 (user_id, corpus_id, root_concept_id, display_order, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, corpus_id, root_concept_id)
             WHERE corpus_id IS NOT NULL
             DO UPDATE SET display_order = $4, updated_at = CURRENT_TIMESTAMP`,
            [userId, corpusId, item.rootConceptId, item.displayOrder]
          );
        } else {
          await pool.query(
            `INSERT INTO saved_tree_order_v2 (user_id, corpus_id, root_concept_id, display_order, updated_at)
             VALUES ($1, NULL, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id, root_concept_id)
             WHERE corpus_id IS NULL
             DO UPDATE SET display_order = $3, updated_at = CURRENT_TIMESTAMP`,
            [userId, item.rootConceptId, item.displayOrder]
          );
        }
      }

      res.json({ message: 'Tree order updated' });
    } catch (error) {
      console.error('Error updating tree order v2:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Saved Tabs CRUD
  // ============================================================

  // Get all saved tabs for the current user
  getUserTabs: async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        'SELECT id, name, display_order, group_id, created_at FROM saved_tabs WHERE user_id = $1 ORDER BY display_order ASC, created_at ASC',
        [userId]
      );

      res.json({ tabs: result.rows });
    } catch (error) {
      console.error('Error fetching user tabs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new saved tab
  createTab: async (req, res) => {
    const { name } = req.body;

    try {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tab name is required' });
      }

      const userId = req.user.userId;
      const trimmedName = name.trim();

      if (trimmedName.length > 255) {
        return res.status(400).json({ error: 'Tab name must be 255 characters or fewer' });
      }

      // Get the next display order
      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM saved_tabs WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        'INSERT INTO saved_tabs (user_id, name, display_order) VALUES ($1, $2, $3) RETURNING id, name, display_order, created_at',
        [userId, trimmedName, nextOrder]
      );

      res.status(201).json({ tab: result.rows[0] });
    } catch (error) {
      console.error('Error creating tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Rename a saved tab
  renameTab: async (req, res) => {
    const { tabId, name } = req.body;

    try {
      if (!tabId || !name || !name.trim()) {
        return res.status(400).json({ error: 'Tab ID and name are required' });
      }

      const userId = req.user.userId;
      const trimmedName = name.trim();

      if (trimmedName.length > 255) {
        return res.status(400).json({ error: 'Tab name must be 255 characters or fewer' });
      }

      const result = await pool.query(
        'UPDATE saved_tabs SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, display_order, created_at',
        [trimmedName, tabId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      res.json({ tab: result.rows[0] });
    } catch (error) {
      console.error('Error renaming tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete a saved tab (only if user has more than one tab)
  deleteTab: async (req, res) => {
    const { tabId } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'Tab ID is required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      // Ensure user has more than one tab (can't delete the last tab)
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM saved_tabs WHERE user_id = $1',
        [userId]
      );
      if (parseInt(countResult.rows[0].cnt) <= 1) {
        return res.status(400).json({ error: 'Cannot delete your last tab' });
      }

      // Delete the tab — vote_tab_links cascade automatically.
      // Votes that lose their last tab link are orphaned but still count
      // as endorsements. We clean them up: delete votes with no remaining links.
      // First, find votes that are ONLY linked to this tab
      const orphanVotes = await pool.query(
        `SELECT vtl.vote_id FROM vote_tab_links vtl
         WHERE vtl.saved_tab_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM vote_tab_links other
           WHERE other.vote_id = vtl.vote_id AND other.saved_tab_id != $1
         )`,
        [tabId]
      );
      const orphanVoteIds = orphanVotes.rows.map(r => r.vote_id);

      // Delete the tab (cascades vote_tab_links)
      await pool.query('DELETE FROM saved_tabs WHERE id = $1', [tabId]);

      // Delete orphaned votes (votes that were only in this tab)
      if (orphanVoteIds.length > 0) {
        await pool.query(
          'DELETE FROM votes WHERE id = ANY($1::integer[])',
          [orphanVoteIds]
        );
      }

      res.json({
        message: 'Tab deleted',
        orphanedVotesRemoved: orphanVoteIds.length
      });
    } catch (error) {
      console.error('Error deleting tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a link vote (similarity vote) in contextual Flip View
  addLinkVote: async (req, res) => {
    const { originEdgeId, similarEdgeId } = req.body;

    try {
      if (!originEdgeId || !similarEdgeId) {
        return res.status(400).json({ error: 'originEdgeId and similarEdgeId are required' });
      }

      if (originEdgeId === similarEdgeId) {
        return res.status(400).json({ error: 'Cannot link an edge to itself' });
      }

      const userId = req.user.userId;

      // Verify both edges exist
      const edgeCheck = await pool.query(
        'SELECT id FROM edges WHERE id = ANY($1::integer[])',
        [[originEdgeId, similarEdgeId]]
      );

      if (edgeCheck.rows.length < 2) {
        return res.status(404).json({ error: 'One or both edges not found' });
      }

      // Insert link vote (ON CONFLICT = already voted, just return current count)
      const insertResult = await pool.query(
        `INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, origin_edge_id, similar_edge_id) DO NOTHING
         RETURNING id`,
        [userId, originEdgeId, similarEdgeId]
      );

      // Get updated link vote count for this similar_edge from this origin
      const countResult = await pool.query(
        'SELECT COUNT(*) as link_count FROM similarity_votes WHERE origin_edge_id = $1 AND similar_edge_id = $2',
        [originEdgeId, similarEdgeId]
      );

      res.status(201).json({
        message: insertResult.rows.length > 0 ? 'Link vote added' : 'Already linked',
        linkCount: parseInt(countResult.rows[0].link_count)
      });
    } catch (error) {
      console.error('Error adding link vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a link vote
  removeLinkVote: async (req, res) => {
    const { originEdgeId, similarEdgeId } = req.body;

    try {
      if (!originEdgeId || !similarEdgeId) {
        return res.status(400).json({ error: 'originEdgeId and similarEdgeId are required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM similarity_votes 
         WHERE user_id = $1 AND origin_edge_id = $2 AND similar_edge_id = $3
         RETURNING id`,
        [userId, originEdgeId, similarEdgeId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Link vote not found' });
      }

      // Get updated link vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) as link_count FROM similarity_votes WHERE origin_edge_id = $1 AND similar_edge_id = $2',
        [originEdgeId, similarEdgeId]
      );

      res.json({
        message: 'Link vote removed',
        linkCount: parseInt(countResult.rows[0].link_count)
      });
    } catch (error) {
      console.error('Error removing link vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all swap votes for a specific edge (for the swap modal)
  getSwapVotes: async (req, res) => {
    const { edgeId } = req.params;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user.userId;

      // Get all swap vote replacements for this edge (Phase 38b: no sibling filtering)
      const result = await pool.query(
        `SELECT
          rv.replacement_edge_id,
          e.child_id AS replacement_child_id,
          c.name AS replacement_name,
          a.id AS replacement_attribute_id,
          a.name AS replacement_attribute_name,
          e.parent_id AS replacement_parent_id,
          pc.name AS replacement_parent_name,
          e.graph_path AS replacement_graph_path,
          COUNT(rv.id) AS vote_count,
          BOOL_OR(rv.user_id = $2) AS user_voted
        FROM replace_votes rv
        JOIN edges e ON e.id = rv.replacement_edge_id
        JOIN concepts c ON c.id = e.child_id
        JOIN attributes a ON a.id = e.attribute_id
        LEFT JOIN concepts pc ON pc.id = e.parent_id
        WHERE rv.edge_id = $1
        GROUP BY rv.replacement_edge_id, e.child_id, c.name, a.id, a.name, e.parent_id, pc.name, e.graph_path
        ORDER BY vote_count DESC, c.name`,
        [edgeId, userId]
      );

      // Get total swap vote count for this edge (distinct users)
      const totalResult = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS total_swappers FROM replace_votes WHERE edge_id = $1',
        [edgeId]
      );

      res.json({
        swapVotes: result.rows.map(row => ({
          replacementEdgeId: row.replacement_edge_id,
          replacementChildId: row.replacement_child_id,
          replacementName: row.replacement_name,
          replacementAttributeId: row.replacement_attribute_id,
          replacementAttributeName: row.replacement_attribute_name,
          parentId: row.replacement_parent_id,
          parentName: row.replacement_parent_name,
          graphPath: row.replacement_graph_path,
          voteCount: parseInt(row.vote_count),
          userVoted: row.user_voted
        })),
        totalSwapVotes: parseInt(totalResult.rows[0].total_swappers)
      });
    } catch (error) {
      console.error('Error getting swap votes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a swap vote
  addSwapVote: async (req, res) => {
    const { edgeId, replacementEdgeId } = req.body;

    try {
      if (!edgeId || !replacementEdgeId) {
        return res.status(400).json({ error: 'edgeId and replacementEdgeId are required' });
      }

      if (edgeId === replacementEdgeId) {
        return res.status(400).json({ error: 'Cannot swap an edge with itself' });
      }

      const userId = req.user.userId;

      // Verify both edges exist (Phase 38b: sibling validation removed — any edge can be a swap target)
      const edgeCheck = await pool.query(
        'SELECT id FROM edges WHERE id = ANY($1::integer[])',
        [[edgeId, replacementEdgeId]]
      );

      if (edgeCheck.rows.length < 2) {
        return res.status(404).json({ error: 'One or both edges not found' });
      }

      // Phase 20c: Mutual exclusivity — remove any save vote for this edge before swapping.
      // This mirrors the cascade logic in removeVote: delete the direct vote + all descendant votes.
      const existingSaveForEdge = await pool.query(
        'SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2',
        [userId, edgeId]
      );

      if (existingSaveForEdge.rows.length > 0) {
        // Get the edge details to compute descendant path prefix
        const swapEdgeData = await pool.query('SELECT * FROM edges WHERE id = $1', [edgeId]);
        if (swapEdgeData.rows.length > 0) {
          const swapEdge = swapEdgeData.rows[0];
          const swapChildId = swapEdge.child_id;
          let descendantPathPrefix;
          if (swapEdge.parent_id === null) {
            descendantPathPrefix = [swapChildId];
          } else {
            descendantPathPrefix = [...swapEdge.graph_path, swapChildId];
          }
          const prefixLen = descendantPathPrefix.length;
          const descendantEdges = await pool.query(
            `SELECT e.id FROM edges e
             WHERE e.graph_path[1:$1] = $2::integer[]
             AND array_length(e.graph_path, 1) >= $1`,
            [prefixLen, descendantPathPrefix]
          );
          const descendantEdgeIds = descendantEdges.rows.map(r => r.id);
          const allEdgeIdsToUnsave = [edgeId, ...descendantEdgeIds];

          const deletedVotes = await pool.query(
            'DELETE FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[]) RETURNING edge_id',
            [userId, allEdgeIdsToUnsave]
          );
          if (deletedVotes.rows.length > 0) {
            const removedEdgeIds = deletedVotes.rows.map(r => r.edge_id);

          }
        }
      }

      // Insert swap vote
      const insertResult = await pool.query(
        `INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, edge_id, replacement_edge_id) DO NOTHING
         RETURNING id`,
        [userId, edgeId, replacementEdgeId]
      );

      // Get total swap vote count for this edge (distinct users)
      const totalResult = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS total_swappers FROM replace_votes WHERE edge_id = $1',
        [edgeId]
      );

      // Get vote count for this specific replacement
      const replCountResult = await pool.query(
        'SELECT COUNT(*) AS repl_count FROM replace_votes WHERE edge_id = $1 AND replacement_edge_id = $2',
        [edgeId, replacementEdgeId]
      );

      res.status(201).json({
        message: insertResult.rows.length > 0 ? 'Swap vote added' : 'Already voted for this swap',
        totalSwapVotes: parseInt(totalResult.rows[0].total_swappers),
        replacementVoteCount: parseInt(replCountResult.rows[0].repl_count)
      });
    } catch (error) {
      console.error('Error adding swap vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a swap vote
  removeSwapVote: async (req, res) => {
    const { edgeId, replacementEdgeId } = req.body;

    try {
      if (!edgeId || !replacementEdgeId) {
        return res.status(400).json({ error: 'edgeId and replacementEdgeId are required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM replace_votes 
         WHERE user_id = $1 AND edge_id = $2 AND replacement_edge_id = $3
         RETURNING id`,
        [userId, edgeId, replacementEdgeId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Swap vote not found' });
      }

      // Get updated total swap vote count
      const totalResult = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS total_swappers FROM replace_votes WHERE edge_id = $1',
        [edgeId]
      );

      // Get updated count for this specific replacement
      const replCountResult = await pool.query(
        'SELECT COUNT(*) AS repl_count FROM replace_votes WHERE edge_id = $1 AND replacement_edge_id = $2',
        [edgeId, replacementEdgeId]
      );

      res.json({
        message: 'Swap vote removed',
        totalSwapVotes: parseInt(totalResult.rows[0].total_swappers),
        replacementVoteCount: parseInt(replCountResult.rows[0].repl_count)
      });
    } catch (error) {
      console.error('Error removing swap vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Graph Tabs CRUD (Phase 5c)
  // Persistent in-app navigation tabs for exploring the graph.
  // ============================================================

  // Get all graph tabs for the current user
  getGraphTabs: async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        `SELECT id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at
         FROM graph_tabs 
         WHERE user_id = $1 
         ORDER BY display_order ASC, created_at ASC`,
        [userId]
      );

      res.json({ graphTabs: result.rows });
    } catch (error) {
      console.error('Error fetching graph tabs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new graph tab (e.g. clicking "+" or opening from Saved tree)
  createGraphTab: async (req, res) => {
    const { tabType, conceptId, path, viewMode, label } = req.body;

    try {
      const userId = req.user.userId;
      const type = tabType || 'root';
      const tabPath = Array.isArray(path) ? path : [];
      const mode = viewMode || 'children';
      const tabLabel = (label || 'Root').substring(0, 255);

      // Get next display order
      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM graph_tabs WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO graph_tabs (user_id, tab_type, concept_id, path, view_mode, display_order, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at`,
        [userId, type, conceptId || null, tabPath, mode, nextOrder, tabLabel]
      );

      const newTab = result.rows[0];

      // Add to sidebar_items (at end of list)
      await pool.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'graph_tab', $2,
                 COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 20000) + 10)
         ON CONFLICT DO NOTHING`,
        [userId, newTab.id]
      );

      res.status(201).json({ graphTab: newTab });
    } catch (error) {
      console.error('Error creating graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update a graph tab's navigation state (concept, path, viewMode, label)
  updateGraphTab: async (req, res) => {
    const { tabId, tabType, conceptId, path, viewMode, label } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'tabId is required' });
      }

      const userId = req.user.userId;

      // Build the SET clause dynamically based on what was provided
      const updates = [];
      const values = [userId, tabId];
      let paramIndex = 3;

      if (tabType !== undefined) {
        updates.push(`tab_type = $${paramIndex++}`);
        values.push(tabType);
      }
      if (conceptId !== undefined) {
        updates.push(`concept_id = $${paramIndex++}`);
        values.push(conceptId);
      }
      if (path !== undefined) {
        updates.push(`path = $${paramIndex++}`);
        values.push(Array.isArray(path) ? path : []);
      }
      if (viewMode !== undefined) {
        updates.push(`view_mode = $${paramIndex++}`);
        values.push(viewMode);
      }
      if (label !== undefined) {
        updates.push(`label = $${paramIndex++}`);
        values.push(String(label).substring(0, 255));
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');

      const result = await pool.query(
        `UPDATE graph_tabs SET ${updates.join(', ')} 
         WHERE id = $2 AND user_id = $1
         RETURNING id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Graph tab not found' });
      }

      res.json({ graphTab: result.rows[0] });
    } catch (error) {
      console.error('Error updating graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ─── Tab Groups (Phase 5d) ──────────────────────────────

  // Get all tab groups for the current user
  getTabGroups: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT id, name, display_order, is_expanded, created_at
         FROM tab_groups
         WHERE user_id = $1
         ORDER BY display_order ASC, created_at ASC`,
        [userId]
      );
      res.json({ tabGroups: result.rows });
    } catch (error) {
      console.error('Error fetching tab groups:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new tab group
  createTabGroup: async (req, res) => {
    const { name } = req.body;
    try {
      const userId = req.user.userId;
      const groupName = (name || 'Group').substring(0, 255);

      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM tab_groups WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO tab_groups (user_id, name, display_order)
         VALUES ($1, $2, $3)
         RETURNING id, name, display_order, is_expanded, created_at`,
        [userId, groupName, nextOrder]
      );

      const newGroup = result.rows[0];

      // Add to sidebar_items (at end of list)
      await pool.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'group', $2,
                 COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 10000) + 10)
         ON CONFLICT DO NOTHING`,
        [userId, newGroup.id]
      );

      res.status(201).json({ tabGroup: newGroup });
    } catch (error) {
      console.error('Error creating tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Rename a tab group
  renameTabGroup: async (req, res) => {
    const { groupId, name } = req.body;
    try {
      if (!groupId || !name?.trim()) {
        return res.status(400).json({ error: 'groupId and name are required' });
      }
      const userId = req.user.userId;
      const result = await pool.query(
        `UPDATE tab_groups SET name = $1 WHERE id = $2 AND user_id = $3
         RETURNING id, name, display_order, is_expanded, created_at`,
        [name.trim().substring(0, 255), groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }
      res.json({ tabGroup: result.rows[0] });
    } catch (error) {
      console.error('Error renaming tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete a tab group (tabs inside become ungrouped — NOT deleted)
  deleteTabGroup: async (req, res) => {
    const { groupId } = req.body;
    try {
      if (!groupId) {
        return res.status(400).json({ error: 'groupId is required' });
      }
      const userId = req.user.userId;

      // ON DELETE SET NULL on FK handles ungrouping, but let's be explicit
      await pool.query(
        'UPDATE saved_tabs SET group_id = NULL WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      await pool.query(
        'UPDATE graph_tabs SET group_id = NULL WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      // Note: corpus_subscriptions.group_id was dropped in Phase 19d — no update needed

      const result = await pool.query(
        'DELETE FROM tab_groups WHERE id = $1 AND user_id = $2 RETURNING id',
        [groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }

      // Remove from sidebar_items
      await pool.query(
        `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'group' AND item_id = $2`,
        [userId, groupId]
      );

      res.json({ message: 'Tab group deleted', ungroupedTabs: true });
    } catch (error) {
      console.error('Error deleting tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Toggle a tab group's expanded/collapsed state
  toggleTabGroup: async (req, res) => {
    const { groupId, isExpanded } = req.body;
    try {
      if (!groupId) {
        return res.status(400).json({ error: 'groupId is required' });
      }
      const userId = req.user.userId;
      const result = await pool.query(
        `UPDATE tab_groups SET is_expanded = $1 WHERE id = $2 AND user_id = $3
         RETURNING id, name, display_order, is_expanded, created_at`,
        [isExpanded !== undefined ? isExpanded : true, groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }
      res.json({ tabGroup: result.rows[0] });
    } catch (error) {
      console.error('Error toggling tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a tab (saved or graph) to a group
  addTabToGroup: async (req, res) => {
    const { tabType, tabId, groupId } = req.body;
    try {
      if (!tabType || !tabId || !groupId) {
        return res.status(400).json({ error: 'tabType, tabId, and groupId are required' });
      }
      const userId = req.user.userId;

      // Verify the group belongs to this user
      const groupCheck = await pool.query(
        'SELECT id FROM tab_groups WHERE id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (groupCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }

      if (tabType === 'corpus') {
        return res.status(400).json({ error: 'Corpus tabs cannot be added to groups' });
      }
      let table;
      let idColumn = 'id';
      if (tabType === 'saved') { table = 'saved_tabs'; }
      else if (tabType === 'combo') { table = 'combo_subscriptions'; idColumn = 'combo_id'; }
      else { table = 'graph_tabs'; }
      const whereClause = tabType === 'combo'
        ? `WHERE combo_id = $2 AND user_id = $3`
        : `WHERE id = $2 AND user_id = $3`;
      const result = await pool.query(
        `UPDATE ${table} SET group_id = $1 ${whereClause} RETURNING ${idColumn} as id, group_id`,
        [groupId, tabId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      res.json({ message: 'Tab added to group', tab: result.rows[0] });
    } catch (error) {
      console.error('Error adding tab to group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a tab from its group (make it ungrouped)
  removeTabFromGroup: async (req, res) => {
    const { tabType, tabId } = req.body;
    try {
      if (!tabType || !tabId) {
        return res.status(400).json({ error: 'tabType and tabId are required' });
      }
      const userId = req.user.userId;

      if (tabType === 'corpus') {
        return res.status(400).json({ error: 'Corpus tabs cannot be in groups' });
      }
      let table;
      let idColumn = 'id';
      if (tabType === 'saved') { table = 'saved_tabs'; }
      else if (tabType === 'combo') { table = 'combo_subscriptions'; idColumn = 'combo_id'; }
      else { table = 'graph_tabs'; }
      const whereClause = tabType === 'combo'
        ? `WHERE combo_id = $1 AND user_id = $2`
        : `WHERE id = $1 AND user_id = $2`;
      const result = await pool.query(
        `UPDATE ${table} SET group_id = NULL ${whereClause} RETURNING ${idColumn} as id, group_id`,
        [tabId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      res.json({ message: 'Tab removed from group', tab: result.rows[0] });
    } catch (error) {
      console.error('Error removing tab from group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Saved Tree Order (Phase 5e)
  // Persists the display order of root-level graph trees within
  // each Saved tab. Trees without an explicit order record fall
  // to the bottom, sorted by save count.
  // ============================================================

  // Get tree order for a specific saved tab
  getTreeOrder: async (req, res) => {
    try {
      const userId = req.user.userId;
      const tabId = req.query.tabId;

      if (!tabId) {
        return res.status(400).json({ error: 'tabId query parameter is required' });
      }

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      const result = await pool.query(
        `SELECT root_concept_id, display_order
         FROM saved_tree_order
         WHERE user_id = $1 AND saved_tab_id = $2
         ORDER BY display_order ASC`,
        [userId, tabId]
      );

      res.json({ treeOrder: result.rows });
    } catch (error) {
      console.error('Error fetching tree order:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update tree order for a specific saved tab
  // Expects { tabId, order: [{ rootConceptId, displayOrder }, ...] }
  updateTreeOrder: async (req, res) => {
    const { tabId, order } = req.body;

    try {
      if (!tabId || !Array.isArray(order)) {
        return res.status(400).json({ error: 'tabId and order array are required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      // Upsert each tree order entry
      for (const item of order) {
        if (item.rootConceptId == null || item.displayOrder == null) continue;

        await pool.query(
          `INSERT INTO saved_tree_order (user_id, saved_tab_id, root_concept_id, display_order, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, saved_tab_id, root_concept_id)
           DO UPDATE SET display_order = $4, updated_at = CURRENT_TIMESTAMP`,
          [userId, tabId, item.rootConceptId, item.displayOrder]
        );
      }

      res.json({ message: 'Tree order updated' });
    } catch (error) {
      console.error('Error updating tree order:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Child Rankings (Phase 5f)
  // Per-user numeric rankings of children when filtering to a
  // single identical vote set. Only the user's own vote set
  // can be ranked; other vote sets show aggregated read-only.
  // ============================================================

  // Get rankings for a specific parent edge + vote set key
  // Returns both the current user's rankings and the aggregated
  // rankings from all users in that vote set.
  // Child Rankings (Phase 5f) — removed in Phase 28b
  getChildRankings: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },
  updateChildRanking: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },
  removeChildRanking: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },

  // ============================================================
  // Web Links (Phase 6)
  // External URLs attached to concepts in specific contexts.
  // Simple upvote system (one vote per user per link).
  // ============================================================

  // Get all web links for an edge (with vote counts and user's vote status)
  getWebLinks: async (req, res) => {
    const { edgeId } = req.params;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      // req.user may be null for guests (optionalAuth)
      const userId = req.user ? req.user.userId : -1;

      const result = await pool.query(
        `SELECT
          cl.id,
          cl.edge_id,
          cl.url,
          cl.title,
          cl.added_by,
          u.username AS added_by_username,
          cl.created_at,
          cl.comment,
          cl.updated_at,
          COUNT(clv.id) AS vote_count,
          BOOL_OR(clv.user_id = $2) AS user_voted
        FROM concept_links cl
        LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
        LEFT JOIN users u ON u.id = cl.added_by
        WHERE cl.edge_id = $1
        GROUP BY cl.id, cl.edge_id, cl.url, cl.title, cl.added_by, u.username, cl.created_at, cl.comment, cl.updated_at
        ORDER BY COUNT(clv.id) DESC, cl.created_at DESC`,
        [edgeId, userId]
      );

      res.json({
        webLinks: result.rows.map(row => ({
          id: row.id,
          edgeId: row.edge_id,
          url: row.url,
          title: row.title,
          addedBy: row.added_by,
          addedByUsername: row.added_by_username,
          createdAt: row.created_at,
          comment: row.comment,
          updatedAt: row.updated_at,
          voteCount: parseInt(row.vote_count),
          userVoted: row.user_voted || false,
        }))
      });
    } catch (error) {
      console.error('Error fetching web links:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a new web link to an edge
  addWebLink: async (req, res) => {
    const { edgeId, url, title, comment } = req.body;

    try {
      if (!edgeId || !url) {
        return res.status(400).json({ error: 'edgeId and url are required' });
      }

      // Basic URL validation
      const trimmedUrl = url.trim();
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        return res.status(400).json({ error: 'URL must start with http:// or https://' });
      }

      if (trimmedUrl.length > 2048) {
        return res.status(400).json({ error: 'URL is too long (max 2048 characters)' });
      }

      const userId = req.user.userId;

      // Verify the edge exists and is not hidden
      const edgeCheck = await pool.query(
        'SELECT id, is_hidden FROM edges WHERE id = $1',
        [edgeId]
      );
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      if (edgeCheck.rows[0].is_hidden) {
        return res.status(400).json({ error: 'Cannot add web links to a hidden concept' });
      }

      // Check for duplicate URL on this edge
      const dupCheck = await pool.query(
        'SELECT id FROM concept_links WHERE edge_id = $1 AND url = $2',
        [edgeId, trimmedUrl]
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ error: 'This URL has already been added to this concept in this context' });
      }

      const trimmedTitle = title ? title.trim().substring(0, 255) : null;
      const trimmedComment = comment ? comment.trim() : null;

      const result = await pool.query(
        `INSERT INTO concept_links (edge_id, url, title, added_by, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, edge_id, url, title, added_by, created_at, comment, updated_at`,
        [edgeId, trimmedUrl, trimmedTitle, userId, trimmedComment]
      );

      // Auto-upvote the link by the person who added it
      await pool.query(
        `INSERT INTO concept_link_votes (user_id, concept_link_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, result.rows[0].id]
      );

      res.status(201).json({
        message: 'Web link added',
        webLink: {
          id: result.rows[0].id,
          edgeId: result.rows[0].edge_id,
          url: result.rows[0].url,
          title: result.rows[0].title,
          addedBy: result.rows[0].added_by,
          createdAt: result.rows[0].created_at,
          comment: result.rows[0].comment,
          updatedAt: result.rows[0].updated_at,
          voteCount: 1,
          userVoted: true,
        }
      });
    } catch (error) {
      console.error('Error adding web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a web link (only the user who added it can remove it)
  removeWebLink: async (req, res) => {
    const { linkId } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      // Verify the link exists and was added by this user
      const linkCheck = await pool.query(
        'SELECT id, added_by FROM concept_links WHERE id = $1',
        [linkId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Web link not found' });
      }
      if (linkCheck.rows[0].added_by !== userId) {
        return res.status(403).json({ error: 'You can only remove links you added' });
      }

      // Delete the link (concept_link_votes cascade automatically)
      await pool.query('DELETE FROM concept_links WHERE id = $1', [linkId]);

      res.json({ message: 'Web link removed' });
    } catch (error) {
      console.error('Error removing web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Upvote a web link
  upvoteWebLink: async (req, res) => {
    const { linkId } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      // Verify the link exists
      const linkCheck = await pool.query(
        'SELECT id FROM concept_links WHERE id = $1',
        [linkId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Web link not found' });
      }

      // Insert upvote (ON CONFLICT = already voted)
      const insertResult = await pool.query(
        `INSERT INTO concept_link_votes (user_id, concept_link_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, concept_link_id) DO NOTHING
         RETURNING id`,
        [userId, linkId]
      );

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) AS vote_count FROM concept_link_votes WHERE concept_link_id = $1',
        [linkId]
      );

      res.json({
        message: insertResult.rows.length > 0 ? 'Upvote added' : 'Already upvoted',
        voteCount: parseInt(countResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error upvoting web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all web links for a concept across ALL parent contexts
  // Groups links by parent edge, with parent name/path info
  getAllWebLinksForConcept: async (req, res) => {
    const { conceptId } = req.params;
    const { path: pathParam } = req.query;

    try {
      if (!conceptId) {
        return res.status(400).json({ error: 'Concept ID is required' });
      }

      const userId = req.user ? req.user.userId : -1;

      // Find all edges where this concept is the child (i.e., all parent contexts)
      // For each edge, get its web links with vote counts
      const query = `
        SELECT
          e.id AS edge_id,
          e.parent_id,
          e.graph_path,
          e.attribute_id,
          a.name AS attribute_name,
          cp.name AS parent_name,
          cl.id AS link_id,
          cl.url,
          cl.title,
          cl.added_by,
          u.username AS added_by_username,
          cl.created_at AS link_created_at,
          cl.comment,
          cl.updated_at AS link_updated_at,
          COUNT(clv.id) AS vote_count,
          BOOL_OR(clv.user_id = $2) AS user_voted
        FROM edges e
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN concepts cp ON e.parent_id = cp.id
        LEFT JOIN concept_links cl ON cl.edge_id = e.id
        LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
        LEFT JOIN users u ON u.id = cl.added_by
        WHERE e.child_id = $1
        GROUP BY e.id, e.parent_id, e.graph_path, e.attribute_id, a.name,
                 cp.name, cl.id, cl.url, cl.title, cl.added_by, u.username, cl.created_at,
                 cl.comment, cl.updated_at
        ORDER BY e.id, COUNT(clv.id) DESC, cl.created_at DESC
      `;

      const result = await pool.query(query, [conceptId, userId]);

      // Group by edge_id
      const edgeMap = {};
      const edgeOrder = [];

      for (const row of result.rows) {
        if (!edgeMap[row.edge_id]) {
          edgeMap[row.edge_id] = {
            edgeId: row.edge_id,
            parentId: row.parent_id,
            parentName: row.parent_name || '(root)',
            graphPath: row.graph_path || [],
            attributeId: row.attribute_id,
            attributeName: row.attribute_name,
            links: [],
          };
          edgeOrder.push(row.edge_id);
        }
        // Only add a link entry if there's actually a link (cl.id is not null)
        if (row.link_id) {
          edgeMap[row.edge_id].links.push({
            id: row.link_id,
            url: row.url,
            title: row.title,
            addedBy: row.added_by,
            addedByUsername: row.added_by_username,
            createdAt: row.link_created_at,
            comment: row.comment,
            updatedAt: row.link_updated_at,
            voteCount: parseInt(row.vote_count),
            userVoted: row.user_voted || false,
          });
        }
      }

      // Determine which edge is the "current context" based on the path param
      let currentEdgeId = null;
      if (pathParam) {
        const pathArray = pathParam.split(',').map(Number).filter(Boolean);
        // The current edge connects the last concept in the path to conceptId
        if (pathArray.length > 0) {
          const parentId = pathArray[pathArray.length - 1];
          // Find matching edge
          for (const eid of edgeOrder) {
            const e = edgeMap[eid];
            if (e.parentId === parentId && 
                JSON.stringify(e.graphPath) === JSON.stringify(pathArray)) {
              currentEdgeId = eid;
              break;
            }
          }
        } else {
          // Root concept: find edge with parent_id IS NULL
          for (const eid of edgeOrder) {
            const e = edgeMap[eid];
            if (e.parentId === null) {
              currentEdgeId = eid;
              break;
            }
          }
        }
      }

      // Build response: current context first, then others sorted by total link votes desc
      const groups = edgeOrder.map(eid => edgeMap[eid]);
      
      // Sort: current context first, then by total link count desc
      groups.sort((a, b) => {
        if (a.edgeId === currentEdgeId) return -1;
        if (b.edgeId === currentEdgeId) return 1;
        const aTotal = a.links.reduce((sum, l) => sum + l.voteCount, 0);
        const bTotal = b.links.reduce((sum, l) => sum + l.voteCount, 0);
        if (bTotal !== aTotal) return bTotal - aTotal;
        return b.links.length - a.links.length;
      });

      // Collect concept IDs from graph paths for name resolution
      const pathConceptIds = new Set();
      groups.forEach(g => {
        (g.graphPath || []).forEach(id => pathConceptIds.add(id));
        if (g.parentId) pathConceptIds.add(g.parentId);
      });

      let conceptNames = {};
      if (pathConceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(pathConceptIds)]
        );
        namesResult.rows.forEach(row => {
          conceptNames[row.id] = row.name;
        });
      }

      res.json({
        groups,
        currentEdgeId,
        conceptNames,
      });
    } catch (error) {
      console.error('Error fetching all web links for concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove upvote from a web link
  removeWebLinkVote: async (req, res) => {
    const { linkId } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM concept_link_votes 
         WHERE user_id = $1 AND concept_link_id = $2
         RETURNING id`,
        [userId, linkId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Upvote not found' });
      }

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) AS vote_count FROM concept_link_votes WHERE concept_link_id = $1',
        [linkId]
      );

      res.json({
        message: 'Upvote removed',
        voteCount: parseInt(countResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error removing web link upvote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update comment on a web link (creator only)
  updateConceptLinkComment: async (req, res) => {
    const { linkId } = req.params;
    const { comment } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      // Verify the link exists and was added by this user
      const linkCheck = await pool.query(
        'SELECT id, added_by, comment FROM concept_links WHERE id = $1',
        [linkId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Web link not found' });
      }
      if (linkCheck.rows[0].added_by !== userId) {
        return res.status(403).json({ error: 'You can only edit comments on links you added' });
      }

      // Normalize: empty string or null clears the comment
      const trimmedComment = (comment && comment.trim()) ? comment.trim() : null;

      // Only bump updated_at when editing an existing comment (not adding one for the first time)
      const hadComment = !!linkCheck.rows[0].comment;
      const result = await pool.query(
        `UPDATE concept_links
         SET comment = $1, updated_at = ${hadComment ? 'CURRENT_TIMESTAMP' : 'updated_at'}
         WHERE id = $2
         RETURNING id, edge_id, url, title, added_by, created_at, comment, updated_at`,
        [trimmedComment, linkId]
      );

      // Fetch username
      const userResult = await pool.query(
        'SELECT username FROM users WHERE id = $1',
        [result.rows[0].added_by]
      );

      res.json({
        message: 'Comment updated',
        webLink: {
          id: result.rows[0].id,
          edgeId: result.rows[0].edge_id,
          url: result.rows[0].url,
          title: result.rows[0].title,
          addedBy: result.rows[0].added_by,
          addedByUsername: userResult.rows[0]?.username || null,
          createdAt: result.rows[0].created_at,
          comment: result.rows[0].comment,
          updatedAt: result.rows[0].updated_at,
        }
      });
    } catch (error) {
      console.error('Error updating web link comment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Close (delete) a graph tab
  closeGraphTab: async (req, res) => {
    const { tabId } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'tabId is required' });
      }

      const userId = req.user.userId;

      const result = await pool.query(
        'DELETE FROM graph_tabs WHERE id = $1 AND user_id = $2 RETURNING id',
        [tabId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Graph tab not found' });
      }

      // Remove from sidebar_items
      await pool.query(
        `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'graph_tab' AND item_id = $2`,
        [userId, tabId]
      );

      res.json({ message: 'Graph tab closed' });
    } catch (error) {
      console.error('Error closing graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 8 (retired): Tab activity / dormancy endpoints return 410 Gone
  recordTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  getTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  reviveTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  // ============================================================
  // Phase 12c: Graph Tab Placement in Corpus Tree
  // ============================================================

  // Get all placements for the current user (loaded on mount alongside graph tabs)
  getTabPlacements: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT id, graph_tab_id, corpus_id, display_order
         FROM user_corpus_tab_placements
         WHERE user_id = $1
         ORDER BY display_order ASC`,
        [userId]
      );
      res.json({ placements: result.rows });
    } catch (error) {
      console.error('Error fetching tab placements:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Place a graph tab inside a corpus (or move it to a different corpus)
  placeTabInCorpus: async (req, res) => {
    const { graphTabId, corpusId } = req.body;
    try {
      const userId = req.user.userId;

      // Validate graph tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id, group_id FROM graph_tabs WHERE id = $1 AND user_id = $2',
        [graphTabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Graph tab not found' });
      }

      // Validate corpus exists
      const corpusCheck = await pool.query(
        'SELECT id FROM corpuses WHERE id = $1',
        [corpusId]
      );
      if (corpusCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Corpus not found' });
      }

      // Remove from flat tab group if currently in one
      if (tabCheck.rows[0].group_id) {
        await pool.query(
          'UPDATE graph_tabs SET group_id = NULL WHERE id = $1',
          [graphTabId]
        );
      }

      // Upsert placement (move to new corpus if already placed)
      await pool.query(
        `INSERT INTO user_corpus_tab_placements (user_id, graph_tab_id, corpus_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, graph_tab_id) DO UPDATE SET corpus_id = $3`,
        [userId, graphTabId, corpusId]
      );

      res.json({ message: 'Tab placed in corpus', graphTabId, corpusId });
    } catch (error) {
      console.error('Error placing tab in corpus:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a graph tab from its corpus placement (makes it ungrouped)
  removeTabFromCorpus: async (req, res) => {
    const { graphTabId } = req.body;
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        `DELETE FROM user_corpus_tab_placements
         WHERE user_id = $1 AND graph_tab_id = $2
         RETURNING id`,
        [userId, graphTabId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab placement not found' });
      }

      res.json({ message: 'Tab removed from corpus', graphTabId });
    } catch (error) {
      console.error('Error removing tab from corpus:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Phase 19b: Unified Sidebar Items
  // ============================================================

  // Get the ordered sidebar items for the current user.
  // Returns the unified list of corpus, group, and graph_tab entries
  // sorted by display_order. The frontend joins these IDs against its
  // already-loaded corpusTabs, tabGroups, and graphTabs state.
  getSidebarItems: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT id, item_type, item_id, display_order
         FROM sidebar_items
         WHERE user_id = $1
         ORDER BY display_order ASC`,
        [userId]
      );
      res.json({ items: result.rows });
    } catch (error) {
      console.error('Error getting sidebar items:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Reorder sidebar items by updating their display_order values.
  // Body: { items: [{ id, display_order }, ...] }
  reorderSidebarItems: async (req, res) => {
    const { items } = req.body;
    try {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const userId = req.user.userId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          if (!item.id || item.display_order === undefined) continue;
          await client.query(
            'UPDATE sidebar_items SET display_order = $1 WHERE id = $2 AND user_id = $3',
            [item.display_order, item.id, userId]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ message: 'Sidebar reordered' });
    } catch (error) {
      console.error('Error reordering sidebar items:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 23b (retired): Vote set drift returns 410 Gone
  getVoteSetDrift: async (req, res) => {
    res.status(410).json({ error: 'Vote set drift has been retired' });
  },
};

module.exports = votesController;
