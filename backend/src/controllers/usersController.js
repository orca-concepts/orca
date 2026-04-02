const pool = require('../config/database');

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
};

module.exports = usersController;
