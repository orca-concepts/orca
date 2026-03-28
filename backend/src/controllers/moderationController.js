const pool = require('../config/database');

const moderationController = {
  // Flag an edge as spam/vandalism — hides it once 10 or more distinct flags
  flagEdge: async (req, res) => {
    const { edgeId, reason } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const validReasons = ['spam', 'vandalism', 'offensive'];
      const flagReason = validReasons.includes(reason) ? reason : 'spam';

      // Verify edge exists
      const edgeCheck = await pool.query('SELECT id FROM edges WHERE id = $1', [edgeId]);
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }

      // Check if user already flagged this edge
      const existingFlag = await pool.query(
        'SELECT id FROM concept_flags WHERE user_id = $1 AND edge_id = $2',
        [req.user.userId, edgeId]
      );

      if (existingFlag.rows.length > 0) {
        return res.status(400).json({ error: 'You have already flagged this concept' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Insert the flag
        await client.query(
          'INSERT INTO concept_flags (edge_id, user_id, reason) VALUES ($1, $2, $3)',
          [edgeId, req.user.userId, flagReason]
        );

        // Count distinct flags on this edge
        const countResult = await client.query(
          'SELECT COUNT(*) FROM concept_flags WHERE edge_id = $1',
          [edgeId]
        );
        const flagCount = parseInt(countResult.rows[0].count);

        // Only hide the edge when 10 or more distinct flags
        let hidden = false;
        if (flagCount >= 10) {
          await client.query(
            'UPDATE edges SET is_hidden = true WHERE id = $1',
            [edgeId]
          );
          hidden = true;
        }

        await client.query('COMMIT');

        res.status(201).json({
          message: hidden ? 'Concept flagged and hidden' : 'Concept flagged',
          edgeId,
          reason: flagReason,
          flagCount,
          hidden
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error flagging edge:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove the current user's flag from an edge
  unflagEdge: async (req, res) => {
    const { edgeId } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const result = await pool.query(
        'DELETE FROM concept_flags WHERE user_id = $1 AND edge_id = $2 RETURNING id',
        [req.user.userId, edgeId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'You have not flagged this concept' });
      }

      res.json({ message: 'Flag removed', edgeId });
    } catch (error) {
      console.error('Error unflagging edge:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get hidden children for a parent in context
  getHiddenChildren: async (req, res) => {
    const { parentId } = req.params;
    const { path } = req.query;

    try {
      // Parse path from query string — comes as comma-separated string
      let graphPath = [];
      if (path) {
        graphPath = path.split(',').map(Number).filter(n => !isNaN(n));
      }

      // Build the expected graph_path for children of this parent
      // Children of parentId have graph_path = [...path, parentId]
      const childGraphPath = parentId !== 'null' && parentId !== '0'
        ? [...graphPath, parseInt(parentId)]
        : [];

      // Query hidden edges for this parent context
      // Always use consistent parameter indices: $1 = parentId (or ignored), $2 = graphPath, $3 = userId
      const isRootParent = parentId === 'null' || parentId === '0';

      const result = await pool.query(
        `SELECT 
          e.id AS edge_id,
          e.child_id,
          c.name AS concept_name,
          a.name AS attribute_name,
          e.created_at AS edge_created_at,
          e.created_by AS edge_created_by,
          creator.username AS created_by_username,
          (SELECT COUNT(*) FROM concept_flags cf WHERE cf.edge_id = e.id) AS flag_count,
          (SELECT COUNT(*) FROM concept_flag_votes cfv WHERE cfv.edge_id = e.id AND cfv.vote_type = 'hide') AS hide_vote_count,
          (SELECT COUNT(*) FROM concept_flag_votes cfv WHERE cfv.edge_id = e.id AND cfv.vote_type = 'show') AS show_vote_count,
          (SELECT cfv.vote_type FROM concept_flag_votes cfv WHERE cfv.edge_id = e.id AND cfv.user_id = $3) AS user_vote_type,
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = e.id AND cf.user_id = $3) AS user_flagged
        FROM edges e
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN users creator ON e.created_by = creator.id
        WHERE ${isRootParent ? 'e.parent_id IS NULL' : 'e.parent_id = $1'}
          AND e.graph_path = $2
          AND e.is_hidden = true
        ORDER BY flag_count DESC, e.created_at DESC`,
        [isRootParent ? null : parseInt(parentId), childGraphPath, req.user.userId]
      );

      res.json({
        hiddenChildren: result.rows.map(row => ({
          edgeId: row.edge_id,
          childId: row.child_id,
          conceptName: row.concept_name,
          attributeName: row.attribute_name,
          edgeCreatedAt: row.edge_created_at,
          createdByUsername: row.created_by_username,
          flagCount: parseInt(row.flag_count),
          hideVoteCount: parseInt(row.hide_vote_count),
          showVoteCount: parseInt(row.show_vote_count),
          userVoteType: row.user_vote_type || null,
          userFlagged: row.user_flagged
        })),
        isAdmin: req.user.userId === parseInt(process.env.ADMIN_USER_ID || '0')
      });
    } catch (error) {
      console.error('Error getting hidden children:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Vote to 'hide' or 'show' on a hidden edge
  voteOnHidden: async (req, res) => {
    const { edgeId, voteType } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      if (!['hide', 'show'].includes(voteType)) {
        return res.status(400).json({ error: 'Vote type must be "hide" or "show"' });
      }

      // Verify edge exists and is hidden
      const edgeCheck = await pool.query(
        'SELECT id, is_hidden FROM edges WHERE id = $1',
        [edgeId]
      );
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      if (!edgeCheck.rows[0].is_hidden) {
        return res.status(400).json({ error: 'This concept is not currently hidden' });
      }

      // Upsert — insert or update if user already voted
      const result = await pool.query(
        `INSERT INTO concept_flag_votes (edge_id, user_id, vote_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, edge_id) 
         DO UPDATE SET vote_type = $3, created_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [edgeId, req.user.userId, voteType]
      );

      // Get updated counts
      const counts = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE vote_type = 'hide') AS hide_count,
          COUNT(*) FILTER (WHERE vote_type = 'show') AS show_count
         FROM concept_flag_votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: `Vote recorded: ${voteType}`,
        voteType,
        hideVoteCount: parseInt(counts.rows[0].hide_count),
        showVoteCount: parseInt(counts.rows[0].show_count)
      });
    } catch (error) {
      console.error('Error voting on hidden edge:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a hide/show vote
  removeVoteOnHidden: async (req, res) => {
    const { edgeId } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const deleteResult = await pool.query(
        'DELETE FROM concept_flag_votes WHERE user_id = $1 AND edge_id = $2 RETURNING id',
        [req.user.userId, edgeId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'No vote found to remove' });
      }

      // Get updated counts
      const counts = await pool.query(
        `SELECT 
          COUNT(*) FILTER (WHERE vote_type = 'hide') AS hide_count,
          COUNT(*) FILTER (WHERE vote_type = 'show') AS show_count
         FROM concept_flag_votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: 'Vote removed',
        hideVoteCount: parseInt(counts.rows[0].hide_count),
        showVoteCount: parseInt(counts.rows[0].show_count)
      });
    } catch (error) {
      console.error('Error removing vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a moderation comment
  addComment: async (req, res) => {
    const { edgeId, body } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      if (!body || body.trim().length === 0) {
        return res.status(400).json({ error: 'Comment body is required' });
      }

      if (body.length > 2000) {
        return res.status(400).json({ error: 'Comment must be under 2000 characters' });
      }

      // Verify edge exists and is hidden
      const edgeCheck = await pool.query(
        'SELECT id, is_hidden FROM edges WHERE id = $1',
        [edgeId]
      );
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      if (!edgeCheck.rows[0].is_hidden) {
        return res.status(400).json({ error: 'Comments are only allowed on hidden concepts' });
      }

      const result = await pool.query(
        `INSERT INTO moderation_comments (edge_id, user_id, body)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [edgeId, req.user.userId, body.trim()]
      );

      // Return the comment with username
      const comment = await pool.query(
        `SELECT mc.*, u.username 
         FROM moderation_comments mc
         JOIN users u ON mc.user_id = u.id
         WHERE mc.id = $1`,
        [result.rows[0].id]
      );

      res.status(201).json({
        message: 'Comment added',
        comment: {
          id: comment.rows[0].id,
          edgeId: comment.rows[0].edge_id,
          userId: comment.rows[0].user_id,
          username: comment.rows[0].username,
          body: comment.rows[0].body,
          createdAt: comment.rows[0].created_at
        }
      });
    } catch (error) {
      console.error('Error adding comment:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get comments for a hidden edge
  getComments: async (req, res) => {
    const { edgeId } = req.params;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const result = await pool.query(
        `SELECT mc.id, mc.edge_id, mc.user_id, mc.body, mc.created_at,
                u.username
         FROM moderation_comments mc
         JOIN users u ON mc.user_id = u.id
         WHERE mc.edge_id = $1
         ORDER BY mc.created_at ASC`,
        [edgeId]
      );

      res.json({
        comments: result.rows.map(row => ({
          id: row.id,
          edgeId: row.edge_id,
          userId: row.user_id,
          username: row.username,
          body: row.body,
          createdAt: row.created_at
        }))
      });
    } catch (error) {
      console.error('Error getting comments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Admin-only: unhide an edge
  unhideEdge: async (req, res) => {
    const { edgeId } = req.body;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      // Check if current user is admin
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can unhide concepts' });
      }

      // Verify edge exists and is hidden
      const edgeCheck = await pool.query(
        'SELECT id, is_hidden FROM edges WHERE id = $1',
        [edgeId]
      );
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      if (!edgeCheck.rows[0].is_hidden) {
        return res.status(400).json({ error: 'This concept is not currently hidden' });
      }

      // Unhide the edge
      await pool.query(
        'UPDATE edges SET is_hidden = false WHERE id = $1',
        [edgeId]
      );

      res.json({
        message: 'Concept unhidden successfully',
        edgeId
      });
    } catch (error) {
      console.error('Error unhiding edge:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = moderationController;
