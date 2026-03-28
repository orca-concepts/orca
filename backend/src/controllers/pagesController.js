const pool = require('../config/database');

const VALID_SLUGS = ['using-orca', 'constitution', 'donate'];

module.exports = {
  // GET /:slug/comments
  getPageComments: async (req, res) => {
    try {
      const { slug } = req.params;

      if (!VALID_SLUGS.includes(slug)) {
        return res.status(400).json({ error: 'Invalid page slug' });
      }

      const userId = req.user ? req.user.userId : null;

      const result = await pool.query(
        `SELECT pc.id, pc.body, pc.user_id, pc.created_at, pc.parent_comment_id,
                u.username,
                COUNT(pcv.id)::int AS vote_count
                ${userId ? `, EXISTS(SELECT 1 FROM page_comment_votes WHERE user_id = $2 AND comment_id = pc.id) AS user_voted` : ''}
         FROM page_comments pc
         JOIN users u ON pc.user_id = u.id
         LEFT JOIN page_comment_votes pcv ON pcv.comment_id = pc.id
         WHERE pc.page_slug = $1
         GROUP BY pc.id, u.username
         ORDER BY vote_count DESC, pc.created_at DESC`,
        userId ? [slug, userId] : [slug]
      );

      // Build tree: top-level comments with nested replies
      const allComments = result.rows.map(row => ({
        id: row.id,
        body: row.body,
        username: row.username,
        userId: row.user_id,
        voteCount: row.vote_count,
        userVoted: userId ? row.user_voted : false,
        createdAt: row.created_at,
        parentCommentId: row.parent_comment_id || null,
        replies: [],
      }));

      const topLevel = allComments.filter(c => !c.parentCommentId);
      const replies = allComments.filter(c => c.parentCommentId);

      const byId = {};
      topLevel.forEach(c => { byId[c.id] = c; });

      replies.forEach(r => {
        if (byId[r.parentCommentId]) {
          byId[r.parentCommentId].replies.push(r);
        }
      });

      // Sort replies by votes desc, then chronologically as tiebreaker
      topLevel.forEach(c => {
        c.replies.sort((a, b) => b.voteCount - a.voteCount || new Date(a.createdAt) - new Date(b.createdAt));
      });

      res.json({ comments: topLevel });
    } catch (err) {
      console.error('Failed to get page comments:', err);
      res.status(500).json({ error: 'Failed to get comments' });
    }
  },

  // POST /:slug/comments
  addPageComment: async (req, res) => {
    try {
      const { slug } = req.params;
      const { body, parentCommentId } = req.body;

      if (!VALID_SLUGS.includes(slug)) {
        return res.status(400).json({ error: 'Invalid page slug' });
      }
      if (!body || body.trim().length === 0) {
        return res.status(400).json({ error: 'Comment body is required' });
      }
      if (body.length > 2000) {
        return res.status(400).json({ error: 'Comment must be under 2000 characters' });
      }

      // Validate parent comment if replying
      if (parentCommentId) {
        const parentResult = await pool.query(
          'SELECT id, page_slug, parent_comment_id FROM page_comments WHERE id = $1',
          [parentCommentId]
        );
        if (parentResult.rows.length === 0 || parentResult.rows[0].page_slug !== slug) {
          return res.status(400).json({ error: 'Parent comment not found' });
        }
        if (parentResult.rows[0].parent_comment_id) {
          return res.status(400).json({ error: 'Cannot reply to a reply' });
        }
      }

      const userId = req.user.userId;

      // Insert comment
      const result = await pool.query(
        `INSERT INTO page_comments (page_slug, user_id, body, parent_comment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [slug, userId, body.trim(), parentCommentId || null]
      );

      const comment = result.rows[0];

      // Auto-vote for the creator
      await pool.query(
        `INSERT INTO page_comment_votes (user_id, comment_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, comment_id) DO NOTHING`,
        [userId, comment.id]
      );

      // Get username
      const userResult = await pool.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );

      res.status(201).json({
        comment: {
          id: comment.id,
          body: comment.body,
          username: userResult.rows[0].username,
          userId: comment.user_id,
          voteCount: 1,
          userVoted: true,
          createdAt: comment.created_at,
          parentCommentId: comment.parent_comment_id || null,
          replies: [],
        },
      });
    } catch (err) {
      console.error('Failed to add page comment:', err);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  },

  // POST /comments/:commentId/vote
  togglePageCommentVote: async (req, res) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;

      // Check if already voted
      const existing = await pool.query(
        'SELECT id FROM page_comment_votes WHERE user_id = $1 AND comment_id = $2',
        [userId, commentId]
      );

      if (existing.rows.length > 0) {
        // Remove vote
        await pool.query(
          'DELETE FROM page_comment_votes WHERE user_id = $1 AND comment_id = $2',
          [userId, commentId]
        );
      } else {
        // Add vote
        await pool.query(
          `INSERT INTO page_comment_votes (user_id, comment_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, comment_id) DO NOTHING`,
          [userId, commentId]
        );
      }

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS vote_count FROM page_comment_votes WHERE comment_id = $1',
        [commentId]
      );

      res.json({
        voted: existing.rows.length === 0,
        voteCount: countResult.rows[0].vote_count,
      });
    } catch (err) {
      console.error('Failed to toggle page comment vote:', err);
      res.status(500).json({ error: 'Failed to toggle vote' });
    }
  },
};
