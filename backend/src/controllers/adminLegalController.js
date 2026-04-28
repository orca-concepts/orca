const pool = require('../config/database');

const VALID_TARGET_TYPES = ['document_version', 'annotation', 'concept', 'edge', 'web_link', 'page_comment', 'moderation_comment'];
const VALID_REMOVAL_REASONS = ['dmca', 'illegal_content', 'court_order'];

const adminLegalController = {
  legalRemove: async (req, res) => {
    const { target_type, target_id, removal_reason, notice_reference, internal_notes } = req.body;

    try {
      // Admin check — same pattern as moderationController.unhideEdge
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can perform legal removals' });
      }

      // Validate required fields
      if (!target_type || !target_id || !removal_reason) {
        return res.status(400).json({ error: 'target_type, target_id, and removal_reason are required' });
      }
      if (!VALID_TARGET_TYPES.includes(target_type)) {
        return res.status(400).json({ error: `Invalid target_type. Must be one of: ${VALID_TARGET_TYPES.join(', ')}` });
      }
      const parsedTargetId = parseInt(target_id);
      if (isNaN(parsedTargetId)) {
        return res.status(400).json({ error: 'target_id must be an integer' });
      }
      if (!VALID_REMOVAL_REASONS.includes(removal_reason)) {
        return res.status(400).json({ error: `Invalid removal_reason. Must be one of: ${VALID_REMOVAL_REASONS.join(', ')}` });
      }

      // DMCA notice_reference convention warning
      if (removal_reason === 'dmca' && notice_reference && !notice_reference.startsWith('copyright_infringement_notices.id=')) {
        console.warn(`[LEGAL] DMCA removal with non-standard notice_reference: "${notice_reference}". Expected prefix "copyright_infringement_notices.id=".`);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let affectedUserId = null;
        let affectedUserEmail = null;
        let affectedUsername = null;

        // --- Execute target-specific action and look up affected user ---

        if (target_type === 'document_version') {
          // Hard-delete the document row; cascading FKs handle annotations, etc.
          const docResult = await client.query(
            `SELECT d.id, d.uploaded_by, u.email, u.username
             FROM documents d
             LEFT JOIN users u ON d.uploaded_by = u.id
             WHERE d.id = $1`,
            [parsedTargetId]
          );
          if (docResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Document not found' });
          }
          affectedUserId = docResult.rows[0].uploaded_by;
          affectedUserEmail = docResult.rows[0].email;
          affectedUsername = docResult.rows[0].username;

          await client.query('DELETE FROM documents WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'annotation') {
          const annResult = await client.query(
            `SELECT da.id, da.created_by, u.email, u.username
             FROM document_annotations da
             LEFT JOIN users u ON da.created_by = u.id
             WHERE da.id = $1`,
            [parsedTargetId]
          );
          if (annResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Annotation not found' });
          }
          affectedUserId = annResult.rows[0].created_by;
          affectedUserEmail = annResult.rows[0].email;
          affectedUsername = annResult.rows[0].username;

          await client.query('DELETE FROM document_annotations WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'concept') {
          // No is_hidden on concepts — just set legal_hold
          const conceptResult = await client.query(
            `SELECT c.id, c.created_by, u.email, u.username
             FROM concepts c
             LEFT JOIN users u ON c.created_by = u.id
             WHERE c.id = $1`,
            [parsedTargetId]
          );
          if (conceptResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Concept not found' });
          }
          affectedUserId = conceptResult.rows[0].created_by;
          affectedUserEmail = conceptResult.rows[0].email;
          affectedUsername = conceptResult.rows[0].username;

          await client.query('UPDATE concepts SET legal_hold = true WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'edge') {
          const edgeResult = await client.query(
            `SELECT e.id, e.created_by, u.email, u.username
             FROM edges e
             LEFT JOIN users u ON e.created_by = u.id
             WHERE e.id = $1`,
            [parsedTargetId]
          );
          if (edgeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Edge not found' });
          }
          affectedUserId = edgeResult.rows[0].created_by;
          affectedUserEmail = edgeResult.rows[0].email;
          affectedUsername = edgeResult.rows[0].username;

          await client.query('UPDATE edges SET is_hidden = true, legal_hold = true WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'web_link') {
          // concept_links has no is_hidden — just set legal_hold
          const linkResult = await client.query(
            `SELECT cl.id, cl.added_by, u.email, u.username
             FROM concept_links cl
             LEFT JOIN users u ON cl.added_by = u.id
             WHERE cl.id = $1`,
            [parsedTargetId]
          );
          if (linkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Web link not found' });
          }
          affectedUserId = linkResult.rows[0].added_by;
          affectedUserEmail = linkResult.rows[0].email;
          affectedUsername = linkResult.rows[0].username;

          await client.query('UPDATE concept_links SET legal_hold = true WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'page_comment') {
          const commentResult = await client.query(
            `SELECT pc.id, pc.user_id, u.email, u.username
             FROM page_comments pc
             LEFT JOIN users u ON pc.user_id = u.id
             WHERE pc.id = $1`,
            [parsedTargetId]
          );
          if (commentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Page comment not found' });
          }
          affectedUserId = commentResult.rows[0].user_id;
          affectedUserEmail = commentResult.rows[0].email;
          affectedUsername = commentResult.rows[0].username;

          await client.query('DELETE FROM page_comments WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'moderation_comment') {
          const modCommentResult = await client.query(
            `SELECT mc.id, mc.user_id, u.email, u.username
             FROM moderation_comments mc
             LEFT JOIN users u ON mc.user_id = u.id
             WHERE mc.id = $1`,
            [parsedTargetId]
          );
          if (modCommentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Moderation comment not found' });
          }
          affectedUserId = modCommentResult.rows[0].user_id;
          affectedUserEmail = modCommentResult.rows[0].email;
          affectedUsername = modCommentResult.rows[0].username;

          await client.query('DELETE FROM moderation_comments WHERE id = $1', [parsedTargetId]);
        }

        // --- Write audit row ---
        const auditResult = await client.query(
          `INSERT INTO legal_removals
             (target_type, target_id, affected_user_id, removal_reason, notice_reference, internal_notes, removed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [target_type, parsedTargetId, affectedUserId, removal_reason, notice_reference || null, internal_notes || null, req.user.userId]
        );

        await client.query('COMMIT');

        res.json({
          success: true,
          legal_removal_id: auditResult.rows[0].id,
          affected_user_email: affectedUserEmail || null,
          affected_username: affectedUsername || null
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error performing legal removal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = adminLegalController;
