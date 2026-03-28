/**
 * Utility functions for resolving document version chains and co-authorship.
 * document_authors rows always reference the ROOT document in a version chain
 * (where source_document_id IS NULL).
 */

async function getRootDocumentId(pool, documentId) {
  const result = await pool.query(`
    WITH RECURSIVE lineage AS (
      SELECT id, source_document_id FROM documents WHERE id = $1
      UNION ALL
      SELECT d.id, d.source_document_id
      FROM documents d
      JOIN lineage l ON d.id = l.source_document_id
    )
    SELECT id FROM lineage WHERE source_document_id IS NULL
  `, [documentId]);

  if (result.rows.length === 0) {
    throw new Error(`Document ${documentId} not found`);
  }

  return result.rows[0].id;
}

async function isDocumentAuthor(pool, documentId, userId) {
  const rootId = await getRootDocumentId(pool, documentId);

  const result = await pool.query(`
    SELECT 1 FROM documents WHERE id = $1 AND uploaded_by = $2
    UNION ALL
    SELECT 1 FROM document_authors WHERE document_id = $1 AND user_id = $2
    LIMIT 1
  `, [rootId, userId]);

  return result.rows.length > 0;
}

module.exports = { getRootDocumentId, isDocumentAuthor };
