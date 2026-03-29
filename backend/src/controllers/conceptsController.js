const pool = require('../config/database');

const conceptsController = {
  // Get all root concepts (concepts with no parents)
  getRootConcepts: async (req, res) => {
    try {
      const { sort } = req.query; // 'new' or default (saves)
      
      // Phase 11: Support sort=annotations (count of distinct documents annotating each root edge)
      const annotationJoin = sort === 'annotations'
        ? 'LEFT JOIN document_annotations da ON da.edge_id = root_e.id'
        : '';
      const annotationSelect = sort === 'annotations'
        ? ', COUNT(DISTINCT da.document_id) as annotation_count'
        : '';
      // Phase 29b: Support sort=top_annotation (max vote count on any single annotation for each root edge)
      const topAnnotationJoin = sort === 'top_annotation'
        ? `LEFT JOIN LATERAL (
            SELECT COALESCE(MAX(av_cnt.cnt), 0) as top_votes
            FROM (
              SELECT COUNT(av.id) as cnt
              FROM document_annotations da2
              JOIN annotation_votes av ON av.annotation_id = da2.id
              WHERE da2.edge_id = root_e.id
              GROUP BY da2.id
            ) av_cnt
          ) top_ann ON true`
        : '';
      const topAnnotationSelect = sort === 'top_annotation'
        ? ', top_ann.top_votes as top_annotation_votes'
        : '';
      const orderClause = sort === 'new'
        ? 'ORDER BY root_e.created_at DESC, c.name'
        : sort === 'annotations'
        ? 'ORDER BY annotation_count DESC, vote_count DESC, c.name'
        : sort === 'top_annotation'
        ? 'ORDER BY top_annotation_votes DESC, vote_count DESC, c.name'
        : 'ORDER BY vote_count DESC, c.name';

      const query = `
        SELECT DISTINCT c.id, c.name, c.created_at,
          COALESCE(COUNT(DISTINCT child_e.id), 0) as child_count,
          root_e.id as edge_id,
          root_e.created_at as edge_created_at,
          a.id as attribute_id,
          a.name as attribute_name,
          COALESCE(COUNT(DISTINCT v.id), 0) as vote_count,
          BOOL_OR(v.user_id = $1) as user_voted,
          (SELECT COUNT(*) FROM concept_flags cf WHERE cf.edge_id = root_e.id) as flag_count,
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = root_e.id AND cf.user_id = $1) as user_flagged
          ${annotationSelect}
          ${topAnnotationSelect}
        FROM concepts c
        LEFT JOIN edges child_e ON c.id = child_e.parent_id AND child_e.is_hidden = false
        LEFT JOIN edges root_e ON root_e.child_id = c.id AND root_e.parent_id IS NULL AND root_e.graph_path = '{}' AND root_e.is_hidden = false
        LEFT JOIN attributes a ON root_e.attribute_id = a.id
        LEFT JOIN votes v ON root_e.id = v.edge_id        ${annotationJoin}
        ${topAnnotationJoin}
        WHERE root_e.id IS NOT NULL
        GROUP BY c.id, c.name, c.created_at, root_e.id, root_e.created_at, a.id, a.name${sort === 'top_annotation' ? ', top_ann.top_votes' : ''}
        ${orderClause};
      `;
      
      const result = await pool.query(query, [req.user ? req.user.userId : -1]);

      // Get total user count (all users for now; Phase 7 will filter inactive)
      const userCountResult = await pool.query('SELECT COUNT(*) as total_users FROM users');
      const totalUsers = parseInt(userCountResult.rows[0].total_users);

      res.json({ concepts: result.rows, totalUsers });
    } catch (error) {
      console.error('Error fetching root concepts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get a concept by ID with its children in a specific context
  getConceptWithChildren: async (req, res) => {
    const { id } = req.params;
    const { path, sort } = req.query; // graph_path as comma-separated IDs, sort = 'new' or default

    try {
      // Get the concept itself
      const conceptResult = await pool.query(
        'SELECT * FROM concepts WHERE id = $1',
        [id]
      );

      if (conceptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }

      const concept = conceptResult.rows[0];

      // Parse the path
      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(id));

      // Phase 11: Support sort=annotations (count of distinct documents annotating each child edge)
      const annotationJoin = sort === 'annotations'
        ? 'LEFT JOIN document_annotations da ON da.edge_id = e.id'
        : '';
      const annotationSelect = sort === 'annotations'
        ? ', COUNT(DISTINCT da.document_id) as annotation_count'
        : '';
      // Phase 29b: Support sort=top_annotation (max vote count on any single annotation for each child edge)
      const topAnnotationJoin = sort === 'top_annotation'
        ? `LEFT JOIN LATERAL (
            SELECT COALESCE(MAX(av_cnt.cnt), 0) as top_votes
            FROM (
              SELECT COUNT(av.id) as cnt
              FROM document_annotations da2
              JOIN annotation_votes av ON av.annotation_id = da2.id
              WHERE da2.edge_id = e.id
              GROUP BY da2.id
            ) av_cnt
          ) top_ann ON true`
        : '';
      const topAnnotationSelect = sort === 'top_annotation'
        ? ', top_ann.top_votes as top_annotation_votes'
        : '';
      const orderClause = sort === 'new'
        ? 'ORDER BY e.created_at DESC, c.name'
        : sort === 'annotations'
        ? 'ORDER BY annotation_count DESC, vote_count DESC, c.name'
        : sort === 'top_annotation'
        ? 'ORDER BY top_annotation_votes DESC, vote_count DESC, c.name'
        : 'ORDER BY vote_count DESC, c.name';

      // Get children with vote counts, attribute info, move count, and swap count
      const childrenQuery = `
        SELECT 
          c.id, 
          c.name, 
          e.id as edge_id,
          e.graph_path,
          e.created_at as edge_created_at,
          a.id as attribute_id,
          a.name as attribute_name,
          COUNT(DISTINCT v.id) as vote_count,
          BOOL_OR(v.user_id = $2) as user_voted,
          COUNT(DISTINCT child_edges.id) as child_count,
          (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) as swap_count,
          (SELECT COUNT(*) FROM concept_flags cf WHERE cf.edge_id = e.id) as flag_count,
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = e.id AND cf.user_id = $2) as user_flagged
          ${annotationSelect}
          ${topAnnotationSelect}
        FROM edges e
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN votes v ON e.id = v.edge_id        LEFT JOIN edges child_edges ON child_edges.parent_id = c.id AND child_edges.graph_path = e.graph_path || c.id AND child_edges.is_hidden = false
        ${annotationJoin}
        ${topAnnotationJoin}
        WHERE e.parent_id = $1 AND e.graph_path = $3 AND e.is_hidden = false
        GROUP BY c.id, c.name, e.id, e.graph_path, e.created_at, a.id, a.name${sort === 'top_annotation' ? ', top_ann.top_votes' : ''}
        ${orderClause};
      `;

      const childrenResult = await pool.query(childrenQuery, [
        id,
        req.user ? req.user.userId : -1,
        graphPath
      ]);

      // Get vote count on the edge connecting this concept to its parent in current path
      // Also get the attribute for this concept in this context
      let currentEdgeVoteCount = null;
      let currentAttribute = null;
      if (graphPath.length >= 2) {
        // Non-root concept: look up edge from parent
        const parentId = graphPath[graphPath.length - 2];
        const parentPath = graphPath.slice(0, -1);
        
        const edgeVoteQuery = `
          SELECT COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id          WHERE e.parent_id = $1 AND e.child_id = $2 AND e.graph_path = $3
          GROUP BY a.id, a.name
        `;
        
        const edgeVoteResult = await pool.query(edgeVoteQuery, [parentId, id, parentPath]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      } else if (graphPath.length === 1) {
        // Root concept: look up root edge (parent_id IS NULL, graph_path = '{}')
        const edgeVoteQuery = `
          SELECT COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id          WHERE e.parent_id IS NULL AND e.child_id = $1 AND e.graph_path = '{}'
          GROUP BY a.id, a.name
        `;
        
        const edgeVoteResult = await pool.query(edgeVoteQuery, [id]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      }

      res.json({
        concept,
        path: graphPath,
        children: childrenResult.rows,
        currentEdgeVoteCount,
        currentAttribute
      });
    } catch (error) {
      console.error('Error fetching concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all parent contexts for a concept (for flip view)
  // When originPath is provided (contextual mode), includes link vote counts
  // relative to the origin edge, and Jaccard similarity percentages
  getConceptParents: async (req, res) => {
    const { id } = req.params;
    const { originPath } = req.query; // Optional: path we came from (for contextual flip view)

    try {
      // Get the concept itself
      const conceptResult = await pool.query(
        'SELECT * FROM concepts WHERE id = $1',
        [id]
      );

      if (conceptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }

      const concept = conceptResult.rows[0];

      // Determine the origin edge ID if we have an originPath (contextual mode)
      let originEdgeId = null;
      let originParentId = null;
      let originGraphPath = null;
      if (originPath) {
        const pathArray = originPath.split(',').map(Number);
        
        if (pathArray.length === 0) {
          // Edge case: originPath is empty — concept is a root, origin edge is the root edge
          // This shouldn't normally happen in flip view, but handle gracefully
        } else {
          // The origin edge connects the last concept in originPath to our concept (id)
          // originPath = path up to and including the parent
          // So the edge is: parent_id = last in originPath, child_id = id, graph_path = originPath
          originParentId = pathArray[pathArray.length - 1];
          originGraphPath = pathArray;
          
          const originEdgeResult = await pool.query(
            'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3',
            [originParentId, id, originGraphPath]
          );
          
          if (originEdgeResult.rows.length > 0) {
            originEdgeId = originEdgeResult.rows[0].id;
          }
        }
      }

      // Build query — if we have an origin edge, include link vote counts
      let parentsQuery;
      let parentsParams;

      if (originEdgeId) {
        // Contextual mode: include link vote counts and user_linked status
        // Primary sort: link_count DESC, tiebreaker: save vote_count DESC
        parentsQuery = `
          SELECT 
            c.id,
            c.name,
            e.id as edge_id,
            e.graph_path,
            a.id as attribute_id,
            a.name as attribute_name,
            COUNT(DISTINCT v.id) as vote_count,
            BOOL_OR(v.user_id = $2) as user_voted,
            COUNT(DISTINCT sv.id) as link_count,
            BOOL_OR(sv.user_id = $2) as user_linked
          FROM edges e
          JOIN concepts c ON e.parent_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id          LEFT JOIN similarity_votes sv ON sv.origin_edge_id = $3 AND sv.similar_edge_id = e.id
          WHERE e.child_id = $1 AND e.is_hidden = false
          GROUP BY c.id, c.name, e.id, e.graph_path, a.id, a.name
          ORDER BY link_count DESC, vote_count DESC, c.name;
        `;
        parentsParams = [id, req.user ? req.user.userId : -1, originEdgeId];
      } else {
        // Exploratory/decontextualized mode: no link votes, sort by save count
        parentsQuery = `
          SELECT 
            c.id,
            c.name,
            e.id as edge_id,
            e.graph_path,
            a.id as attribute_id,
            a.name as attribute_name,
            COUNT(DISTINCT v.id) as vote_count,
            BOOL_OR(v.user_id = $2) as user_voted,
            0 as link_count,
            false as user_linked
          FROM edges e
          JOIN concepts c ON e.parent_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id          WHERE e.child_id = $1 AND e.is_hidden = false
          GROUP BY c.id, c.name, e.id, e.graph_path, a.id, a.name
          ORDER BY vote_count DESC, c.name;
        `;
        parentsParams = [id, req.user ? req.user.userId : -1];
      }

      const parentsResult = await pool.query(parentsQuery, parentsParams);

      // --- Jaccard Similarity Calculation (contextual mode only) ---
      // Compare direct children of origin context vs each alt parent context
      let parentsWithSimilarity = parentsResult.rows;

      if (originEdgeId && originParentId && originGraphPath) {
        const originChildPath = [...originGraphPath, parseInt(id)];

        // Get direct child concept IDs of the origin context
        const originChildrenResult = await pool.query(
          'SELECT DISTINCT child_id FROM edges WHERE parent_id = $1 AND graph_path = $2 AND is_hidden = false',
          [id, originChildPath]
        );
        const originChildIds = new Set(originChildrenResult.rows.map(r => r.child_id));

        // For each alt parent, get its direct child concept IDs and compute Jaccard
        parentsWithSimilarity = await Promise.all(
          parentsResult.rows.map(async (parent) => {
            const altChildPath = [...parent.graph_path, parseInt(id)];
            
            const altChildrenResult = await pool.query(
              'SELECT DISTINCT child_id FROM edges WHERE parent_id = $1 AND graph_path = $2 AND is_hidden = false',
              [id, altChildPath]
            );
            const altChildIds = new Set(altChildrenResult.rows.map(r => r.child_id));

            // Jaccard similarity: |intersection| / |union|
            let similarity = null;
            const unionSize = new Set([...originChildIds, ...altChildIds]).size;
            if (unionSize > 0) {
              let intersectionCount = 0;
              for (const childId of originChildIds) {
                if (altChildIds.has(childId)) {
                  intersectionCount++;
                }
              }
              similarity = Math.round((intersectionCount / unionSize) * 100);
            } else {
              // Both contexts have 0 children — similarity is null (not meaningful)
              similarity = null;
            }

            return {
              ...parent,
              similarity_percentage: similarity
            };
          })
        );
      }

      res.json({
        concept,
        parents: parentsWithSimilarity,
        originPath: originPath || null,
        originEdgeId: originEdgeId
      });
    } catch (error) {
      console.error('Error fetching concept parents:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Search concepts by name (text matching + trigram similarity)
  // Returns attribute info for each edge context the concept appears in
  searchConcepts: async (req, res) => {
    const { q, parentId, path } = req.query;

    try {
      if (!q || q.trim().length === 0) {
        return res.json({ results: [] });
      }

      const searchTerm = q.trim();

      // Combined query: exact prefix matches first, then trigram similarity matches
      // Results are deduped and limited to 20
      const searchQuery = `
        WITH exact_matches AS (
          SELECT id, name, 1 as match_type, 
            CASE 
              WHEN LOWER(name) = LOWER($1) THEN 1.0
              ELSE 0.9
            END as relevance
          FROM concepts 
          WHERE LOWER(name) LIKE LOWER($1) || '%'
          LIMIT 10
        ),
        similar_matches AS (
          SELECT id, name, 2 as match_type, 
            similarity(name, $1) as relevance
          FROM concepts 
          WHERE similarity(name, $1) > 0.15
            AND id NOT IN (SELECT id FROM exact_matches)
          ORDER BY similarity(name, $1) DESC
          LIMIT 10
        ),
        combined AS (
          SELECT * FROM exact_matches
          UNION ALL
          SELECT * FROM similar_matches
        )
        SELECT c.id, c.name, c.match_type, c.relevance
        FROM combined c
        ORDER BY c.match_type, c.relevance DESC
        LIMIT 20;
      `;

      const result = await pool.query(searchQuery, [searchTerm]);

      // If we have a parentId and path, check which results are already children
      // AND what attributes they have in this context
      let childInfo = {};
      if (parentId && path !== undefined) {
        const graphPath = path ? path.split(',').map(Number) : [];
        graphPath.push(parseInt(parentId));

        const childCheckQuery = `
          SELECT e.child_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          WHERE e.parent_id = $1 AND e.graph_path = $2 AND e.is_hidden = false
        `;

        const childResult = await pool.query(childCheckQuery, [parentId, graphPath]);
        for (const row of childResult.rows) {
          if (!childInfo[row.child_id]) {
            childInfo[row.child_id] = [];
          }
          childInfo[row.child_id].push(row.attribute_name);
        }
      }

      // If user is logged in, check which results appear in their saved tabs
      let savedTabInfo = {};
      if (req.user && result.rows.length > 0) {
        const conceptIds = result.rows.map(r => r.id);
        const savedTabQuery = `
          SELECT DISTINCT e.child_id AS concept_id, st.id AS tab_id, st.name AS tab_name
          FROM votes v
          JOIN vote_tab_links vtl ON vtl.vote_id = v.id
          JOIN saved_tabs st ON vtl.saved_tab_id = st.id
          JOIN edges e ON v.edge_id = e.id
          WHERE v.user_id = $1 AND e.child_id = ANY($2::integer[])
          ORDER BY e.child_id, st.name
        `;
        const savedTabResult = await pool.query(savedTabQuery, [req.user.userId, conceptIds]);
        for (const row of savedTabResult.rows) {
          if (!savedTabInfo[row.concept_id]) {
            savedTabInfo[row.concept_id] = [];
          }
          // Avoid duplicate tab entries for the same concept
          if (!savedTabInfo[row.concept_id].some(t => t.tabId === row.tab_id)) {
            savedTabInfo[row.concept_id].push({ tabId: row.tab_id, tabName: row.tab_name });
          }
        }
      }

      // If user is logged in, check which results appear as annotations in subscribed corpuses
      let corpusAnnotationInfo = {};
      if (req.user && result.rows.length > 0) {
        const conceptIds = result.rows.map(r => r.id);
        const corpusAnnotationQuery = `
          SELECT DISTINCT e.child_id AS concept_id, co.id AS corpus_id, co.name AS corpus_name
          FROM document_annotations da
          JOIN edges e ON da.edge_id = e.id
          JOIN corpuses co ON da.corpus_id = co.id
          JOIN corpus_subscriptions cs ON cs.corpus_id = co.id AND cs.user_id = $1
          WHERE e.child_id = ANY($2::integer[])
          ORDER BY e.child_id, co.name
        `;
        const corpusResult = await pool.query(corpusAnnotationQuery, [req.user.userId, conceptIds]);
        for (const row of corpusResult.rows) {
          if (!corpusAnnotationInfo[row.concept_id]) {
            corpusAnnotationInfo[row.concept_id] = [];
          }
          if (!corpusAnnotationInfo[row.concept_id].some(c => c.corpusId === row.corpus_id)) {
            corpusAnnotationInfo[row.concept_id].push({ corpusId: row.corpus_id, corpusName: row.corpus_name });
          }
        }
      }

      const results = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        matchType: row.match_type === 1 ? 'exact' : 'similar',
        isChild: !!childInfo[row.id],
        childAttributes: childInfo[row.id] || [],
        savedTabs: savedTabInfo[row.id] || [],
        corpusAnnotations: corpusAnnotationInfo[row.id] || [],
      }));

      // Sort: results in saved tabs or corpuses first, then normal order
      results.sort((a, b) => {
        const aHasContext = (a.savedTabs.length > 0 || a.corpusAnnotations.length > 0) ? 0 : 1;
        const bHasContext = (b.savedTabs.length > 0 || b.corpusAnnotations.length > 0) ? 0 : 1;
        if (aHasContext !== bHasContext) return aHasContext - bHasContext;
        return 0; // preserve existing order within each group
      });

      // Flag whether there's an exact match (for "create root" logic)
      const exactMatch = result.rows.some(
        r => r.name.toLowerCase() === searchTerm.toLowerCase()
      );

      // Check if the exact-match concept already has root edges (and which attributes)
      let exactMatchRootAttributes = [];
      if (exactMatch) {
        const exactRow = result.rows.find(r => r.name.toLowerCase() === searchTerm.toLowerCase());
        if (exactRow) {
          const rootEdgeCheck = await pool.query(
            `SELECT a.id as attribute_id, a.name as attribute_name
             FROM edges e JOIN attributes a ON e.attribute_id = a.id
             WHERE e.child_id = $1 AND e.parent_id IS NULL AND e.graph_path = '{}'`,
            [exactRow.id]
          );
          exactMatchRootAttributes = rootEdgeCheck.rows.map(r => r.attribute_name);
        }
      }

      res.json({ results, exactMatch, exactMatchRootAttributes });
    } catch (error) {
      console.error('Error searching concepts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all available attributes
  getAttributes: async (req, res) => {
    try {
      const enabled = process.env.ENABLED_ATTRIBUTES;
      let result;
      if (enabled) {
        const names = enabled.split(',').map(n => n.trim()).filter(Boolean);
        result = await pool.query(
          'SELECT id, name FROM attributes WHERE name = ANY($1) ORDER BY id',
          [names]
        );
      } else {
        result = await pool.query(
          'SELECT id, name FROM attributes ORDER BY id'
        );
      }
      res.json({ attributes: result.rows });
    } catch (error) {
      console.error('Error fetching attributes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new concept as a child of a parent in a specific context
  createChildConcept: async (req, res) => {
    const { name, parentId, path } = req.body;

    try {
      // Validate input
      if (!name || !parentId) {
        return res.status(400).json({ error: 'Name and parentId are required' });
      }

      // Validate concept name length
      if (name.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      // Parse the path to build the graph_path for the new edge
      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(parentId));

      // Determine attributeId from the root edge of this graph
      // graph_path[0] is the root concept ID
      const rootConceptId = graphPath[0];
      const rootEdgeResult = await pool.query(
        'SELECT attribute_id FROM edges WHERE parent_id IS NULL AND child_id = $1',
        [rootConceptId]
      );
      if (rootEdgeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Could not find root edge to determine attribute' });
      }
      const attributeId = rootEdgeResult.rows[0].attribute_id;

      // Validate attribute exists (sanity check)
      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute on root edge' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Check if concept with this name already exists
        let conceptResult = await client.query(
          'SELECT * FROM concepts WHERE LOWER(name) = LOWER($1)',
          [name]
        );

        let conceptId;
        if (conceptResult.rows.length > 0) {
          // Concept exists, use its ID
          conceptId = conceptResult.rows[0].id;

          // Check if this would create a cycle
          if (graphPath.includes(conceptId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'Cannot add concept: would create a cycle in the graph' 
            });
          }
        } else {
          // Create new concept
          conceptResult = await client.query(
            'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING *',
            [name, req.user.userId]
          );
          conceptId = conceptResult.rows[0].id;
        }

        // Check if edge already exists WITH THIS ATTRIBUTE
        const existingEdge = await client.query(
          'SELECT * FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 AND attribute_id = $4',
          [parentId, conceptId, graphPath, attributeId]
        );

        if (existingEdge.rows.length > 0) {
          // Check if the existing edge is hidden — return a specific message
          if (existingEdge.rows[0].is_hidden) {
            await client.query('ROLLBACK');
            return res.status(409).json({ 
              error: 'This concept exists but has been hidden by the community' 
            });
          }
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: 'This concept with this attribute is already a child in this context' 
          });
        }

        // Create edge with attribute
        const edgeResult = await client.query(
          'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [parentId, conceptId, graphPath, attributeId, req.user.userId]
        );

        await client.query('COMMIT');

        // Fetch the attribute name to include in response
        const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;

        res.status(201).json({
          message: 'Child concept added successfully',
          concept: conceptResult.rows[0],
          edge: edgeResult.rows[0],
          attribute: { id: parseInt(attributeId), name: attrName }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating child concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get concept names by IDs (for breadcrumbs)
  getConceptNames: async (req, res) => {
    const { ids } = req.query; // Comma-separated IDs

    try {
      if (!ids) {
        return res.json({ concepts: [] });
      }

      const idArray = ids.split(',').map(Number).filter(id => !isNaN(id));
      
      if (idArray.length === 0) {
        return res.json({ concepts: [] });
      }

      const result = await pool.query(
        'SELECT id, name FROM concepts WHERE id = ANY($1)',
        [idArray]
      );

      // Return in same order as requested
      const conceptMap = {};
      result.rows.forEach(row => {
        conceptMap[row.id] = row.name;
      });

      const orderedConcepts = idArray.map(id => ({
        id,
        name: conceptMap[id] || `Concept ${id}`
      }));

      res.json({ concepts: orderedConcepts });
    } catch (error) {
      console.error('Error fetching concept names:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a root concept
  createRootConcept: async (req, res) => {
    const { name, attributeId } = req.body;

    try {
      // Validate input
      if (!name || !attributeId) {
        return res.status(400).json({ error: 'Name and attributeId are required' });
      }

      // Validate concept name length
      if (name.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      // Validate attribute exists
      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Check if concept name already exists — reuse if so (same pattern as createChildConcept)
        const existingConcept = await client.query(
          'SELECT id, name FROM concepts WHERE LOWER(name) = LOWER($1)',
          [name]
        );

        let conceptId;
        let conceptRow;

        if (existingConcept.rows.length > 0) {
          conceptId = existingConcept.rows[0].id;
          conceptRow = existingConcept.rows[0];

          // Check if a root edge already exists for this concept + attribute
          const existingRootEdge = await client.query(
            'SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND attribute_id = $2',
            [conceptId, attributeId]
          );
          if (existingRootEdge.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'A root concept with this name and attribute already exists'
            });
          }
        } else {
          // Create new concept
          const result = await client.query(
            'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING *',
            [name, req.user.userId]
          );
          conceptId = result.rows[0].id;
          conceptRow = result.rows[0];
        }

        // Create root edge with attribute (parent_id = NULL, graph_path = empty)
        await client.query(
          'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES (NULL, $1, $2, $3, $4)',
          [conceptId, '{}', attributeId, req.user.userId]
        );

        await client.query('COMMIT');

        // Fetch the attribute name to include in response
        const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;

        res.status(201).json({
          message: 'Root concept created successfully',
          concept: conceptRow,
          attribute: { id: parseInt(attributeId), name: attrName }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating root concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Find all concept names that appear as whole words in provided text
  // Returns matches with positions, concept IDs, and names
  // Used for live concept linking in document views (Phase 7i)
  findConceptsInText: async (req, res) => {
    const { text } = req.body;

    try {
      if (!text || text.trim().length === 0) {
        return res.json({ matches: [] });
      }

      // Get all concept names from the database
      const conceptsResult = await pool.query(
        'SELECT id, name FROM concepts ORDER BY LENGTH(name) DESC'
      );

      if (conceptsResult.rows.length === 0) {
        return res.json({ matches: [] });
      }

      const matches = [];
      const textLower = text.toLowerCase();

      // For each concept, find all whole-word case-insensitive matches in the text
      for (const concept of conceptsResult.rows) {
        const nameLower = concept.name.toLowerCase();
        // Escape regex special characters in concept name
        const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match whole words only — use word boundary \b
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            conceptId: concept.id,
            conceptName: concept.name,
            start: match.index,
            end: match.index + match[0].length,
          });
        }
      }

      // Sort by position (start ascending), then by length descending (longer matches first)
      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      // Remove overlapping matches (longer/earlier match wins)
      const filtered = [];
      let lastEnd = 0;
      for (const m of matches) {
        if (m.start >= lastEnd) {
          filtered.push(m);
          lastEnd = m.end;
        }
      }

      res.json({ matches: filtered });
    } catch (error) {
      console.error('Error finding concepts in text:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 7i-5: Get concept links for a finalized document, using cache
  // Returns cached matches if fresh, otherwise recomputes from the document body.
  // Cache is stale when new concepts have been created since computed_at.
  // Guest-accessible (optionalAuth).
  getDocumentConceptLinks: async (req, res) => {
    const { documentId } = req.params;

    try {
      // Verify document exists and is finalized
      const docResult = await pool.query(
        'SELECT id, body FROM documents WHERE id = $1',
        [documentId]
      );

      if (docResult.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const doc = docResult.rows[0];

      // Check if we have cached links
      const cacheResult = await pool.query(
        'SELECT computed_at FROM document_concept_links_cache WHERE document_id = $1 LIMIT 1',
        [documentId]
      );

      let cacheIsFresh = false;
      if (cacheResult.rows.length > 0) {
        const computedAt = cacheResult.rows[0].computed_at;
        // Check if any concepts were created after the cache was computed
        const newerConcepts = await pool.query(
          'SELECT 1 FROM concepts WHERE created_at > $1 LIMIT 1',
          [computedAt]
        );
        cacheIsFresh = newerConcepts.rows.length === 0;
      }

      if (cacheIsFresh) {
        // Serve from cache
        const cached = await pool.query(
          `SELECT concept_id AS "conceptId", concept_name AS "conceptName", 
                  start_position AS "start", end_position AS "end"
           FROM document_concept_links_cache 
           WHERE document_id = $1
           ORDER BY start_position`,
          [documentId]
        );
        return res.json({ matches: cached.rows, cached: true });
      }

      // Cache is stale or doesn't exist — recompute
      const conceptsResult = await pool.query(
        'SELECT id, name FROM concepts ORDER BY LENGTH(name) DESC'
      );

      if (conceptsResult.rows.length === 0) {
        // Clear any old cache and return empty
        await pool.query('DELETE FROM document_concept_links_cache WHERE document_id = $1', [documentId]);
        return res.json({ matches: [], cached: true });
      }

      const matches = [];
      for (const concept of conceptsResult.rows) {
        const nameLower = concept.name.toLowerCase();
        const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        let match;
        while ((match = regex.exec(doc.body)) !== null) {
          matches.push({
            conceptId: concept.id,
            conceptName: concept.name,
            start: match.index,
            end: match.index + match[0].length,
          });
        }
      }

      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      const filtered = [];
      let lastEnd = 0;
      for (const m of matches) {
        if (m.start >= lastEnd) {
          filtered.push(m);
          lastEnd = m.end;
        }
      }

      // Store in cache (replace any existing entries)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM document_concept_links_cache WHERE document_id = $1', [documentId]);
        const now = new Date();
        for (const m of filtered) {
          await client.query(
            `INSERT INTO document_concept_links_cache 
             (document_id, concept_id, concept_name, start_position, end_position, computed_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [documentId, m.conceptId, m.conceptName, m.start, m.end, now]
          );
        }
        await client.query('COMMIT');
      } catch (cacheErr) {
        await client.query('ROLLBACK');
        console.warn('Failed to cache concept links, serving computed results:', cacheErr);
      } finally {
        client.release();
      }

      return res.json({ matches: filtered, cached: true });
    } catch (error) {
      console.error('Error getting document concept links:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get identical vote sets for children of a concept in a specific context
  // Returns groups of users who have saved the exact same set of children
  getVoteSets: async (req, res) => {
    const { id } = req.params;
    const { path } = req.query;

    try {
      // Parse the path (same logic as getConceptWithChildren)
      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(id));

      // Step 1: For each user, get the sorted array of child edge IDs they've saved
      // in this context (parent_id = id, graph_path = graphPath)
      // Step 2: Group users by identical vote arrays
      // Step 3: Return only groups with 2+ users (threshold)
      const voteSetsQuery = `
        WITH user_saved_children AS (
          -- For each user, get the set of child edge IDs they've saved in this context
          SELECT
            v.user_id,
            array_agg(e.id ORDER BY e.id) as saved_edge_ids,
            array_agg(e.child_id ORDER BY e.id) as saved_child_ids
          FROM votes v
          JOIN edges e ON v.edge_id = e.id
          WHERE e.parent_id = $1 AND e.graph_path = $2 AND e.is_hidden = false
          GROUP BY v.user_id
        ),
        vote_set_groups AS (
          -- Group users by identical saved sets
          SELECT 
            saved_edge_ids,
            saved_child_ids,
            array_agg(user_id ORDER BY user_id) as user_ids,
            COUNT(*) as user_count
          FROM user_saved_children
          GROUP BY saved_edge_ids, saved_child_ids
        )
        SELECT 
          saved_edge_ids,
          saved_child_ids,
          user_ids,
          user_count
        FROM vote_set_groups
        ORDER BY user_count DESC;
      `;

      const result = await pool.query(voteSetsQuery, [id, graphPath]);

      // Look up the parent edge ID (the edge connecting this concept to its parent)
      // This is used as the context key for child rankings (Phase 5f)
      let parentEdgeId = null;
      if (graphPath.length >= 2) {
        // Non-root: edge from parent to this concept
        const parentId = graphPath[graphPath.length - 2];
        const parentPath = graphPath.slice(0, -1);
        const peResult = await pool.query(
          'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 LIMIT 1',
          [parentId, id, parentPath]
        );
        if (peResult.rows.length > 0) parentEdgeId = peResult.rows[0].id;
      } else if (graphPath.length === 1) {
        // Root concept: root edge
        const peResult = await pool.query(
          "SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = '{}' LIMIT 1",
          [id]
        );
        if (peResult.rows.length > 0) parentEdgeId = peResult.rows[0].id;
      }

      // Build initial vote sets from query results
      const rawSets = result.rows.map((row) => ({
        edgeIds: row.saved_edge_ids,
        childIds: row.saved_child_ids,
        userCount: parseInt(row.user_count),
        userIds: row.user_ids,
        voteSetKey: [...row.saved_edge_ids].sort((a, b) => a - b).join(','),
      }));

      // Reorder vote sets by nearest-neighbor Jaccard similarity
      // so that similar compositions get adjacent colors
      const orderedSets = [];
      if (rawSets.length <= 1) {
        orderedSets.push(...rawSets);
      } else {
        const edgeSets = rawSets.map(s => new Set(s.edgeIds));
        const used = new Set();
        // Start with the first set (largest by user count, from ORDER BY)
        used.add(0);
        orderedSets.push(rawSets[0]);
        let lastIdx = 0;
        for (let step = 1; step < rawSets.length; step++) {
          const lastSet = edgeSets[lastIdx];
          let bestIdx = -1;
          let bestSim = -1;
          for (let j = 0; j < rawSets.length; j++) {
            if (used.has(j)) continue;
            const setB = edgeSets[j];
            let intersection = 0;
            for (const id of lastSet) {
              if (setB.has(id)) intersection++;
            }
            const union = lastSet.size + setB.size - intersection;
            const sim = union === 0 ? 0 : intersection / union;
            if (sim > bestSim) {
              bestSim = sim;
              bestIdx = j;
            }
          }
          used.add(bestIdx);
          orderedSets.push(rawSets[bestIdx]);
          lastIdx = bestIdx;
        }
      }

      // Assign setIndex based on new order
      const voteSets = orderedSets.map((set, index) => ({
        ...set,
        setIndex: index,
      }));

      // Build a lookup: for each edge_id, which set indices does it belong to?
      const edgeToSets = {};
      voteSets.forEach((set) => {
        set.edgeIds.forEach((edgeId) => {
          if (!edgeToSets[edgeId]) {
            edgeToSets[edgeId] = [];
          }
          edgeToSets[edgeId].push(set.setIndex);
        });
      });

      // Identify which set index the current user belongs to (if any)
      const currentUserId = req.user ? req.user.userId : null;
      let userSetIndex = null;
      if (currentUserId !== null) {
        for (const set of voteSets) {
          if (set.userIds.some(uid => uid == currentUserId)) {
            userSetIndex = set.setIndex;
            break;
          }
        }
      }

      res.json({ voteSets, edgeToSets, userSetIndex, parentEdgeId });
    } catch (error) {
      console.error('Error fetching vote sets:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 14a: Get children (with grandchildren names) for multiple concepts in batch
  // Used by the Diff Modal for side-by-side comparison
  getBatchChildrenForDiff: async (req, res) => {
    try {
      const { panes } = req.body;

      if (!panes || !Array.isArray(panes) || panes.length === 0) {
        return res.status(400).json({ error: 'panes array is required' });
      }

      if (panes.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 panes allowed' });
      }

      const results = [];

      for (const pane of panes) {
        const { conceptId, path } = pane;

        if (!conceptId || path === undefined || path === null) {
          results.push({ conceptId, path, children: [], error: 'Missing conceptId or path' });
          continue;
        }

        const pathArray = typeof path === 'string' ? path.split(',').filter(Boolean).map(Number) : path;

        // Build graph_path the same way getConceptWithChildren does:
        // the frontend sends the "context path" (path to parent), and we append the conceptId
        // to form the actual graph_path used on this concept's child edges
        const graphPath = [...pathArray, parseInt(conceptId)];

        // Get children of this concept in this path context
        const childrenResult = await pool.query(
          `SELECT e.id as edge_id, e.child_id, c.name as child_name,
                  a.name as child_attribute,
                  COUNT(DISTINCT v.user_id) as save_count
           FROM edges e
           JOIN concepts c ON e.child_id = c.id
           JOIN attributes a ON e.attribute_id = a.id
           LEFT JOIN votes v ON v.edge_id = e.id
           WHERE e.parent_id = $1
             AND e.graph_path = $2
             AND e.is_hidden = false
           GROUP BY e.id, e.child_id, c.name, a.name
           ORDER BY save_count DESC, c.name`,
          [conceptId, `{${graphPath.join(',')}}`]
        );

        // For each child, get THEIR children (grandchildren) for Jaccard computation
        // Grandchildren's graph_path = graphPath + child_id
        const children = [];
        for (const child of childrenResult.rows) {
          const grandchildPath = [...graphPath, child.child_id];
          const grandchildrenResult = await pool.query(
            `SELECT c.name, a.name as attribute_name
             FROM edges e
             JOIN concepts c ON e.child_id = c.id
             JOIN attributes a ON e.attribute_id = a.id
             WHERE e.parent_id = $1
               AND e.graph_path = $2
               AND e.is_hidden = false`,
            [child.child_id, `{${grandchildPath.join(',')}}`]
          );

          children.push({
            edgeId: child.edge_id,
            childId: child.child_id,
            name: child.child_name,
            attribute: child.child_attribute,
            saveCount: parseInt(child.save_count),
            grandchildren: grandchildrenResult.rows.map(gc => `${gc.name} [${gc.attribute_name}]`)
          });
        }

        results.push({
          conceptId: parseInt(conceptId),
          path: pathArray,
          children
        });
      }

      res.json({ results });
    } catch (error) {
      console.error('Error in getBatchChildrenForDiff:', error);
      res.status(500).json({ error: 'Failed to get batch children for diff' });
    }
  },

  // Phase 27b: Get all annotations for a concept across ALL edges/contexts
  getAnnotationsForConcept: async (req, res) => {
    try {
      const conceptId = parseInt(req.params.id);
      if (isNaN(conceptId)) {
        return res.status(400).json({ error: 'Invalid concept ID' });
      }

      const sort = req.query.sort === 'newest' ? 'newest' : 'votes';
      const edgeId = req.query.edgeId ? parseInt(req.query.edgeId) : null;
      const tagId = req.query.tagId ? parseInt(req.query.tagId) : null;
      const corpusIds = req.query.corpusIds
        ? req.query.corpusIds.split(',').map(Number).filter(n => !isNaN(n))
        : null;
      const userId = req.user ? req.user.userId : null;

      const orderClause = sort === 'newest'
        ? 'ORDER BY created_at DESC'
        : 'ORDER BY vote_count DESC, created_at DESC';

      // Build dynamic WHERE filters with parameterized queries
      const params = [conceptId];
      if (userId) params.push(userId);
      const userParamIdx = userId ? 2 : null;

      let extraFilters = '';
      if (edgeId) {
        params.push(edgeId);
        extraFilters += ` AND da.edge_id = $${params.length}`;
      }
      if (tagId) {
        params.push(tagId);
        extraFilters += ` AND d.tag_id = $${params.length}`;
      }
      if (corpusIds && corpusIds.length > 0) {
        params.push(corpusIds);
        extraFilters += ` AND da.corpus_id = ANY($${params.length}::integer[])`;
      }

      // Deduplicate across document versions: for each version chain + corpus + creator + quote_text,
      // keep only the annotation from the latest version.
      const result = await pool.query(
        `WITH RECURSIVE doc_roots AS (
          SELECT d2.id AS doc_id, d2.id AS current_id, d2.source_document_id
          FROM documents d2
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
        all_anns AS (
          SELECT da.id AS annotation_id,
                  da.quote_text, da.comment, da.quote_occurrence,
                  da.created_at, da.created_by,
                  u.username AS creator_username,
                  da.document_id, d.title AS document_title,
                  d.tag_id, d.version_number,
                  dt.name AS tag_name,
                  da.corpus_id, cor.name AS corpus_name,
                  da.edge_id,
                  e.parent_id, e.graph_path, e.attribute_id,
                  pc.name AS parent_name,
                  att.name AS attribute_name,
                  COUNT(av.id)::int AS vote_count,
                  ${userParamIdx ? `BOOL_OR(av.user_id = $${userParamIdx})` : 'false'} AS user_voted,
                  r.root_document_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY r.root_document_id, da.corpus_id, da.created_by, da.edge_id, COALESCE(da.quote_text, '')
                    ORDER BY d.version_number DESC
                  ) AS rn
           FROM document_annotations da
           JOIN edges e ON e.id = da.edge_id
           JOIN users u ON u.id = da.created_by
           JOIN documents d ON d.id = da.document_id
           JOIN corpuses cor ON cor.id = da.corpus_id
           JOIN roots r ON r.doc_id = da.document_id
           LEFT JOIN concepts pc ON pc.id = e.parent_id
           LEFT JOIN attributes att ON att.id = e.attribute_id
           LEFT JOIN annotation_votes av ON av.annotation_id = da.id
           LEFT JOIN document_tags dt ON dt.id = d.tag_id
           WHERE e.child_id = $1
             AND e.is_hidden = false
             ${extraFilters}
           GROUP BY da.id, da.quote_text, da.comment, da.quote_occurrence,
                    da.created_at, da.created_by, u.username,
                    da.document_id, d.title, d.tag_id, d.version_number, dt.name,
                    da.corpus_id, cor.name,
                    da.edge_id, e.parent_id, e.graph_path, e.attribute_id,
                    pc.name, att.name, r.root_document_id
        )
        SELECT annotation_id, quote_text, comment, quote_occurrence,
               created_at, created_by, creator_username,
               document_id, document_title, tag_id, tag_name,
               corpus_id, corpus_name, edge_id, parent_id, graph_path,
               attribute_id, parent_name, attribute_name,
               vote_count, user_voted
        FROM all_anns WHERE rn = 1
        ${orderClause}`,
        params
      );

      // Collect all concept IDs from graph_paths for name resolution
      const pathIds = new Set();
      for (const row of result.rows) {
        if (row.graph_path) {
          for (const id of row.graph_path) {
            pathIds.add(id);
          }
        }
      }

      let nameMap = {};
      if (pathIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(pathIds)]
        );
        for (const row of namesResult.rows) {
          nameMap[row.id] = row.name;
        }
      }

      const annotations = result.rows.map(row => {
        const pathNames = (row.graph_path || []).map(id => nameMap[id] || `#${id}`);
        return {
          annotationId: row.annotation_id,
          quoteText: row.quote_text,
          comment: row.comment,
          quoteOccurrence: row.quote_occurrence,
          createdAt: row.created_at,
          creatorUsername: row.creator_username,
          documentId: row.document_id,
          documentTitle: row.document_title,
          tagId: row.tag_id || null,
          tagName: row.tag_name || null,
          corpusId: row.corpus_id,
          corpusName: row.corpus_name,
          voteCount: row.vote_count,
          userVoted: row.user_voted || false,
          context: {
            edgeId: row.edge_id,
            parentId: row.parent_id,
            parentName: row.parent_name || '(root)',
            pathNames,
            attributeName: row.attribute_name,
          },
        };
      });

      res.json({ annotations });
    } catch (error) {
      console.error('Error in getAnnotationsForConcept:', error);
      res.status(500).json({ error: 'Failed to get annotations for concept' });
    }
  },
};

module.exports = conceptsController;
