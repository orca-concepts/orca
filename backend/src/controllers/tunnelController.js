const pool = require('../config/database');

const tunnelController = {
  // GET /api/tunnels/:edgeId — get all tunnel links for an edge, grouped by attribute
  getTunnelLinks: async (req, res) => {
    try {
      const edgeId = parseInt(req.params.edgeId);
      const userId = req.user ? req.user.userId : -1;
      const sort = req.query.sort || 'votes';

      if (isNaN(edgeId)) {
        return res.status(400).json({ error: 'Invalid edge ID' });
      }

      // Get all tunnel links originating from this edge
      const linksQuery = `
        SELECT
          tl.id AS tunnel_link_id,
          tl.linked_edge_id,
          tl.created_at,
          e.child_id AS concept_id,
          e.parent_id,
          e.graph_path,
          e.attribute_id,
          c.name AS concept_name,
          a.name AS attribute_name,
          u.username AS created_by,
          (SELECT COUNT(*) FROM tunnel_votes tv WHERE tv.tunnel_link_id = tl.id) AS tunnel_vote_count,
          (SELECT BOOL_OR(tv.user_id = $2) FROM tunnel_votes tv WHERE tv.tunnel_link_id = tl.id) AS user_voted,
          (SELECT COUNT(DISTINCT v.user_id) FROM votes v WHERE v.edge_id = tl.linked_edge_id) AS save_vote_count
        FROM tunnel_links tl
        JOIN edges e ON tl.linked_edge_id = e.id
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN users u ON tl.created_by = u.id
        WHERE tl.origin_edge_id = $1
      `;

      const result = await pool.query(linksQuery, [edgeId, userId]);

      if (result.rows.length === 0) {
        return res.json({ tunnelLinks: {} });
      }

      // Collect all concept IDs from graph_paths for batch name resolution
      const allPathIds = new Set();
      for (const row of result.rows) {
        if (row.graph_path && row.graph_path.length > 0) {
          for (const pid of row.graph_path) {
            allPathIds.add(pid);
          }
        }
        if (row.parent_id) {
          allPathIds.add(row.parent_id);
        }
      }

      // Batch lookup concept names for paths
      let nameMap = {};
      if (allPathIds.size > 0) {
        const nameResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(allPathIds)]
        );
        for (const r of nameResult.rows) {
          nameMap[r.id] = r.name;
        }
      }

      // Group results by attribute_id
      const grouped = {};
      for (const row of result.rows) {
        const attrId = row.attribute_id;
        if (!grouped[attrId]) {
          grouped[attrId] = {
            attributeName: row.attribute_name,
            links: [],
          };
        }

        // Resolve path names — graph_path already includes parent as last element
        const pathNames = (row.graph_path || []).map(pid => nameMap[pid] || `[${pid}]`);

        grouped[attrId].links.push({
          tunnelLinkId: row.tunnel_link_id,
          linkedEdgeId: row.linked_edge_id,
          conceptId: row.concept_id,
          conceptName: row.concept_name,
          parentId: row.parent_id,
          parentName: row.parent_id ? (nameMap[row.parent_id] || null) : null,
          graphPath: row.graph_path || [],
          pathNames,
          attributeId: attrId,
          attributeName: row.attribute_name,
          tunnelVoteCount: Number(row.tunnel_vote_count),
          userVoted: row.user_voted === true,
          saveVoteCount: Number(row.save_vote_count),
          createdBy: row.created_by || '[deleted user]',
          createdAt: row.created_at,
        });
      }

      // Sort links within each attribute group
      for (const attrId of Object.keys(grouped)) {
        if (sort === 'new') {
          grouped[attrId].links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
          // Default: sort by tunnel vote count descending, then save vote count
          grouped[attrId].links.sort((a, b) => b.tunnelVoteCount - a.tunnelVoteCount || b.saveVoteCount - a.saveVoteCount);
        }
      }

      res.json({ tunnelLinks: grouped });
    } catch (error) {
      console.error('Error getting tunnel links:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/tunnels/create — create a bidirectional tunnel link
  createTunnelLink: async (req, res) => {
    const client = await pool.connect();
    try {
      const { originEdgeId, linkedEdgeId } = req.body;
      const userId = req.user.userId;

      if (!originEdgeId || !linkedEdgeId) {
        return res.status(400).json({ error: 'originEdgeId and linkedEdgeId are required' });
      }

      if (originEdgeId === linkedEdgeId) {
        return res.status(400).json({ error: 'Cannot create a tunnel link to the same edge' });
      }

      // Validate both edges exist and are not hidden
      const edgeCheck = await client.query(
        'SELECT id, is_hidden FROM edges WHERE id = ANY($1::integer[])',
        [[originEdgeId, linkedEdgeId]]
      );

      if (edgeCheck.rows.length < 2) {
        return res.status(404).json({ error: 'One or both edges not found' });
      }

      for (const edge of edgeCheck.rows) {
        if (edge.is_hidden) {
          return res.status(400).json({ error: 'Cannot create tunnel links to hidden edges' });
        }
      }

      await client.query('BEGIN');

      // Insert forward direction (origin → linked)
      let forwardRow;
      try {
        const forwardResult = await client.query(
          `INSERT INTO tunnel_links (origin_edge_id, linked_edge_id, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [originEdgeId, linkedEdgeId, userId]
        );
        forwardRow = forwardResult.rows[0];
      } catch (err) {
        if (err.code === '23505') { // unique_violation
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Tunnel link already exists' });
        }
        throw err;
      }

      // Insert reverse direction (linked → origin)
      let reverseRow;
      try {
        const reverseResult = await client.query(
          `INSERT INTO tunnel_links (origin_edge_id, linked_edge_id, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [linkedEdgeId, originEdgeId, userId]
        );
        reverseRow = reverseResult.rows[0];
      } catch (err) {
        if (err.code === '23505') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Tunnel link already exists' });
        }
        throw err;
      }

      // Auto-vote both directions for the creator
      await client.query(
        `INSERT INTO tunnel_votes (user_id, tunnel_link_id) VALUES ($1, $2)`,
        [userId, forwardRow.id]
      );
      await client.query(
        `INSERT INTO tunnel_votes (user_id, tunnel_link_id) VALUES ($1, $2)`,
        [userId, reverseRow.id]
      );

      await client.query('COMMIT');

      res.json({
        message: 'Tunnel link created',
        tunnelLinkId: forwardRow.id,
        reverseTunnelLinkId: reverseRow.id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating tunnel link:', error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // POST /api/tunnels/vote — toggle vote on a tunnel link
  toggleTunnelVote: async (req, res) => {
    try {
      const { tunnelLinkId } = req.body;
      const userId = req.user.userId;

      if (!tunnelLinkId) {
        return res.status(400).json({ error: 'tunnelLinkId is required' });
      }

      // Validate tunnel link exists
      const linkCheck = await pool.query(
        'SELECT id FROM tunnel_links WHERE id = $1',
        [tunnelLinkId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tunnel link not found' });
      }

      // Check if user already voted
      const existingVote = await pool.query(
        'SELECT id FROM tunnel_votes WHERE user_id = $1 AND tunnel_link_id = $2',
        [userId, tunnelLinkId]
      );

      let voted;
      if (existingVote.rows.length > 0) {
        // Remove vote
        await pool.query(
          'DELETE FROM tunnel_votes WHERE user_id = $1 AND tunnel_link_id = $2',
          [userId, tunnelLinkId]
        );
        voted = false;
      } else {
        // Add vote
        await pool.query(
          'INSERT INTO tunnel_votes (user_id, tunnel_link_id) VALUES ($1, $2)',
          [userId, tunnelLinkId]
        );
        voted = true;
      }

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM tunnel_votes WHERE tunnel_link_id = $1',
        [tunnelLinkId]
      );

      res.json({
        voted,
        voteCount: Number(countResult.rows[0].count),
      });
    } catch (error) {
      console.error('Error toggling tunnel vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = tunnelController;
