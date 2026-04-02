const pool = require('../config/database');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');
const { getRootDocumentId, isDocumentAuthor } = require('../utils/documentLineage');

// Phase 22a: Extract text and format from an uploaded file buffer.
// Returns { body, format } or throws with a message for unsupported types.
const extractTextFromFile = async (buffer, originalname) => {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.txt') {
    return { body: buffer.toString('utf-8'), format: 'plain' };
  } else if (ext === '.md') {
    return { body: buffer.toString('utf-8'), format: 'markdown' };
  } else if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    return { body: data.text, format: 'pdf' };
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return { body: result.value, format: 'docx' };
  } else {
    const err = new Error(`Unsupported file type: ${ext}`);
    err.status = 400;
    throw err;
  }
};

// Create a new corpus
const createCorpus = async (req, res) => {
  try {
    const { name, description, annotationMode } = req.body;
    const userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Corpus name is required' });
    }

    if (name.trim().length > 255) {
      return res.status(400).json({ error: 'Corpus name must be 255 characters or less' });
    }

    // Validate annotationMode if provided
    const mode = annotationMode || 'public';
    if (!['public', 'private'].includes(mode)) {
      return res.status(400).json({ error: 'annotationMode must be "public" or "private" (note: this field is functionally retired)' });
    }

    // Check for duplicate corpus name (case-insensitive)
    const nameCheck = await pool.query(
      'SELECT id FROM corpuses WHERE LOWER(name) = LOWER($1)',
      [name.trim()]
    );
    if (nameCheck.rows.length > 0) {
      return res.status(409).json({ error: 'A corpus with this name already exists' });
    }

    const result = await pool.query(
      `INSERT INTO corpuses (name, description, annotation_mode, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, annotation_mode, created_by, created_at`,
      [name.trim(), description?.trim() || null, mode, userId]
    );

    res.status(201).json({ corpus: result.rows[0] });
  } catch (error) {
    console.error('Error creating corpus:', error);
    res.status(500).json({ error: 'Failed to create corpus' });
  }
};

// List all corpuses (browsable — any logged-in or guest user)
const listCorpuses = async (req, res) => {
  try {
    const userId = req.user?.userId || -1;

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.annotation_mode, c.created_by, c.created_at,
              u.username AS owner_username,
              u.orcid_id AS owner_orcid_id,
              COUNT(DISTINCT cd.document_id) AS document_count,
              (SELECT COUNT(*) FROM corpus_subscriptions cs WHERE cs.corpus_id = c.id) AS subscriber_count,
              BOOL_OR(cs_user.user_id IS NOT NULL) AS user_subscribed
       FROM corpuses c
       JOIN users u ON u.id = c.created_by
       LEFT JOIN corpus_documents cd ON cd.corpus_id = c.id
       LEFT JOIN corpus_subscriptions cs_user ON cs_user.corpus_id = c.id AND cs_user.user_id = $1
       GROUP BY c.id, u.username, u.orcid_id
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({ corpuses: result.rows });
  } catch (error) {
    console.error('Error listing corpuses:', error);
    res.status(500).json({ error: 'Failed to list corpuses' });
  }
};

// List current user's own corpuses
const listMyCorpuses = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.annotation_mode, c.created_by, c.created_at,
              COUNT(DISTINCT cd.document_id) AS document_count
       FROM corpuses c
       LEFT JOIN corpus_documents cd ON cd.corpus_id = c.id
       WHERE c.created_by = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({ corpuses: result.rows });
  } catch (error) {
    console.error('Error listing user corpuses:', error);
    res.status(500).json({ error: 'Failed to list corpuses' });
  }
};

// Get a single corpus with its document list
const getCorpus = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.id);
    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    // Get corpus details
    const corpusResult = await pool.query(
      `SELECT c.id, c.name, c.description, c.annotation_mode, c.created_by, c.created_at,
              u.username AS owner_username,
              u.orcid_id AS owner_orcid_id,
              (SELECT COUNT(*) FROM corpus_subscriptions cs WHERE cs.corpus_id = c.id) AS subscriber_count
       FROM corpuses c
       JOIN users u ON u.id = c.created_by
       WHERE c.id = $1`,
      [corpusId]
    );

    if (corpusResult.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    // Check if current user is subscribed
    const userId = req.user?.userId || -1;
    const subCheck = await pool.query(
      'SELECT id FROM corpus_subscriptions WHERE user_id = $1 AND corpus_id = $2',
      [userId, corpusId]
    );
    const userSubscribed = subCheck.rows.length > 0;

    // Get documents in this corpus, with root_document_id resolved via recursive CTE
    // so the frontend can reliably group version chains even if intermediate versions
    // are missing from the corpus.
    const docsResult = await pool.query(
      `WITH RECURSIVE doc_roots AS (
         SELECT d.id AS doc_id, d.id AS current_id, d.source_document_id
         FROM corpus_documents cd
         JOIN documents d ON d.id = cd.document_id
         WHERE cd.corpus_id = $1
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
       )
       SELECT d.id, d.title, d.format, d.uploaded_by, d.created_at,
              d.version_number, d.source_document_id,
              r.root_document_id,
              u.username AS uploader_username,
              u.orcid_id AS uploader_orcid_id,
              cd.added_by AS added_to_corpus_by,
              cd.created_at AS added_at,
              CASE WHEN dt.id IS NOT NULL
                THEN json_build_array(json_build_object('id', dt.id, 'name', dt.name))
                ELSE '[]'::json
              END AS tags
       FROM corpus_documents cd
       JOIN documents d ON d.id = cd.document_id
       LEFT JOIN users u ON u.id = d.uploaded_by
       LEFT JOIN document_tags dt ON dt.id = d.tag_id
       LEFT JOIN roots r ON r.doc_id = d.id
       WHERE cd.corpus_id = $1
       ORDER BY cd.created_at DESC`,
      [corpusId]
    );

    res.json({
      corpus: corpusResult.rows[0],
      documents: docsResult.rows,
      userSubscribed
    });
  } catch (error) {
    console.error('Error getting corpus:', error);
    res.status(500).json({ error: 'Failed to get corpus' });
  }
};

// Update a corpus (name, description, annotation_mode) — owner only
const updateCorpus = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { name, description, annotationMode } = req.body;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    // Verify ownership
    const ownerCheck = await pool.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the corpus owner can update it' });
    }

    // Build dynamic update
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Corpus name cannot be empty' });
      }
      if (name.trim().length > 255) {
        return res.status(400).json({ error: 'Corpus name must be 255 characters or less' });
      }
      // Check for duplicate corpus name (case-insensitive), excluding this corpus
      const nameCheck = await pool.query(
        'SELECT id FROM corpuses WHERE LOWER(name) = LOWER($1) AND id != $2',
        [name.trim(), corpusId]
      );
      if (nameCheck.rows.length > 0) {
        return res.status(409).json({ error: 'A corpus with this name already exists' });
      }
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description?.trim() || null);
    }

    if (annotationMode !== undefined) {
      if (!['public', 'private'].includes(annotationMode)) {
        return res.status(400).json({ error: 'annotationMode must be "public" or "private" (note: this field is functionally retired)' });
      }
      updates.push(`annotation_mode = $${paramIndex++}`);
      values.push(annotationMode);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(corpusId);
    const result = await pool.query(
      `UPDATE corpuses SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, description, annotation_mode, created_by, created_at`,
      values
    );

    res.json({ corpus: result.rows[0] });
  } catch (error) {
    console.error('Error updating corpus:', error);
    res.status(500).json({ error: 'Failed to update corpus' });
  }
};

// Delete a corpus — owner only
// Removes all corpus-document links. Documents that end up in
// zero corpuses are also deleted.
const deleteCorpus = async (req, res) => {
  const client = await pool.connect();
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    await client.query('BEGIN');

    // Verify ownership
    const ownerCheck = await client.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the corpus owner can delete it' });
    }

    // Find documents that are ONLY in this corpus (will be orphaned)
    // Include uploaded_by so we can check if an allowed user authored them
    const orphanedDocs = await client.query(
      `SELECT cd.document_id, d.uploaded_by
       FROM corpus_documents cd
       JOIN documents d ON d.id = cd.document_id
       WHERE cd.corpus_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM corpus_documents cd2
           WHERE cd2.document_id = cd.document_id
             AND cd2.corpus_id != $1
         )`,
      [corpusId]
    );

    // Phase 9b: Determine which orphans to rescue vs delete.
    // Rescue = leave orphaned for the author to handle later.
    // A doc is rescued if its uploader is an allowed user (not the corpus owner).
    const allowedUsers = await client.query(
      'SELECT user_id FROM corpus_allowed_users WHERE corpus_id = $1',
      [corpusId]
    );
    const allowedUserIds = new Set(allowedUsers.rows.map(r => r.user_id));

    const docsToDelete = [];
    const docsToRescue = [];

    for (const doc of orphanedDocs.rows) {
      // Rescue if the uploader is an allowed user and not the corpus owner
      if (doc.uploaded_by !== userId && allowedUserIds.has(doc.uploaded_by)) {
        docsToRescue.push(doc.document_id);
      } else {
        docsToDelete.push(doc.document_id);
      }
    }

    // Delete the corpus (CASCADE removes corpus_documents, annotations, subscriptions, etc.)
    await client.query('DELETE FROM corpuses WHERE id = $1', [corpusId]);

    // Delete orphaned documents that are NOT being rescued
    let orphanedDocsRemoved = 0;
    if (docsToDelete.length > 0) {
      const deleteResult = await client.query(
        'DELETE FROM documents WHERE id = ANY($1)',
        [docsToDelete]
      );
      orphanedDocsRemoved = deleteResult.rowCount;
    }

    // Rescued documents are left in the database with zero corpus_documents rows.
    // The contributing user will see them via GET /corpuses/orphaned-documents.

    await client.query('COMMIT');

    res.json({
      message: 'Corpus deleted',
      orphanedDocumentsRemoved: orphanedDocsRemoved,
      documentsAwaitingRescue: docsToRescue.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting corpus:', error);
    res.status(500).json({ error: 'Failed to delete corpus' });
  } finally {
    client.release();
  }
};

// ============================================================
// Duplicate Detection (Phase 7b)
// ============================================================

// Check for existing documents similar to the text being uploaded.
// Uses pg_trgm similarity on a truncated prefix of the body text
// (first 5000 chars) for performance. Returns matches above 0.3
// similarity threshold, sorted by similarity descending.
const checkDuplicates = async (req, res) => {
  try {
    let body;

    // Accept either a file upload (for PDF/DOCX) or JSON body text
    if (req.file) {
      const extracted = await extractTextFromFile(req.file.buffer, req.file.originalname);
      body = extracted.body;
    } else {
      body = req.body.body;
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Document body is required' });
    }

    // Use a prefix for comparison — full-body trigram similarity on very
    // long documents is expensive. 5000 chars captures the distinctive
    // content of most documents while staying fast.
    const prefix = body.substring(0, 5000);

    // pg_trgm similarity() returns a value from 0 to 1.
    // 0.3 is a reasonable threshold — catches near-duplicates and
    // substantially similar content without too many false positives.
    const result = await pool.query(
      `SELECT d.id, d.title, d.format, d.uploaded_by, d.created_at,
              u.username AS uploader_username,
              similarity(LEFT(d.body, 5000), $1) AS sim_score
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE similarity(LEFT(d.body, 5000), $1) > 0.3
       ORDER BY sim_score DESC
       LIMIT 10`,
      [prefix]
    );

    // For each matching document, also fetch which corpuses it belongs to
    const matches = [];
    for (const doc of result.rows) {
      const corpusesRes = await pool.query(
        `SELECT c.id, c.name
         FROM corpus_documents cd
         JOIN corpuses c ON c.id = cd.corpus_id
         WHERE cd.document_id = $1
         ORDER BY c.name ASC`,
        [doc.id]
      );

      matches.push({
        id: doc.id,
        title: doc.title,
        format: doc.format,
        uploaderUsername: doc.uploader_username,
        createdAt: doc.created_at,
        similarityScore: parseFloat(doc.sim_score),
        corpuses: corpusesRes.rows,
      });
    }

    res.json({ matches });
  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({ error: 'Failed to check for duplicates' });
  }
};

// ============================================================
// Document Search (Phase 7e — for "Add existing document" UI)
// ============================================================

// Search documents by title. Excludes documents already in the specified corpus.
// Used by the "Add existing document" flow in CorpusDetailView.
const searchDocuments = async (req, res) => {
  try {
    const { q, excludeCorpusId } = req.query;

    if (!q || !q.trim()) {
      return res.json({ documents: [] });
    }

    const query = q.trim();
    const params = [`%${query}%`];
    let excludeClause = '';

    if (excludeCorpusId) {
      const corpusId = parseInt(excludeCorpusId);
      if (!isNaN(corpusId)) {
        excludeClause = `AND d.id NOT IN (SELECT document_id FROM corpus_documents WHERE corpus_id = $2)`;
        params.push(corpusId);
      }
    }

    const result = await pool.query(
      `SELECT d.id, d.title, d.format, d.uploaded_by, d.created_at,
              u.username AS uploader_username
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.title ILIKE $1 ${excludeClause}
         AND NOT EXISTS (SELECT 1 FROM documents d2 WHERE d2.source_document_id = d.id)
       ORDER BY d.title ASC
       LIMIT 10`,
      params
    );

    // For each match, also list which corpuses it's already in
    const documents = [];
    for (const doc of result.rows) {
      const corpusesRes = await pool.query(
        `SELECT c.id, c.name
         FROM corpus_documents cd
         JOIN corpuses c ON c.id = cd.corpus_id
         WHERE cd.document_id = $1
         ORDER BY c.name ASC`,
        [doc.id]
      );
      documents.push({
        ...doc,
        corpuses: corpusesRes.rows,
      });
    }

    res.json({ documents });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
};

// ============================================================
// Document Endpoints (Phase 7a-3)
// ============================================================

// Upload a new document and place it into a corpus
const uploadDocument = async (req, res) => {
  const client = await pool.connect();
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    // Phase 36b: Copyright confirmation (multipart string comparison)
    if (req.body.copyrightConfirmed !== 'true') {
      return res.status(400).json({ error: 'Copyright confirmation is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }

    // Verify corpus exists and check permissions (owner or allowed user)
    const permCheck = await pool.query(
      'SELECT id, created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (permCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }
    const isOwner = permCheck.rows[0].created_by === userId;
    if (!isOwner) {
      const allowedCheck = await pool.query(
        'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
        [corpusId, userId]
      );
      if (allowedCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Only the corpus owner or allowed users can upload documents' });
      }
    }

    // Extract text from the uploaded file
    let body, docFormat;
    try {
      ({ body, format: docFormat } = await extractTextFromFile(req.file.buffer, req.file.originalname));
    } catch (extractErr) {
      return res.status(extractErr.status || 400).json({ error: extractErr.message });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Could not extract text from the uploaded file' });
    }

    // Derive title: use provided form field or fallback to filename without extension
    const rawTitle = (req.body.title && req.body.title.trim())
      ? req.body.title.trim()
      : path.basename(req.file.originalname, path.extname(req.file.originalname));

    if (rawTitle.length > 255) {
      return res.status(400).json({ error: 'Document title must be 255 characters or less' });
    }

    // Parse optional tags field (JSON array of tag IDs)
    let tagIds = [];
    if (req.body.tags) {
      try {
        tagIds = JSON.parse(req.body.tags);
        if (!Array.isArray(tagIds)) tagIds = [];
      } catch (_) {
        tagIds = [];
      }
    }

    // Check for duplicate document title (case-insensitive)
    const titleCheck = await pool.query(
      'SELECT id FROM documents WHERE LOWER(title) = LOWER($1)',
      [rawTitle]
    );
    if (titleCheck.rows.length > 0) {
      return res.status(409).json({ error: 'A document with this title already exists' });
    }

    await client.query('BEGIN');

    // Verify corpus exists
    const corpusCheck = await client.query(
      'SELECT id FROM corpuses WHERE id = $1',
      [corpusId]
    );

    if (corpusCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Corpus not found' });
    }

    // Create the document
    const docResult = await client.query(
      `INSERT INTO documents (title, body, format, uploaded_by, copyright_confirmed_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, title, format, uploaded_by, created_at`,
      [rawTitle, body, docFormat, userId]
    );

    const document = docResult.rows[0];

    // Link it to the corpus
    await client.query(
      `INSERT INTO corpus_documents (corpus_id, document_id, added_by)
       VALUES ($1, $2, $3)`,
      [corpusId, document.id, userId]
    );

    // Assign single tag if provided (take first from array — Phase 25a)
    if (tagIds.length > 0) {
      await client.query(
        'UPDATE documents SET tag_id = $1 WHERE id = $2',
        [tagIds[0], document.id]
      );
    }

    // Phase 38j: Detect and store citation links
    await detectAndStoreCitations(document.id, body, client);

    await client.query('COMMIT');

    res.status(201).json({ document });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  } finally {
    client.release();
  }
};

// Add an existing document to a corpus (corpus owner or allowed users)
const addDocumentToCorpus = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { documentId } = req.body;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    // Verify corpus exists and check permissions (owner or allowed user)
    const corpusCheck = await pool.query(
      'SELECT id, created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );

    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    const isOwner = corpusCheck.rows[0].created_by === userId;
    if (!isOwner) {
      const allowedCheck = await pool.query(
        'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
        [corpusId, userId]
      );
      if (allowedCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Only the corpus owner or allowed users can add documents' });
      }
    }

    // Verify document exists
    const docCheck = await pool.query(
      'SELECT id FROM documents WHERE id = $1',
      [documentId]
    );

    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Link document to corpus
    const result = await pool.query(
      `INSERT INTO corpus_documents (corpus_id, document_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (corpus_id, document_id) DO NOTHING
       RETURNING id`,
      [corpusId, documentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Document is already in this corpus' });
    }

    res.status(201).json({ message: 'Document added to corpus' });
  } catch (error) {
    console.error('Error adding document to corpus:', error);
    res.status(500).json({ error: 'Failed to add document to corpus' });
  }
};

// Remove a document from a corpus (corpus owner only)
// If the document ends up in zero corpuses, it is deleted.
const removeDocumentFromCorpus = async (req, res) => {
  const client = await pool.connect();
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { documentId } = req.body;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    await client.query('BEGIN');

    // Verify corpus ownership
    const corpusCheck = await client.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );

    if (corpusCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the corpus owner can remove documents from it' });
    }

    // Phase 9b: Get the document's uploader BEFORE removing the link
    const docInfo = await client.query(
      'SELECT uploaded_by FROM documents WHERE id = $1',
      [documentId]
    );

    if (docInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete annotations for this document within this corpus
    await client.query(
      'DELETE FROM document_annotations WHERE corpus_id = $1 AND document_id = $2',
      [corpusId, documentId]
    );

    // Remove the link
    const removeResult = await client.query(
      'DELETE FROM corpus_documents WHERE corpus_id = $1 AND document_id = $2',
      [corpusId, documentId]
    );

    if (removeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document is not in this corpus' });
    }

    // Check if the document is now orphaned (in zero corpuses)
    const remainingLinks = await client.query(
      'SELECT COUNT(*) AS count FROM corpus_documents WHERE document_id = $1',
      [documentId]
    );

    let documentDeleted = false;
    let documentOrphaned = false;

    if (parseInt(remainingLinks.rows[0].count) === 0) {
      // Phase 9b: Check if uploader is an allowed user (not corpus owner)
      const uploaderId = docInfo.rows[0].uploaded_by;
      let isAllowedUserDoc = false;

      if (uploaderId !== userId) {
        const allowedCheck = await client.query(
          'SELECT 1 FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
          [corpusId, uploaderId]
        );
        isAllowedUserDoc = allowedCheck.rows.length > 0;
      }

      if (isAllowedUserDoc) {
        // Rescue: leave orphaned for the author to handle
        documentOrphaned = true;
      } else {
        // Delete as before
        await client.query('DELETE FROM documents WHERE id = $1', [documentId]);
        documentDeleted = true;
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Document removed from corpus',
      documentDeleted,
      documentOrphaned
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing document from corpus:', error);
    res.status(500).json({ error: 'Failed to remove document from corpus' });
  } finally {
    client.release();
  }
};

// Get a single document (full body text) — guest accessible
const getDocument = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const result = await pool.query(
      `SELECT d.id, d.title, d.body, d.format, d.uploaded_by, d.created_at,
              d.version_number, d.source_document_id,
              u.username AS uploader_username,
              u.orcid_id AS uploader_orcid_id
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = $1`,
      [documentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Also return which corpuses this document belongs to
    const corpusesResult = await pool.query(
      `SELECT c.id, c.name, c.annotation_mode, c.created_by,
              u.username AS owner_username,
              u.orcid_id AS owner_orcid_id
       FROM corpus_documents cd
       JOIN corpuses c ON c.id = cd.corpus_id
       JOIN users u ON u.id = c.created_by
       WHERE cd.document_id = $1
       ORDER BY c.name ASC`,
      [documentId]
    );

    res.json({
      document: result.rows[0],
      corpuses: corpusesResult.rows
    });
  } catch (error) {
    console.error('Error getting document:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
};

// ============================================================
// Document Versioning (Phase 7h)
// ============================================================

// Create a new version of an existing document within a corpus
// Copies the source document's text into a new document. Only allowed
// Only document authors (uploader or coauthors) can create versions.
const createVersion = async (req, res) => {
  const client = await pool.connect();
  try {
    const corpusId = parseInt(req.body.corpusId);
    const sourceDocumentId = parseInt(req.body.sourceDocumentId);
    const userId = req.user.userId;

    if (!corpusId || !sourceDocumentId || isNaN(corpusId) || isNaN(sourceDocumentId)) {
      return res.status(400).json({ error: 'corpusId and sourceDocumentId are required' });
    }

    // Phase 36b: Copyright confirmation (multipart string comparison)
    if (req.body.copyrightConfirmed !== 'true') {
      return res.status(400).json({ error: 'Copyright confirmation is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }

    // Extract text from the uploaded file
    let body, docFormat;
    try {
      ({ body, format: docFormat } = await extractTextFromFile(req.file.buffer, req.file.originalname));
    } catch (extractErr) {
      return res.status(extractErr.status || 400).json({ error: extractErr.message });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'Could not extract text from the uploaded file' });
    }

    // Verify corpus exists
    const corpusCheck = await client.query(
      'SELECT id FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    // Verify source document exists (may be in this corpus or accessed via version history from another corpus)
    const docCheck = await client.query(
      `SELECT d.id, d.title, d.format, d.version_number, d.source_document_id, d.tag_id, d.uploaded_by
       FROM documents d
       WHERE d.id = $1`,
      [sourceDocumentId]
    );
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const sourceDoc = docCheck.rows[0];

    // Phase 26a: Any co-author (uploader or document_authors member) can create new versions
    const canVersion = await isDocumentAuthor(pool, sourceDocumentId, userId);
    if (!canVersion) {
      return res.status(403).json({ error: 'Only the document author can create new versions' });
    }

    // Find the root of the version chain to compute next version number
    const rootDocId = await getRootDocumentId(pool, sourceDocumentId);
    const maxVersionResult = await client.query(
      `WITH RECURSIVE lineage AS (
        SELECT id, version_number FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id, d.version_number FROM documents d
        JOIN lineage l ON d.source_document_id = l.id
      )
      SELECT MAX(version_number) AS max_version FROM lineage`,
      [rootDocId]
    );
    const nextVersion = (parseInt(maxVersionResult.rows[0].max_version) || 1) + 1;

    await client.query('BEGIN');

    // Create the new version document — always point source_document_id to the
    // previous latest version (the one we're superseding), keeping a linear chain.
    // The new version's source is the source doc being viewed, preserving lineage.
    const newDoc = await client.query(
      `INSERT INTO documents (title, body, format, uploaded_by, version_number, source_document_id, tag_id, copyright_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, title, body, format, uploaded_by, created_at, version_number, source_document_id`,
      [sourceDoc.title, body, docFormat, userId, nextVersion, sourceDoc.id, sourceDoc.tag_id || null]
    );

    const newDocId = newDoc.rows[0].id;

    // Auto-add the new version to ALL corpuses the source document belongs to
    const sourceCorpuses = await client.query(
      'SELECT corpus_id FROM corpus_documents WHERE document_id = $1',
      [sourceDocumentId]
    );
    for (const row of sourceCorpuses.rows) {
      await client.query(
        `INSERT INTO corpus_documents (corpus_id, document_id, added_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (corpus_id, document_id) DO NOTHING`,
        [row.corpus_id, newDocId, userId]
      );
    }

    // Also ensure the current corpus has it (in case source wasn't in this corpus,
    // e.g. reached via version history)
    await client.query(
      `INSERT INTO corpus_documents (corpus_id, document_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (corpus_id, document_id) DO NOTHING`,
      [corpusId, newDocId, userId]
    );

    // Copy annotations from source document to new version
    const copiedAnns = await client.query(
      `INSERT INTO document_annotations (corpus_id, document_id, edge_id, quote_text, comment, quote_occurrence, layer, created_by)
       SELECT corpus_id, $1, edge_id, quote_text, comment, quote_occurrence, layer, created_by
       FROM document_annotations WHERE document_id = $2
       RETURNING id`,
      [newDocId, sourceDocumentId]
    );

    // Copy annotation_votes for each copied annotation
    if (copiedAnns.rows.length > 0) {
      // Get source annotations in same order to map old→new
      const sourceAnns = await client.query(
        `SELECT id FROM document_annotations WHERE document_id = $1 ORDER BY id`,
        [sourceDocumentId]
      );
      const newAnns = await client.query(
        `SELECT id FROM document_annotations WHERE document_id = $1 ORDER BY id`,
        [newDocId]
      );
      // Map source annotation IDs to new annotation IDs (same insertion order)
      for (let i = 0; i < sourceAnns.rows.length; i++) {
        const oldAnnId = sourceAnns.rows[i].id;
        const newAnnId = newAnns.rows[i].id;
        await client.query(
          `INSERT INTO annotation_votes (user_id, annotation_id)
           SELECT user_id, $1 FROM annotation_votes WHERE annotation_id = $2
           ON CONFLICT (user_id, annotation_id) DO NOTHING`,
          [newAnnId, oldAnnId]
        );
      }
    }

    // Phase 38j: Detect and store citation links in new version
    await detectAndStoreCitations(newDocId, body, client);

    await client.query('COMMIT');

    res.status(201).json({ document: newDoc.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating version:', error);
    res.status(500).json({ error: 'Failed to create version' });
  } finally {
    client.release();
  }
};

// Get version history for a document — returns all versions in the lineage
const getVersionHistory = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    // Find the root of the version chain by walking up source_document_id
    // Then find all documents that share the same root
    const rootResult = await pool.query(
      `WITH RECURSIVE chain AS (
        -- Start from the requested document
        SELECT id, source_document_id, 0 AS depth
        FROM documents WHERE id = $1
        UNION ALL
        -- Walk up the chain
        SELECT d.id, d.source_document_id, c.depth + 1
        FROM documents d
        JOIN chain c ON d.id = c.source_document_id
        WHERE d.source_document_id IS NOT NULL OR c.depth = 0
      )
      SELECT id FROM chain ORDER BY depth DESC LIMIT 1`,
      [documentId]
    );

    // The root is the document at the top of the chain (no source_document_id)
    // Now find ALL documents in this lineage
    const rootId = rootResult.rows.length > 0 ? rootResult.rows[0].id : documentId;

    // Get all versions: the root itself + anything with source_document_id pointing
    // to any member of the chain. Use recursive CTE to walk down the tree.
    const versionsResult = await pool.query(
      `WITH RECURSIVE lineage AS (
        SELECT id FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id FROM documents d
        JOIN lineage l ON d.source_document_id = l.id
      )
      SELECT d.id, d.title, d.version_number, d.source_document_id,
             d.uploaded_by, d.created_at, u.username AS uploader_username,
             u.orcid_id AS uploader_orcid_id
      FROM documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.id IN (SELECT id FROM lineage)
      ORDER BY d.version_number ASC`,
      [rootId]
    );

    res.json({ versions: versionsResult.rows, currentDocumentId: documentId });
  } catch (error) {
    console.error('Error getting version history:', error);
    res.status(500).json({ error: 'Failed to get version history' });
  }
};

// Phase 21c: Get version chain for a document (lightweight — no body text)
// Guest-accessible. Used by frontend for version consolidation + navigator.
const getVersionChain = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    // Walk up to find the root of the version chain
    const rootResult = await pool.query(
      `WITH RECURSIVE chain AS (
        SELECT id, source_document_id, 0 AS depth
        FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id, d.source_document_id, c.depth + 1
        FROM documents d
        JOIN chain c ON d.id = c.source_document_id
        WHERE d.source_document_id IS NOT NULL OR c.depth = 0
      )
      SELECT id FROM chain ORDER BY depth DESC LIMIT 1`,
      [documentId]
    );

    const rootId = rootResult.rows.length > 0 ? rootResult.rows[0].id : documentId;

    // Get all versions in the lineage (no body text — lightweight)
    const versionsResult = await pool.query(
      `WITH RECURSIVE lineage AS (
        SELECT id FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id FROM documents d
        JOIN lineage l ON d.source_document_id = l.id
      )
      SELECT d.id, d.title, d.version_number, d.uploaded_by, d.created_at
      FROM documents d
      WHERE d.id IN (SELECT id FROM lineage)
      ORDER BY d.version_number ASC`,
      [rootId]
    );

    res.json({ versions: versionsResult.rows });
  } catch (error) {
    console.error('Error getting version chain:', error);
    res.status(500).json({ error: 'Failed to get version chain' });
  }
};

// Phase 31d: Get annotation fingerprints for all versions in a document's lineage.
// Returns { document_id, version_number, edge_id, quote_text } for each annotation
// across the entire version chain. Lightweight — no joins to users/corpuses.
const getVersionAnnotationMap = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const result = await pool.query(`
      WITH RECURSIVE chain_up AS (
        SELECT id, source_document_id FROM documents WHERE id = $1
        UNION ALL
        SELECT d.id, d.source_document_id
        FROM documents d JOIN chain_up cu ON d.id = cu.source_document_id
      ),
      chain_down AS (
        SELECT id FROM documents WHERE source_document_id = $1
        UNION ALL
        SELECT d.id FROM documents d JOIN chain_down cd ON d.source_document_id = cd.id
      ),
      all_versions AS (
        SELECT id FROM chain_up UNION SELECT id FROM chain_down
      )
      SELECT da.document_id, d.version_number, da.edge_id, da.quote_text
      FROM document_annotations da
      JOIN all_versions av ON da.document_id = av.id
      JOIN documents d ON d.id = da.document_id
    `, [documentId]);

    res.json({ annotations: result.rows });
  } catch (error) {
    console.error('Error getting version annotation map:', error);
    res.status(500).json({ error: 'Failed to get version annotation map' });
  }
};

// ============================================================
// Corpus Subscriptions (Phase 7c)
// ============================================================

// Subscribe to a corpus
const subscribe = async (req, res) => {
  try {
    const { corpusId } = req.body;
    const userId = req.user.userId;

    if (!corpusId) {
      return res.status(400).json({ error: 'corpusId is required' });
    }

    // Verify corpus exists
    const corpusCheck = await pool.query(
      'SELECT id FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    const result = await pool.query(
      `INSERT INTO corpus_subscriptions (user_id, corpus_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, corpus_id) DO NOTHING
       RETURNING id, user_id, corpus_id, created_at`,
      [userId, corpusId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Already subscribed to this corpus' });
    }

    // Add to sidebar_items
    await pool.query(
      `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
       VALUES ($1, 'corpus', $2,
         COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [userId, corpusId]
    );

    res.status(201).json({ subscription: result.rows[0] });
  } catch (error) {
    console.error('Error subscribing to corpus:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
};

// Unsubscribe from a corpus
const unsubscribe = async (req, res) => {
  try {
    const { corpusId } = req.body;
    const userId = req.user.userId;

    if (!corpusId) {
      return res.status(400).json({ error: 'corpusId is required' });
    }

    const result = await pool.query(
      'DELETE FROM corpus_subscriptions WHERE user_id = $1 AND corpus_id = $2',
      [userId, corpusId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not subscribed to this corpus' });
    }

    // Remove from sidebar_items
    await pool.query(
      `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'corpus' AND item_id = $2`,
      [userId, corpusId]
    );

    res.json({ message: 'Unsubscribed from corpus' });
  } catch (error) {
    console.error('Error unsubscribing from corpus:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
};

// Get current user's subscriptions (with corpus details)
const getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT cs.id AS subscription_id, cs.created_at AS subscribed_at,
              c.id, c.name, c.description, c.annotation_mode, c.created_by, c.created_at,
              u.username AS owner_username,
              COUNT(DISTINCT cd.document_id) AS document_count,
              (SELECT COUNT(*) FROM corpus_subscriptions cs2 WHERE cs2.corpus_id = c.id) AS subscriber_count
       FROM corpus_subscriptions cs
       JOIN corpuses c ON c.id = cs.corpus_id
       JOIN users u ON u.id = c.created_by
       LEFT JOIN corpus_documents cd ON cd.corpus_id = c.id
       WHERE cs.user_id = $1
       GROUP BY cs.id, c.id, u.username
       ORDER BY cs.created_at DESC`,
      [userId]
    );

    res.json({ subscriptions: result.rows });
  } catch (error) {
    console.error('Error getting subscriptions:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
};

// ============================================================
// Document Annotations (Phase 7d)
// ============================================================

// Create an annotation — attach an edge to a document,
// scoped to a specific corpus. Optionally includes a quote_text
// (text from the document), comment, and quote_occurrence (which
// occurrence of the quote to navigate to, default 1).
const createAnnotation = async (req, res) => {
  try {
    const { corpusId, documentId, edgeId, quoteText, comment, quoteOccurrence } = req.body;
    const userId = req.user.userId;

    // Validate required fields
    if (!corpusId || !documentId || !edgeId) {
      return res.status(400).json({ error: 'corpusId, documentId, and edgeId are required' });
    }
    if (quoteText && quoteText.length > 2000) {
      return res.status(400).json({ error: 'Quote text must be 2,000 characters or fewer' });
    }
    if (comment && comment.length > 5000) {
      return res.status(400).json({ error: 'Comment must be 5,000 characters or fewer' });
    }

    // Verify corpus exists
    const corpusCheck = await pool.query(
      'SELECT id, annotation_mode, created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    const corpus = corpusCheck.rows[0];

    // Phase 26d: layer is always 'public' (column is NOT NULL DEFAULT 'public')
    // Frontend layer param is ignored.
    const layer = 'public';

    // Verify the document is in this corpus
    const docCorpusCheck = await pool.query(
      'SELECT id FROM corpus_documents WHERE corpus_id = $1 AND document_id = $2',
      [corpusId, documentId]
    );
    if (docCorpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document is not in this corpus' });
    }

    // Verify the edge exists and is not hidden
    const edgeCheck = await pool.query(
      'SELECT id, is_hidden FROM edges WHERE id = $1',
      [edgeId]
    );
    if (edgeCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Edge not found' });
    }
    if (edgeCheck.rows[0].is_hidden) {
      return res.status(400).json({ error: 'Cannot annotate with a hidden concept' });
    }

    // Insert annotation + auto-vote in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO document_annotations (corpus_id, document_id, edge_id, quote_text, comment, quote_occurrence, created_by, layer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, corpus_id, document_id, edge_id, quote_text, comment, quote_occurrence, created_by, created_at, layer`,
        [corpusId, documentId, edgeId, quoteText || null, comment || null, quoteOccurrence || null, userId, layer]
      );

      // Auto-vote: creator automatically endorses their own annotation (Phase 26c-1)
      const annotationId = result.rows[0].id;
      await client.query(
        `INSERT INTO annotation_votes (user_id, annotation_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, annotation_id) DO NOTHING`,
        [userId, annotationId]
      );

      await client.query('COMMIT');

      res.status(201).json({ annotation: { ...result.rows[0], vote_count: 1, user_voted: true } });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating annotation:', error);
    res.status(500).json({ error: 'Failed to create annotation' });
  }
};

// Phase 26d: Get annotations for a document with identity-based filtering.
// Query param ?filter=all|corpus_members|author (default: "all").
// Legacy ?layer= param is mapped for backwards compatibility.
const getDocumentAnnotations = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.corpusId);
    const documentId = parseInt(req.params.documentId);

    if (isNaN(corpusId) || isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid corpus ID or document ID' });
    }

    // Verify document is in corpus
    const docCorpusCheck = await pool.query(
      'SELECT id FROM corpus_documents WHERE corpus_id = $1 AND document_id = $2',
      [corpusId, documentId]
    );
    if (docCorpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document is not in this corpus' });
    }

    const userId = req.user?.userId || -1;

    // Determine filter: support both ?filter= (new) and ?layer= (legacy)
    let filter = req.query.filter;
    if (!filter && req.query.layer) {
      const layerMap = { public: 'all', editorial: 'corpus_members', author: 'author' };
      filter = layerMap[req.query.layer] || 'all';
    }
    if (!filter) filter = 'all';

    if (!['all', 'corpus_members', 'author'].includes(filter)) {
      return res.status(400).json({ error: 'filter must be "all", "corpus_members", or "author"' });
    }

    // Resolve author IDs: uploaded_by on root doc UNION document_authors
    const rootDocId = await getRootDocumentId(pool, documentId);
    const authorResult = await pool.query(`
      SELECT uploaded_by AS user_id FROM documents WHERE id = $1
      UNION
      SELECT user_id FROM document_authors WHERE document_id = $1
    `, [rootDocId]);
    const authorIds = authorResult.rows.map(r => r.user_id);

    // Resolve corpus member IDs and owner in one pass
    const corpusOwnerRow = await pool.query('SELECT created_by FROM corpuses WHERE id = $1', [corpusId]);
    const corpusOwnerId = corpusOwnerRow.rows[0]?.created_by;
    const corpusAllowedResult = await pool.query(
      'SELECT user_id FROM corpus_allowed_users WHERE corpus_id = $1', [corpusId]
    );
    const corpusMemberIds = [corpusOwnerId, ...corpusAllowedResult.rows.map(r => r.user_id)].filter(Boolean);
    const isCorpusOwner = userId !== -1 && corpusOwnerId === userId;
    const isAllowedUser = !isCorpusOwner && userId !== -1 && corpusMemberIds.includes(userId);

    // Build query based on filter
    const params = [corpusId, documentId, userId];
    let filterClause = '';
    let badgeColumns = '';

    if (filter === 'all') {
      // Return ALL annotations with 4 provenance badges
      badgeColumns = `,
        da.created_by = ANY($4::int[]) AS "addedByAuthor",
        EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = ANY($4::int[])) AS "votedByAuthor",
        da.created_by = ANY($5::int[]) AS "addedByCorpusMember",
        EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = ANY($5::int[])) AS "votedByCorpusMember"`;
      params.push(authorIds, corpusMemberIds);
    } else if (filter === 'corpus_members') {
      // Return annotations created by OR voted by corpus members, with author badges
      filterClause = `AND (da.created_by = ANY($4::int[]) OR EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = ANY($4::int[])))`;
      badgeColumns = `,
        da.created_by = ANY($5::int[]) AS "addedByAuthor",
        EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = ANY($5::int[])) AS "votedByAuthor"`;
      params.push(corpusMemberIds, authorIds);
    } else if (filter === 'author') {
      // Return annotations created by OR voted by authors, no badges
      filterClause = `AND (da.created_by = ANY($4::int[]) OR EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = ANY($4::int[])))`;
      params.push(authorIds);
    }

    // Sort parameter: votes (default) or subscribed
    const sortParam = req.query.sort;
    const useSubscribed = sortParam === 'subscribed' && userId !== -1;

    let subscribedCte = '';
    let subscribedCol = '';
    let orderClause = 'ORDER BY vote_count DESC';

    if (useSubscribed) {
      // Push userId for subscribed_members CTE — reuses $3 which is already userId
      subscribedCte = `WITH subscribed_members AS (
        SELECT DISTINCT member_id AS user_id FROM (
          SELECT c.created_by AS member_id
          FROM corpus_subscriptions cs
          JOIN corpuses c ON c.id = cs.corpus_id
          WHERE cs.user_id = $3
          AND c.created_by IS NOT NULL
          UNION
          SELECT cau.user_id AS member_id
          FROM corpus_subscriptions cs
          JOIN corpus_allowed_users cau ON cau.corpus_id = cs.corpus_id
          WHERE cs.user_id = $3
        ) members
      )`;
      subscribedCol = `, (SELECT COUNT(*) FROM annotation_votes av2 WHERE av2.annotation_id = da.id AND av2.user_id IN (SELECT user_id FROM subscribed_members))::int AS subscribed_vote_count`;
      orderClause = 'ORDER BY subscribed_vote_count DESC, vote_count DESC, da.created_at DESC';
    }

    const result = await pool.query(
      `${subscribedCte}
       SELECT da.id, da.corpus_id, da.document_id, da.edge_id,
              da.quote_text, da.comment, da.quote_occurrence, da.layer,
              da.created_by, da.created_at,
              u.username AS creator_username,
              u.orcid_id AS creator_orcid_id,
              e.parent_id, e.child_id, e.graph_path, e.attribute_id,
              c_child.name AS concept_name,
              a.name AS attribute_name,
              c_parent.name AS parent_name,
              (SELECT COUNT(*) FROM annotation_votes av WHERE av.annotation_id = da.id) AS vote_count,
              EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = $3) AS user_voted
              ${subscribedCol}
              ${badgeColumns}
       FROM document_annotations da
       JOIN users u ON u.id = da.created_by
       JOIN edges e ON e.id = da.edge_id
       JOIN concepts c_child ON c_child.id = e.child_id
       JOIN attributes a ON a.id = e.attribute_id
       LEFT JOIN concepts c_parent ON c_parent.id = e.parent_id
       WHERE da.corpus_id = $1 AND da.document_id = $2
       ${filterClause}
       ${orderClause}`,
      params
    );

    res.json({
      annotations: result.rows,
      isAllowedUser: isCorpusOwner || isAllowedUser,
      isCorpusOwner,
      isAuthor: userId !== -1 && authorIds.includes(userId),
      isCorpusMember: userId !== -1 && corpusMemberIds.includes(userId),
    });
  } catch (error) {
    console.error('Error getting document annotations:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
};

// Delete an annotation.
// Public layer: only the annotation creator can delete.
// Editorial layer: creator, corpus owner, or any allowed user can delete.
// Allowed user removals are logged in annotation_removal_log.
// Phase 26c-1: Annotations are now permanent — deletion is no longer allowed
const deleteAnnotation = async (req, res) => {
  return res.status(410).json({ error: 'Annotations can no longer be deleted' });
};

// Get ALL annotations for a document across ALL corpuses.
// Used for the decontextualized document view (Phase 7e).
// Returns annotations with edge details and corpus attribution,
// with duplicate detection (same text range + same edge in multiple corpuses).
const getAllDocumentAnnotations = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);

    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    // Verify document exists
    const docCheck = await pool.query(
      'SELECT id FROM documents WHERE id = $1',
      [documentId]
    );
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const result = await pool.query(
      `SELECT da.id, da.corpus_id, da.document_id, da.edge_id,
              da.quote_text, da.comment, da.quote_occurrence,
              da.created_by, da.created_at,
              u.username AS creator_username,
              e.parent_id, e.child_id, e.graph_path, e.attribute_id,
              c_child.name AS concept_name,
              a.name AS attribute_name,
              c_parent.name AS parent_name,
              c.name AS corpus_name,
              c.annotation_mode AS corpus_annotation_mode,
              c_owner.username AS corpus_owner_username,
              (SELECT COUNT(*) FROM corpus_subscriptions cs WHERE cs.corpus_id = c.id) AS corpus_subscriber_count,
              (SELECT COUNT(*) FROM annotation_votes av WHERE av.annotation_id = da.id) AS vote_count
       FROM document_annotations da
       JOIN users u ON u.id = da.created_by
       JOIN edges e ON e.id = da.edge_id
       JOIN concepts c_child ON c_child.id = e.child_id
       JOIN attributes a ON a.id = e.attribute_id
       LEFT JOIN concepts c_parent ON c_parent.id = e.parent_id
       JOIN corpuses c ON c.id = da.corpus_id
       JOIN users c_owner ON c_owner.id = c.created_by
       WHERE da.document_id = $1
       ORDER BY da.created_at ASC, c.name ASC`,
      [documentId]
    );

    // Group annotations and detect duplicates:
    // "Duplicate" = same quote_text + edge_id in multiple corpuses
    // These get merged into one annotation entry with multiple corpus attributions.
    const mergedAnnotations = [];
    const mergeKeyMap = {}; // key: `${quoteText}-${edgeId}` -> index in mergedAnnotations

    for (const row of result.rows) {
      const mergeKey = `${row.quote_text || ''}-${row.edge_id}`;

      if (mergeKeyMap[mergeKey] !== undefined) {
        // Duplicate — add this corpus to the existing annotation's corpus list
        mergedAnnotations[mergeKeyMap[mergeKey]].vote_count += parseInt(row.vote_count);
        mergedAnnotations[mergeKeyMap[mergeKey]].corpuses.push({
          corpusId: row.corpus_id,
          corpusName: row.corpus_name,
          annotationMode: row.corpus_annotation_mode,
          corpusOwnerUsername: row.corpus_owner_username,
          subscriberCount: parseInt(row.corpus_subscriber_count),
          annotationId: row.id,
          creatorUsername: row.creator_username,
          createdAt: row.created_at,
        });
      } else {
        // New unique annotation
        const idx = mergedAnnotations.length;
        mergeKeyMap[mergeKey] = idx;
        mergedAnnotations.push({
          // Use the first annotation's ID as the "primary" for display
          id: row.id,
          edge_id: row.edge_id,
          quote_text: row.quote_text,
          comment: row.comment,
          quote_occurrence: row.quote_occurrence,
          vote_count: parseInt(row.vote_count),
          parent_id: row.parent_id,
          child_id: row.child_id,
          graph_path: row.graph_path,
          attribute_id: row.attribute_id,
          concept_name: row.concept_name,
          attribute_name: row.attribute_name,
          parent_name: row.parent_name,
          corpuses: [{
            corpusId: row.corpus_id,
            corpusName: row.corpus_name,
            annotationMode: row.corpus_annotation_mode,
            corpusOwnerUsername: row.corpus_owner_username,
            subscriberCount: parseInt(row.corpus_subscriber_count),
            annotationId: row.id,
            creatorUsername: row.creator_username,
            createdAt: row.created_at,
          }],
        });
      }
    }

    res.json({
      annotations: mergedAnnotations,
      totalAnnotations: result.rows.length,
      uniqueAnnotations: mergedAnnotations.length,
    });
  } catch (error) {
    console.error('Error getting all document annotations:', error);
    res.status(500).json({ error: 'Failed to get document annotations' });
  }
};

// Get all annotations across all corpuses for a specific edge.
// Used for the "Document Annotations" section on the External Links page.
// Returns annotations grouped by corpus, with document title and text snippet.
const getAnnotationsForEdge = async (req, res) => {
  try {
    const edgeId = parseInt(req.params.edgeId);

    if (isNaN(edgeId)) {
      return res.status(400).json({ error: 'Invalid edge ID' });
    }

    // Deduplicate across document versions: for each version chain + corpus + quote_text,
    // keep only the annotation from the latest version (highest version_number).
    // Uses a window function to rank annotations within each lineage group.
    const result = await pool.query(
      `WITH RECURSIVE doc_roots AS (
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
        FROM doc_roots WHERE source_document_id IS NULL
      ),
      ranked AS (
        SELECT da.id, da.corpus_id, da.document_id, da.edge_id,
               da.quote_text, da.comment, da.quote_occurrence,
               da.created_by, da.created_at,
               u.username AS creator_username,
               d.title AS document_title, d.format AS document_format, d.version_number AS document_version_number, d.uploaded_by AS document_uploaded_by,
               c.id AS c_id, c.name AS corpus_name, c.annotation_mode,
               c_owner.username AS corpus_owner_username,
               (SELECT COUNT(*) FROM corpus_subscriptions cs WHERE cs.corpus_id = c.id) AS corpus_subscriber_count,
               r.root_document_id,
               ROW_NUMBER() OVER (
                 PARTITION BY r.root_document_id, da.corpus_id, da.created_by, COALESCE(da.quote_text, '')
                 ORDER BY d.version_number DESC
               ) AS rn
        FROM document_annotations da
        JOIN users u ON u.id = da.created_by
        JOIN documents d ON d.id = da.document_id
        JOIN corpuses c ON c.id = da.corpus_id
        JOIN users c_owner ON c_owner.id = c.created_by
        JOIN roots r ON r.doc_id = da.document_id
        WHERE da.edge_id = $1
      )
      SELECT id, corpus_id, document_id, edge_id,
             quote_text, comment, quote_occurrence,
             created_by, created_at,
             creator_username,
             document_title, document_format, document_version_number, document_uploaded_by,
             c_id AS corpus_id, corpus_name, annotation_mode,
             corpus_owner_username, corpus_subscriber_count
      FROM ranked WHERE rn = 1
      ORDER BY corpus_name ASC, document_title ASC, created_at ASC`,
      [edgeId]
    );

    // Group by corpus for the frontend
    const corpusMap = {};
    for (const row of result.rows) {
      const cId = row.corpus_id;
      if (!corpusMap[cId]) {
        corpusMap[cId] = {
          corpusId: cId,
          corpusName: row.corpus_name,
          annotationMode: row.annotation_mode,
          corpusOwnerUsername: row.corpus_owner_username,
          subscriberCount: parseInt(row.corpus_subscriber_count),
          documents: {}
        };
      }
      const dId = row.document_id;
      if (!corpusMap[cId].documents[dId]) {
        corpusMap[cId].documents[dId] = {
          documentId: dId,
          documentTitle: row.document_title,
          documentFormat: row.document_format,
          documentVersionNumber: parseInt(row.document_version_number) || 1,
          uploadedBy: row.document_uploaded_by,
          tags: [],
          annotations: []
        };
      }
      corpusMap[cId].documents[dId].annotations.push({
        id: row.id,
        quoteText: row.quote_text,
        comment: row.comment,
        quoteOccurrence: row.quote_occurrence,
        creatorUsername: row.creator_username,
        createdAt: row.created_at
      });
    }

    // Convert to arrays
    const corpuses = Object.values(corpusMap).map(corpus => ({
      ...corpus,
      documents: Object.values(corpus.documents)
    }));

    // Phase 25a: Fetch tags via documents.tag_id (single tag per document)
    const allDocIds = [...new Set(result.rows.map(r => r.document_id))];
    if (allDocIds.length > 0) {
      const tagResult = await pool.query(
        `SELECT d.id AS document_id, dt.id AS tag_id, dt.name AS tag_name
         FROM documents d
         JOIN document_tags dt ON dt.id = d.tag_id
         WHERE d.id = ANY($1)`,
        [allDocIds]
      );
      // Build a map of docId -> tags
      const docTagMap = {};
      for (const row of tagResult.rows) {
        if (!docTagMap[row.document_id]) docTagMap[row.document_id] = [];
        docTagMap[row.document_id].push({ id: row.tag_id, name: row.tag_name });
      }
      // Attach tags to documents
      for (const corpus of corpuses) {
        for (const doc of corpus.documents) {
          doc.tags = docTagMap[doc.documentId] || [];
        }
      }
    }

    res.json({ corpuses, totalAnnotations: result.rows.length });
  } catch (error) {
    console.error('Error getting annotations for edge:', error);
    res.status(500).json({ error: 'Failed to get annotations for edge' });
  }
};

// Vote on an annotation (Phase 7f) — endorse the connection between text and concept
const voteOnAnnotation = async (req, res) => {
  try {
    const { annotationId } = req.body;
    const userId = req.user.userId;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }

    // Verify annotation exists
    const annCheck = await pool.query(
      'SELECT id FROM document_annotations WHERE id = $1',
      [annotationId]
    );
    if (annCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }

    // Phase 26c-1: Any logged-in user can vote on any annotation (editorial-layer restriction removed)

    // Insert vote (unique constraint prevents duplicates)
    await pool.query(
      `INSERT INTO annotation_votes (user_id, annotation_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, annotation_id) DO NOTHING`,
      [userId, annotationId]
    );

    // Return updated vote count
    const countResult = await pool.query(
      'SELECT COUNT(*) AS vote_count FROM annotation_votes WHERE annotation_id = $1',
      [annotationId]
    );

    res.json({
      message: 'Annotation vote added',
      voteCount: parseInt(countResult.rows[0].vote_count),
    });
  } catch (error) {
    console.error('Error voting on annotation:', error);
    res.status(500).json({ error: 'Failed to vote on annotation' });
  }
};

// Remove vote from an annotation (Phase 7f)
const unvoteAnnotation = async (req, res) => {
  try {
    const { annotationId } = req.body;
    const userId = req.user.userId;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }

    const result = await pool.query(
      'DELETE FROM annotation_votes WHERE user_id = $1 AND annotation_id = $2',
      [userId, annotationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Vote not found' });
    }

    // Return updated vote count
    const countResult = await pool.query(
      'SELECT COUNT(*) AS vote_count FROM annotation_votes WHERE annotation_id = $1',
      [annotationId]
    );

    res.json({
      message: 'Annotation vote removed',
      voteCount: parseInt(countResult.rows[0].vote_count),
    });
  } catch (error) {
    console.error('Error removing annotation vote:', error);
    res.status(500).json({ error: 'Failed to remove annotation vote' });
  }
};

// Vote for a color set preference on an annotation (Phase 7f)
// Stores/updates the user's preferred vote_set_key for this annotation.
const voteAnnotationColorSet = async (req, res) => {
  try {
    const { annotationId, voteSetKey } = req.body;
    const userId = req.user.userId;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }
    if (!voteSetKey || typeof voteSetKey !== 'string' || !voteSetKey.trim()) {
      return res.status(400).json({ error: 'voteSetKey is required (sorted comma-separated edge IDs)' });
    }

    // Verify annotation exists and check layer
    const annCheck = await pool.query(
      `SELECT da.id, da.layer, da.corpus_id, c.created_by AS corpus_owner_id
       FROM document_annotations da
       JOIN corpuses c ON c.id = da.corpus_id
       WHERE da.id = $1`,
      [annotationId]
    );
    if (annCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }

    // Phase 10a: Only allowed users can vote on editorial-layer annotations
    const annotation = annCheck.rows[0];
    if (annotation.layer === 'editorial') {
      const isOwner = annotation.corpus_owner_id === userId;
      if (!isOwner) {
        const allowedCheck = await pool.query(
          'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
          [annotation.corpus_id, userId]
        );
        if (allowedCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Only allowed users can vote on editorial-layer annotations' });
        }
      }
    }

    // Upsert: insert or update the user's color set preference
    await pool.query(
      `INSERT INTO annotation_color_set_votes (annotation_id, user_id, vote_set_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, annotation_id)
       DO UPDATE SET vote_set_key = $3, created_at = CURRENT_TIMESTAMP`,
      [annotationId, userId, voteSetKey.trim()]
    );

    // Return all color set votes for this annotation
    const votesResult = await pool.query(
      `SELECT vote_set_key, COUNT(*) AS vote_count
       FROM annotation_color_set_votes
       WHERE annotation_id = $1
       GROUP BY vote_set_key
       ORDER BY vote_count DESC`,
      [annotationId]
    );

    res.json({
      message: 'Color set preference saved',
      colorSetVotes: votesResult.rows,
      userVoteSetKey: voteSetKey.trim(),
    });
  } catch (error) {
    console.error('Error voting on annotation color set:', error);
    res.status(500).json({ error: 'Failed to save color set preference' });
  }
};

// Remove a user's color set preference from an annotation (Phase 7f)
const unvoteAnnotationColorSet = async (req, res) => {
  try {
    const { annotationId } = req.body;
    const userId = req.user.userId;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }

    const result = await pool.query(
      'DELETE FROM annotation_color_set_votes WHERE user_id = $1 AND annotation_id = $2',
      [userId, annotationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No color set preference found' });
    }

    // Return remaining color set votes
    const votesResult = await pool.query(
      `SELECT vote_set_key, COUNT(*) AS vote_count
       FROM annotation_color_set_votes
       WHERE annotation_id = $1
       GROUP BY vote_set_key
       ORDER BY vote_count DESC`,
      [annotationId]
    );

    res.json({
      message: 'Color set preference removed',
      colorSetVotes: votesResult.rows,
      userVoteSetKey: null,
    });
  } catch (error) {
    console.error('Error removing annotation color set vote:', error);
    res.status(500).json({ error: 'Failed to remove color set preference' });
  }
};

// Get all color set votes for an annotation (Phase 7f) — guest accessible
const getAnnotationColorSets = async (req, res) => {
  try {
    const annotationId = parseInt(req.params.annotationId);
    const userId = req.user?.userId || -1;

    if (isNaN(annotationId)) {
      return res.status(400).json({ error: 'Invalid annotation ID' });
    }

    // Get all color set votes grouped by vote_set_key
    const votesResult = await pool.query(
      `SELECT vote_set_key, COUNT(*) AS vote_count
       FROM annotation_color_set_votes
       WHERE annotation_id = $1
       GROUP BY vote_set_key
       ORDER BY vote_count DESC`,
      [annotationId]
    );

    // Get current user's vote if logged in
    let userVoteSetKey = null;
    if (userId !== -1) {
      const userVote = await pool.query(
        'SELECT vote_set_key FROM annotation_color_set_votes WHERE annotation_id = $1 AND user_id = $2',
        [annotationId, userId]
      );
      if (userVote.rows.length > 0) {
        userVoteSetKey = userVote.rows[0].vote_set_key;
      }
    }

    res.json({
      colorSetVotes: votesResult.rows,
      userVoteSetKey,
    });
  } catch (error) {
    console.error('Error getting annotation color sets:', error);
    res.status(500).json({ error: 'Failed to get color set votes' });
  }
};

// ============================================================
// Allowed Users (Phase 7g)
// ============================================================

// Generate an invite link for a corpus (corpus owner only)
const generateInviteToken = async (req, res) => {
  try {
    const { corpusId, maxUses, expiresInDays } = req.body;
    const userId = req.user.userId;

    if (!corpusId) {
      return res.status(400).json({ error: 'corpusId is required' });
    }

    // Verify ownership
    const corpusCheck = await pool.query(
      'SELECT id, name FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the corpus owner can generate invite links' });
    }

    // Generate a random token (48 chars, URL-safe)
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('base64url').substring(0, 48);

    // Calculate expiry if specified
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const result = await pool.query(
      `INSERT INTO corpus_invite_tokens (corpus_id, token, created_by, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, corpus_id, token, created_at, expires_at, max_uses, use_count`,
      [corpusId, token, userId, expiresAt, maxUses || null]
    );

    res.status(201).json({
      invite: result.rows[0],
      corpusName: corpusCheck.rows[0].name,
    });
  } catch (error) {
    console.error('Error generating invite token:', error);
    res.status(500).json({ error: 'Failed to generate invite link' });
  }
};

// Accept an invite token (any logged-in user)
const acceptInvite = async (req, res) => {
  const client = await pool.connect();
  try {
    const { token } = req.body;
    const userId = req.user.userId;

    if (!token || !token.trim()) {
      return res.status(400).json({ error: 'Invite token is required' });
    }

    await client.query('BEGIN');

    // Find the invite token
    const tokenCheck = await client.query(
      `SELECT it.id, it.corpus_id, it.expires_at, it.max_uses, it.use_count,
              c.name AS corpus_name
       FROM corpus_invite_tokens it
       JOIN corpuses c ON c.id = it.corpus_id
       WHERE it.token = $1`,
      [token.trim()]
    );

    if (tokenCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invalid invite token' });
    }

    const invite = tokenCheck.rows[0];

    // Check if expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite link has expired' });
    }

    // Check if max uses exceeded
    if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite link has reached its maximum number of uses' });
    }

    // Check if user is already an allowed user
    const existingCheck = await client.query(
      'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [invite.corpus_id, userId]
    );
    if (existingCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You are already an allowed user of this corpus', corpusName: invite.corpus_name });
    }

    // Check if user is the corpus owner
    const ownerCheck = await client.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [invite.corpus_id, userId]
    );
    if (ownerCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You are the owner of this corpus — no need for an invite', corpusName: invite.corpus_name });
    }

    // Add user as allowed user
    await client.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2)',
      [invite.corpus_id, userId]
    );

    // Increment use count
    await client.query(
      'UPDATE corpus_invite_tokens SET use_count = use_count + 1 WHERE id = $1',
      [invite.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'You are now an allowed user of this corpus',
      corpusId: invite.corpus_id,
      corpusName: invite.corpus_name,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error accepting invite:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  } finally {
    client.release();
  }
};

// List allowed users for a corpus (corpus owner or allowed users only)
const listAllowedUsers = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.corpusId);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    const corpusCheck = await pool.query(
      'SELECT created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    const isOwner = corpusCheck.rows[0].created_by === userId;

    // Check if the requesting user is an allowed member of this corpus
    const memberCheck = await pool.query(
      'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, userId]
    );
    const isMember = isOwner || memberCheck.rows.length > 0;

    // Count is always returned
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM corpus_allowed_users WHERE corpus_id = $1',
      [corpusId]
    );
    const count = countResult.rows[0].count;

    // Owner and allowed members get the full member list; everyone else gets count only
    if (isMember) {
      const result = await pool.query(
        `SELECT cau.user_id, u.username, u.orcid_id
         FROM corpus_allowed_users cau
         JOIN users u ON u.id = cau.user_id
         WHERE cau.corpus_id = $1
         ORDER BY cau.invited_at ASC`,
        [corpusId]
      );
      res.json({ count, members: result.rows, isOwner, isMember: true });
    } else {
      res.json({ count, isOwner: false, isMember: false });
    }
  } catch (error) {
    console.error('Error listing allowed users:', error);
    res.status(500).json({ error: 'Failed to list allowed users' });
  }
};

// Remove an allowed user (corpus owner only)
const removeAllowedUser = async (req, res) => {
  try {
    const { corpusId, targetUserId } = req.body;
    const userId = req.user.userId;

    if (!corpusId || !targetUserId) {
      return res.status(400).json({ error: 'corpusId and targetUserId are required' });
    }

    // Verify ownership
    const corpusCheck = await pool.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the corpus owner can remove allowed users' });
    }

    const result = await pool.query(
      'DELETE FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, targetUserId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User is not an allowed user of this corpus' });
    }

    res.json({ message: 'Allowed user removed' });
  } catch (error) {
    console.error('Error removing allowed user:', error);
    res.status(500).json({ error: 'Failed to remove allowed user' });
  }
};

// Phase 26b: display-name endpoint retired
const setAllowedUserDisplayName = async (req, res) => {
  res.status(410).json({ error: 'Display name feature has been retired' });
};

// Phase 26b: Leave a corpus (self-remove from allowed users + subscription)
const leaveCorpus = async (req, res) => {
  try {
    const { corpusId } = req.body;
    const userId = req.user.userId;

    if (!corpusId) {
      return res.status(400).json({ error: 'corpusId is required' });
    }

    // Cannot leave if you are the owner
    const corpusCheck = await pool.query(
      'SELECT created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }
    if (corpusCheck.rows[0].created_by === userId) {
      return res.status(403).json({ error: 'The corpus owner cannot leave their own corpus' });
    }

    // Remove from allowed users
    const result = await pool.query(
      'DELETE FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'You are not an allowed user of this corpus' });
    }

    // Also remove subscription if present
    await pool.query(
      'DELETE FROM corpus_subscriptions WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, userId]
    );

    res.json({ message: 'You have left the corpus' });
  } catch (error) {
    console.error('Error leaving corpus:', error);
    res.status(500).json({ error: 'Failed to leave corpus' });
  }
};

// Get active invite tokens for a corpus (corpus owner only)
const getInviteTokens = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.corpusId);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    // Verify ownership
    const corpusCheck = await pool.query(
      'SELECT id FROM corpuses WHERE id = $1 AND created_by = $2',
      [corpusId, userId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only the corpus owner can view invite tokens' });
    }

    const result = await pool.query(
      `SELECT id, token, created_at, expires_at, max_uses, use_count
       FROM corpus_invite_tokens
       WHERE corpus_id = $1
       ORDER BY created_at DESC`,
      [corpusId]
    );

    res.json({ tokens: result.rows });
  } catch (error) {
    console.error('Error getting invite tokens:', error);
    res.status(500).json({ error: 'Failed to get invite tokens' });
  }
};

// Delete an invite token (corpus owner only)
const deleteInviteToken = async (req, res) => {
  try {
    const { tokenId } = req.body;
    const userId = req.user.userId;

    if (!tokenId) {
      return res.status(400).json({ error: 'tokenId is required' });
    }

    // Verify the token belongs to a corpus the user owns
    const tokenCheck = await pool.query(
      `SELECT it.id FROM corpus_invite_tokens it
       JOIN corpuses c ON c.id = it.corpus_id
       WHERE it.id = $1 AND c.created_by = $2`,
      [tokenId, userId]
    );

    if (tokenCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Token not found or not authorized' });
    }

    await pool.query('DELETE FROM corpus_invite_tokens WHERE id = $1', [tokenId]);

    res.json({ message: 'Invite token deleted' });
  } catch (error) {
    console.error('Error deleting invite token:', error);
    res.status(500).json({ error: 'Failed to delete invite token' });
  }
};

// Phase 26b: removal-log endpoint retired
const getRemovalLog = async (req, res) => {
  res.status(410).json({ error: 'Removal log feature has been retired' });
};

// Check if current user is an allowed user of a corpus
const checkAllowedStatus = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.corpusId);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    const corpusCheck = await pool.query(
      'SELECT created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    const isOwner = corpusCheck.rows[0].created_by === userId;

    let isAllowedUser = false;
    if (!isOwner) {
      const allowedCheck = await pool.query(
        'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
        [corpusId, userId]
      );
      isAllowedUser = allowedCheck.rows.length > 0;
    }

    res.json({ isOwner, isAllowedUser });
  } catch (error) {
    console.error('Error checking allowed status:', error);
    res.status(500).json({ error: 'Failed to check allowed status' });
  }
};

// ============================================================
// Document Favorites (Phase 7c Overhaul — per-corpus favoriting)
// ============================================================

const toggleDocumentFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { corpusId, documentId } = req.body;

    if (!corpusId || !documentId) {
      return res.status(400).json({ error: 'corpusId and documentId are required' });
    }

    // Check if already favorited
    const existing = await pool.query(
      'SELECT id FROM document_favorites WHERE user_id = $1 AND corpus_id = $2 AND document_id = $3',
      [userId, corpusId, documentId]
    );

    if (existing.rows.length > 0) {
      // Unfavorite
      await pool.query(
        'DELETE FROM document_favorites WHERE user_id = $1 AND corpus_id = $2 AND document_id = $3',
        [userId, corpusId, documentId]
      );
      res.json({ favorited: false });
    } else {
      // Favorite
      await pool.query(
        `INSERT INTO document_favorites (user_id, corpus_id, document_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, corpus_id, document_id) DO NOTHING`,
        [userId, corpusId, documentId]
      );
      res.json({ favorited: true });
    }
  } catch (error) {
    console.error('Error toggling document favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
};

const getDocumentFavorites = async (req, res) => {
  try {
    const userId = req.user.userId;
    const corpusId = parseInt(req.params.corpusId);

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    const result = await pool.query(
      'SELECT document_id FROM document_favorites WHERE user_id = $1 AND corpus_id = $2',
      [userId, corpusId]
    );

    const favoriteDocIds = result.rows.map(r => r.document_id);
    res.json({ favoriteDocIds });
  } catch (error) {
    console.error('Error fetching document favorites:', error);
    res.status(500).json({ error: 'Failed to get favorites' });
  }
};


// ============================================================
// Phase 9b: Orphan Rescue
// ============================================================

// Get orphaned documents belonging to the current user
// (documents they uploaded that are in zero corpuses)
const getOrphanedDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT d.id, d.title, d.format, d.created_at, d.uploaded_by,
             u.username AS uploader_username
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
      WHERE d.uploaded_by = $1
        AND NOT EXISTS (
          SELECT 1 FROM corpus_documents cd WHERE cd.document_id = d.id
        )
      ORDER BY d.created_at DESC
    `, [userId]);

    res.json({ orphanedDocuments: result.rows });
  } catch (error) {
    console.error('Error fetching orphaned documents:', error);
    res.status(500).json({ error: 'Failed to fetch orphaned documents' });
  }
};

// Rescue an orphaned document by adding it to a corpus
const rescueOrphanedDocument = async (req, res) => {
  const { documentId, corpusId } = req.body;
  const userId = req.user.userId;

  if (!documentId || !corpusId) {
    return res.status(400).json({ error: 'documentId and corpusId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify the document exists and is owned by current user
    const docResult = await client.query(
      'SELECT id, uploaded_by FROM documents WHERE id = $1',
      [documentId]
    );
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docResult.rows[0].uploaded_by !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only rescue documents you uploaded' });
    }

    // Verify document is actually orphaned (in zero corpuses)
    const corpusCount = await client.query(
      'SELECT COUNT(*) AS count FROM corpus_documents WHERE document_id = $1',
      [documentId]
    );
    if (parseInt(corpusCount.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Document is not orphaned — it already belongs to a corpus' });
    }

    // Verify the target corpus exists and user is owner or allowed user
    const corpusResult = await client.query(
      'SELECT created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target corpus not found' });
    }

    const isOwner = corpusResult.rows[0].created_by === userId;
    if (!isOwner) {
      const allowedCheck = await client.query(
        'SELECT 1 FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
        [corpusId, userId]
      );
      if (allowedCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You must be an owner or allowed user of the target corpus' });
      }
    }

    // Add the document to the target corpus
    await client.query(
      'INSERT INTO corpus_documents (corpus_id, document_id, added_by) VALUES ($1, $2, $3)',
      [corpusId, documentId, userId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Document rescued successfully', documentId, corpusId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error rescuing orphaned document:', error);
    res.status(500).json({ error: 'Failed to rescue document' });
  } finally {
    client.release();
  }
};

// Dismiss (permanently delete) an orphaned document
const dismissOrphanedDocument = async (req, res) => {
  const { documentId } = req.body;
  const userId = req.user.userId;

  if (!documentId) {
    return res.status(400).json({ error: 'documentId is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify the document exists and belongs to the user
    const docResult = await client.query(
      'SELECT id, uploaded_by FROM documents WHERE id = $1',
      [documentId]
    );
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docResult.rows[0].uploaded_by !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You can only dismiss documents you uploaded' });
    }

    // Verify document is actually orphaned
    const corpusCount = await client.query(
      'SELECT COUNT(*) AS count FROM corpus_documents WHERE document_id = $1',
      [documentId]
    );
    if (parseInt(corpusCount.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Document is not orphaned — it still belongs to a corpus' });
    }

    // Delete the document permanently
    await client.query('DELETE FROM documents WHERE id = $1', [documentId]);

    await client.query('COMMIT');
    res.json({ message: 'Document dismissed and deleted', documentId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error dismissing orphaned document:', error);
    res.status(500).json({ error: 'Failed to dismiss document' });
  } finally {
    client.release();
  }
};

// ============================================================

// ─── Phase 17a: Document Tags ───

// List all tags with usage counts (guest OK)
const listDocumentTags = async (req, res) => {
  try {
    const enabledRaw = process.env.ENABLED_DOCUMENT_TAGS;
    const enabledNames = enabledRaw
      ? enabledRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    let query = `SELECT dt.id, dt.name, dt.created_by, dt.created_at, u.username AS creator_username,
              COUNT(d.id)::int AS usage_count
       FROM document_tags dt
       LEFT JOIN documents d ON d.tag_id = dt.id
       LEFT JOIN users u ON u.id = dt.created_by`;
    const params = [];

    if (enabledNames.length > 0) {
      const placeholders = enabledNames.map((_, i) => `$${i + 1}`).join(', ');
      query += ` WHERE dt.name IN (${placeholders})`;
      params.push(...enabledNames);
    }

    query += ` GROUP BY dt.id, dt.name, dt.created_by, dt.created_at, u.username
       ORDER BY dt.name ASC`;

    const result = await pool.query(query, params);
    res.json({ tags: result.rows });
  } catch (error) {
    console.error('Error listing document tags:', error);
    res.status(500).json({ error: 'Failed to list document tags' });
  }
};

// Create a new tag — RETIRED (Phase 27e: tags are now admin-controlled)
const createDocumentTag = async (req, res) => {
  res.status(410).json({ error: 'Tag creation is no longer available. Tags are managed by the administrator.' });
};

// Assign a tag to a document (auth required — uploader only, Phase 25a)
const assignDocumentTag = async (req, res) => {
  try {
    const { documentId, tagId } = req.body;
    const userId = req.user.userId;

    if (!documentId || !tagId) {
      return res.status(400).json({ error: 'documentId and tagId are required' });
    }

    // Verify document exists and check uploader
    const docCheck = await pool.query('SELECT id, uploaded_by FROM documents WHERE id = $1', [documentId]);
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docCheck.rows[0].uploaded_by !== userId) {
      return res.status(403).json({ error: 'Only the document uploader can assign tags' });
    }

    // Verify tag exists
    const tagCheck = await pool.query('SELECT id FROM document_tags WHERE id = $1', [tagId]);
    if (tagCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Update tag on all versions in the same chain (walk up to root, then down to all descendants)
    await pool.query(
      `WITH RECURSIVE
       chain_up AS (
         SELECT id, source_document_id FROM documents WHERE id = $1
         UNION ALL
         SELECT d.id, d.source_document_id FROM documents d
         INNER JOIN chain_up c ON d.id = c.source_document_id
       ),
       chain_root AS (
         SELECT id FROM chain_up WHERE source_document_id IS NULL
       ),
       chain_all AS (
         SELECT id FROM documents WHERE id = (SELECT id FROM chain_root)
         UNION ALL
         SELECT d.id FROM documents d
         INNER JOIN chain_all c ON d.source_document_id = c.id
       )
       UPDATE documents SET tag_id = $2 WHERE id IN (SELECT id FROM chain_all)`,
      [documentId, tagId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error assigning document tag:', error);
    res.status(500).json({ error: 'Failed to assign tag to document' });
  }
};

// Remove the tag from a document (auth required — uploader only, Phase 25a)
const removeDocumentTag = async (req, res) => {
  try {
    const { documentId } = req.body;
    const userId = req.user.userId;

    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    // Verify document exists and check uploader
    const docCheck = await pool.query('SELECT id, uploaded_by FROM documents WHERE id = $1', [documentId]);
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docCheck.rows[0].uploaded_by !== userId) {
      return res.status(403).json({ error: 'Only the document uploader can remove tags' });
    }

    // Clear tag on all versions in the same chain
    await pool.query(
      `WITH RECURSIVE
       chain_up AS (
         SELECT id, source_document_id FROM documents WHERE id = $1
         UNION ALL
         SELECT d.id, d.source_document_id FROM documents d
         INNER JOIN chain_up c ON d.id = c.source_document_id
       ),
       chain_root AS (
         SELECT id FROM chain_up WHERE source_document_id IS NULL
       ),
       chain_all AS (
         SELECT id FROM documents WHERE id = (SELECT id FROM chain_root)
         UNION ALL
         SELECT d.id FROM documents d
         INNER JOIN chain_all c ON d.source_document_id = c.id
       )
       UPDATE documents SET tag_id = NULL WHERE id IN (SELECT id FROM chain_all)`,
      [documentId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing document tag:', error);
    res.status(500).json({ error: 'Failed to remove tag from document' });
  }
};

// Phase 41c: Get external links for a document (guest OK)
// Links are stored against the root document, so all versions share one set.
const getDocumentExternalLinks = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const rootId = await getRootDocumentId(pool, documentId);

    const result = await pool.query(
      `SELECT del.id, del.url, del.added_by, del.created_at,
              u.username AS added_by_username
       FROM document_external_links del
       LEFT JOIN users u ON u.id = del.added_by
       WHERE del.document_id = $1
       ORDER BY del.created_at ASC`,
      [rootId]
    );

    res.json({ links: result.rows });
  } catch (error) {
    console.error('Error getting document external links:', error);
    res.status(500).json({ error: 'Failed to get external links' });
  }
};

// Phase 41c: Add an external link to a document (author only)
const addDocumentExternalLink = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const userId = req.user.userId;
    const { url } = req.body;

    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    if (!url || !url.trim()) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }
    if (trimmedUrl.length > 2000) {
      return res.status(400).json({ error: 'URL must be 2000 characters or less' });
    }

    // Verify document exists
    const docCheck = await pool.query('SELECT id FROM documents WHERE id = $1', [documentId]);
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Permission: must be an author
    const canEdit = await isDocumentAuthor(pool, documentId, userId);
    if (!canEdit) {
      return res.status(403).json({ error: 'Only document authors can add external links' });
    }

    const rootId = await getRootDocumentId(pool, documentId);

    // Check for duplicate URL on this document
    const dupCheck = await pool.query(
      'SELECT id FROM document_external_links WHERE document_id = $1 AND url = $2',
      [rootId, trimmedUrl]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'This URL is already linked to this document' });
    }

    const result = await pool.query(
      `INSERT INTO document_external_links (document_id, url, added_by)
       VALUES ($1, $2, $3)
       RETURNING id, url, added_by, created_at`,
      [rootId, trimmedUrl, userId]
    );

    res.json({ success: true, link: result.rows[0] });
  } catch (error) {
    console.error('Error adding document external link:', error);
    res.status(500).json({ error: 'Failed to add external link' });
  }
};

// Phase 41c: Remove an external link from a document (author only)
const removeDocumentExternalLink = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const linkId = parseInt(req.params.linkId);
    const userId = req.user.userId;

    if (isNaN(documentId) || isNaN(linkId)) {
      return res.status(400).json({ error: 'Invalid document or link ID' });
    }

    // Verify document exists
    const docCheck = await pool.query('SELECT id FROM documents WHERE id = $1', [documentId]);
    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Permission: must be an author
    const canEdit = await isDocumentAuthor(pool, documentId, userId);
    if (!canEdit) {
      return res.status(403).json({ error: 'Only document authors can remove external links' });
    }

    const rootId = await getRootDocumentId(pool, documentId);

    // Verify link exists and belongs to this document
    const linkCheck = await pool.query(
      'SELECT id FROM document_external_links WHERE id = $1 AND document_id = $2',
      [linkId, rootId]
    );
    if (linkCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    await pool.query('DELETE FROM document_external_links WHERE id = $1', [linkId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing document external link:', error);
    res.status(500).json({ error: 'Failed to remove external link' });
  }
};

// Get tag for a specific document (guest OK — Phase 25a: single tag via documents.tag_id)
const getDocumentTags = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const result = await pool.query(
      `SELECT dt.id, dt.name
       FROM documents d
       JOIN document_tags dt ON dt.id = d.tag_id
       WHERE d.id = $1`,
      [documentId]
    );

    res.json({ tags: result.rows });
  } catch (error) {
    console.error('Error getting document tags:', error);
    res.status(500).json({ error: 'Failed to get document tags' });
  }
};

// ============================================================
// Phase 26a: Document Co-Author endpoints
// ============================================================

// Generate an invite token for a document (author only)
const generateDocumentInviteToken = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    const userId = req.user.userId;

    if (!documentId || isNaN(documentId)) {
      return res.status(400).json({ error: 'Valid documentId is required' });
    }

    const rootId = await getRootDocumentId(pool, documentId);
    const authorized = await isDocumentAuthor(pool, documentId, userId);
    if (!authorized) {
      return res.status(403).json({ error: 'Only document authors can generate invite tokens' });
    }

    const token = crypto.randomBytes(36).toString('base64url');

    await pool.query(
      `INSERT INTO document_invite_tokens (document_id, token, created_by)
       VALUES ($1, $2, $3)`,
      [rootId, token, userId]
    );

    res.json({ token, inviteUrl: `/doc-invite/${token}` });
  } catch (error) {
    console.error('Error generating document invite token:', error);
    if (error.message && error.message.startsWith('Document')) {
      return res.status(404).json({ error: 'Document not found or has no version history' });
    }
    res.status(500).json({ error: 'Failed to generate invite token' });
  }
};

// Accept a document invite token (any logged-in user)
const acceptDocumentInvite = async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.userId;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const tokenResult = await pool.query(
      `SELECT id, document_id, expires_at, max_uses, use_count
       FROM document_invite_tokens WHERE token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite token' });
    }

    const invite = tokenResult.rows[0];

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite token has expired' });
    }

    if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
      return res.status(410).json({ error: 'Invite token has reached its maximum uses' });
    }

    // Check if user is already an author
    const alreadyAuthor = await isDocumentAuthor(pool, invite.document_id, userId);
    if (alreadyAuthor) {
      return res.status(409).json({ error: 'You are already an author of this document' });
    }

    await pool.query(
      `INSERT INTO document_authors (document_id, user_id) VALUES ($1, $2)`,
      [invite.document_id, userId]
    );

    await pool.query(
      `UPDATE document_invite_tokens SET use_count = use_count + 1 WHERE id = $1`,
      [invite.id]
    );

    res.json({ success: true, documentId: invite.document_id });
  } catch (error) {
    console.error('Error accepting document invite:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
};

// Get authors for a document (full list for authors, count only for others)
const getDocumentAuthors = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    if (!documentId || isNaN(documentId)) {
      return res.status(400).json({ error: 'Valid documentId is required' });
    }

    const rootId = await getRootDocumentId(pool, documentId);
    const userId = req.user ? req.user.userId : null;

    // Count = uploader (1) + document_authors rows
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS co_author_count FROM document_authors WHERE document_id = $1`,
      [rootId]
    );
    const count = 1 + countResult.rows[0].co_author_count;

    // Check if requester is an author
    const requesterIsAuthor = userId ? await isDocumentAuthor(pool, rootId, userId) : false;

    if (!requesterIsAuthor) {
      return res.json({ count });
    }

    // Return full list: uploader + co-authors
    const uploaderResult = await pool.query(
      `SELECT u.id AS "userId", u.username, TRUE AS "isUploader"
       FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = $1`,
      [rootId]
    );

    const coAuthorsResult = await pool.query(
      `SELECT u.id AS "userId", u.username, FALSE AS "isUploader"
       FROM document_authors da JOIN users u ON u.id = da.user_id
       WHERE da.document_id = $1
       ORDER BY da.invited_at`,
      [rootId]
    );

    const authors = [...uploaderResult.rows, ...coAuthorsResult.rows];
    res.json({ count, authors });
  } catch (error) {
    console.error('Error getting document authors:', error);
    if (error.message && error.message.startsWith('Document')) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.status(500).json({ error: 'Failed to get document authors' });
  }
};

// Remove a co-author from a document (author only, cannot remove uploader or self)
const removeDocumentAuthor = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    const targetUserId = parseInt(req.body.userId);
    const userId = req.user.userId;

    if (!documentId || isNaN(documentId)) {
      return res.status(400).json({ error: 'Valid documentId is required' });
    }
    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    const rootId = await getRootDocumentId(pool, documentId);
    const authorized = await isDocumentAuthor(pool, rootId, userId);
    if (!authorized) {
      return res.status(403).json({ error: 'Only document authors can remove co-authors' });
    }

    // Cannot remove yourself via this endpoint
    if (targetUserId === userId) {
      return res.status(400).json({ error: 'Use the leave endpoint to remove yourself' });
    }

    // Cannot remove the original uploader
    const uploaderCheck = await pool.query(
      `SELECT uploaded_by FROM documents WHERE id = $1`,
      [rootId]
    );
    if (uploaderCheck.rows[0].uploaded_by === targetUserId) {
      return res.status(403).json({ error: 'Cannot remove the original document uploader' });
    }

    const deleteResult = await pool.query(
      `DELETE FROM document_authors WHERE document_id = $1 AND user_id = $2`,
      [rootId, targetUserId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'User is not a co-author of this document' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing document author:', error);
    if (error.message && error.message.startsWith('Document')) {
      return res.status(404).json({ error: 'Document not found for co-author removal' });
    }
    res.status(500).json({ error: 'Failed to remove co-author' });
  }
};

// Leave as a co-author (self-remove, uploader cannot leave)
const leaveDocumentAuthorship = async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    const userId = req.user.userId;

    if (!documentId || isNaN(documentId)) {
      return res.status(400).json({ error: 'Valid documentId is required' });
    }

    const rootId = await getRootDocumentId(pool, documentId);

    // Cannot leave if you're the original uploader
    const uploaderCheck = await pool.query(
      `SELECT uploaded_by FROM documents WHERE id = $1`,
      [rootId]
    );
    if (uploaderCheck.rows[0].uploaded_by === userId) {
      return res.status(403).json({ error: 'The original uploader cannot leave the document' });
    }

    const deleteResult = await pool.query(
      `DELETE FROM document_authors WHERE document_id = $1 AND user_id = $2`,
      [rootId, userId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'You are not a co-author of this document' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving document authorship:', error);
    if (error.message && error.message.startsWith('Document')) {
      return res.status(404).json({ error: 'Document not found for leaving authorship' });
    }
    res.status(500).json({ error: 'Failed to leave document' });
  }
};

// Phase 35a: Delete a single document version (uploader only)
const deleteDocument = async (req, res) => {
  const documentId = parseInt(req.params.id);
  if (isNaN(documentId)) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }
  const userId = req.user.userId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const docResult = await client.query(
      'SELECT id, uploaded_by FROM documents WHERE id = $1',
      [documentId]
    );
    if (docResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Document not found' });
    }
    if (docResult.rows[0].uploaded_by !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the original uploader can delete this document' });
    }

    await client.query(
      'DELETE FROM documents WHERE id = $1 AND uploaded_by = $2',
      [documentId, userId]
    );

    await client.query('COMMIT');
    res.json({ deletedDocumentId: documentId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  } finally {
    client.release();
  }
};

// Phase 35b: Transfer corpus ownership
const transferOwnership = async (req, res) => {
  const client = await pool.connect();
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }

    // 1. Get corpus
    const corpusResult = await client.query(
      'SELECT id, created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusResult.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }

    // 2. Check ownership
    if (corpusResult.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the corpus owner can transfer ownership' });
    }

    // 3. Validate newOwnerId
    const { newOwnerId } = req.body;
    const parsedNewOwnerId = parseInt(newOwnerId);
    if (!newOwnerId || isNaN(parsedNewOwnerId)) {
      return res.status(400).json({ error: 'newOwnerId is required and must be a number' });
    }

    // 4. Cannot transfer to yourself
    if (parsedNewOwnerId === userId) {
      return res.status(400).json({ error: 'Cannot transfer ownership to yourself' });
    }

    // 5. Verify new owner is a current allowed user
    const memberCheck = await client.query(
      'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, parsedNewOwnerId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(400).json({ error: 'New owner must be an existing member of the corpus' });
    }

    // 6. Transaction: transfer ownership
    await client.query('BEGIN');

    // a. Update corpus owner
    await client.query(
      'UPDATE corpuses SET created_by = $1 WHERE id = $2',
      [parsedNewOwnerId, corpusId]
    );

    // b. Remove new owner from allowed_users (they're now the owner — implicitly a member)
    await client.query(
      'DELETE FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, parsedNewOwnerId]
    );

    // c. Add old owner to allowed_users (old owner becomes a regular member)
    await client.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2) ON CONFLICT (corpus_id, user_id) DO NOTHING',
      [corpusId, userId]
    );

    await client.query('COMMIT');

    res.json({ message: 'Ownership transferred', newOwnerId: parsedNewOwnerId, corpusId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error transferring corpus ownership:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  } finally {
    client.release();
  }
};

// Phase 38h: Get annotations for a specific concept on a specific document within a specific corpus
const getAnnotationsForConceptOnDocument = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.corpusId);
    const documentId = parseInt(req.params.documentId);
    const conceptId = parseInt(req.params.conceptId);

    if (isNaN(corpusId) || isNaN(documentId) || isNaN(conceptId)) {
      return res.status(400).json({ error: 'Invalid corpus ID, document ID, or concept ID' });
    }

    const userId = req.user?.userId || -1;

    const result = await pool.query(
      `SELECT da.id, da.edge_id, da.quote_text, da.comment, da.created_at,
              e.parent_id, e.graph_path, e.attribute_id,
              a.name AS attribute_name,
              c_parent.name AS parent_name,
              u.username AS created_by_username,
              u.orcid_id AS created_by_orcid_id,
              (SELECT COUNT(*) FROM annotation_votes av WHERE av.annotation_id = da.id) AS vote_count,
              EXISTS(SELECT 1 FROM annotation_votes av WHERE av.annotation_id = da.id AND av.user_id = $4) AS user_voted
       FROM document_annotations da
       JOIN edges e ON da.edge_id = e.id
       JOIN attributes a ON e.attribute_id = a.id
       LEFT JOIN concepts c_parent ON e.parent_id = c_parent.id
       LEFT JOIN users u ON da.created_by = u.id
       WHERE da.corpus_id = $1
         AND da.document_id = $2
         AND e.child_id = $3
       ORDER BY vote_count DESC, da.created_at DESC`,
      [corpusId, documentId, conceptId, userId]
    );

    res.json({ annotations: result.rows });
  } catch (error) {
    console.error('Error getting annotations for concept on document:', error);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
};

// ── Phase 38j: Citation detection helper ──
async function detectAndStoreCitations(citingDocumentId, body, dbClient) {
  try {
    const citationRegex = /(?:https?:\/\/[^/\s]+)?\/cite\/a\/(\d+)/g;
    const seen = new Set();
    const annotationIds = [];
    let match;
    while ((match = citationRegex.exec(body)) !== null) {
      const id = parseInt(match[1], 10);
      if (!isNaN(id) && !seen.has(id)) {
        seen.add(id);
        annotationIds.push(id);
      }
    }
    if (annotationIds.length === 0) return;

    // Batch-fetch snapshot data for all cited annotations
    const snapshotResult = await dbClient.query(`
      SELECT
        da.id as annotation_id,
        c.name as concept_name,
        da.quote_text,
        d.title as document_title,
        cor.name as corpus_name
      FROM document_annotations da
      JOIN edges e ON da.edge_id = e.id
      JOIN concepts c ON e.child_id = c.id
      JOIN documents d ON da.document_id = d.id
      JOIN corpuses cor ON da.corpus_id = cor.id
      WHERE da.id = ANY($1)
    `, [annotationIds]);

    const snapshotMap = {};
    snapshotResult.rows.forEach(row => {
      snapshotMap[row.annotation_id] = row;
    });

    // Insert citation links
    for (const annotationId of annotationIds) {
      const snapshot = snapshotMap[annotationId];
      await dbClient.query(`
        INSERT INTO document_citation_links
          (citing_document_id, cited_annotation_id, citation_url,
           snapshot_concept_name, snapshot_quote_text, snapshot_document_title, snapshot_corpus_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        citingDocumentId,
        snapshot ? annotationId : null,
        `/cite/a/${annotationId}`,
        snapshot?.concept_name || null,
        snapshot?.quote_text || null,
        snapshot?.document_title || null,
        snapshot?.corpus_name || null,
      ]);
    }
  } catch (err) {
    // Citation detection failure should NOT block the upload
    console.error('Citation detection error (non-fatal):', err.message);
  }
}

// Phase 38j: Get citations for a document
const getDocumentCitations = async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    if (isNaN(documentId)) return res.status(400).json({ error: 'Invalid document ID' });

    const result = await pool.query(`
      SELECT
        dcl.id,
        dcl.cited_annotation_id,
        dcl.citation_url,
        dcl.snapshot_concept_name,
        dcl.snapshot_quote_text,
        dcl.snapshot_document_title,
        dcl.snapshot_corpus_name,
        dcl.created_at,
        da.id as live_annotation_id,
        da.quote_text as live_quote_text,
        da.comment as live_comment,
        da.document_id as live_document_id,
        da.corpus_id as live_corpus_id,
        c.name as live_concept_name,
        d.title as live_document_title,
        cor.name as live_corpus_name,
        e.child_id as live_concept_id,
        e.graph_path as live_graph_path
      FROM document_citation_links dcl
      LEFT JOIN document_annotations da ON dcl.cited_annotation_id = da.id
      LEFT JOIN edges e ON da.edge_id = e.id
      LEFT JOIN concepts c ON e.child_id = c.id
      LEFT JOIN documents d ON da.document_id = d.id
      LEFT JOIN corpuses cor ON da.corpus_id = cor.id
      WHERE dcl.citing_document_id = $1
      ORDER BY dcl.created_at ASC
    `, [documentId]);

    const citations = result.rows.map(row => {
      const available = row.live_annotation_id != null;
      return {
        id: row.id,
        citationUrl: row.citation_url,
        available,
        conceptName: available ? row.live_concept_name : row.snapshot_concept_name,
        quoteText: available ? row.live_quote_text : row.snapshot_quote_text,
        documentTitle: available ? row.live_document_title : row.snapshot_document_title,
        corpusName: available ? row.live_corpus_name : row.snapshot_corpus_name,
        documentId: available ? row.live_document_id : null,
        corpusId: available ? row.live_corpus_id : null,
        conceptId: available ? row.live_concept_id : null,
        graphPath: available ? row.live_graph_path : null,
        annotationId: available ? row.live_annotation_id : null,
      };
    });

    res.json({ citations });
  } catch (error) {
    console.error('Error getting document citations:', error);
    res.status(500).json({ error: 'Failed to get citations' });
  }
};

// Phase 38j: Resolve a citation URL to corpus/document for navigation
const resolveCitation = async (req, res) => {
  try {
    const annotationId = parseInt(req.params.annotationId);
    if (isNaN(annotationId)) return res.status(400).json({ found: false });

    const result = await pool.query(`
      SELECT
        da.id as annotation_id,
        da.corpus_id,
        da.document_id,
        da.quote_text,
        e.child_id as concept_id,
        c.name as concept_name,
        d.title as document_title,
        cor.name as corpus_name
      FROM document_annotations da
      JOIN edges e ON da.edge_id = e.id
      JOIN concepts c ON e.child_id = c.id
      JOIN documents d ON da.document_id = d.id
      JOIN corpuses cor ON da.corpus_id = cor.id
      WHERE da.id = $1
    `, [annotationId]);

    if (result.rows.length === 0) {
      return res.json({ found: false });
    }

    const row = result.rows[0];
    res.json({
      found: true,
      corpusId: row.corpus_id,
      documentId: row.document_id,
      annotationId: row.annotation_id,
      conceptName: row.concept_name,
      quoteText: row.quote_text,
      documentTitle: row.document_title,
      corpusName: row.corpus_name,
    });
  } catch (error) {
    console.error('Error resolving citation:', error);
    res.status(500).json({ error: 'Failed to resolve citation' });
  }
};

// Phase 41d: Direct invite user to corpus by userId
const inviteUserToCorpus = async (req, res) => {
  try {
    const corpusId = parseInt(req.params.id);
    const userId = req.user.userId;
    const targetUserId = parseInt(req.body.userId);

    if (isNaN(corpusId)) {
      return res.status(400).json({ error: 'Invalid corpus ID' });
    }
    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Check corpus exists and verify ownership
    const corpusCheck = await pool.query(
      'SELECT id, created_by FROM corpuses WHERE id = $1',
      [corpusId]
    );
    if (corpusCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Corpus not found' });
    }
    if (corpusCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the corpus owner can invite users' });
    }

    // Check target user exists
    const userCheck = await pool.query(
      'SELECT id, username, orcid_id FROM users WHERE id = $1',
      [targetUserId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot add the corpus owner
    if (targetUserId === corpusCheck.rows[0].created_by) {
      return res.status(400).json({ error: 'Cannot add the corpus owner as a member' });
    }

    // Check not already a member
    const memberCheck = await pool.query(
      'SELECT id FROM corpus_allowed_users WHERE corpus_id = $1 AND user_id = $2',
      [corpusId, targetUserId]
    );
    if (memberCheck.rows.length > 0) {
      return res.status(409).json({ error: 'User is already a member of this corpus' });
    }

    await pool.query(
      'INSERT INTO corpus_allowed_users (corpus_id, user_id) VALUES ($1, $2)',
      [corpusId, targetUserId]
    );

    const addedUser = userCheck.rows[0];
    res.json({
      success: true,
      user: {
        id: addedUser.id,
        username: addedUser.username,
        orcidId: addedUser.orcid_id || null,
      },
    });
  } catch (error) {
    console.error('Error inviting user to corpus:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
};

module.exports = {
  createCorpus,
  listCorpuses,
  listMyCorpuses,
  getCorpus,
  updateCorpus,
  deleteCorpus,
  checkDuplicates,
  searchDocuments,
  uploadDocument,
  addDocumentToCorpus,
  removeDocumentFromCorpus,
  getDocument,
  subscribe,
  unsubscribe,
  getMySubscriptions,
  createAnnotation,
  getDocumentAnnotations,
  getAllDocumentAnnotations,
  deleteAnnotation,
  getAnnotationsForEdge,
  voteOnAnnotation,
  unvoteAnnotation,
  voteAnnotationColorSet,
  unvoteAnnotationColorSet,
  getAnnotationColorSets,
  // Phase 7g: Allowed users
  generateInviteToken,
  acceptInvite,
  listAllowedUsers,
  removeAllowedUser,
  setAllowedUserDisplayName,
  leaveCorpus,
  getInviteTokens,
  deleteInviteToken,
  getRemovalLog,
  checkAllowedStatus,
  // Phase 7h/21a/21c: Document versioning
  createVersion,
  getVersionHistory,
  getVersionChain,
  getVersionAnnotationMap,
  // Document favorites (Phase 7c Overhaul)
  toggleDocumentFavorite,
  getDocumentFavorites,
  // Phase 9b: Orphan rescue
  getOrphanedDocuments,
  rescueOrphanedDocument,
  dismissOrphanedDocument,
  // Phase 17a: Document tags
  listDocumentTags,
  createDocumentTag,
  assignDocumentTag,
  removeDocumentTag,
  getDocumentTags,
  // Phase 26a: Document co-authors
  generateDocumentInviteToken,
  acceptDocumentInvite,
  getDocumentAuthors,
  removeDocumentAuthor,
  leaveDocumentAuthorship,
  // Phase 35a: Document deletion
  deleteDocument,
  // Phase 35b: Corpus ownership transfer
  transferOwnership,
  // Phase 38h: Annotate from graph view
  getAnnotationsForConceptOnDocument,
  // Phase 38j: Citation links
  getDocumentCitations,
  resolveCitation,
  // Phase 41c: Document external links
  getDocumentExternalLinks,
  addDocumentExternalLink,
  removeDocumentExternalLink,
  // Phase 41d: Direct invite user
  inviteUserToCorpus,
};
