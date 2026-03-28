const pool = require('../config/database');
const { getRootDocumentId, isDocumentAuthor } = require('../utils/documentLineage');

// ── Helpers ──

/**
 * Get the author group for a document (uploaded_by + document_authors via root doc).
 * Returns an array of user IDs.
 */
async function getAuthorGroup(documentId) {
  const rootId = await getRootDocumentId(pool, documentId);
  const result = await pool.query(`
    SELECT uploaded_by AS user_id FROM documents WHERE id = $1
    UNION
    SELECT user_id FROM document_authors WHERE document_id = $1
  `, [rootId]);
  return result.rows.map(r => r.user_id);
}

/**
 * Check if a user is a participant in a thread.
 * Participants = author group (via annotation's document) + external_user_id.
 */
async function isParticipant(threadId, userId) {
  const thread = await pool.query(`
    SELECT mt.external_user_id, da.document_id
    FROM message_threads mt
    JOIN document_annotations da ON da.id = mt.annotation_id
    WHERE mt.id = $1
  `, [threadId]);
  if (thread.rows.length === 0) return false;

  const { external_user_id, document_id } = thread.rows[0];
  if (userId === external_user_id) return true;

  const authorGroup = await getAuthorGroup(document_id);
  return authorGroup.includes(userId);
}

// ── POST /api/messages/threads/create ──
const createThread = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { annotation_id, thread_type, body } = req.body;

    if (!annotation_id || !thread_type || !body || !body.trim()) {
      return res.status(400).json({ error: 'annotation_id, thread_type, and body are required' });
    }
    if (body.length > 10000) {
      return res.status(400).json({ error: 'Message body must be 10,000 characters or fewer' });
    }
    if (!['to_authors', 'to_annotator'].includes(thread_type)) {
      return res.status(400).json({ error: 'thread_type must be "to_authors" or "to_annotator"' });
    }

    // Look up the annotation
    const annResult = await pool.query(
      'SELECT id, document_id, created_by FROM document_annotations WHERE id = $1',
      [annotation_id]
    );
    if (annResult.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    const annotation = annResult.rows[0];
    const authorGroup = await getAuthorGroup(annotation.document_id);
    const isAuthor = authorGroup.includes(userId);

    let external_user_id;

    if (thread_type === 'to_authors') {
      // The requesting user IS the external user (they're reaching out to the author group)
      // Validate: not the sole author messaging themselves
      if (isAuthor && authorGroup.length === 1) {
        return res.status(403).json({ error: 'Sole author cannot message themselves' });
      }
      external_user_id = userId;
    } else {
      // to_annotator: an author reaches out to the annotation creator
      if (!isAuthor) {
        return res.status(403).json({ error: 'Only document authors can initiate "to_annotator" threads' });
      }
      // The annotator is the external user
      external_user_id = annotation.created_by;
      // Validate: annotation creator must NOT already be a coauthor
      if (authorGroup.includes(external_user_id)) {
        return res.status(400).json({ error: 'Annotation creator is already a coauthor — use "to_authors" instead' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const threadResult = await client.query(
        `INSERT INTO message_threads (annotation_id, external_user_id, thread_type, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [annotation_id, external_user_id, thread_type, userId]
      );
      const thread = threadResult.rows[0];

      const messageResult = await client.query(
        `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
        [thread.id, userId, body.trim()]
      );

      // Auto-mark as read for the creator
      await client.query(
        `INSERT INTO message_read_status (thread_id, user_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW()`,
        [thread.id, userId]
      );

      await client.query('COMMIT');

      res.status(201).json({ thread, message: messageResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      // Unique constraint violation = thread already exists
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Thread already exists for this annotation/user/type combination' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating thread:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
};

// ── GET /api/messages/threads ──
const getThreads = async (req, res) => {
  try {
    const userId = req.user.userId;
    const section = req.query.section; // 'my_docs' | 'others_docs'

    // Get all threads where the user is a participant.
    // A user is a participant if they are the external_user_id OR in the author group.
    // We compute this by joining through annotations → documents → root documents → author group.
    const result = await pool.query(`
      WITH RECURSIVE doc_roots AS (
        SELECT d.id AS doc_id, d.id AS current_id, d.source_document_id
        FROM documents d
        UNION ALL
        SELECT dr.doc_id, parent.id AS current_id, parent.source_document_id
        FROM doc_roots dr
        JOIN documents parent ON parent.id = dr.source_document_id
        WHERE dr.source_document_id IS NOT NULL
      ),
      roots AS (
        SELECT doc_id, current_id AS root_document_id
        FROM doc_roots
        WHERE source_document_id IS NULL
      ),
      author_groups AS (
        SELECT r.doc_id AS document_id, d.uploaded_by AS user_id
        FROM roots r
        JOIN documents d ON d.id = r.root_document_id
        UNION
        SELECT r.doc_id AS document_id, da.user_id
        FROM roots r
        JOIN document_authors da ON da.document_id = r.root_document_id
      ),
      user_threads AS (
        SELECT mt.*, da.document_id, da.corpus_id,
               r.root_document_id,
               CASE WHEN ag.user_id IS NOT NULL THEN true ELSE false END AS user_is_author
        FROM message_threads mt
        JOIN document_annotations da ON da.id = mt.annotation_id
        JOIN roots r ON r.doc_id = da.document_id
        LEFT JOIN author_groups ag ON ag.document_id = da.document_id AND ag.user_id = $1
        WHERE mt.external_user_id = $1 OR ag.user_id IS NOT NULL
      )
      SELECT
        ut.id AS thread_id,
        ut.annotation_id,
        ut.external_user_id,
        ut.thread_type,
        ut.created_at AS thread_created_at,
        ut.document_id,
        ut.corpus_id,
        ut.root_document_id,
        ut.user_is_author,
        d.title AS document_title,
        da_ann.quote_text,
        da_ann.comment AS annotation_comment,
        da_ann.edge_id AS annotation_edge_id,
        c.name AS annotation_concept_name,
        e.graph_path AS annotation_graph_path,
        ext_user.username AS external_username,
        (SELECT COUNT(*) FROM messages m WHERE m.thread_id = ut.id) AS message_count,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = ut.id) AS last_message_at,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.thread_id = ut.id
            AND m.created_at > COALESCE(
              (SELECT mrs.last_read_at FROM message_read_status mrs
               WHERE mrs.thread_id = ut.id AND mrs.user_id = $1),
              '1970-01-01'::timestamp
            )
        ) AS unread_count
      FROM user_threads ut
      JOIN documents d ON d.id = ut.document_id
      JOIN document_annotations da_ann ON da_ann.id = ut.annotation_id
      JOIN edges e ON e.id = da_ann.edge_id
      JOIN concepts c ON c.id = e.child_id
      JOIN users ext_user ON ext_user.id = ut.external_user_id
      ${section === 'my_docs' ? 'WHERE ut.user_is_author = true' : ''}
      ${section === 'others_docs' ? 'WHERE ut.user_is_author = false' : ''}
      ORDER BY last_message_at DESC NULLS LAST
    `, [userId]);

    // Group by document lineage → equivalent annotation → threads
    // Documents in the same version chain are grouped together under the latest title.
    // Annotations with the same edge_id + quote_text across versions are grouped together.
    const byDocLineage = {};
    for (const row of result.rows) {
      const lineageKey = row.root_document_id;
      if (!byDocLineage[lineageKey]) {
        byDocLineage[lineageKey] = {
          document_id: row.document_id,
          document_title: row.document_title,
          corpus_id: row.corpus_id,
          unread_count: 0,
          annotations: {}
        };
      }
      // Use the most recent document title (higher document_id = newer version)
      if (row.document_id > byDocLineage[lineageKey].document_id) {
        byDocLineage[lineageKey].document_id = row.document_id;
        byDocLineage[lineageKey].document_title = row.document_title;
      }
      byDocLineage[lineageKey].unread_count += parseInt(row.unread_count);

      // Group equivalent annotations by edge_id + quote_text
      const annKey = `${row.annotation_edge_id}:${row.quote_text || ''}`;
      if (!byDocLineage[lineageKey].annotations[annKey]) {
        byDocLineage[lineageKey].annotations[annKey] = {
          annotation_id: row.annotation_id,
          annotation_ids: [row.annotation_id],
          quote_text: row.quote_text,
          annotation_comment: row.annotation_comment,
          concept_name: row.annotation_concept_name,
          graph_path: row.annotation_graph_path || [],
          unread_count: 0,
          threads: []
        };
      } else {
        // Track all equivalent annotation IDs
        if (!byDocLineage[lineageKey].annotations[annKey].annotation_ids.includes(row.annotation_id)) {
          byDocLineage[lineageKey].annotations[annKey].annotation_ids.push(row.annotation_id);
        }
      }
      byDocLineage[lineageKey].annotations[annKey].unread_count += parseInt(row.unread_count);

      byDocLineage[lineageKey].annotations[annKey].threads.push({
        thread_id: row.thread_id,
        thread_type: row.thread_type,
        external_user_id: row.external_user_id,
        external_username: row.external_username,
        message_count: parseInt(row.message_count),
        unread_count: parseInt(row.unread_count),
        last_message_at: row.last_message_at,
        created_at: row.thread_created_at
      });
    }
    const byDocument = byDocLineage;

    // Resolve graph_path concept IDs to names
    const allPathIds = new Set();
    for (const doc of Object.values(byDocument)) {
      for (const ann of Object.values(doc.annotations)) {
        for (const id of ann.graph_path) allPathIds.add(id);
      }
    }
    let pathNames = {};
    if (allPathIds.size > 0) {
      const namesResult = await pool.query(
        `SELECT e.child_id, c.name FROM edges e JOIN concepts c ON c.id = e.child_id WHERE e.child_id = ANY($1::int[])`,
        [Array.from(allPathIds)]
      );
      for (const row of namesResult.rows) {
        pathNames[row.child_id] = row.name;
      }
    }

    // Convert annotations objects to arrays, attach resolved path names
    const documents = Object.values(byDocument).map(doc => ({
      ...doc,
      annotations: Object.values(doc.annotations).map(ann => ({
        ...ann,
        path_names: ann.graph_path.map(id => pathNames[id] || `#${id}`),
      }))
    }));

    res.json({ documents });
  } catch (error) {
    console.error('Error getting threads:', error);
    res.status(500).json({ error: 'Failed to get threads' });
  }
};

// ── GET /api/messages/threads/:threadId ──
const getThread = async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = parseInt(req.params.threadId);

    if (!await isParticipant(threadId, userId)) {
      return res.status(403).json({ error: 'Not a participant in this thread' });
    }

    // Get thread info
    const threadResult = await pool.query(`
      SELECT mt.*, da.document_id, da.corpus_id, da.quote_text, da.comment AS annotation_comment,
             d.title AS document_title, ext_user.username AS external_username
      FROM message_threads mt
      JOIN document_annotations da ON da.id = mt.annotation_id
      JOIN documents d ON d.id = da.document_id
      JOIN users ext_user ON ext_user.id = mt.external_user_id
      WHERE mt.id = $1
    `, [threadId]);

    if (threadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Get all messages
    const messagesResult = await pool.query(`
      SELECT m.*, u.username AS sender_username
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC
    `, [threadId]);

    // Auto-upsert last_read_at
    await pool.query(`
      INSERT INTO message_read_status (thread_id, user_id, last_read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW()
    `, [threadId, userId]);

    res.json({
      thread: threadResult.rows[0],
      messages: messagesResult.rows
    });
  } catch (error) {
    console.error('Error getting thread:', error);
    res.status(500).json({ error: 'Failed to get thread' });
  }
};

// ── POST /api/messages/threads/:threadId/reply ──
const replyToThread = async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = parseInt(req.params.threadId);
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    if (body.length > 10000) {
      return res.status(400).json({ error: 'Message body must be 10,000 characters or fewer' });
    }

    if (!await isParticipant(threadId, userId)) {
      return res.status(403).json({ error: 'Not a participant in this thread' });
    }

    const result = await pool.query(
      `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
      [threadId, userId, body.trim()]
    );

    // Update read status for sender
    await pool.query(`
      INSERT INTO message_read_status (thread_id, user_id, last_read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = NOW()
    `, [threadId, userId]);

    // Attach username for frontend convenience
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
    const message = { ...result.rows[0], sender_username: userResult.rows[0].username };

    res.status(201).json({ message });
  } catch (error) {
    console.error('Error replying to thread:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
};

// ── GET /api/messages/threads/:threadId/messages ──
const getMessages = async (req, res) => {
  try {
    const userId = req.user.userId;
    const threadId = parseInt(req.params.threadId);
    const before = req.query.before;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    if (!await isParticipant(threadId, userId)) {
      return res.status(403).json({ error: 'Not a participant in this thread' });
    }

    let query, params;
    if (before) {
      query = `
        SELECT m.*, u.username AS sender_username
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.thread_id = $1 AND m.created_at < $2
        ORDER BY m.created_at DESC
        LIMIT $3
      `;
      params = [threadId, before, limit];
    } else {
      query = `
        SELECT m.*, u.username AS sender_username
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.thread_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [threadId, limit];
    }

    const result = await pool.query(query, params);

    // Return in chronological order (reversed from DESC query)
    res.json({ messages: result.rows.reverse() });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

// ── GET /api/messages/unread-count ──
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      WITH RECURSIVE doc_roots AS (
        SELECT d.id AS doc_id, d.id AS current_id, d.source_document_id
        FROM documents d
        UNION ALL
        SELECT dr.doc_id, parent.id AS current_id, parent.source_document_id
        FROM doc_roots dr
        JOIN documents parent ON parent.id = dr.source_document_id
        WHERE dr.source_document_id IS NOT NULL
      ),
      roots AS (
        SELECT doc_id, current_id AS root_document_id
        FROM doc_roots
        WHERE source_document_id IS NULL
      ),
      author_groups AS (
        SELECT r.doc_id AS document_id, d.uploaded_by AS user_id
        FROM roots r
        JOIN documents d ON d.id = r.root_document_id
        UNION
        SELECT r.doc_id AS document_id, da.user_id
        FROM roots r
        JOIN document_authors da ON da.document_id = r.root_document_id
      ),
      user_threads AS (
        SELECT mt.id AS thread_id
        FROM message_threads mt
        JOIN document_annotations da ON da.id = mt.annotation_id
        LEFT JOIN author_groups ag ON ag.document_id = da.document_id AND ag.user_id = $1
        WHERE mt.external_user_id = $1 OR ag.user_id IS NOT NULL
      )
      SELECT COALESCE(SUM(
        (SELECT COUNT(*) FROM messages m
         WHERE m.thread_id = ut.thread_id
           AND m.created_at > COALESCE(
             (SELECT mrs.last_read_at FROM message_read_status mrs
              WHERE mrs.thread_id = ut.thread_id AND mrs.user_id = $1),
             '1970-01-01'::timestamp
           ))
      ), 0) AS total_unread
      FROM user_threads ut
    `, [userId]);

    res.json({ unread_count: parseInt(result.rows[0].total_unread) });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};

// ── GET /api/messages/annotations/:annotationId/status ──
const getAnnotationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;
    const annotationId = parseInt(req.params.annotationId);

    // Get the annotation's details
    const annResult = await pool.query(
      'SELECT id, document_id, edge_id, quote_text FROM document_annotations WHERE id = $1',
      [annotationId]
    );
    if (annResult.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }
    const annotation = annResult.rows[0];
    const documentId = annotation.document_id;
    const authorGroup = await getAuthorGroup(documentId);
    const isAuthor = authorGroup.includes(userId);

    // Phase 31d: Find equivalent annotations across the version chain.
    // Two annotations are equivalent if they share the same edge_id AND same quote_text
    // AND their documents are in the same version lineage.
    const equivalentAnns = await pool.query(`
      WITH RECURSIVE lineage_up AS (
        SELECT id, source_document_id FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id, d.source_document_id
        FROM documents d JOIN lineage_up lu ON d.id = lu.source_document_id
      ),
      lineage_down AS (
        SELECT id FROM documents WHERE source_document_id = $1
        UNION ALL
        SELECT d.id FROM documents d JOIN lineage_down ld ON d.source_document_id = ld.id
      ),
      all_versions AS (
        SELECT id FROM lineage_up
        UNION
        SELECT id FROM lineage_down
      )
      SELECT da.id FROM document_annotations da
      JOIN all_versions av ON da.document_id = av.id
      WHERE da.edge_id = $2
        AND ((da.quote_text IS NULL AND $3::text IS NULL) OR da.quote_text = $3)
        AND da.id != $4
    `, [documentId, annotation.edge_id, annotation.quote_text, annotationId]);

    const allAnnotationIds = [annotationId, ...equivalentAnns.rows.map(r => r.id)];

    // Find all threads for this annotation AND equivalent annotations
    const threadsResult = await pool.query(
      'SELECT id, annotation_id, external_user_id, thread_type, created_at FROM message_threads WHERE annotation_id = ANY($1::int[])',
      [allAnnotationIds]
    );

    // Filter to threads where this user is a participant
    const participantThreads = threadsResult.rows.filter(t =>
      t.external_user_id === userId || isAuthor
    );

    res.json({
      is_participant: participantThreads.length > 0,
      is_author: isAuthor,
      author_group_size: authorGroup.length,
      threads: participantThreads,
      equivalent_annotation_ids: allAnnotationIds
    });
  } catch (error) {
    console.error('Error getting annotation status:', error);
    res.status(500).json({ error: 'Failed to get annotation status' });
  }
};

module.exports = {
  createThread,
  getThreads,
  getThread,
  replyToThread,
  getMessages,
  getUnreadCount,
  getAnnotationStatus
};
