const pool = require('./database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Enable pg_trgm extension for fuzzy text search (concept name search
    // in conceptsController.searchConcepts and document duplicate detection
    // in corpusController.checkDuplicates). Must run before any index that
    // uses gin_trgm_ops — idx_concepts_name_trgm below and
    // idx_documents_body_trgm further down.
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Concepts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS concepts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Trigram and lowercase indexes on concepts.name — used by
    // conceptsController.searchConcepts for fuzzy and exact-prefix matching.
    // Requires the pg_trgm extension enabled above.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concepts_name_trgm
        ON concepts USING GIN (name gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concepts_name_lower
        ON concepts (LOWER(name));
    `);

    // Attributes table - stores reusable attribute tags (action, tool, value)
    await client.query(`
      CREATE TABLE IF NOT EXISTS attributes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default attributes (action, tool, value) if they don't exist
    await client.query(`
      INSERT INTO attributes (name) VALUES ('action'), ('tool'), ('value')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Edges table - represents parent-child relationships in specific graph contexts
    await client.query(`
      CREATE TABLE IF NOT EXISTS edges (
        id SERIAL PRIMARY KEY,
        parent_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        child_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        graph_path INTEGER[] NOT NULL,
        attribute_id INTEGER REFERENCES attributes(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // If edges table already existed without attribute_id, add the column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'edges' AND column_name = 'attribute_id'
        ) THEN
          ALTER TABLE edges ADD COLUMN attribute_id INTEGER REFERENCES attributes(id);
        END IF;
      END $$;
    `);

    // Backfill: assign all existing edges without an attribute to 'action'
    await client.query(`
      UPDATE edges 
      SET attribute_id = (SELECT id FROM attributes WHERE name = 'action')
      WHERE attribute_id IS NULL;
    `);

    // Now enforce NOT NULL on attribute_id
    await client.query(`
      ALTER TABLE edges ALTER COLUMN attribute_id SET NOT NULL;
    `);

    // Drop old unique constraint if it exists (without attribute_id)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'edges_parent_id_child_id_graph_path_key'
          AND table_name = 'edges'
        ) THEN
          ALTER TABLE edges DROP CONSTRAINT edges_parent_id_child_id_graph_path_key;
        END IF;
      END $$;
    `);

    // Add new unique constraint that includes attribute_id
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'edges_parent_child_path_attribute_key'
          AND table_name = 'edges'
        ) THEN
          ALTER TABLE edges ADD CONSTRAINT edges_parent_child_path_attribute_key 
            UNIQUE(parent_id, child_id, graph_path, attribute_id);
        END IF;
      END $$;
    `);

    // Indexes for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_parent ON edges(parent_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_attribute ON edges(attribute_id);
    `);

    // Votes table (saves)
    await client.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    // Similarity votes table (link votes — Flip View only)
    // origin_edge_id = the edge the user came from (their current context)
    // similar_edge_id = the alt parent edge they're voting as helpful/linked
    await client.query(`
      CREATE TABLE IF NOT EXISTS similarity_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        origin_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        similar_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, origin_edge_id, similar_edge_id)
      );
    `);

    // Indexes for similarity_votes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_similarity_votes_origin ON similarity_votes(origin_edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_similarity_votes_similar ON similarity_votes(similar_edge_id);
    `);

    // Side votes table (move votes)
    // edge_id = the edge being flagged as misplaced
    // destination_edge_id = the edge in the destination context where it should live
    await client.query(`
      CREATE TABLE IF NOT EXISTS side_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        destination_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id, destination_edge_id)
      );
    `);

    // Indexes for side_votes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_side_votes_edge ON side_votes(edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_side_votes_destination ON side_votes(destination_edge_id);
    `);

    // Replace votes table (swap votes)
    // edge_id = the edge being flagged as replaceable
    // replacement_edge_id = the sibling edge that should replace it
    await client.query(`
      CREATE TABLE IF NOT EXISTS replace_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        replacement_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id, replacement_edge_id)
      );
    `);

    // Indexes for replace_votes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_replace_votes_edge ON replace_votes(edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_replace_votes_replacement ON replace_votes(replacement_edge_id);
    `);

    // ============================================================
    // Saved Tabs table (Phase 5b)
    // Each user has one or more named tabs on their Saved page.
    // A default "Saved" tab is auto-created at registration time.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_tabs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT 'Saved',
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_tabs_user ON saved_tabs(user_id);
    `);

    // ============================================================
    // Vote-Tab Links junction table (Phase 5b)
    // Links a vote (user endorsement of an edge) to one or more
    // Saved tabs. A vote can appear in multiple tabs. Removing a
    // link from a tab does NOT delete the vote itself — it only
    // removes it from that tab's view.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS vote_tab_links (
        id SERIAL PRIMARY KEY,
        vote_id INTEGER REFERENCES votes(id) ON DELETE CASCADE,
        saved_tab_id INTEGER REFERENCES saved_tabs(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vote_id, saved_tab_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vote_tab_links_vote ON vote_tab_links(vote_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vote_tab_links_tab ON vote_tab_links(saved_tab_id);
    `);

    // ============================================================
    // Backfill: Create a default "Saved" tab for any existing user
    // who does not yet have one, and link all their existing votes
    // to that tab. This ensures seamless upgrade from Phase 5a.
    // ============================================================
    await client.query(`
      INSERT INTO saved_tabs (user_id, name, display_order)
      SELECT u.id, 'Saved', 0
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM saved_tabs st WHERE st.user_id = u.id
      );
    `);

    // Link all existing votes that have no tab link to the user's default tab
    await client.query(`
      INSERT INTO vote_tab_links (vote_id, saved_tab_id)
      SELECT v.id, st.id
      FROM votes v
      JOIN saved_tabs st ON st.user_id = v.user_id
      WHERE st.display_order = 0
        AND NOT EXISTS (
          SELECT 1 FROM vote_tab_links vtl WHERE vtl.vote_id = v.id
        )
      ON CONFLICT (vote_id, saved_tab_id) DO NOTHING;
    `);

    // ============================================================
    // Graph Tabs table (Phase 5c)
    // Persistent in-app navigation tabs. Each graph tab tracks
    // where the user is in the concept graph (concept_id + path).
    // Graph tabs live alongside Saved tabs in the unified tab bar.
    // tab_type: 'root' (at root page) or 'concept' (at a concept)
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS graph_tabs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tab_type VARCHAR(20) NOT NULL DEFAULT 'root',
        concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
        path INTEGER[] NOT NULL DEFAULT '{}',
        view_mode VARCHAR(20) NOT NULL DEFAULT 'children',
        display_order INTEGER NOT NULL DEFAULT 0,
        label VARCHAR(255) NOT NULL DEFAULT 'Root',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_tabs_user ON graph_tabs(user_id);
    `);

    // ============================================================
    // Tab Groups table (Phase 5d)
    // Named groups that can contain any combination of saved tabs
    // and graph tabs. Flat grouping only — no groups within groups.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS tab_groups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT 'Group',
        display_order INTEGER NOT NULL DEFAULT 0,
        is_expanded BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tab_groups_user ON tab_groups(user_id);
    `);

    // Add group_id column to saved_tabs (nullable — null means ungrouped)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'saved_tabs' AND column_name = 'group_id'
        ) THEN
          ALTER TABLE saved_tabs ADD COLUMN group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add group_id column to graph_tabs (nullable — null means ungrouped)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'graph_tabs' AND column_name = 'group_id'
        ) THEN
          ALTER TABLE graph_tabs ADD COLUMN group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ============================================================
    // Saved Tree Order table (Phase 5e)
    // Stores per-user, per-tab display order of root-level graph
    // trees on the Saved Page. Trees without an explicit order
    // record fall to the bottom, sorted by save count.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_tree_order (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        saved_tab_id INTEGER REFERENCES saved_tabs(id) ON DELETE CASCADE,
        root_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        display_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, saved_tab_id, root_concept_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_tree_order_user_tab 
        ON saved_tree_order(user_id, saved_tab_id);
    `);

    // ============================================================
    // Child Rankings table (Phase 5f)
    // Stores per-user numeric rankings of children when filtering
    // to a single identical vote set. Rankings are keyed by a
    // deterministic vote_set_key so they apply only to a specific
    // vote set composition. If set membership changes, old rankings
    // become stale (different key).
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS child_rankings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        child_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        vote_set_key TEXT NOT NULL,
        rank_position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, parent_edge_id, child_edge_id, vote_set_key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_child_rankings_parent_set
        ON child_rankings(parent_edge_id, vote_set_key);
    `);

    // ============================================================
    // Concept Links table (Phase 6)
    // External URLs attached to concepts in specific contexts.
    // Links are tied to edges (context-specific), not concepts
    // globally. Same concept can have different links in different
    // parent contexts.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_links (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title VARCHAR(255),
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_links_edge ON concept_links(edge_id);
    `);

    // Phase 29a: Add comment and updated_at columns to concept_links (idempotent)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concept_links' AND column_name = 'comment'
        ) THEN
          ALTER TABLE concept_links ADD COLUMN comment TEXT;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concept_links' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE concept_links ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    // ============================================================
    // Concept Link Votes table (Phase 6)
    // Simple upvote system for web links. One vote per user per
    // link — not the four-type vote system used for edges.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_link_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        concept_link_id INTEGER REFERENCES concept_links(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, concept_link_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_link_votes_link ON concept_link_votes(concept_link_id);
    `);

    // ============================================================
    // Corpuses table (Phase 7a)
    // A corpus is a named collection of documents. Annotations,
    // permissions, and subscriptions all operate at the corpus
    // level. annotation_mode: 'public' (anyone can annotate) or
    // 'private' (invite-only). Note: this column is functionally retired as of Phase 7g.
    // Phase 10a renamed the annotation layer from 'private' to 'editorial'.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS corpuses (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        annotation_mode VARCHAR(20) NOT NULL DEFAULT 'public',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpuses_created_by ON corpuses(created_by);
    `);

    // ============================================================
    // Documents table (Phase 7a)
    // Stores uploaded document content. Documents are immutable
    // once uploaded — text content cannot be edited, which
    // guarantees annotation character offsets remain valid.
    // format: 'plain' (plain text) or 'markdown'.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        format VARCHAR(20) NOT NULL DEFAULT 'plain',
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
    `);

    // ============================================================
    // Document Versioning columns (Phase 7h)
    // version_number: Auto-incremented per lineage (default 1 for
    //   original uploads). source_document_id: Self-referencing FK
    //   forming a version chain (NULL for originals). is_draft:
    //   New versions start as drafts (editable); finalized = immutable.
    //   Existing documents are always finalized (is_draft = false).
    // ============================================================

    // Add version_number column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'version_number'
        ) THEN
          ALTER TABLE documents ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1;
        END IF;
      END $$;
    `);

    // Add source_document_id (self-referencing FK for version chain)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'source_document_id'
        ) THEN
          ALTER TABLE documents ADD COLUMN source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add is_draft column (false for existing documents — they're already finalized)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'is_draft'
        ) THEN
          ALTER TABLE documents ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);

    // Index for version chain lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_document_id);
    `);

    // ============================================================
    // Corpus-Documents junction table (Phase 7a)
    // Links documents to corpuses. A document can appear in
    // multiple corpuses. Removing a document from a corpus deletes
    // all annotations for that document within that corpus.
    // If a document is in zero corpuses, it is deleted.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS corpus_documents (
        id SERIAL PRIMARY KEY,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(corpus_id, document_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_documents_corpus ON corpus_documents(corpus_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_documents_document ON corpus_documents(document_id);
    `);

    // ============================================================
    // Trigram index on documents.body (Phase 7b)
    // Used for duplicate detection on upload — pg_trgm similarity
    // matching against existing document bodies. Requires the
    // pg_trgm extension (already enabled for concept name search).
    // ============================================================
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_body_trgm 
        ON documents USING GIN (body gin_trgm_ops);
    `);

    // ============================================================
    // Corpus Subscriptions table (Phase 7c)
    // Tracks which users are subscribed to which corpuses.
    // Subscribing creates a persistent corpus tab in the main tab
    // bar. Unsubscribing removes it. Subscriber count is displayed
    // on corpus listings.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS corpus_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, corpus_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_subscriptions_user ON corpus_subscriptions(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_subscriptions_corpus ON corpus_subscriptions(corpus_id);
    `);

    // Add group_id to corpus_subscriptions (Phase 7f — allows corpus tabs to join tab groups)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'corpus_subscriptions' AND column_name = 'group_id'
        ) THEN
          ALTER TABLE corpus_subscriptions ADD COLUMN group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ============================================================
    // Document Annotations table (Phase 7d)
    // Annotations attach an edge (concept-in-context) to a text
    // selection within a document, scoped to a specific corpus.
    // The same document in different corpuses has entirely separate
    // annotation sets. Character offsets (start_position,
    // end_position) are stored against the immutable document body.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_annotations (
        id SERIAL PRIMARY KEY,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        start_position INTEGER NOT NULL,
        end_position INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_positions CHECK (start_position >= 0 AND end_position > start_position)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_annotations_corpus_doc 
        ON document_annotations(corpus_id, document_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_annotations_edge 
        ON document_annotations(edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_annotations_document 
        ON document_annotations(document_id);
    `);

    // ============================================================
    // Annotation Votes table (Phase 7f)
    // Simple save-style votes on annotations. One vote per user
    // per annotation — endorses the connection between the text
    // selection and the annotated concept-in-context.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS annotation_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, annotation_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_annotation_votes_annotation
        ON annotation_votes(annotation_id);
    `);

    // ============================================================
    // Annotation Color Set Votes table (Phase 7f)
    // Stores a user's preferred color set (vote set) for an
    // annotation. The vote_set_key is the same sorted comma-
    // separated edge ID string used in child_rankings, identifying
    // which identical vote set of children the user prefers.
    // One preference per user per annotation.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS annotation_color_set_votes (
        id SERIAL PRIMARY KEY,
        annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        vote_set_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, annotation_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_annotation_color_set_votes_annotation
        ON annotation_color_set_votes(annotation_id);
    `);

    // ============================================================
    // Corpus Allowed Users table (Phase 7g)
    // Tracks which users are allowed to contribute to a corpus's
    // editorial annotation layer. The corpus owner invites users via
    // invite links. Allowed users can: add documents, create
    // editorial-layer annotations, vote on editorial-layer annotations,
    // and remove annotations (with changelog).
    // display_name: optional username visible only within this
    // corpus's annotation layer, only to other allowed users.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS corpus_allowed_users (
        id SERIAL PRIMARY KEY,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(255),
        invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(corpus_id, user_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_allowed_users_corpus
        ON corpus_allowed_users(corpus_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_allowed_users_user
        ON corpus_allowed_users(user_id);
    `);

    // ============================================================
    // Corpus Invite Tokens table (Phase 7g)
    // Stores invite tokens generated by corpus owners. Each token
    // is a unique random string. Accepting a token adds the user
    // to corpus_allowed_users. Tokens can optionally expire.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS corpus_invite_tokens (
        id SERIAL PRIMARY KEY,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        max_uses INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_invite_tokens_corpus
        ON corpus_invite_tokens(corpus_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpus_invite_tokens_token
        ON corpus_invite_tokens(token);
    `);

    // ============================================================
    // Annotation Removal Log table (Phase 7g)
    // Logs every annotation removal performed by an allowed user
    // within a corpus. Provides accountability for curation
    // decisions. Uses ON DELETE SET NULL for FKs so log entries
    // survive even if the referenced document/edge/user is deleted.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS annotation_removal_log (
        id SERIAL PRIMARY KEY,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        edge_id INTEGER REFERENCES edges(id) ON DELETE SET NULL,
        start_position INTEGER NOT NULL,
        end_position INTEGER NOT NULL,
        annotation_layer VARCHAR(10) NOT NULL DEFAULT 'public',
        original_creator INTEGER REFERENCES users(id) ON DELETE SET NULL,
        removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_annotation_removal_log_corpus
        ON annotation_removal_log(corpus_id);
    `);

    // ============================================================
    // Add 'layer' column to document_annotations (Phase 7g)
    // Every annotation now has a layer: 'public' (visible to all)
    // or 'editorial' (curated layer maintained by allowed users of the corpus).
    // Existing annotations default to 'public'.
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'layer'
        ) THEN
          ALTER TABLE document_annotations ADD COLUMN layer VARCHAR(10) NOT NULL DEFAULT 'public';
        END IF;
      END $$;
    `);

    // ============================================================
    // Document Concept Links Cache table (Phase 7i-5)
    // Pre-computed concept link matches for finalized documents.
    // Finalized doc bodies are immutable, so matches only change
    // when new concepts are created. On document open, compare
    // computed_at against MAX(concepts.created_at) — if stale,
    // recompute and replace the cache.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_concept_links_cache (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        concept_id INTEGER NOT NULL,
        concept_name VARCHAR(255) NOT NULL,
        start_position INTEGER NOT NULL,
        end_position INTEGER NOT NULL,
        computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_doc_concept_links_cache_doc
        ON document_concept_links_cache(document_id);
    `);

    // ============================================================
    // Saved Tree Order V2 table (Phase 7c Saved Page Overhaul)
    // Replaces saved_tree_order (which keyed on saved_tab_id).
    // New version keys on corpus_id — NULL corpus_id = Uncategorized tab.
    // Stores user-configured display order of root-level graph trees
    // on each corpus-based Saved Page tab.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_tree_order_v2 (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        root_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        display_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Partial unique index for rows WITH a corpus_id
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_tree_order_v2_with_corpus
        ON saved_tree_order_v2(user_id, corpus_id, root_concept_id)
        WHERE corpus_id IS NOT NULL;
    `);

    // Partial unique index for rows WITHOUT a corpus_id (Uncategorized tab)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_tree_order_v2_uncategorized
        ON saved_tree_order_v2(user_id, root_concept_id)
        WHERE corpus_id IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_tree_order_v2_user_corpus
        ON saved_tree_order_v2(user_id, corpus_id);
    `);

    // ============================================================
    // Document Favorites table (Phase 7c Overhaul — per-corpus favoriting)
    // Users can favorite documents within a specific corpus.
    // Favorited docs float to the top of that corpus's document list.
    // Per-corpus favoriting — favoriting in one corpus does not affect
    // the document's position in other corpuses.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, corpus_id, document_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_favorites_user_corpus
        ON document_favorites(user_id, corpus_id);
    `);

    // ============================================================
    // Saved Page Tab Activity table (Phase 8)
    // Tracks when each corpus tab on the Saved Page was last
    // opened, used to determine dormancy. After 30 days of
    // inactivity, a corpus tab goes dormant and its save votes
    // are excluded from public save totals. Users can revive
    // dormant tabs to restore their vote contributions.
    // corpus_id is NULL for the "Uncategorized" tab.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_page_tab_activity (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        last_opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_dormant BOOLEAN NOT NULL DEFAULT false,
        UNIQUE(user_id, corpus_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_page_tab_activity_user
        ON saved_page_tab_activity(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_page_tab_activity_dormant
        ON saved_page_tab_activity(user_id, is_dormant);
    `);

    // Handle the NULL corpus_id (Uncategorized tab) — PostgreSQL treats NULLs
    // as distinct in UNIQUE constraints, so we need a partial unique index
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_page_tab_activity_uncategorized
        ON saved_page_tab_activity(user_id)
        WHERE corpus_id IS NULL;
    `);

    // ============================================================
    // Backfill: Create activity rows for all existing users who
    // have saves grouped into corpuses (via getUserSavesByCorpus).
    // We seed last_opened_at = NOW() so nobody is instantly dormant
    // on deploy. For corpus tabs: one row per (user, corpus) where
    // the user has annotations in that corpus. For uncategorized:
    // one row per user who has any saves at all.
    // ============================================================

    // Seed uncategorized tab activity for all users who have any saves
    await client.query(`
      INSERT INTO saved_page_tab_activity (user_id, corpus_id, last_opened_at, is_dormant)
      SELECT DISTINCT v.user_id, NULL::INTEGER, CURRENT_TIMESTAMP, false
      FROM votes v
      WHERE NOT EXISTS (
        SELECT 1 FROM saved_page_tab_activity spa
        WHERE spa.user_id = v.user_id AND spa.corpus_id IS NULL
      )
      ON CONFLICT DO NOTHING;
    `);

    // Seed corpus tab activity for all (user, corpus) pairs where
    // the user has saves on edges that have annotations in that corpus
    await client.query(`
      INSERT INTO saved_page_tab_activity (user_id, corpus_id, last_opened_at, is_dormant)
      SELECT DISTINCT v.user_id, da.corpus_id, CURRENT_TIMESTAMP, false
      FROM votes v
      JOIN document_annotations da ON da.edge_id = v.edge_id
      WHERE NOT EXISTS (
        SELECT 1 FROM saved_page_tab_activity spa
        WHERE spa.user_id = v.user_id AND spa.corpus_id = da.corpus_id
      )
      ON CONFLICT DO NOTHING;
    `);

    // ============================================================
    // Phase 12a: Nested Corpuses — parent_corpus_id column
    // Allows corpuses to be nested in a single-parent tree.
    // NULL = top-level corpus. ON DELETE SET NULL = if parent
    // is deleted, children become top-level (not deleted).
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'corpuses' AND column_name = 'parent_corpus_id'
        ) THEN
          ALTER TABLE corpuses ADD COLUMN parent_corpus_id INTEGER REFERENCES corpuses(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_corpuses_parent ON corpuses(parent_corpus_id);
    `);

    // ============================================================
    // Phase 12: Retire corpus_subscriptions.group_id
    // Corpus tabs are now positioned by the tree structure, not
    // flat tab groups. Clear any existing group_id values.
    // ============================================================
    await client.query(`
      UPDATE corpus_subscriptions SET group_id = NULL WHERE group_id IS NOT NULL;
    `);

    // ============================================================
    // Phase 12c: User Corpus Tab Placements
    // Allows users to place their graph tabs inside any corpus
    // node in the sidebar directory tree. These placements are
    // private — only visible to the placing user. A graph tab
    // can only be placed in one corpus at a time per user.
    // Placing in a corpus removes from any flat tab group.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_corpus_tab_placements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        graph_tab_id INTEGER REFERENCES graph_tabs(id) ON DELETE CASCADE,
        corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, graph_tab_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_corpus_tab_placements_user_corpus
        ON user_corpus_tab_placements(user_id, corpus_id);
    `);

    // ============================================================
    // Phase 16a: Moderation / Spam Flagging
    // ============================================================

    // concept_flags — one flag per user per edge, immediate hide on first flag
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_flags (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(50) NOT NULL DEFAULT 'spam',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_flags_edge ON concept_flags(edge_id);
    `);

    // concept_flag_votes — community votes to keep hidden or restore
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_flag_votes (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('hide', 'show')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_flag_votes_edge ON concept_flag_votes(edge_id);
    `);

    // moderation_comments — discussion on hidden concepts (no unique constraint)
    await client.query(`
      CREATE TABLE IF NOT EXISTS moderation_comments (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_moderation_comments_edge ON moderation_comments(edge_id);
    `);

    // ─── Phase 17a: Document Tags ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Phase 27e: Seed admin-controlled document tags
    await client.query(`
      INSERT INTO document_tags (name, created_by) VALUES
        ('preprint', NULL),
        ('protocol', NULL),
        ('grant application', NULL),
        ('review article', NULL),
        ('dataset', NULL),
        ('thesis', NULL),
        ('textbook', NULL),
        ('lecture notes', NULL),
        ('commentary', NULL)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Phase 28d: Delete the "PrePrint" duplicate tag (keep lowercase "preprint")
    // Cleanup runs only if document_tag_links already exists (skipped on fresh installs)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_tag_links') THEN
          DELETE FROM document_tag_links WHERE tag_id IN (SELECT id FROM document_tags WHERE name = 'PrePrint');
        END IF;
        DELETE FROM document_tags WHERE name = 'PrePrint';
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_tag_links (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES document_tags(id) ON DELETE CASCADE,
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, tag_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_tag_links_doc ON document_tag_links(document_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_tag_links_tag ON document_tag_links(tag_id);
    `);

    // Phase 28d: case-insensitive unique index to prevent future duplicate tags
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_document_tags_name_lower ON document_tags (LOWER(name));
    `);

    // Add is_hidden column to edges table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'edges' AND column_name = 'is_hidden'
        ) THEN
          ALTER TABLE edges ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);

    // ============================================================
    // Phase 19b: Unified sidebar ordering — sidebar_items table
    // A single ordered list of corpus subscriptions, tab groups,
    // and graph tabs that replaces the 3-section sidebar layout.
    // item_type: 'corpus' | 'group' | 'graph_tab'
    // item_id: corpus_id, tab_groups.id, or graph_tabs.id
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sidebar_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_type VARCHAR(20) NOT NULL,
        item_id INTEGER NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, item_type, item_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sidebar_items_user
        ON sidebar_items(user_id, display_order);
    `);

    // Backfill: corpus subscriptions (ordered by subscription date, offset 0)
    await client.query(`
      INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
      SELECT user_id, 'corpus', corpus_id,
             (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at)) * 10
      FROM corpus_subscriptions
      ON CONFLICT DO NOTHING;
    `);

    // Backfill: tab groups (offset 10000 to appear after all corpuses)
    await client.query(`
      INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
      SELECT user_id, 'group', id,
             10000 + (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY display_order, id)) * 10
      FROM tab_groups
      ON CONFLICT DO NOTHING;
    `);

    // Backfill: graph tabs (offset 20000 to appear after all groups)
    await client.query(`
      INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
      SELECT user_id, 'graph_tab', id,
             20000 + (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY display_order, id)) * 10
      FROM graph_tabs
      ON CONFLICT DO NOTHING;
    `);

    // ============================================================
    // Phase 19a: Remove parent_corpus_id column from corpuses
    // Sub-corpus infrastructure removed entirely. Existing sub-
    // corpuses become top-level corpuses (ON DELETE SET NULL
    // already null-ified children when parents were deleted;
    // here we simply drop the column). Non-destructive: all
    // corpus data (documents, subscriptions, annotations) kept.
    // ============================================================
    await client.query(`
      ALTER TABLE corpuses DROP COLUMN IF EXISTS parent_corpus_id;
    `);
    await client.query(`
      DROP INDEX IF EXISTS idx_corpuses_parent;
    `);

    // Phase 19d: Remove corpus_subscriptions.group_id — corpus tabs are always
    // top-level in the unified sidebar; group membership via this column was
    // retired in Phase 12 (values cleared) and is now fully removed.
    await client.query(`
      ALTER TABLE corpus_subscriptions DROP COLUMN IF EXISTS group_id;
    `);

    // Phase 49a: Postgres-backed rate limit counters. Survives restarts and
    // deploys (unlike express-rate-limit's default in-memory store). Used for
    // the per-phone SMS limiter and the global daily SMS cap. Keyed by an
    // arbitrary bucket string (e.g. `sms:phone:<hmac>` or `sms:global`) plus
    // the window_start timestamp, so multiple windows can coexist.
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        key TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        count INT NOT NULL DEFAULT 0,
        PRIMARY KEY (key, window_start)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rlc_window ON rate_limit_counters(window_start);
    `);

    await client.query('COMMIT');

    // Phase 20a migration REMOVED — it destructively normalized all edges
    // in each graph to the most common attribute, overwriting intentional
    // attribute assignments. Single-attribute-per-graph is now enforced at
    // write time in createChildConcept (graph_path[0] root edge lookup).
    // ─── Phase 10a: Rename 'private' layer to 'editorial' ───
    // Update document_annotations.layer from 'private' to 'editorial'
    await client.query(`
      UPDATE document_annotations SET layer = 'editorial' WHERE layer = 'private'
    `);
    // Update annotation_removal_log.annotation_layer from 'private' to 'editorial'
    await client.query(`
      UPDATE annotation_removal_log SET annotation_layer = 'editorial' WHERE annotation_layer = 'private'
    `);
    console.log('Phase 10a: Renamed private layer to editorial');

    // Phase 20b: Drop side_votes (move votes) table
    await client.query(`
      DROP TABLE IF EXISTS side_votes CASCADE;
    `);
    console.log('Phase 20b: Dropped side_votes table');

    // Phase 21a: Remove is_draft column from documents
    // First finalize any remaining drafts so no data is lost
    await client.query(`
      UPDATE documents SET is_draft = false WHERE is_draft = true
    `);
    await client.query(`
      ALTER TABLE documents DROP COLUMN IF EXISTS is_draft
    `);
    console.log('Phase 21a: Removed is_draft column from documents');

    // ─── Phase 22b-1: Migrate document_annotations to document-level ───
    // Add new columns: quote_text, comment, quote_occurrence
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'quote_text'
        ) THEN
          ALTER TABLE document_annotations ADD COLUMN quote_text TEXT;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'comment'
        ) THEN
          ALTER TABLE document_annotations ADD COLUMN comment TEXT;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'quote_occurrence'
        ) THEN
          ALTER TABLE document_annotations ADD COLUMN quote_occurrence INTEGER;
        END IF;
      END $$;
    `);

    // Migrate existing annotations: populate quote_text from document body
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'start_position'
        ) THEN
          UPDATE document_annotations da
          SET quote_text = SUBSTRING(d.body FROM da.start_position + 1 FOR da.end_position - da.start_position)
          FROM documents d
          WHERE da.document_id = d.id
            AND da.start_position IS NOT NULL
            AND da.quote_text IS NULL;
        END IF;
      END $$;
    `);

    // Set quote_occurrence = 1 for all migrated annotations
    await client.query(`
      UPDATE document_annotations SET quote_occurrence = 1 WHERE quote_occurrence IS NULL
    `);

    // Drop valid_positions CHECK constraint
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'document_annotations' AND constraint_name = 'valid_positions'
        ) THEN
          ALTER TABLE document_annotations DROP CONSTRAINT valid_positions;
        END IF;
      END $$;
    `);

    // Make start_position and end_position nullable before dropping
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'start_position'
        ) THEN
          ALTER TABLE document_annotations ALTER COLUMN start_position DROP NOT NULL;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_annotations' AND column_name = 'end_position'
        ) THEN
          ALTER TABLE document_annotations ALTER COLUMN end_position DROP NOT NULL;
        END IF;
      END $$;
    `);

    // Drop start_position and end_position columns
    await client.query(`
      ALTER TABLE document_annotations DROP COLUMN IF EXISTS start_position
    `);
    await client.query(`
      ALTER TABLE document_annotations DROP COLUMN IF EXISTS end_position
    `);

    console.log('Phase 22b-1: Migrated document_annotations to document-level (quote_text, comment, quote_occurrence)');

    // Update annotation_removal_log: add quote_text, make positions nullable
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'annotation_removal_log' AND column_name = 'quote_text'
        ) THEN
          ALTER TABLE annotation_removal_log ADD COLUMN quote_text TEXT;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'annotation_removal_log' AND column_name = 'start_position'
        ) THEN
          ALTER TABLE annotation_removal_log ALTER COLUMN start_position DROP NOT NULL;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'annotation_removal_log' AND column_name = 'end_position'
        ) THEN
          ALTER TABLE annotation_removal_log ALTER COLUMN end_position DROP NOT NULL;
        END IF;
      END $$;
    `);
    console.log('Phase 22b-1: Updated annotation_removal_log (added quote_text, made positions nullable)');

    // ============================================================
    // Phase 23a: Vote Set Drift Event Log
    // Append-only log of save/unsave events per parent context.
    // parent_edge_id: the edge whose children list was affected
    //   (NULL for root-level concepts — no parent edge)
    // child_edge_id: the specific child edge that was saved/unsaved
    // action: 'save' or 'unsave'
    // Index on (parent_edge_id, user_id, created_at) for efficient
    // reconstruction queries.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS vote_set_changes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        child_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        action VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vote_set_changes_parent_user_time
        ON vote_set_changes(parent_edge_id, user_id, created_at);
    `);

    console.log('Phase 23a: Created vote_set_changes table');

    // ============================================================
    // Phase 25a: Single Tag Per Document
    // Add tag_id column to documents, migrate earliest assigned tag
    // per document from document_tag_links, then drop the junction
    // table. Documents with no tags keep tag_id = NULL.
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'tag_id'
        ) THEN
          ALTER TABLE documents ADD COLUMN tag_id INTEGER REFERENCES document_tags(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Only run if document_tag_links still exists (idempotent)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'document_tag_links'
        ) THEN
          -- Copy earliest assigned tag per document (keep first by created_at)
          UPDATE documents d
          SET tag_id = earliest.tag_id
          FROM (
            SELECT DISTINCT ON (document_id) document_id, tag_id
            FROM document_tag_links
            ORDER BY document_id, created_at ASC
          ) AS earliest
          WHERE d.id = earliest.document_id AND d.tag_id IS NULL;

          DROP TABLE document_tag_links;
        END IF;
      END $$;
    `);

    console.log('Phase 25a: Migrated tags to documents.tag_id, dropped document_tag_links');

    // Phase 25e migration REMOVED — it destructively forced all edges to
    // the "value" attribute. This was intended for a value-only launch mode
    // that is no longer the plan. All four attributes (value, action, tool,
    // question) are now enabled via ENABLED_ATTRIBUTES env var, and edges
    // should retain whatever attribute they were created with.

    // ── Phase 26a: Co-author infrastructure tables ──

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_authors (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, user_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_authors_document_id ON document_authors(document_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_authors_user_id ON document_authors(user_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_invite_tokens (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        max_uses INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_invite_tokens_document_id ON document_invite_tokens(document_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_invite_tokens_token ON document_invite_tokens(token)
    `);

    console.log('Phase 26a: Created document_authors and document_invite_tokens tables');

    // ── Phase 27a: Retire links/fliplinks view modes from graph_tabs ──
    await client.query(`
      UPDATE graph_tabs SET view_mode = 'children'
      WHERE view_mode IN ('links', 'fliplinks')
    `);
    console.log('Phase 27a: Migrated links/fliplinks view_mode rows to children');

    // Phase 28g: Widen concept name column from VARCHAR(40) to VARCHAR(255)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concepts' AND column_name = 'name'
            AND character_maximum_length < 255
        ) THEN
          ALTER TABLE concepts ALTER COLUMN name TYPE VARCHAR(255);
        END IF;
      END $$;
    `);

    // Also widen the concept_name cache column
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'document_concept_links_cache' AND column_name = 'concept_name'
            AND character_maximum_length < 255
        ) THEN
          ALTER TABLE document_concept_links_cache ALTER COLUMN concept_name TYPE VARCHAR(255);
        END IF;
      END $$;
    `);
    console.log('Phase 28g: Concept name columns widened to VARCHAR(255)');

    // Phase 30g: Informational page comments and comment votes
    await client.query(`
      CREATE TABLE IF NOT EXISTS page_comments (
        id SERIAL PRIMARY KEY,
        page_slug VARCHAR(50) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_page_comments_page ON page_comments(page_slug);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS page_comment_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, comment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_page_comment_votes_comment ON page_comment_votes(comment_id);
    `);
    console.log('Phase 30g: page_comments and page_comment_votes tables created');

    // Phase 30g-2: Add parent_comment_id for 1-level nested replies
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'page_comments' AND column_name = 'parent_comment_id'
        ) THEN
          ALTER TABLE page_comments ADD COLUMN parent_comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE;
          CREATE INDEX idx_page_comments_parent ON page_comments(parent_comment_id);
        END IF;
      END $$;
    `);
    console.log('Phase 30g-2: page_comments parent_comment_id column added');

    // ── Phase 31a: Annotation Messaging tables ──

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_threads (
        id SERIAL PRIMARY KEY,
        annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
        external_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        thread_type VARCHAR(20) NOT NULL CHECK (thread_type IN ('to_authors', 'to_annotator')),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(annotation_id, external_user_id, thread_type)
      );
      CREATE INDEX IF NOT EXISTS idx_message_threads_annotation ON message_threads(annotation_id);
      CREATE INDEX IF NOT EXISTS idx_message_threads_external_user ON message_threads(external_user_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES message_threads(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS message_read_status (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES message_threads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(thread_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_message_read_status_user ON message_read_status(user_id);
    `);

    console.log('Phase 31a: Created message_threads, messages, and message_read_status tables');

    // ── Phase 32a: Phone OTP Authentication — add phone_hash to users ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(255);
    `);
    console.log('Phase 32a: Added phone_hash column to users table');

    // ── Phase 32b: Make email/password_hash nullable, add token_issued_after ──
    await client.query(`
      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    `);
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_issued_after TIMESTAMP;
    `);
    console.log('Phase 32b: email/password_hash now nullable, added token_issued_after column');

    // ── Phase 32d: Assign phone hashes to existing test users ──
    const testUsers = [
      { username: 'alice', phone: '+15005550001' },
      { username: 'bob', phone: '+15005550002' },
      { username: 'carol', phone: '+15005550003' },
      { username: 'dave', phone: '+15005550004' },
      { username: 'eve', phone: '+15005550005' },
      { username: 'frank', phone: '+15005550006' },
    ];
    for (const { username, phone } of testUsers) {
      try {
        const exists = await client.query(
          'SELECT id FROM users WHERE username = $1 AND phone_hash IS NULL',
          [username]
        );
        if (exists.rows.length > 0) {
          const phoneHash = await bcrypt.hash(phone, 10);
          await client.query(
            'UPDATE users SET phone_hash = $1 WHERE username = $2',
            [phoneHash, username]
          );
          console.log(`  Assigned phone hash to ${username}`);
        }
      } catch (err) {
        console.error(`  Failed to assign phone hash to ${username}:`, err.message);
      }
    }
    console.log('Phase 32d: Test user phone hash migration complete');

    // Phase 33d: Add missing FK constraint on document_concept_links_cache.concept_id
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'document_concept_links_cache'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name = 'fk_doc_concept_links_cache_concept'
        ) THEN
          ALTER TABLE document_concept_links_cache
            ADD CONSTRAINT fk_doc_concept_links_cache_concept
            FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    console.log('Phase 33d: FK constraint on document_concept_links_cache.concept_id ensured');

    // ── Phase 33e: O(1) phone lookup via HMAC-SHA256 ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_lookup VARCHAR(64);
    `);
    // Add UNIQUE constraint if not already present
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'users'
            AND constraint_type = 'UNIQUE'
            AND constraint_name = 'users_phone_lookup_key'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_phone_lookup_key UNIQUE (phone_lookup);
        END IF;
      END $$;
    `);
    // Backfill phone_lookup for the 6 test users (we know their plain phone numbers)
    if (process.env.PHONE_LOOKUP_KEY) {
      const testPhones = [
        { username: 'alice', phone: '+15005550001' },
        { username: 'bob', phone: '+15005550002' },
        { username: 'carol', phone: '+15005550003' },
        { username: 'dave', phone: '+15005550004' },
        { username: 'eve', phone: '+15005550005' },
        { username: 'frank', phone: '+15005550006' },
      ];
      for (const { username, phone } of testPhones) {
        try {
          const lookup = crypto.createHmac('sha256', process.env.PHONE_LOOKUP_KEY)
            .update(phone).digest('hex');
          const updated = await client.query(
            'UPDATE users SET phone_lookup = $1 WHERE username = $2 AND phone_lookup IS NULL',
            [lookup, username]
          );
          if (updated.rowCount > 0) {
            console.log(`  Assigned phone_lookup to ${username}`);
          }
        } catch (err) {
          console.error(`  Failed to assign phone_lookup to ${username}:`, err.message);
        }
      }
    }
    console.log('Phase 33e: phone_lookup column + UNIQUE constraint + test user backfill complete');

    // ============================================================
    // Phase 35c: Fix Foreign Key Constraints for Account Deletion
    // Change all user-provenance FKs (community contributions) from
    // RESTRICT (default) to ON DELETE SET NULL. This allows
    // DELETE FROM users WHERE id = X to succeed, preserving
    // contributions with NULL attribution.
    // ============================================================
    try {
      const fksToFix = [
        { table: 'concepts',             column: 'created_by', constraint: 'concepts_created_by_fkey' },
        { table: 'attributes',           column: 'created_by', constraint: 'attributes_created_by_fkey' },
        { table: 'edges',                column: 'created_by', constraint: 'edges_created_by_fkey' },
        { table: 'concept_links',        column: 'added_by',   constraint: 'concept_links_added_by_fkey' },
        { table: 'corpuses',             column: 'created_by', constraint: 'corpuses_created_by_fkey' },
        { table: 'documents',            column: 'uploaded_by', constraint: 'documents_uploaded_by_fkey' },
        { table: 'corpus_documents',     column: 'added_by',   constraint: 'corpus_documents_added_by_fkey' },
        { table: 'document_annotations', column: 'created_by', constraint: 'document_annotations_created_by_fkey' },
        { table: 'corpus_invite_tokens', column: 'created_by', constraint: 'corpus_invite_tokens_created_by_fkey' },
        { table: 'document_invite_tokens', column: 'created_by', constraint: 'document_invite_tokens_created_by_fkey' },
        { table: 'document_tags',        column: 'created_by', constraint: 'document_tags_created_by_fkey' },
        { table: 'message_threads',      column: 'created_by', constraint: 'message_threads_created_by_fkey' },
      ];

      for (const { table, column, constraint } of fksToFix) {
        await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
        await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE SET NULL`);
      }
      console.log('Phase 35c: Fixed 12 foreign key constraints to ON DELETE SET NULL');
    } catch (phase35cErr) {
      console.error('Phase 35c: FK migration error:', phase35cErr.message);
    }

    // ============================================================
    // Phase 36a: Legal Compliance — Age Verification & Copyright
    // Add age_verified_at to users, copyright_confirmed_at to
    // documents, backfill test users with emails + age verification.
    // ============================================================

    // Add age_verified_at column to users
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'age_verified_at'
        ) THEN
          ALTER TABLE users ADD COLUMN age_verified_at TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add copyright_confirmed_at column to documents
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'copyright_confirmed_at'
        ) THEN
          ALTER TABLE documents ADD COLUMN copyright_confirmed_at TIMESTAMP;
        END IF;
      END $$;
    `);

    // Backfill test users with fake emails (only where email IS NULL)
    const testEmails = [
      { username: 'alice', email: 'alice@test.com' },
      { username: 'bob', email: 'bob@test.com' },
      { username: 'carol', email: 'carol@test.com' },
      { username: 'dave', email: 'dave@test.com' },
      { username: 'eve', email: 'eve@test.com' },
      { username: 'frank', email: 'frank@test.com' },
    ];
    for (const { username, email } of testEmails) {
      await client.query(
        'UPDATE users SET email = $1 WHERE username = $2 AND email IS NULL',
        [email, username]
      );
    }

    // Set age_verified_at for all test users where it's NULL
    await client.query(`
      UPDATE users SET age_verified_at = NOW()
      WHERE username IN ('alice', 'bob', 'carol', 'dave', 'eve', 'frank')
        AND age_verified_at IS NULL
    `);

    console.log('Phase 36a: Added age_verified_at, copyright_confirmed_at, backfilled test users');

    // ── Phase 38j: Citation Links ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_citation_links (
        id SERIAL PRIMARY KEY,
        citing_document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        cited_annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE SET NULL,
        citation_url TEXT NOT NULL,
        snapshot_concept_name VARCHAR(255),
        snapshot_quote_text TEXT,
        snapshot_document_title VARCHAR(500),
        snapshot_corpus_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_citation_links_citing_doc ON document_citation_links(citing_document_id);
      CREATE INDEX IF NOT EXISTS idx_citation_links_cited_annotation ON document_citation_links(cited_annotation_id);
    `);
    console.log('Phase 38j: Created document_citation_links table');

    // ── Phase 39a: Combo Infrastructure ──
    // Combos are user-created collections of edges (concepts-in-context)
    // from across the graph system. A combo groups related concepts and
    // shows all annotations attached to those edges.

    await client.query(`
      CREATE TABLE IF NOT EXISTS combos (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_combos_name_lower ON combos (LOWER(name));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combos_created_by ON combos(created_by);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS combo_edges (
        id SERIAL PRIMARY KEY,
        combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(combo_id, edge_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_edges_combo ON combo_edges(combo_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_edges_edge ON combo_edges(edge_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS combo_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, combo_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_subscriptions_user ON combo_subscriptions(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_subscriptions_combo ON combo_subscriptions(combo_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS combo_annotation_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
        annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, combo_id, annotation_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_annotation_votes_combo_annotation
        ON combo_annotation_votes(combo_id, annotation_id);
    `);

    // Phase 39e: Add group_id to combo_subscriptions for tab group support
    await client.query(`
      ALTER TABLE combo_subscriptions ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
    `);

    // Phase 39e: Change combos.created_by to ON DELETE SET NULL for existing databases
    // (The CREATE TABLE above handles fresh databases; this ALTER handles existing ones)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'combos' AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = (
            SELECT constraint_name FROM information_schema.key_column_usage
            WHERE table_name = 'combos' AND column_name = 'created_by'
          )
        ) THEN
          ALTER TABLE combos DROP CONSTRAINT IF EXISTS combos_created_by_fkey;
          ALTER TABLE combos ADD CONSTRAINT combos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    console.log('Phase 39a: Created combos, combo_edges, combo_subscriptions, combo_annotation_votes tables');

    // Phase 40b: Set password_hash for test users (alice-frank) to known test password
    const testPasswordHash = await bcrypt.hash('testpass123!', 10);
    const testUpdateResult = await client.query(`
      UPDATE users
      SET password_hash = $1
      WHERE username IN ('alice', 'bob', 'carol', 'dave', 'eve', 'frank')
    `, [testPasswordHash]);
    console.log('Phase 40b: Set test user passwords (' + testUpdateResult.rowCount + ' rows updated)');

    // ============================================================
    // Phase 41c: Document External Links (multi-link table)
    // Links stored against the root document in the version chain,
    // so all versions share one set of links (same pattern as
    // document_authors).
    // ============================================================

    // Drop the single-column approach if it was previously applied
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'external_url'
        ) THEN
          ALTER TABLE documents DROP COLUMN external_url;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_external_links (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_external_links_doc
        ON document_external_links(document_id)
    `);
    console.log('Phase 41c: Created document_external_links table');

    // ============================================================
    // Phase 41a: ORCID Integration — add orcid_id column to users
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'orcid_id'
        ) THEN
          ALTER TABLE users ADD COLUMN orcid_id VARCHAR(19);
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_orcid
        ON users(orcid_id) WHERE orcid_id IS NOT NULL
    `);
    console.log('Phase 41a: Added orcid_id column to users table');

    // ============================================================
    // Phase 43a: Tunnel Links table
    // Bidirectional tunnel connections between edges across different
    // graphs and attributes. Each row represents one direction.
    // Creating a tunnel inserts two rows (A→B and B→A).
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS tunnel_links (
        id SERIAL PRIMARY KEY,
        origin_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        linked_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(origin_edge_id, linked_edge_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_links_origin ON tunnel_links(origin_edge_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_links_linked ON tunnel_links(linked_edge_id)
    `);

    // ============================================================
    // Phase 43a: Tunnel Votes table
    // Endorsement votes on tunnel links. Votes are directional —
    // voting for B in A's tunnel view does NOT affect A's vote
    // count in B's tunnel view.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS tunnel_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tunnel_link_id INTEGER REFERENCES tunnel_links(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, tunnel_link_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_votes_link ON tunnel_votes(tunnel_link_id)
    `);
    console.log('Phase 43a: Created tunnel_links and tunnel_votes tables');

    // ============================================================
    // Phase 44: Cleanup cross-context swap votes
    // Per Architecture Decision #256, swap votes must be between
    // sibling edges. Delete any pre-existing rows that violate this.
    // ============================================================
    const crossContextSwaps = await client.query(`
      DELETE FROM replace_votes rv
      USING edges src, edges rep
      WHERE rv.edge_id = src.id
        AND rv.replacement_edge_id = rep.id
        AND (
          src.parent_id IS DISTINCT FROM rep.parent_id
          OR src.graph_path IS DISTINCT FROM rep.graph_path
          OR (src.parent_id IS NULL AND rep.parent_id IS NULL AND src.attribute_id != rep.attribute_id)
        )
    `);
    if (crossContextSwaps.rowCount > 0) {
      console.log(`Phase 44: Deleted ${crossContextSwaps.rowCount} cross-context swap votes`);
    } else {
      console.log('Phase 44: No cross-context swap votes to clean up');
    }

    // ── Phase 45: Annotation warning dismissal ──
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'hide_annotation_warning'
        ) THEN
          ALTER TABLE users ADD COLUMN hide_annotation_warning BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);
    console.log('Phase 45: Added hide_annotation_warning column to users table');

    console.log('Database tables created/migrated successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
createTables()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
