const pool = require('../config/database');

// List all combos
const listCombos = async (req, res) => {
  try {
    const userId = req.user?.userId || -1;
    const { search, sort } = req.query;

    let whereClause = '';
    const params = [userId];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereClause = `WHERE c.name ILIKE $${params.length}`;
    }

    const orderBy = sort === 'new' ? 'c.created_at DESC' : 'subscriber_count DESC, c.created_at DESC';

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS creator_username,
              u.orcid_id AS creator_orcid_id,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(DISTINCT da.id)
               FROM combo_edges ce2
               JOIN document_annotations da ON da.edge_id = ce2.edge_id
               WHERE ce2.combo_id = c.id) AS annotation_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count,
              BOOL_OR(cs_user.user_id IS NOT NULL) AS user_subscribed
       FROM combos c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN combo_subscriptions cs_user ON cs_user.combo_id = c.id AND cs_user.user_id = $1
       ${whereClause}
       GROUP BY c.id, u.username, u.orcid_id
       ORDER BY ${orderBy}`,
      params
    );

    res.json({
      combos: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
        annotation_count: Number(r.annotation_count),
        subscriber_count: Number(r.subscriber_count),
        user_subscribed: r.user_subscribed || false,
      })),
    });
  } catch (error) {
    console.error('Error listing combos:', error);
    res.status(500).json({ error: 'Failed to list combos' });
  }
};

// Get combo details with member edges
const getCombo = async (req, res) => {
  try {
    const userId = req.user?.userId || -1;
    const comboId = req.params.id;

    const comboResult = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS creator_username,
              u.orcid_id AS creator_orcid_id,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count,
              BOOL_OR(cs_user.user_id IS NOT NULL) AS user_subscribed
       FROM combos c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN combo_subscriptions cs_user ON cs_user.combo_id = c.id AND cs_user.user_id = $1
       WHERE c.id = $2
       GROUP BY c.id, u.username, u.orcid_id`,
      [userId, comboId]
    );

    if (comboResult.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const combo = comboResult.rows[0];
    combo.subscriber_count = Number(combo.subscriber_count);
    combo.user_subscribed = combo.user_subscribed || false;

    // Get member edges with concept details
    const edgesResult = await pool.query(
      `SELECT ce.edge_id, ce.added_at,
              e.child_id AS concept_id,
              child_c.name AS concept_name,
              e.parent_id,
              parent_c.name AS parent_name,
              e.attribute_id,
              a.name AS attribute_name,
              e.graph_path
       FROM combo_edges ce
       JOIN edges e ON e.id = ce.edge_id
       JOIN concepts child_c ON child_c.id = e.child_id
       LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
       JOIN attributes a ON a.id = e.attribute_id
       WHERE ce.combo_id = $1
       ORDER BY ce.added_at DESC`,
      [comboId]
    );

    res.json({
      combo,
      edges: edgesResult.rows,
    });
  } catch (error) {
    console.error('Error getting combo:', error);
    res.status(500).json({ error: 'Failed to get combo' });
  }
};

// Get annotations for all edges in a combo
const getComboAnnotations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const comboId = req.params.id;
    const { sort, edgeIds, mode } = req.query;

    // Validate mode parameter (Phase 48)
    const matchMode = mode || 'any';
    if (matchMode !== 'any' && matchMode !== 'all') {
      return res.status(400).json({ error: "mode must be 'any' or 'all'" });
    }

    // Verify combo exists
    const comboCheck = await pool.query('SELECT id FROM combos WHERE id = $1', [comboId]);
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    let edgeFilter = '';
    const params = [comboId, userId];

    if (edgeIds) {
      const ids = edgeIds.split(',').map(Number).filter(n => !isNaN(n));
      if (ids.length > 0) {
        params.push(ids);
        edgeFilter = `AND da.edge_id = ANY($${params.length})`;
      }
    }

    // Phase 48: Compute the evaluated edge set for "all" mode — edgeIds
    // intersected with the combo's actual member edges, or all member edges
    // if edgeIds is absent/empty.
    let evaluatedSet = null;
    if (matchMode === 'all') {
      const memberEdgesRes = await pool.query(
        'SELECT edge_id FROM combo_edges WHERE combo_id = $1',
        [comboId]
      );
      const memberSet = new Set(memberEdgesRes.rows.map(r => Number(r.edge_id)));

      let requestedIds = null;
      if (edgeIds) {
        const parsed = edgeIds.split(',').map(Number).filter(n => !isNaN(n));
        if (parsed.length > 0) requestedIds = parsed;
      }

      if (requestedIds) {
        evaluatedSet = requestedIds.filter(id => memberSet.has(id));
      } else {
        evaluatedSet = Array.from(memberSet);
      }

      // Edge case: N = 0 → return empty array immediately
      if (evaluatedSet.length === 0) {
        return res.json({ annotations: [] });
      }
      // Edge case: N = 1 → fall through; the coverage filter is a no-op
      // relative to the "any" path, so no special-case needed.
    }

    const useSubscribed = sort === 'subscribed';

    let orderBy;
    switch (sort) {
      case 'new':
        orderBy = 'da.created_at DESC';
        break;
      case 'annotation_votes':
        orderBy = 'annotation_vote_count DESC, da.created_at DESC';
        break;
      case 'subscribed':
        orderBy = 'subscribed_vote_count DESC, annotation_vote_count DESC, da.created_at DESC';
        break;
      default: // combo_votes
        orderBy = 'combo_vote_count DESC, da.created_at DESC';
    }

    const cteParts = [];

    if (useSubscribed) {
      cteParts.push(`subscribed_members AS (
          SELECT DISTINCT member_id AS user_id FROM (
            SELECT c.created_by AS member_id
            FROM corpus_subscriptions cs
            JOIN corpuses c ON c.id = cs.corpus_id
            WHERE cs.user_id = $2
            AND c.created_by IS NOT NULL
            UNION
            SELECT cau.user_id AS member_id
            FROM corpus_subscriptions cs
            JOIN corpus_allowed_users cau ON cau.corpus_id = cs.corpus_id
            WHERE cs.user_id = $2
          ) members
        )`);
    }

    // Phase 48: CTEs for "all" mode coverage check. Only built when mode='all'
    // so the default "any" path pays no extra cost.
    let qualifyingRootsJoin = '';
    if (matchMode === 'all') {
      params.push(evaluatedSet);
      const evalParamIdx = params.length;
      cteParts.push(`doc_roots AS (
          WITH RECURSIVE chain AS (
            SELECT id, source_document_id, id AS root_id
            FROM documents
            WHERE source_document_id IS NULL
            UNION ALL
            SELECT d.id, d.source_document_id, ch.root_id
            FROM documents d
            JOIN chain ch ON d.source_document_id = ch.id
          )
          SELECT id, root_id FROM chain
        )`);
      cteParts.push(`root_doc_coverage AS (
          SELECT dr.root_id, COUNT(DISTINCT da2.edge_id) AS covered_edges
          FROM document_annotations da2
          JOIN doc_roots dr ON dr.id = da2.document_id
          WHERE da2.edge_id = ANY($${evalParamIdx})
          GROUP BY dr.root_id
        )`);
      cteParts.push(`qualifying_roots AS (
          SELECT root_id FROM root_doc_coverage WHERE covered_edges = ${evaluatedSet.length}
        )`);
      qualifyingRootsJoin = `JOIN doc_roots dr_filter ON dr_filter.id = da.document_id
       JOIN qualifying_roots qr ON qr.root_id = dr_filter.root_id`;
    }

    const cteClause = cteParts.length > 0 ? `WITH ${cteParts.join(', ')}` : '';
    const subscribedCol = useSubscribed
      ? `, (SELECT COUNT(*) FROM annotation_votes av2 WHERE av2.annotation_id = da.id AND av2.user_id IN (SELECT user_id FROM subscribed_members))::int AS subscribed_vote_count`
      : '';

    const result = await pool.query(
      `${cteClause}
       SELECT da.id AS annotation_id,
              da.quote_text,
              da.comment,
              da.created_at,
              da.edge_id,
              da.document_id,
              da.corpus_id,
              creator.username AS creator_username,
              creator.orcid_id AS creator_orcid_id,
              d.title AS document_title,
              corp.name AS corpus_name,
              e.child_id AS concept_id,
              child_c.name AS concept_name,
              e.parent_id,
              parent_c.name AS parent_name,
              a.name AS attribute_name,
              e.graph_path,
              (SELECT COUNT(*) FROM combo_annotation_votes cav
               WHERE cav.combo_id = $1 AND cav.annotation_id = da.id) AS combo_vote_count,
              (SELECT COUNT(*) FROM annotation_votes av
               WHERE av.annotation_id = da.id) AS annotation_vote_count,
              EXISTS(SELECT 1 FROM combo_annotation_votes cav2
                     WHERE cav2.combo_id = $1 AND cav2.annotation_id = da.id AND cav2.user_id = $2) AS user_combo_voted
              ${subscribedCol}
       FROM document_annotations da
       JOIN combo_edges ce ON ce.edge_id = da.edge_id AND ce.combo_id = $1
       JOIN edges e ON e.id = da.edge_id
       JOIN concepts child_c ON child_c.id = e.child_id
       LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
       JOIN attributes a ON a.id = e.attribute_id
       LEFT JOIN users creator ON creator.id = da.created_by
       JOIN documents d ON d.id = da.document_id
       JOIN corpuses corp ON corp.id = da.corpus_id
       ${qualifyingRootsJoin}
       WHERE 1=1 ${edgeFilter}
       ORDER BY ${orderBy}`,
      params
    );

    res.json({
      annotations: result.rows.map(r => ({
        ...r,
        combo_vote_count: Number(r.combo_vote_count),
        annotation_vote_count: Number(r.annotation_vote_count),
        ...(r.subscribed_vote_count !== undefined ? { subscribed_vote_count: Number(r.subscribed_vote_count) } : {}),
      })),
    });
  } catch (error) {
    console.error('Error getting combo annotations:', error);
    res.status(500).json({ error: 'Failed to get combo annotations' });
  }
};

// Create a new combo
const createCombo = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description } = req.body;
    const userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Combo name is required' });
    }

    if (name.trim().length > 255) {
      return res.status(400).json({ error: 'Combo name must be 255 characters or less' });
    }

    await client.query('BEGIN');

    // Check uniqueness (case-insensitive)
    const nameCheck = await client.query(
      'SELECT id FROM combos WHERE LOWER(name) = LOWER($1)',
      [name.trim()]
    );
    if (nameCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A combo with this name already exists' });
    }

    // Insert combo
    const comboResult = await client.query(
      `INSERT INTO combos (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by, created_at`,
      [name.trim(), description?.trim() || null, userId]
    );
    const combo = comboResult.rows[0];

    // Auto-subscribe the creator
    const subResult = await client.query(
      `INSERT INTO combo_subscriptions (user_id, combo_id)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, combo.id]
    );

    // Add sidebar item (item_id = combo_id, matching corpus pattern)
    await client.query(
      `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
       VALUES ($1, 'combo', $2,
         COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [userId, combo.id]
    );

    await client.query('COMMIT');

    res.status(201).json({ combo });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating combo:', error);
    res.status(500).json({ error: 'Failed to create combo' });
  } finally {
    client.release();
  }
};

// Get current user's owned combos
const getMyCombos = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_at,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count
       FROM combos c
       WHERE c.created_by = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({
      combos: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
      })),
    });
  } catch (error) {
    console.error('Error getting my combos:', error);
    res.status(500).json({ error: 'Failed to get combos' });
  }
};

// Get current user's combo subscriptions
const getComboSubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT cs.id AS subscription_id, cs.created_at AS subscribed_at, cs.group_id,
              c.id, c.name, c.description,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs2 WHERE cs2.combo_id = c.id) AS subscriber_count
       FROM combo_subscriptions cs
       JOIN combos c ON c.id = cs.combo_id
       WHERE cs.user_id = $1
       ORDER BY cs.created_at DESC`,
      [userId]
    );

    res.json({
      subscriptions: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
        subscriber_count: Number(r.subscriber_count),
      })),
    });
  } catch (error) {
    console.error('Error getting combo subscriptions:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
};

// Subscribe to a combo
const subscribeToCombo = async (req, res) => {
  try {
    const { comboId } = req.body;
    const userId = req.user.userId;

    if (!comboId) {
      return res.status(400).json({ error: 'comboId is required' });
    }

    // Verify combo exists
    const comboCheck = await pool.query('SELECT id, name FROM combos WHERE id = $1', [comboId]);
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const result = await pool.query(
      `INSERT INTO combo_subscriptions (user_id, combo_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, combo_id) DO NOTHING
       RETURNING id, user_id, combo_id, created_at`,
      [userId, comboId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Already subscribed to this combo' });
    }

    // Add to sidebar_items (item_id = combo_id, matching corpus pattern)
    await pool.query(
      `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
       VALUES ($1, 'combo', $2,
         COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [userId, comboId]
    );

    res.status(201).json({ subscription: result.rows[0], combo: comboCheck.rows[0] });
  } catch (error) {
    console.error('Error subscribing to combo:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
};

// Unsubscribe from a combo
const unsubscribeFromCombo = async (req, res) => {
  try {
    const { comboId } = req.body;
    const userId = req.user.userId;

    if (!comboId) {
      return res.status(400).json({ error: 'comboId is required' });
    }

    // Remove from sidebar_items (item_id = combo_id, matching corpus pattern)
    await pool.query(
      `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'combo' AND item_id = $2`,
      [userId, comboId]
    );

    // Delete subscription
    const delResult = await pool.query(
      'DELETE FROM combo_subscriptions WHERE user_id = $1 AND combo_id = $2',
      [userId, comboId]
    );

    if (delResult.rowCount === 0) {
      return res.status(404).json({ error: 'Not subscribed to this combo' });
    }

    res.json({ message: 'Unsubscribed from combo' });
  } catch (error) {
    console.error('Error unsubscribing from combo:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
};

// Add an edge to a combo (owner only)
const addEdgeToCombo = async (req, res) => {
  try {
    const { edgeId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!edgeId) {
      return res.status(400).json({ error: 'edgeId is required' });
    }

    // Verify combo exists and user is owner
    const comboCheck = await pool.query(
      'SELECT id, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }
    if (comboCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the combo owner can add edges' });
    }

    // Verify edge exists
    const edgeCheck = await pool.query(
      `SELECT e.id, e.child_id, e.parent_id, e.attribute_id, e.graph_path,
              child_c.name AS concept_name,
              parent_c.name AS parent_name,
              a.name AS attribute_name
       FROM edges e
       JOIN concepts child_c ON child_c.id = e.child_id
       LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
       JOIN attributes a ON a.id = e.attribute_id
       WHERE e.id = $1`,
      [edgeId]
    );
    if (edgeCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Edge not found' });
    }

    const result = await pool.query(
      `INSERT INTO combo_edges (combo_id, edge_id)
       VALUES ($1, $2)
       ON CONFLICT (combo_id, edge_id) DO NOTHING
       RETURNING id, combo_id, edge_id, added_at`,
      [comboId, edgeId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Edge already in this combo' });
    }

    res.status(201).json({ comboEdge: result.rows[0], edge: edgeCheck.rows[0] });
  } catch (error) {
    console.error('Error adding edge to combo:', error);
    res.status(500).json({ error: 'Failed to add edge to combo' });
  }
};

// Remove an edge from a combo (owner only)
const removeEdgeFromCombo = async (req, res) => {
  try {
    const { edgeId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!edgeId) {
      return res.status(400).json({ error: 'edgeId is required' });
    }

    // Verify combo exists and user is owner
    const comboCheck = await pool.query(
      'SELECT id, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }
    if (comboCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the combo owner can remove edges' });
    }

    const result = await pool.query(
      'DELETE FROM combo_edges WHERE combo_id = $1 AND edge_id = $2',
      [comboId, edgeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Edge not found in this combo' });
    }

    res.json({ message: 'Edge removed from combo' });
  } catch (error) {
    console.error('Error removing edge from combo:', error);
    res.status(500).json({ error: 'Failed to remove edge from combo' });
  }
};

// Vote on an annotation within a combo
const voteComboAnnotation = async (req, res) => {
  try {
    const { annotationId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }

    // Verify combo exists
    const comboCheck = await pool.query('SELECT id FROM combos WHERE id = $1', [comboId]);
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    // Verify annotation exists
    const annCheck = await pool.query('SELECT id FROM document_annotations WHERE id = $1', [annotationId]);
    if (annCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Annotation not found' });
    }

    const result = await pool.query(
      `INSERT INTO combo_annotation_votes (user_id, combo_id, annotation_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, combo_id, annotation_id) DO NOTHING
       RETURNING id`,
      [userId, comboId, annotationId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Already voted on this annotation in this combo' });
    }

    // Return updated count
    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM combo_annotation_votes WHERE combo_id = $1 AND annotation_id = $2',
      [comboId, annotationId]
    );

    res.status(201).json({ comboVoteCount: Number(countResult.rows[0].count) });
  } catch (error) {
    console.error('Error voting on combo annotation:', error);
    res.status(500).json({ error: 'Failed to vote' });
  }
};

// Remove vote on an annotation within a combo
const unvoteComboAnnotation = async (req, res) => {
  try {
    const { annotationId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!annotationId) {
      return res.status(400).json({ error: 'annotationId is required' });
    }

    const result = await pool.query(
      'DELETE FROM combo_annotation_votes WHERE user_id = $1 AND combo_id = $2 AND annotation_id = $3',
      [userId, comboId, annotationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Vote not found' });
    }

    // Return updated count
    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM combo_annotation_votes WHERE combo_id = $1 AND annotation_id = $2',
      [comboId, annotationId]
    );

    res.json({ comboVoteCount: Number(countResult.rows[0].count) });
  } catch (error) {
    console.error('Error removing combo annotation vote:', error);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
};

// Transfer combo ownership (Phase 42c)
const transferOwnership = async (req, res) => {
  const client = await pool.connect();
  try {
    const comboId = req.params.id;
    const userId = req.user.userId;
    const { newOwnerId } = req.body;

    if (!newOwnerId || isNaN(Number(newOwnerId))) {
      return res.status(400).json({ error: 'newOwnerId is required and must be a number' });
    }

    await client.query('BEGIN');

    // Verify combo exists
    const comboCheck = await client.query(
      'SELECT id, name, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Superconcept not found' });
    }

    // Verify caller is owner
    if (comboCheck.rows[0].created_by !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the superconcept owner can transfer ownership' });
    }

    // Cannot transfer to self
    if (Number(newOwnerId) === userId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already own this superconcept' });
    }

    // Verify target user exists
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [newOwnerId]
    );
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    // Update ownership
    await client.query(
      'UPDATE combos SET created_by = $1 WHERE id = $2',
      [newOwnerId, comboId]
    );

    // Auto-subscribe new owner if not already subscribed
    const subCheck = await client.query(
      'SELECT id FROM combo_subscriptions WHERE user_id = $1 AND combo_id = $2',
      [newOwnerId, comboId]
    );
    if (subCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO combo_subscriptions (user_id, combo_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, combo_id) DO NOTHING`,
        [newOwnerId, comboId]
      );
      await client.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'combo', $2,
           COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
         ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
        [newOwnerId, comboId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error transferring combo ownership:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  } finally {
    client.release();
  }
};

// Get combos containing a specific edge (Phase 47)
const getCombosByEdge = async (req, res) => {
  try {
    const edgeId = parseInt(req.params.edgeId, 10);
    if (!edgeId || edgeId < 1 || isNaN(edgeId)) {
      return res.status(400).json({ error: 'Invalid edgeId' });
    }

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS created_by_username,
              u.orcid_id AS created_by_orcid_id,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(DISTINCT da.id)
               FROM combo_edges ce2
               JOIN document_annotations da ON da.edge_id = ce2.edge_id
               WHERE ce2.combo_id = c.id) AS annotation_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count
       FROM combos c
       JOIN combo_edges ce_filter ON ce_filter.combo_id = c.id AND ce_filter.edge_id = $1
       LEFT JOIN users u ON u.id = c.created_by
       GROUP BY c.id, u.username, u.orcid_id
       ORDER BY subscriber_count DESC, c.name ASC`,
      [edgeId]
    );

    res.json(result.rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_by_username: r.created_by_username || null,
      created_by_orcid_id: r.created_by_orcid_id || null,
      edge_count: Number(r.edge_count),
      annotation_count: Number(r.annotation_count),
      subscriber_count: Number(r.subscriber_count),
    })));
  } catch (error) {
    console.error('Error getting combos by edge:', error);
    res.status(500).json({ error: 'Failed to get combos for edge' });
  }
};

module.exports = {
  listCombos,
  getCombo,
  getComboAnnotations,
  getCombosByEdge,
  createCombo,
  getMyCombos,
  getComboSubscriptions,
  subscribeToCombo,
  unsubscribeFromCombo,
  addEdgeToCombo,
  removeEdgeFromCombo,
  voteComboAnnotation,
  unvoteComboAnnotation,
  transferOwnership,
};
