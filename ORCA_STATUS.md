
# ORCA - Project Status & Technical Reference

**Last Updated:** March 29, 2026 (Post-Phase 36 — Phase 37/38 bug & enhancement plan added; pre-launch QA & legal prep; codebase published under AGPL v3)

---

## Project Overview

Orca is a collaborative action ontology platform where users create and navigate hierarchical graphs of concepts with context-dependent children, community voting, and concept attributes. The initial use case is **research material** — users organize academic and scientific concepts (e.g., "Microscopy [tool]", "Cell Culture [action]", "Reproducibility [value]", "Western Blot [tool]", "Hypothesis Generation [action]", "How does institutional review board process design influence reproducibility? [question]"), annotate research documents (preprints, grant applications, outlines), and build shared ontologies for their fields. Example concepts throughout this document should reflect realistic research/academic scenarios.

**License:** AGPL v3 (GNU Affero General Public License v3.0)

**Repository:** [github.com/orca-concepts/orca](https://github.com/orca-concepts/orca) (public)

**Local working directory:** `\Users\17wil\orca\orca-public` — this is the active development folder. The private repo (`orca-private`) is retained for history but all new work happens in the public repo.

---

## Tech Stack

### Backend
- **Runtime:** Node.js (v24.13.0)
- **Framework:** Express.js
- **Database:** PostgreSQL (v16+) with pg_trgm extension (trigram fuzzy search)
- **Authentication:** JWT (jsonwebtoken)
- **Phone Hashing:** bcryptjs for phone number hashing (Note: Using bcryptjs instead of bcrypt due to ARM64 Windows compatibility)
- **Phone Lookup:** HMAC-SHA256 deterministic hash for O(1) phone lookups (Phase 33e)
- **Phone OTP:** Twilio Verify API (Phase 32)
- **Rate Limiting:** express-rate-limit (Phase 32)
- **Environment:** dotenv for configuration

### Frontend
- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** React Router v6
- **HTTP Client:** Axios
- **Styling:** Inline styles (CSS-in-JS)

### Development
- **Backend Dev Server:** nodemon (auto-restart on changes)
- **Frontend Dev Server:** Vite dev server (hot module replacement)
- **Package Manager:** npm

---

## Database Schema

### Current Tables

#### `users`
Stores user account information.

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255),
  password_hash VARCHAR(255),
  phone_hash VARCHAR(255),
  phone_lookup VARCHAR(64) UNIQUE,
  token_issued_after TIMESTAMP,
  age_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Points:**
- Phone numbers hashed with bcryptjs (10 salt rounds) for OTP authentication (Phase 32). Passwords are no longer used.
- Username must be unique
- No concept of "ownership" - all graphs are public/collaborative
- `email` — **Re-activated in Phase 36.** Required for new registrations (enforced at application level, not DB constraint — column remains nullable for backward compatibility with existing rows). Collected at sign-up for legal notifications: copyright violation notices and ToS/privacy policy updates. Previously retired in Phase 32d; now written by `verifyRegister` endpoint. Test users backfilled with fake emails (Phase 36 migration).
- `password_hash` — nullable as of Phase 32b, functionally retired as of Phase 32d. Column retained (append-only philosophy) but no longer read or written by auth code.
- `phone_hash` — bcrypt-hashed phone number for Phone OTP auth (Phase 32a). Nullable. All six test users (alice–frank) assigned fake phone hashes via Phase 32d migration. Retained for backward compatibility but no longer used for lookup (Phase 33e).
- `phone_lookup` — HMAC-SHA256 of normalized phone number, keyed by `PHONE_LOOKUP_KEY` env var (Phase 33e). Deterministic — enables O(1) database lookup via UNIQUE index. Replaces the O(n) bcrypt scan previously used for login and registration uniqueness checks.
- `token_issued_after` — timestamp used by "Log out everywhere" (Phase 32b). When set, auth middleware rejects any JWT with `iat <= token_issued_after`. Nullable — null means no sessions have been invalidated.
- `age_verified_at` — timestamp recording when the user confirmed they are at least 18 years old during registration (Phase 36). Set once at account creation, never cleared. Nullable — null for users who registered before Phase 36 (test users backfilled with `NOW()` in migration).
- **Note:** `last_active` column was originally planned for inactive user filtering. The inactive feature was redesigned to operate at the **corpus tab level on the Saved Page** instead — see Phase 8 (Inactive Corpus Tab Dormancy, now complete). No `last_active` column is needed on the users table.

---

#### `concepts`
Stores individual concepts (nodes in the graph).

```sql
CREATE TABLE concepts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,  -- Widened from VARCHAR(40) in Phase 28g
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Points:**
- **Character limit:** Concept names are capped at 255 characters (raised from 40 in Phase 28g). Enforced at both frontend (input validation) and backend (database column + application-level check).
- Concept names are globally unique strings (enforced at application level)
- `created_by` is for provenance/moderation, not ownership
- Same concept can appear in multiple graphs with different children
- **Identity clarification:** A concept row is just a name+ID. The *contextual identity* of a concept is determined by its path + attribute. "Cardio [action]" under `Health → Fitness` is a completely different contextual entity than "Cardio [action]" under `Sports → Team Sports` — different vote counts, different children, different attributes. The concept table stores the shared name; the edges table stores the contextual identity.

---

#### `edges`
Represents parent-child relationships in specific graph contexts.

```sql
CREATE TABLE edges (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
  graph_path INTEGER[] NOT NULL,
  attribute_id INTEGER NOT NULL REFERENCES attributes(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(parent_id, child_id, graph_path, attribute_id)
);

CREATE INDEX idx_edges_parent ON edges(parent_id);
CREATE INDEX idx_edges_child ON edges(child_id);
CREATE INDEX idx_edges_attribute ON edges(attribute_id);
```

**Key Points:**
- `graph_path` is an array of concept IDs representing the path from root to parent
- Root concepts have edges with `parent_id = NULL` and `graph_path = '{}'` (empty array) so that votes can attach to them via the unified edge model
- The same child can exist under the same parent in different graph contexts
- `UNIQUE` constraint prevents duplicate edges in the same context (note: PostgreSQL treats NULLs as distinct in unique constraints, so root edge uniqueness is enforced at the application level)
- `attribute_id` is NOT NULL — every edge must have an attribute
- Unique constraint includes `attribute_id`: same concept with different attributes in the same context = separate edges
- **Important:** When querying children, the path includes the current concept at the end
- **Important:** When querying root concepts, the WHERE clause must filter `WHERE parent_id IS NOT NULL` in the subquery to avoid excluding roots that have root edges

**Example:**
```
Graph: Root(1) → Health(2) → Exercise(3) → Cardio(4)

Edge for "Cardio under Exercise in this context":
  parent_id: 3
  child_id: 4
  graph_path: [1, 2, 3]  ← Path from root to parent
```

---

#### `votes`
User save votes on edges (parent-child relationships).

```sql
CREATE TABLE votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, edge_id)
);
```

**Key Points:**
- One save per user per edge
- Saves are context-specific (tied to edges, not concepts)
- Save removal is implemented with cascading unsave (removing a save also removes saves on all descendant edges in that branch)
- Children are sorted by save count (descending) by default; "Sort by New" option sorts by edge `created_at` descending

---

#### `attributes` — ✅ IMPLEMENTED (Phase 3)
Stores reusable attribute tags that can be applied to concepts in context.

```sql
CREATE TABLE attributes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Points:**
- Attributes are discrete, reusable entities (not free text or key-value pairs)
- Attributes are category labels (like "action", "tool", "value", "question") — NOT metadata fields with values (NOT `difficulty=hard`)
- Four default attributes seeded: **action**, **tool**, **value**, **question**
- **Attributes are required:** Every concept must have an attribute selected at creation time. There are no "unattributed" concepts.
- **Selection model (Phase 20a):** Users select an attribute only when creating a **root concept**. All descendant edges in the graph inherit the root edge's attribute automatically. No free-text attribute creation.
- **No user-created attributes for now.** The four released attributes are the only options. All four are enabled at launch via `ENABLED_ATTRIBUTES=value,action,tool,question`. The owner (Miles) will manually add new attributes as needed by inserting rows into the `attributes` table and updating the `ENABLED_ATTRIBUTES` environment variable. The original Phase 23 (user-generated attributes) has been cancelled.
- **Immutability:** Once an attribute is assigned to an edge at creation time, it cannot be changed. The attribute becomes part of the contextual identity of that concept in that path.
- **Single-attribute graphs (Phase 20a):** Every graph has exactly one attribute, determined by the root edge. All descendant edges must match. Consistency enforced on write — backend looks up `graph_path[0]` to find the root edge's attribute and auto-assigns it.
- Same concept name with different attributes = completely separate contextual entities. "Running [action]" and "Running [tool]" share a string but are unrelated.
- **Display format (Phase 20a):** Attributes are NO LONGER shown in square brackets after every concept name. Instead, attribute badges appear in specific locations: concept page header (near breadcrumb), root page cards, Flip View cards (one per card), and annotation cards. Bracket tags were removed from child lists, search results, breadcrumbs, Saved page, diff modal, and all other locations.

#### `similarity_votes` — ✅ IMPLEMENTED (Phase 4) — "Links"
Flip View votes asserting that a parent context is similar/helpful relative to the user's origin context.

```sql
CREATE TABLE similarity_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  origin_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  similar_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, origin_edge_id, similar_edge_id)
);

CREATE INDEX idx_similarity_votes_origin ON similarity_votes(origin_edge_id);
CREATE INDEX idx_similarity_votes_similar ON similarity_votes(similar_edge_id);
```

**Key Points:**
- Only available in contextual Flip View (entered from a specific path), not in decontextualized Flip View (from search)
- Different origin contexts have independent sets of link votes
- Helps users coming from a specific context quickly find the most relevant alternate parent paths
- `origin_edge_id` = the edge connecting the concept to the parent the user navigated from
- `similar_edge_id` = the alt parent edge the user is voting as helpful/linked
- Indexes on both `origin_edge_id` and `similar_edge_id` for fast lookups

#### `side_votes` — ❌ REMOVED (Phase 20b) — formerly "Moves"
**Dropped in Phase 20b.** Move votes were redundant with Flip View link votes. The `side_votes` table has been dropped. See Architecture Decision #152.

#### `replace_votes` — ✅ IMPLEMENTED (Phase 4) — "Swaps"
User assertions that a concept should be replaced by a sibling in the same context.

```sql
CREATE TABLE replace_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  replacement_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, edge_id, replacement_edge_id)
);

CREATE INDEX idx_replace_votes_edge ON replace_votes(edge_id);
CREATE INDEX idx_replace_votes_replacement ON replace_votes(replacement_edge_id);
```

**Key Points:**
- Replacement must be a sibling (another child edge in the same parent context — same `parent_id` and `graph_path`)
- Backend validates sibling relationship before accepting a swap vote
- Multiple users can point to different replacements
- Visible to all users; purely informational — no automatic removal (append-only model)
- `edge_id` = the edge being flagged as replaceable
- `replacement_edge_id` = the sibling edge that should replace it
- Indexes on both `edge_id` and `replacement_edge_id` for fast lookups
- Swap count (distinct users) returned as `swap_count` in children queries
- **Mutual exclusivity (Phase 20c):** Save and swap are mutually exclusive per user per edge. Saving removes any existing swap; swapping removes any existing save (with cascading unsave to descendants).

---

#### `saved_tabs` — ✅ IMPLEMENTED (Phase 5b) — ⚠️ WILL BE RETIRED (Phase 7c)
Stores named Saved Page tabs per user. **Note:** This table and the `vote_tab_links` junction table will be retired when Phase 7c (Saved Page Overhaul) is built. Saved tabs will be replaced by dynamically generated corpus-based tabs on a standalone Saved Page. See Phase 7c for the new design.

```sql
CREATE TABLE saved_tabs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Saved',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_saved_tabs_user ON saved_tabs(user_id);
```

**Key Points:**
- Each user gets a default tab named "Saved" auto-created at registration time (can be renamed later)
- Users can create additional named tabs for organizing saves
- When saving a concept (clicking ▲), user selects which tab to save to via inline dropdown
- If only one tab exists, saves go to it automatically (no picker shown)
- `display_order` controls tab ordering in the UI
- Users cannot delete their last tab (at least one must exist)
- Deleting a tab removes its vote-tab links; votes that lose their last link are also deleted
- `group_id` is nullable — links to a `tab_groups` row if this tab is in a group, or NULL if ungrouped (Phase 5d)
- Migration backfills a default "Saved" tab for all existing users

#### `vote_tab_links` — ✅ IMPLEMENTED (Phase 5b) — ⚠️ WILL BE RETIRED (Phase 7c)
Junction table linking votes to Saved tabs. A vote can appear in multiple tabs. **Note:** This table will be retired when Phase 7c (Saved Page Overhaul) is built. Save organization will be determined dynamically by corpus annotation membership instead of explicit tab links.

```sql
CREATE TABLE vote_tab_links (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER REFERENCES votes(id) ON DELETE CASCADE,
  saved_tab_id INTEGER REFERENCES saved_tabs(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vote_id, saved_tab_id)
);

CREATE INDEX idx_vote_tab_links_vote ON vote_tab_links(vote_id);
CREATE INDEX idx_vote_tab_links_tab ON vote_tab_links(saved_tab_id);
```

**Key Points:**
- A vote (user endorsement of an edge) stays unique per `(user_id, edge_id)` in the `votes` table
- The junction table says which tabs that vote appears in — purely organizational
- Same vote can be linked to multiple tabs (user saves the same concept to different tabs)
- Removing a save from a specific tab deletes the link; if no links remain, the vote itself is deleted
- ON DELETE CASCADE from both `votes` and `saved_tabs` ensures automatic cleanup
- Save counts visible to other users (`COUNT(DISTINCT user_id)` on edges) are unaffected by tabs
- Migration backfills all existing votes into each user's default tab

---

#### `graph_tabs` — ✅ IMPLEMENTED (Phase 5c-1)
Persistent in-app navigation tabs for exploring the concept graph. Each graph tab tracks where the user is (concept + path + view mode).

```sql
CREATE TABLE graph_tabs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tab_type VARCHAR(20) NOT NULL DEFAULT 'root',
  concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
  path INTEGER[] NOT NULL DEFAULT '{}',
  view_mode VARCHAR(20) NOT NULL DEFAULT 'children',
  display_order INTEGER NOT NULL DEFAULT 0,
  label VARCHAR(255) NOT NULL DEFAULT 'Root',
  group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_graph_tabs_user ON graph_tabs(user_id);
```

**Key Points:**
- `tab_type` is `'root'` (at root page, concept_id is null) or `'concept'` (viewing a specific concept)
- `concept_id` uses `ON DELETE SET NULL` — if a concept is removed, the tab gracefully degrades rather than being deleted
- `path` stores the graph path as an integer array (same format as edges.graph_path)
- `view_mode` is `'children'` or `'flip'` — persists the user's current view state. (Note: `'links'` and `'fliplinks'` were retired in Phase 27a — migration updates stale rows to `'children'`)
- `label` stores the display name shown in the tab bar (updated dynamically as user navigates)
- `updated_at` tracks the last navigation action (useful for ordering/recency)
- `group_id` is nullable — links to a `tab_groups` row if this tab is in a group, or NULL if ungrouped (Phase 5d)
- Graph tabs are fully persistent across sessions — survive refresh and logout/login
- No limit on number of graph tabs per user
- Graph tabs live alongside Saved tabs in a unified tab bar (AppShell) — Note: after Phase 7c, saved tabs will be replaced by corpus tabs in the main tab bar; graph tabs will then live alongside corpus tabs

---

#### `tab_groups` — ✅ IMPLEMENTED (Phase 5d)
Named tab groups that can contain any combination of graph tabs (and corpus tabs after Phase 7c). Flat grouping only — no groups within groups. (Currently also supports saved tabs via `saved_tabs.group_id`, but saved tabs will leave the main tab bar in Phase 7c.)

```sql
CREATE TABLE tab_groups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Group',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_expanded BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tab_groups_user ON tab_groups(user_id);
```

**Key Points:**
- Each group belongs to a single user
- `is_expanded` persists the expand/collapse state of the group in the tab bar
- Groups appear in the tab bar between corpus tabs and graph tabs (currently between saved tabs and graph tabs until Phase 7c)
- Deleting a group ungroups its member tabs (sets `group_id = NULL`) — does NOT delete the tabs
- `saved_tabs.group_id` and `graph_tabs.group_id` are nullable FK references to `tab_groups(id)` with `ON DELETE SET NULL` (Note: `saved_tabs.group_id` will be retired when Phase 7c Saved Page Overhaul is built — saved tabs will leave the main tab bar; corpus tabs will get their own `group_id` FK)
- Mixed tab types allowed within a single group (currently saved + graph tabs; will become corpus + graph tabs after Phase 7c)
- Flat grouping only — groups cannot contain other groups

---

#### `saved_tree_order` — ✅ IMPLEMENTED (Phase 5e) — ⚠️ LEGACY (replaced by `saved_tree_order_v2`)
Stores user-configured display order of root-level graph trees on each Saved Page tab. **Note:** This table is keyed on `saved_tab_id` which belongs to the retired manual saved tabs system. The Phase 7c Saved Page Overhaul replaced this with `saved_tree_order_v2` keyed on `corpus_id`. This table remains in the database but is no longer actively used.

```sql
CREATE TABLE saved_tree_order (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  saved_tab_id INTEGER REFERENCES saved_tabs(id) ON DELETE CASCADE,
  root_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, saved_tab_id, root_concept_id)
);

CREATE INDEX idx_saved_tree_order_user_tab ON saved_tree_order(user_id, saved_tab_id);
```

---

#### `saved_tree_order_v2` — ✅ IMPLEMENTED (Phase 7c Saved Page Overhaul)
Stores user-configured display order of root-level graph trees on each corpus-based Saved Page tab. Replaces `saved_tree_order` which was keyed on `saved_tab_id`.

```sql
CREATE TABLE saved_tree_order_v2 (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  root_concept_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique index for rows WITH a corpus_id
CREATE UNIQUE INDEX idx_saved_tree_order_v2_with_corpus
  ON saved_tree_order_v2(user_id, corpus_id, root_concept_id)
  WHERE corpus_id IS NOT NULL;

-- Partial unique index for rows WITHOUT a corpus_id (Uncategorized tab)
CREATE UNIQUE INDEX idx_saved_tree_order_v2_uncategorized
  ON saved_tree_order_v2(user_id, root_concept_id)
  WHERE corpus_id IS NULL;

CREATE INDEX idx_saved_tree_order_v2_user_corpus
  ON saved_tree_order_v2(user_id, corpus_id);
```

**Key Points:**
- `corpus_id` is NULL for the Uncategorized tab, or references a corpus for corpus-based tabs
- Uses PostgreSQL partial unique indexes to handle the NULL vs non-NULL corpus_id cases separately
- Trees without an explicit order record fall to the bottom, sorted by save count as before
- Reordering is via up/down arrow buttons on each root tree card (same UI as before)
- Order persists between sessions
- Each corpus tab (and the uncategorized tab) has its own independent ordering

---

#### `child_rankings` — ✅ IMPLEMENTED (Phase 5f) — 💤 DORMANT (Phase 28b)
Stores per-user numeric rankings of children when filtering to a single identical vote set. **Retired in Phase 28b** — the ranking UI (dropdown, aggregated rank badges) is removed from the frontend. Table remains in database (append-only philosophy).

```sql
CREATE TABLE child_rankings (
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

CREATE INDEX idx_child_rankings_parent_set ON child_rankings(parent_edge_id, vote_set_key);
```

**Key Points:**
- `parent_edge_id` identifies the parent context where the children are being ranked (the edge connecting the current concept to its parent)
- `child_edge_id` is the specific child being ranked
- `vote_set_key` is a deterministic string identifying the identical vote set (sorted comma-separated edge IDs). This ties rankings to a specific vote set composition — if set membership changes, it's a new key and old rankings don't apply
- `rank_position` is the user-assigned number (1, 2, 3…)
- Rankings are only visible when filtering to a **single** identical vote set (not multi-select, not super-groups)
- Only the user's own vote set can be ranked (backend validates user has a vote on the parent edge); other sets show aggregated rankings read-only
- Aggregated display: for each child, show the count of users who assigned each rank number; sort children by the most popular rank (rank with the highest count wins; ties broken by overall save count)
- Unranked children (no `child_rankings` row for a user) appear at the bottom of the filtered view
- If a user unsaves a child (leaves the vote set), their `child_rankings` rows for that child are cleaned up automatically
- Single-user vote sets: the aggregated view just shows the user's own ordering

---

#### `concept_links` — ✅ IMPLEMENTED (Phase 6, updated Phase 29a)
External URLs attached to concepts in specific contexts (tied to edges).

```sql
CREATE TABLE concept_links (
  id SERIAL PRIMARY KEY,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title VARCHAR(255),
  comment TEXT,                                    -- Phase 29a: optional creator comment
  added_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP   -- Phase 29a: tracks comment edit time
);

CREATE INDEX idx_concept_links_edge ON concept_links(edge_id);
```

**Key Points:**
- Web links are context-specific (tied to an edge, not a concept globally)
- Same concept can have different web links in different parent contexts
- URL validated to start with `http://` or `https://`, max 2048 characters
- Duplicate URLs on the same edge are rejected (409 Conflict)
- Only the user who added a link can remove it
- Auto-upvoted by the user who adds the link
- Web links appear on the Annotations & Links panel (right column of concept page, Phase 27a)
- Cross-context compilation available via the Web Links tab in the ConceptAnnotationPanel
- **Creator comments (Phase 29a):** Optional `comment` field stored on the link. Only the creator (`added_by`) can edit their comment via `PUT /web-links/:linkId/comment`. The `updated_at` column tracks when the comment was last modified; "(edited)" indicator shows in the UI when `updated_at` differs from `created_at`. First-time comment additions do NOT update `updated_at` — only subsequent edits do, so "(edited)" only appears for genuine modifications.
- **Inline add form (Phase 29a):** "+ Add Web Link" button in the Web Links tab opens an inline form with URL, optional title, and optional comment fields
- **Clickable vote toggle (Phase 29a):** The vote count on each web link is clickable to toggle the user's vote; links re-sort by vote count after each toggle

#### `concept_link_votes` — ✅ IMPLEMENTED (Phase 6)
Simple upvote system for web links attached to concepts.

```sql
CREATE TABLE concept_link_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  concept_link_id INTEGER REFERENCES concept_links(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, concept_link_id)
);

CREATE INDEX idx_concept_link_votes_link ON concept_link_votes(concept_link_id);
```

**Key Points:**
- One upvote per user per web link (simple endorsement, not the four-type vote system used for edges)
- `UNIQUE(user_id, concept_link_id)` prevents double-voting
- ON DELETE CASCADE from both `users` and `concept_links` ensures cleanup
- Vote count computed as `COUNT(*)` on `concept_link_votes` for each link

---

#### `corpuses` — ✅ IMPLEMENTED (Phase 7a)
Named collections of documents. Annotations, permissions, and subscriptions all operate at the corpus level.

```sql
CREATE TABLE corpuses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  annotation_mode VARCHAR(20) NOT NULL DEFAULT 'public',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_corpuses_created_by ON corpuses(created_by);
```

**Key Points:**
- `annotation_mode` is currently `'public'` or `'private'` — **this column will be retired in Phase 7g** when the combined public/private model replaces the binary toggle. All corpuses will have both layers.
- `parent_corpus_id` was removed in Phase 19a — sub-corpus infrastructure removed entirely. All corpuses are now top-level.
- `description` is optional free-text explaining the corpus's purpose
- Only the owner (`created_by`) can update, delete, add/remove documents
- **Unique name:** Corpus names are unique (case-insensitive). Creating or renaming a corpus to an existing name returns 409 Conflict.
- Deleting a corpus cascades to `corpus_documents` rows; documents orphaned (in zero corpuses) are also deleted UNLESS uploaded by an allowed user — those are left orphaned for the author to rescue (Phase 9b)

#### `documents` — ✅ IMPLEMENTED (Phase 7a, extended Phase 7h, Phase 25a)
Stores uploaded document content. Documents are immutable once finalized — text content cannot be edited after finalization.

```sql
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  format VARCHAR(20) NOT NULL DEFAULT 'plain',
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  version_number INTEGER NOT NULL DEFAULT 1,
  source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  tag_id INTEGER REFERENCES document_tags(id) ON DELETE SET NULL,
  copyright_confirmed_at TIMESTAMP
);

CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX idx_documents_source ON documents(source_document_id);
```

**Key Points:**
- `format` is `'plain'`, `'markdown'`, `'pdf'`, or `'docx'` — determines rendering in the document viewer. Phase 22a adds pdf and docx support via server-side text extraction (`pdf-parse` and `mammoth` libraries).
- `body` stores the full text content; character offsets for annotations (Phase 7d) depend on immutability after finalization
- **Unique title:** Document titles are unique (case-insensitive). Uploading a document with an existing title returns 409 Conflict.
- Documents are never manually deleted — their lifecycle is governed entirely by corpus membership
- A document is auto-deleted only when it's removed from its last corpus (orphan cleanup), UNLESS uploaded by an allowed user of that corpus — those are left orphaned for the author to rescue (Phase 9b)
- **Phase 7h versioning columns:**
  - `version_number` — auto-incremented per lineage (default 1 for original uploads)
  - `source_document_id` — self-referencing FK forming a version chain (NULL for originals, points to the immediate predecessor for versions). `ON DELETE SET NULL` so chain survives if a middle version is somehow removed.
- **Phase 25a tag column:**
  - `tag_id` — nullable FK to `document_tags`. Replaces the former `document_tag_links` junction table. Only the document uploader (`uploaded_by`) can assign or change the tag.
  - **Version chain propagation:** Assigning or removing a tag uses a recursive CTE to walk the full version chain (up via `source_document_id` to root, then back down) and updates `tag_id` on all versions simultaneously.
  - New versions inherit the source document's `tag_id` automatically via `createVersion`.
- **Phase 36 copyright confirmation column:**
  - `copyright_confirmed_at` — timestamp recording when the uploader confirmed they have the right to upload the content (owns it or it is public domain). Set per document at upload time. Required for both original uploads and version uploads. Nullable — null for documents uploaded before Phase 36.
- **LEFT JOIN requirement for `uploaded_by` (Phase 36 bug fix):** Because `uploaded_by` uses `ON DELETE SET NULL` (Phase 35c), it becomes NULL when the uploading user deletes their account. Any query that JOINs `users` via `uploaded_by` **must** use `LEFT JOIN`, not inner JOIN — otherwise the document silently disappears from results. This applies to all provenance FKs changed by Phase 35c (`created_by`, `added_by`, `uploaded_by`, etc.).
- **File upload model (Phase 22a):** Documents are created by uploading files (.txt, .md, .pdf, .docx) or via drag-and-drop. There is no in-app text editor. Text is extracted server-side from uploaded files using `pdf-parse` (PDFs) and `mammoth` (Word docs). The `format` column stores the original file type. Document updates happen by uploading a new version (version chain via `source_document_id`), not by editing the body in-place.
- **Edit endpoint retired (Phase 22a):** The `POST /api/corpuses/documents/:id/edit` endpoint and `adjustAnnotationOffsets` helper from Phase 21a are removed. The `diff-match-patch` dependency is also removed. Since documents can no longer be edited in-place, annotation offset adjustment is no longer needed — annotations remain stable against the uploaded text. Document "editing" is now accomplished by creating a new version.

#### `corpus_documents` — ✅ IMPLEMENTED (Phase 7a)
Junction table linking documents to corpuses. A document can appear in multiple corpuses.

```sql
CREATE TABLE corpus_documents (
  id SERIAL PRIMARY KEY,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(corpus_id, document_id)
);

CREATE INDEX idx_corpus_documents_corpus ON corpus_documents(corpus_id);
CREATE INDEX idx_corpus_documents_document ON corpus_documents(document_id);
```

**Key Points:**
- `UNIQUE(corpus_id, document_id)` prevents the same document being added to the same corpus twice
- `ON DELETE CASCADE` from both `corpuses` and `documents` ensures cleanup
- `added_by` tracks who added the document to this specific corpus (may differ from who uploaded the document)
- Removing a document from a corpus checks if it's orphaned and auto-deletes if so

#### `corpus_subscriptions` — ✅ IMPLEMENTED (Phase 7c)
Tracks which users are subscribed to which corpuses. Subscribing creates a persistent corpus tab in the main tab bar.

```sql
CREATE TABLE corpus_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, corpus_id)
);

CREATE INDEX idx_corpus_subscriptions_user ON corpus_subscriptions(user_id);
CREATE INDEX idx_corpus_subscriptions_corpus ON corpus_subscriptions(corpus_id);
```

**Key Points:**
- `UNIQUE(user_id, corpus_id)` prevents duplicate subscriptions
- `ON DELETE CASCADE` from both `users` and `corpuses` ensures cleanup
- Subscribing creates a persistent corpus tab in the sidebar and a row in `sidebar_items`; unsubscribing removes both
- Subscriber count is displayed on corpus listings and corpus detail views
- Corpus deletion cascades to subscriptions automatically
- `group_id` column was removed in Phase 19d — corpus tabs are no longer placed in flat tab groups. Sidebar ordering is handled by the `sidebar_items` table.

#### `document_annotations` — ✅ IMPLEMENTED (Phase 7d, redesigned Phase 22b)
Annotations attach an edge (concept-in-context) to a document, scoped to a specific corpus. The same document in different corpuses has entirely separate annotation sets. Annotations are document-level — they connect a concept to the whole document, with an optional text quote and optional freeform comment.

```sql
CREATE TABLE document_annotations (
  id SERIAL PRIMARY KEY,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  quote_text TEXT,
  comment TEXT,
  quote_occurrence INTEGER,
  layer VARCHAR(10) NOT NULL DEFAULT 'public',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_annotations_corpus_doc ON document_annotations(corpus_id, document_id);
CREATE INDEX idx_document_annotations_edge ON document_annotations(edge_id);
CREATE INDEX idx_document_annotations_document ON document_annotations(document_id);
```

**Key Points:**
- `corpus_id` + `document_id` scopes annotations to a specific corpus — same document in different corpuses has separate annotations
- `edge_id` links the annotation to a concept-in-context (specific path + attribute)
- `quote_text` — optional string quoted from the document. Stored as plain text, not character offsets. Used for click-to-navigate via runtime string search.
- `comment` — optional freeform text explaining the connection (e.g., "Section 3 discusses why their protocol improved reproducibility")
- `quote_occurrence` — optional 1-indexed integer indicating which occurrence of the quote string in the document the annotator selected. Stored when the quote appears multiple times.
- `layer` column is `VARCHAR(10) NOT NULL DEFAULT 'public'` — **functionally retired (Phase 26c).** The column remains in the database (append-only philosophy) and new annotations harmlessly default to `'public'`, but the value is ignored by the filter system. Filtering is now identity-based (Phase 26d) — see `getDocumentAnnotations` query parameter `?filter=all|corpus_members|author`.
- `ON DELETE CASCADE` from all three FKs (corpus, document, edge) ensures automatic cleanup
- Three indexes for fast lookups: by corpus+document (loading annotations for a document view), by edge (bidirectional linking on External Links page), by document (cross-corpus annotation queries)
- **Phase 22b migration:** Existing offset-based annotations were migrated by extracting `SUBSTRING(body, start_position + 1, end_position - start_position)` into `quote_text`. The `start_position`, `end_position` columns and `valid_positions` CHECK constraint were dropped.
- **Annotations are permanent (Phase 26c):** Annotations cannot be deleted. Quality is curated through voting — low-quality annotations sink to the bottom. The `POST /annotations/delete` endpoint returns 410 Gone.
- **Auto-vote on creation (Phase 26c):** Creating an annotation automatically inserts a vote in `annotation_votes` for the creator, so every annotation starts with vote_count = 1.

#### `annotation_votes` — ✅ IMPLEMENTED (Phase 7f)
Simple endorsement votes on annotations. One vote per user per annotation.

```sql
CREATE TABLE annotation_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, annotation_id)
);

CREATE INDEX idx_annotation_votes_annotation ON annotation_votes(annotation_id);
```

**Key Points:**
- One endorsement per user per annotation
- `UNIQUE(user_id, annotation_id)` prevents double-voting
- `ON DELETE CASCADE` from both `users` and `document_annotations` ensures cleanup
- Vote count computed as `COUNT(*)` on `annotation_votes` for each annotation
- Returned alongside annotation data in `getDocumentAnnotations` query (as `vote_count` and `user_voted`)
- **Auto-vote on creation (Phase 26c):** When an annotation is created, a vote is automatically inserted for the creator. The creator can later remove their vote if they change their mind — the annotation itself remains (permanence).
- **No editorial-layer voting restriction (Phase 26c):** Any logged-in user can vote on any annotation regardless of corpus membership or authorship status.

#### `annotation_color_set_votes` — ✅ IMPLEMENTED (Phase 7f) — 💤 DORMANT (Phase 26c)
Stores a user's preferred vote set (color set) for a given annotation's concept's children. **Retired in Phase 26c** — all color set voting endpoints return 410 Gone and the frontend UI has been removed. Table remains in database (append-only philosophy).

```sql
CREATE TABLE annotation_color_set_votes (
  id SERIAL PRIMARY KEY,
  annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  vote_set_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, annotation_id)
);

CREATE INDEX idx_annotation_color_set_votes_annotation ON annotation_color_set_votes(annotation_id);
```

---

#### `corpus_allowed_users` — ✅ IMPLEMENTED (Phase 7g, updated Phase 26b)
Tracks which users are allowed to contribute to a corpus. The corpus owner invites users via invite tokens. Used for "Corpus Members" identity resolution in the annotation filter system (Phase 26d).

```sql
CREATE TABLE corpus_allowed_users (
  id SERIAL PRIMARY KEY,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(corpus_id, user_id)
);

CREATE INDEX idx_corpus_allowed_users_corpus ON corpus_allowed_users(corpus_id);
CREATE INDEX idx_corpus_allowed_users_user ON corpus_allowed_users(user_id);
```

**Key Points:**
- `UNIQUE(corpus_id, user_id)` prevents duplicate allowed-user entries
- `display_name` column is **dormant (Phase 26b)** — remains in database but is no longer read or written. The `POST /allowed-users/display-name` endpoint returns 410 Gone.
- `ON DELETE CASCADE` from both `corpuses` and `users` ensures cleanup
- The corpus owner is implicitly a corpus member (checked by ownership, not by presence in this table)
- **UI (Phase 26b, updated Phase 28e):** All corpus members (owner AND allowed users) can see each other's usernames in the members panel. Invite link generation and member removal remain owner-only. Members can self-remove via "Leave corpus" button. Non-members see count only ("N corpus members").
- **Identity resolution (Phase 26d):** Corpus members = `corpuses.created_by` UNION `corpus_allowed_users.user_id`. Used for the `?filter=corpus_members` annotation filter and `addedByCorpusMember`/`votedByCorpusMember` provenance badges.

#### `corpus_invite_tokens` — ✅ IMPLEMENTED (Phase 7g)
Stores invite tokens generated by corpus owners. Each token is a unique random string. Accepting a token adds the user to `corpus_allowed_users`.

```sql
CREATE TABLE corpus_invite_tokens (
  id SERIAL PRIMARY KEY,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_corpus_invite_tokens_corpus ON corpus_invite_tokens(corpus_id);
CREATE INDEX idx_corpus_invite_tokens_token ON corpus_invite_tokens(token);
```

**Key Points:**
- `token` is a 48-character URL-safe random string generated via `crypto.randomBytes`
- `expires_at` is optional — if set, the token becomes invalid after this time
- `max_uses` is optional — if set, the token becomes invalid after reaching this count
- `use_count` is incremented on each successful acceptance
- Tokens are accepted via `POST /corpuses/invite/accept` and the frontend route `/invite/:token`

#### `annotation_removal_log` — ✅ IMPLEMENTED (Phase 7g, updated Phase 22b) — 💤 DORMANT (Phase 26c)
Logs every annotation removal performed by a non-creator. **Retired in Phase 26c** — annotations can no longer be deleted, so no new entries will be written. The `GET /:corpusId/removal-log` endpoint returns 410 Gone and the frontend removal log panel has been removed. Table remains in database with historical entries (append-only philosophy).

```sql
CREATE TABLE annotation_removal_log (
  id SERIAL PRIMARY KEY,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  edge_id INTEGER REFERENCES edges(id) ON DELETE SET NULL,
  start_position INTEGER,
  end_position INTEGER,
  quote_text TEXT,
  annotation_layer VARCHAR(10) NOT NULL DEFAULT 'public',
  original_creator INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_annotation_removal_log_corpus ON annotation_removal_log(corpus_id);
```

#### `document_annotations.layer` column — ✅ IMPLEMENTED (Phase 7g) — 💤 FUNCTIONALLY RETIRED (Phase 26c/26d)
Layer column is included in the `document_annotations` CREATE TABLE above (Phase 22b consolidated it).

**Key Points:**
- Column retained in database with `NOT NULL DEFAULT 'public'` — new annotations harmlessly get `'public'`, but the value is ignored.
- **Replaced by identity-based filtering (Phase 26d):** The `getDocumentAnnotations` endpoint now accepts `?filter=all|corpus_members|author` instead of `?layer=public|editorial|author`. Filter views are computed at query time from user identities (authors = uploader + `document_authors`; corpus members = corpus owner + `corpus_allowed_users`).
- **Author filter (Phase 26d):** Returns annotations where the creator is an author (uploader or co-author via `document_authors`) OR any author has voted for the annotation.
- **Corpus Members filter (Phase 26d):** Returns annotations where the creator is a corpus member (owner or in `corpus_allowed_users`) OR any corpus member has voted for it.
- **All filter (Phase 26d, default):** Returns ALL annotations with four provenance badges: `addedByAuthor`, `votedByAuthor`, `addedByCorpusMember`, `votedByCorpusMember`.
- All annotations are visible to all users in the All view — the old restriction hiding editorial annotations from non-allowed users is removed.
- The old `annotation_mode` column on `corpuses` is functionally retired — it still exists in the database but is no longer used for permission checks.

#### `document_authors` — ✅ IMPLEMENTED (Phase 26a)
Tracks co-authors of a document. Co-authorship is stored at the version-chain level — `document_id` references the root document (where `source_document_id IS NULL`), and the co-author group applies to all versions in the lineage.

```sql
CREATE TABLE document_authors (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);

CREATE INDEX idx_document_authors_document ON document_authors(document_id);
CREATE INDEX idx_document_authors_user ON document_authors(user_id);
```

**Key Points:**
- `document_id` references the **root document** in the version chain. When checking co-author status for any version, the backend walks up the `source_document_id` chain via recursive CTE (`getRootDocumentId`) to find the root, then checks this table.
- The original uploader (`documents.uploaded_by`) is implicitly an author — not stored in `document_authors`, checked by ownership (same pattern as corpus owner vs `corpus_allowed_users`).
- Any author (uploader or co-author) can: generate invite tokens, remove other co-authors, create new versions.
- Co-authors can self-remove via the "Leave" endpoint (uploader cannot leave).
- **Identity resolution (Phase 26d):** Authors = `documents.uploaded_by` (root doc) UNION `document_authors.user_id`. Used for the `?filter=author` annotation filter and `addedByAuthor`/`votedByAuthor` provenance badges.
- **Promotion behavior:** When a user becomes a co-author, their existing annotations and votes on that document automatically appear in the Author filter — no data migration needed (query-time computation).

#### `document_invite_tokens` — ✅ IMPLEMENTED (Phase 26a)
Stores invite tokens for document co-authorship. Modeled identically to `corpus_invite_tokens` but with `document_id` instead of `corpus_id`.

```sql
CREATE TABLE document_invite_tokens (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_document_invite_tokens_document ON document_invite_tokens(document_id);
CREATE INDEX idx_document_invite_tokens_token ON document_invite_tokens(token);
```

**Key Points:**
- `document_id` references the root document in the version chain (same as `document_authors`).
- `token` is a 48-character URL-safe random string generated via `crypto.randomBytes(36).toString('base64url')`.
- Any author (uploader or co-author) can generate tokens.
- Accepting a token adds the user to `document_authors` for the root document.
- Frontend acceptance route: `/doc-invite/:token` → `DocInviteAccept` component.

#### `document_concept_links_cache` — ✅ IMPLEMENTED (Phase 7i-5)
Pre-computed concept link matches for finalized documents. Since finalized document bodies are immutable, matches only change when new concepts are created.

```sql
CREATE TABLE document_concept_links_cache (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  concept_id INTEGER NOT NULL,
  concept_name VARCHAR(255) NOT NULL,  -- Widened from VARCHAR(40) in Phase 28g
  start_position INTEGER NOT NULL,
  end_position INTEGER NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_doc_concept_links_cache_doc ON document_concept_links_cache(document_id);
```

**Key Points:**
- All cached entries for a document share the same `computed_at` timestamp
- On document open, the backend compares `computed_at` against `MAX(concepts.created_at)` — if any concepts were created after the cache was built, the cache is stale and recomputed
- Cache is replaced atomically (DELETE + INSERT in a transaction) when recomputing
- First view of a document after deployment (or after new concepts are created) triggers computation; subsequent views serve from cache
- `ON DELETE CASCADE` from `documents` ensures cleanup when documents are removed
- **Phase 22b repurposing:** Cache now feeds the "Concepts in this document" sidebar panel instead of rendering persistent underlines in the document body. Same data, different consumer.

---

#### `document_favorites` — ✅ IMPLEMENTED (Post-Phase 7 cleanup)
Per-corpus document favoriting. Users can favorite documents within a specific corpus to float them to the top of that corpus's document list. Favoriting in one corpus does not affect the document's position in other corpuses.

```sql
CREATE TABLE document_favorites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, corpus_id, document_id)
);

CREATE INDEX idx_document_favorites_user_corpus ON document_favorites(user_id, corpus_id);
```

**Key Points:**
- `UNIQUE(user_id, corpus_id, document_id)` — one favorite per user per document per corpus
- Per-corpus: favoriting a document in Corpus A doesn't affect its position in Corpus B
- `ON DELETE CASCADE` from all three FKs ensures cleanup
- Favorited documents sort to the top of the document list in `CorpusTabContent`
- Toggle endpoint: `POST /corpuses/documents/favorite/toggle` — inserts if not favorited, deletes if already favorited
- Star button (☆/★) appears on each document card for logged-in users; guests see no star
- Warm amber color (goldenrod) for the filled star, consistent with Orca's design language

---

#### `saved_page_tab_activity` — ✅ IMPLEMENTED (Phase 8)
Tracks when each corpus tab on the Saved Page was last opened, used to determine dormancy. A background job (`check-dormancy.js`) marks tabs dormant after 30 days of inactivity.

```sql
CREATE TABLE saved_page_tab_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  last_opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_dormant BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(user_id, corpus_id)
);

CREATE INDEX idx_saved_page_tab_activity_user ON saved_page_tab_activity(user_id);
CREATE INDEX idx_saved_page_tab_activity_dormant ON saved_page_tab_activity(user_id, is_dormant);

-- Partial unique index for NULL corpus_id (Uncategorized tab)
CREATE UNIQUE INDEX idx_saved_page_tab_activity_uncategorized
  ON saved_page_tab_activity(user_id)
  WHERE corpus_id IS NULL;
```

**Key Points:**
- `corpus_id` references the corpus whose Saved Page tab is being tracked; NULL for the "Uncategorized" tab
- `last_opened_at` updated whenever a user switches to / opens a corpus tab on the Saved Page
- `is_dormant` set to `true` by the `check-dormancy.js` background job when `last_opened_at` is older than 30 days
- **Simplified dormancy model (Architecture Decision #43):** A user's votes are excluded from ALL public save totals only when EVERY one of that user's `saved_page_tab_activity` rows has `is_dormant = true`. If even one tab is active, all votes count everywhere. This avoids per-edge, per-corpus filtering complexity.
- Users with zero activity rows (never opened Saved Page) are NOT dormant — their votes always count
- Only save votes are affected — swap and link votes are independent and remain unaffected
- On clicking a dormant tab, user sees a modal with two options: "Revive my votes" or "View without reviving"
- "Revive" sets `is_dormant = false`, updates `last_opened_at`, and triggers a data reload so save totals reflect the change
- "View without reviving" allows read-only browsing; votes stay dormant; a persistent info bar offers a "Revive" button
- Modal messaging is context-aware: if all tabs are dormant, it says votes aren't being counted; if only some tabs are dormant, it clarifies votes still count because of other active tabs
- Migration backfills activity rows for all existing users with `last_opened_at = NOW()` so nobody is instantly dormant on deploy
- `ON DELETE CASCADE` from both `users` and `corpuses` ensures cleanup
- PostgreSQL `NULL::INTEGER` cast required in backfill INSERT for the uncategorized tab (bare `NULL` causes type inference error)

---

#### `user_corpus_tab_placements` — ✅ IMPLEMENTED (Phase 12c)
Allows users to place their graph tabs inside any corpus node in the sidebar directory tree. These placements are private — only visible to the placing user.

```sql
CREATE TABLE user_corpus_tab_placements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  graph_tab_id INTEGER REFERENCES graph_tabs(id) ON DELETE CASCADE,
  corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, graph_tab_id)
);

CREATE INDEX idx_user_corpus_tab_placements_user_corpus
  ON user_corpus_tab_placements(user_id, corpus_id);
```

**Key Points:**
- `UNIQUE(user_id, graph_tab_id)` — a graph tab can only be placed in one corpus at a time per user
- Placing a graph tab in a corpus removes it from any flat tab group (sets `graph_tabs.group_id = NULL`)
- Conversely, adding a graph tab to a flat group removes its corpus placement
- `ON DELETE CASCADE` from all three FKs ensures cleanup
- Placed graph tabs appear indented under their corpus in the sidebar tree
- Other users cannot see anyone else's graph tab placements

---

### Planned Tables

#### `concept_flags` — ✅ IMPLEMENTED (Phase 16a, updated Phase 30k)
Spam/moderation flags on edges. 10 flags = hide (changed from single-flag-hides in Phase 30k).

```sql
CREATE TABLE concept_flags (
  id SERIAL PRIMARY KEY,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(50) NOT NULL DEFAULT 'spam',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, edge_id)
);
CREATE INDEX idx_concept_flags_edge ON concept_flags(edge_id);
```

#### `concept_flag_votes` — ✅ IMPLEMENTED (Phase 16a)
Community votes to keep hidden or restore flagged concepts.

```sql
CREATE TABLE concept_flag_votes (
  id SERIAL PRIMARY KEY,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('hide', 'show')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, edge_id)
);
CREATE INDEX idx_concept_flag_votes_edge ON concept_flag_votes(edge_id);
```

#### `moderation_comments` — ✅ IMPLEMENTED (Phase 16a)
Discussion comments on hidden/flagged concepts.

```sql
CREATE TABLE moderation_comments (
  id SERIAL PRIMARY KEY,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_moderation_comments_edge ON moderation_comments(edge_id);
```

#### `edges.is_hidden` column — ✅ IMPLEMENTED (Phase 16a)
```sql
ALTER TABLE edges ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT false;
```

#### `document_tags` — ✅ IMPLEMENTED (Phase 17a), updated Phase 27e (planned)
Admin-controlled tags for categorizing documents (preprint, outline, grant application, protocol, etc.). Originally user-generated (Phase 17a); Phase 27e shifts to owner-controlled model mirroring the attribute system.

```sql
CREATE TABLE document_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Points:**
- Tag names are unique (case-insensitive, enforced at application level via exact match against `ENABLED_DOCUMENT_TAGS` env var values, plus `CREATE UNIQUE INDEX idx_document_tags_name_lower ON document_tags (LOWER(name))` added in Phase 28d to prevent future case-variant duplicates at the database level)
- **Phase 27e (planned):** Tags shift from user-generated to admin-controlled. The `ENABLED_DOCUMENT_TAGS` environment variable gates which tags appear in the picker (comma-separated names, same pattern as `ENABLED_ATTRIBUTES`). The `POST /documents/tags/create` endpoint is retired (410 Gone). New tags are added by the owner via database row insertion + env var update + restart. The `created_by` column remains for provenance but no new rows are created through the API.
- Tags are shared globally across all documents and corpuses
- **Phase 28d fix:** `listDocumentTags` changed from case-insensitive `LOWER()` matching to exact match (`dt.name IN ($1, ...)`) against env var values. Migration deletes the "PrePrint" duplicate tag and its links.

#### `document_tag_links` — ❌ DROPPED (Phase 25a)
Junction table that formerly linked documents to tags. **Dropped in Phase 25a** — replaced by a direct `tag_id` column on the `documents` table (single tag per document). Migration copied the earliest assigned tag per document before dropping the table.

**Historical schema (for reference):**
```sql
CREATE TABLE document_tag_links (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES document_tags(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, tag_id)
);
CREATE INDEX idx_document_tag_links_doc ON document_tag_links(document_id);
CREATE INDEX idx_document_tag_links_tag ON document_tag_links(tag_id);
```

**Key Points (historical):**
- A tag can be assigned to the same document only once (`UNIQUE(document_id, tag_id)`)
- `added_by` tracks who assigned the tag — used for permission checks on removal
- Removal permission: the user who assigned the tag OR any owner of a corpus containing the document
- **Dropped in Phase 25a:** Replaced by `documents.tag_id` direct column. Only the document uploader can assign/change the tag. Tag assignment/removal propagates across the full version chain via recursive CTE.

### Planned Tables

#### `sidebar_items` — ✅ IMPLEMENTED (Phase 19b)
Unified ordering for all sidebar items (corpuses, groups, loose graph tabs). Replaces the separate `display_order` fields that existed on individual tables.

```sql
CREATE TABLE sidebar_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL, -- 'corpus', 'group', or 'graph_tab'
  item_id INTEGER NOT NULL,       -- references corpus_subscriptions.id, tab_groups.id, or graph_tabs.id
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_sidebar_items_user ON sidebar_items(user_id);
CREATE INDEX idx_sidebar_items_user_order ON sidebar_items(user_id, display_order);
```

**Key Points:**
- `item_type` + `item_id` together identify the sidebar item — no single FK (polymorphic reference)
- `display_order` controls the unified order of all items in the sidebar
- Migration backfills from current positions: corpuses first, then groups, then loose graph tabs
- When a new corpus subscription or graph tab is created, a `sidebar_items` row is auto-created at the bottom
- When a subscription or tab is deleted, the corresponding `sidebar_items` row is cleaned up
- Graph tabs inside a corpus or group are NOT in `sidebar_items` — they appear nested under their container. Only top-level items get rows.

#### `user_default_attributes` — ❌ CANCELLED (Phase 23 cancelled)
Per-user configured default attributes shown at concept creation time. **No longer planned** — attribute enablement is now controlled by the app owner via `ENABLED_ATTRIBUTES` environment variable (Phase 25e).

```sql
CREATE TABLE user_default_attributes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  attribute_id INTEGER REFERENCES attributes(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, attribute_id)
);
CREATE INDEX idx_user_default_attributes_user ON user_default_attributes(user_id);
```

#### `vote_set_changes` — ✅ IMPLEMENTED (Phase 23a)
Append-only event log tracking save/unsave actions for vote set drift analysis.

```sql
CREATE TABLE vote_set_changes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  parent_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  child_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  action VARCHAR(10) NOT NULL CHECK (action IN ('save', 'unsave')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_vote_set_changes_parent_user_time ON vote_set_changes(parent_edge_id, user_id, created_at);
```

**Key Points:**
- Append-only — no unique constraint, no updates, no deletes. Every save/unsave event is a new row.
- `parent_edge_id` is the edge whose children list is affected (NULL for root-level saves where the saved edge itself is a root edge)
- `child_edge_id` is the specific child edge being saved or unsaved
- Logging wired into `addVote` (saves), `removeVote` (unsaves including cascading descendants), and `addSwapVote` (cascade removal from Phase 20c mutual exclusivity)
- `addVote` uses indexed loop: `parent_edge_id = edgeIdsToSave[i-1]` (NULL at index 0 for root edge). Only logs when INSERT actually creates a new vote.
- `removeVote` uses LEFT JOIN to map each removed edge to its parent edge, then bulk-inserts 'unsave' events via `unnest`
- No background jobs — reconstruction queries replay events on demand
- Data accumulates from the moment of deployment; pre-deployment saves have no log entries

#### `page_comments`
Stores comments on informational pages (Using Orca, Constitution, Donate). Supports 1-level nesting via `parent_comment_id`.

```sql
CREATE TABLE page_comments (
  id SERIAL PRIMARY KEY,
  page_slug VARCHAR(50) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  parent_comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_page_comments_page ON page_comments(page_slug);
CREATE INDEX idx_page_comments_parent ON page_comments(parent_comment_id);
```

**Key Points:**
- `page_slug` is one of: `using-orca`, `constitution`, `donate`
- `parent_comment_id` enables 1-level nested replies (cannot reply to a reply — backend enforces)
- Comments sorted by vote count desc, then chronologically

#### `page_comment_votes`
Tracks upvotes on page comments. Toggle-based (add/remove). Auto-vote on comment creation.

```sql
CREATE TABLE page_comment_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, comment_id)
);
CREATE INDEX idx_page_comment_votes_comment ON page_comment_votes(comment_id);
```

---

## API Endpoints

### Authentication (`/api/auth`)

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/send-code` | No | Send OTP via Twilio. Accepts `{ phoneNumber }`. Rate-limited: 5 req/IP/15 min. (Phase 32b) |
| POST | `/verify-register` | No | Verify OTP + create account. Accepts `{ phoneNumber, code, username, email, ageVerified }`. Validates email format and `ageVerified === true`. Stores email, sets `age_verified_at = NOW()`. Returns JWT. (Phase 32b, updated Phase 36) |
| POST | `/verify-login` | No | Verify OTP + login. Accepts `{ phoneNumber, code }`. Returns JWT. (Phase 32b) |
| GET | `/me` | Yes | Get current user info |
| POST | `/logout-everywhere` | Yes | Sets `token_issued_after = NOW()`, invalidating all existing JWTs. (Phase 32b) |
| POST | `/delete-account` | Yes | Permanently delete the user's account. Pre-check: user must own zero corpuses (transfer first). CASCADE deletes votes, subscriptions, tabs, messages, flags. SET NULL on concepts, edges, annotations, web links, documents `created_by`/`uploaded_by`. Returns 400 if user still owns corpuses. (Phase 35c) |

**Request/Response Examples:**

```javascript
// Phone OTP flow (Phase 32b)
POST /api/auth/send-code
Body: { phoneNumber }
Response: { message: 'Verification code sent' }

POST /api/auth/verify-register
Body: { phoneNumber, code, username, email, ageVerified }
Response: { token, user: { id, username } }

POST /api/auth/verify-login
Body: { phoneNumber, code }
Response: { token, user: { id, username } }

POST /api/auth/logout-everywhere  [Authorization: Bearer TOKEN]
Response: { message: 'All sessions invalidated. Please log in again.' }
```

---

### Concepts (`/api/concepts`)

All concept endpoints require authentication (JWT token in Authorization header).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/root` | Get all root concepts (concepts with no parents) |
| GET | `/attributes` | Get all available attributes (action, tool, value, question) |
| GET | `/:id?path=...` | Get concept with children in specific context |
| GET | `/:id/parents?originPath=...` | Get all parent contexts for a concept (flip view). Returns `originEdgeId` and link vote counts in contextual mode. |
| GET | `/:id/votesets?path=...` | Get identical vote sets for children in a specific context. Returns color-assignable groups of users who saved the same children. |
| GET | `/search?q=...&parentId=...&path=...` | Search concepts by name (text + trigram similarity) |
| GET | `/names/batch?ids=...` | Get concept names by comma-separated IDs |
| POST | `/root` | Create new root concept (requires attributeId) |
| POST | `/child` | Create child concept in specific context (requires attributeId) |
| POST | `/find-in-text` | Find all concept names appearing as whole words in provided text (Phase 7i). Guest-accessible. |
| GET | `/document-links/:documentId` | Get cached concept links for a finalized document. Recomputes if stale (Phase 7i-5). Guest-accessible. |
| POST | `/batch-children-for-diff` | Get children (with grandchildren for Jaccard) for multiple concepts in batch. Max 10 panes. Guest-accessible. (Phase 14a) |
| GET | `/:id/annotations` | Get all annotations across all edges where this concept is the child. Supports `?sort=votes\|newest`, `?edgeId=N` (single-context filter for children view), `?corpusIds=1,2,3`, `?tagId=N`. Returns flat array with context provenance, document info, vote counts. **Deduplicated across version chains** — when the same annotation (same edge + quote_text + creator) exists on multiple versions of a document, only the most recent version's annotation is returned. Guest-accessible. (Phase 27b, dedup Phase 31d) |

**Key Implementation Details:**

```javascript
// Get concept with children
GET /api/concepts/123?path=1,2

// Optional sort parameter:
GET /api/concepts/123?path=1,2&sort=new  // Sort children by newest first
// Default (no sort param or sort=saves): Sort by save count descending

// Returns:
{
  concept: { id, name, ... },
  path: [1, 2, 123],  // Includes current concept at end
  children: [
    { 
      id, 
      name, 
      edge_id, 
      vote_count,       // save count
      user_voted,       // Boolean: has current user saved this?
      child_count,      // Number of children this concept has
      attribute_id,     // Attribute ID for this edge
      attribute_name,   // Attribute name (e.g., "action", "tool", "value", "question")
      swap_count        // Number of distinct users with swap votes on this edge
    }
  ],
  currentEdgeVoteCount,  // Save count on edge connecting this concept to its parent (null for root concepts navigated to without a path, integer otherwise — including root concepts via root edge)
  currentAttribute       // { id, name } — attribute of this concept in current path context (null if no path context)
}

// Create child concept
POST /api/concepts/child
Body: { 
  name: "Exercise",      // Max 255 characters
  parentId: 2,
  path: "1",             // Comma-separated path (excludes parent)
  attributeId: 1         // Required — ID of attribute (action, tool, value, or question)
}

// The backend will:
// 1. Validate concept name is ≤ 255 characters
// 2. Check if concept exists (by name, case-insensitive)
// 3. If exists, use existing concept ID
// 4. If not, create new concept
// 5. Create edge with graph_path = [1, 2]
// 6. Check for cycles (concept can't be in its own ancestor path)
```

---

### Votes (`/api/votes`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/saved` | Get all edges the current user has saved (for Saved Page). Optional `?tabId=` filter. |
| GET | `/tabs` | Get all saved tabs for the current user |
| POST | `/tabs/create` | Create a new named saved tab |
| POST | `/tabs/rename` | Rename a saved tab |
| POST | `/tabs/delete` | Delete a saved tab (must have 2+ tabs) |
| POST | `/add` | Save (vote for) an edge — saves full path, links to specified tab |
| POST | `/remove` | Remove save from an edge — cascades to descendants, deletes vote entirely |
| POST | `/remove-from-tab` | Remove save from a specific tab only — keeps vote if linked to other tabs |
| POST | `/link/add` | Add a link vote in contextual Flip View |
| POST | `/link/remove` | Remove a link vote |
| GET | `/swap/:edgeId` | Get all swap vote replacements for an edge (with vote counts) |
| POST | `/swap/add` | Add a swap vote (validates sibling relationship) |
| POST | `/swap/remove` | Remove a swap vote |
| GET | `/graph-tabs` | Get all graph tabs for the current user |
| POST | `/graph-tabs/create` | Create a new graph tab (type, conceptId, path, viewMode, label) |
| POST | `/graph-tabs/update` | Update a graph tab's navigation state |
| POST | `/graph-tabs/close` | Close (delete) a graph tab |
| GET | `/tab-groups` | Get all tab groups for the current user |
| POST | `/tab-groups/create` | Create a new named tab group |
| POST | `/tab-groups/rename` | Rename a tab group |
| POST | `/tab-groups/delete` | Delete a tab group (ungroups member tabs) |
| POST | `/tab-groups/toggle` | Toggle a group's expanded/collapsed state |
| POST | `/tab-groups/add-tab` | Add a tab (saved or graph) to a group |
| POST | `/tab-groups/remove-tab` | Remove a tab from its group (make ungrouped) |
| GET | `/tree-order` | Get tree display order for a saved tab (LEGACY — use tree-order-v2) |
| POST | `/tree-order/update` | Update tree display order for a saved tab (LEGACY — use tree-order-v2) |
| GET | `/saved-by-corpus` | Get user's saves grouped by corpus via annotation membership (Phase 7c Overhaul) |
| GET | `/tree-order-v2` | Get tree display order for a corpus-based Saved Page tab (Phase 7c Overhaul) |
| POST | `/tree-order-v2/update` | Update tree display order for a corpus-based Saved Page tab (Phase 7c Overhaul) |
| GET | `/rankings` | Get child rankings for a parent edge + vote set key (user's own + aggregated) |
| POST | `/rankings/update` | Set/update a user's ranking for a child within a vote set |
| POST | `/rankings/remove` | Remove a user's ranking for a child within a vote set |
| GET | `/web-links/:edgeId` | Get all web links for an edge (with vote counts, user vote status). Guest-accessible. |
| GET | `/web-links/all/:conceptId` | Get all web links across ALL parent contexts for a concept. Guest-accessible. |
| POST | `/web-links/add` | Add a new web link to an edge (validates URL format, checks duplicates, auto-upvotes) |
| POST | `/web-links/remove` | Remove a web link (only the user who added it) |
| POST | `/web-links/upvote` | Upvote a web link |
| POST | `/web-links/unvote` | Remove upvote from a web link |
| PUT | `/web-links/:linkId/comment` | Update comment on a web link (creator-only, 403 for non-creators). First-time comment does not set "(edited)"; subsequent edits update `updated_at`. (Phase 29a) |
| GET | `/tab-activity` | Get all saved page tab activity rows for the current user (with dormancy status) (Phase 8) |
| POST | `/tab-activity/record` | Record that a corpus tab was opened on the Saved Page (updates last_opened_at) (Phase 8) |
| POST | `/tab-activity/revive` | Revive a dormant corpus tab (sets is_dormant=false, updates last_opened_at) (Phase 8) |
| GET | `/tab-placements` | Get all graph tab corpus placements for the current user (Phase 12c) |
| POST | `/tab-placements/place` | Place a graph tab inside a corpus (removes from flat group if in one) (Phase 12c) |
| POST | `/tab-placements/remove` | Remove a graph tab from its corpus placement (Phase 12c) |
| GET | `/drift/:parentEdgeId` | Get vote set drift data — departed users grouped by current set, with added/removed diffs (Phase 23b) |
| GET | `/sidebar-items` | Get all sidebar items for the current user (ordered by display_order) (Phase 19b) |
| POST | `/sidebar-items/reorder` | Reorder sidebar items (Phase 19b) |

**Request/Response:**

```javascript
// Get user's saved edges (Saved Page) — optionally filtered by tab
GET /api/votes/saved
GET /api/votes/saved?tabId=5
Response: { edges: [{ edgeId, parentId, childId, childName, graphPath, attributeId, attributeName, voteCount, swapCount, edgeCreatedAt }], conceptNames: { id: name } }

// Get user's saved tabs
GET /api/votes/tabs
Response: { tabs: [{ id, name, display_order, created_at }] }

// Create a new tab
POST /api/votes/tabs/create
Body: { name: "Research" }
Response: { tab: { id, name, display_order, created_at } }

// Rename a tab
POST /api/votes/tabs/rename
Body: { tabId: 5, name: "New Name" }
Response: { tab: { id, name, display_order, created_at } }

// Delete a tab (must have 2+ tabs; orphaned votes are cleaned up)
POST /api/votes/tabs/delete
Body: { tabId: 5 }
Response: { message, orphanedVotesRemoved }

// Save — now accepts optional tabId (defaults to user's first tab)
POST /api/votes/add
Body: { edgeId: 123, path: [1, 2, 3], tabId: 5 }
Response: { message, savedEdgeCount, newVotesCreated, voteCount }

// Unsave (full removal — deletes vote and all tab links, cascades to descendants)
POST /api/votes/remove
Body: { edgeId: 123 }
Response: { message, removedVoteCount, voteCount }

// Remove from specific tab only (keeps vote if linked to other tabs)
POST /api/votes/remove-from-tab
Body: { edgeId: 123, tabId: 5 }
Response: { message, removedLinkCount, removedVoteCount, voteCount }

// Add link vote
POST /api/votes/link/add
Body: { originEdgeId: 10, similarEdgeId: 25 }
Response: { message, linkCount }

// Remove link vote
POST /api/votes/link/remove
Body: { originEdgeId: 10, similarEdgeId: 25 }
Response: { message, linkCount }

// Get swap votes for an edge
GET /api/votes/swap/123
Response: { swapVotes: [{ replacementEdgeId, replacementChildId, replacementName, replacementAttributeId, replacementAttributeName, voteCount, userVoted }], totalSwapVotes }

// Add swap vote (replacement must be a sibling — same parent_id and graph_path)
POST /api/votes/swap/add
Body: { edgeId: 123, replacementEdgeId: 789 }
Response: { message, totalSwapVotes, replacementVoteCount }

// Remove swap vote
POST /api/votes/swap/remove
Body: { edgeId: 123, replacementEdgeId: 789 }
Response: { message, totalSwapVotes, replacementVoteCount }
```

---

## Vote Type Terminology

Orca uses three vote types, each with a short name reflecting its action:

| Short Name | Full Name | Purpose | Scope | Destination Required |
|------------|-----------|---------|-------|---------------------|
| **Save** | Save Vote | Endorse a concept in context; saves full path to Saved Page | Full path (max 1 per user per edge) | No |
| ~~**Move**~~ | ~~Move Vote (formerly "Side Vote")~~ | ~~Assert concept belongs in a different context~~ | ~~Single edge~~ | ~~Yes — user specifies destination context~~ |
| **Swap** | Swap Vote (formerly "Replace-With Vote") | Assert concept should be replaced by a sibling | Single edge | Yes — user specifies sibling |
| **Link** | Link Vote (formerly "Similarity Vote") | Assert a parent context is helpful relative to origin context (Flip View only) | Contextual Flip View only | No — applied to existing parent context |

**Naming convention:** UI buttons and labels use the short names (Save, Swap, Link). Technical documentation and database tables may still reference the original table names (`votes`, `replace_votes`, `similarity_votes`) for continuity.

---

---

### Corpuses (`/api/corpuses`) — ✅ IMPLEMENTED (Phase 7a)

All corpus endpoints use authentication. GET endpoints for listing and viewing are guest-accessible via `optionalAuth`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Guest OK | List all corpuses (with owner username, document counts) |
| GET | `/mine` | Required | List current user's own corpuses |
| GET | `/:id` | Guest OK | Get corpus details + document list |
| POST | `/create` | Required | Create a new corpus (name, description, annotationMode) |
| POST | `/:id/update` | Owner only | Update corpus name, description, and/or annotation mode |
| POST | `/:id/delete` | Owner only | Delete corpus; orphaned documents also deleted |
| POST | `/:id/documents/upload` | Owner/Allowed | Upload a new document into a corpus (title, body, format). Requires `copyrightConfirmed: true` in request body; sets `copyright_confirmed_at = NOW()` on the document row (Phase 36). ⚠️ Permission check added in Phase 33a — was previously open to any authenticated user. |
| POST | `/:id/documents/add` | Owner/Allowed | Add an existing document to a corpus (Phase 7g: allowed users can also add) |
| POST | `/:id/documents/remove` | Owner only | Remove a document from a corpus; auto-deletes if orphaned |
| POST | `/check-duplicates` | Required | Check for existing documents similar to provided text (Phase 7b) |
| GET | `/subscriptions` | Required | Get current user's corpus subscriptions with details (Phase 7c) |
| POST | `/subscribe` | Required | Subscribe to a corpus (creates persistent corpus tab) (Phase 7c) |
| POST | `/unsubscribe` | Required | Unsubscribe from a corpus (removes corpus tab) (Phase 7c) |
| POST | `/annotations/create` | Required | Create an annotation (auto-votes for creator); layer param ignored, always defaults to 'public' (Phase 7d, updated 26c) |
| POST | `/annotations/delete` | — | ⛔ Returns 410 Gone (Phase 26c) — annotations are permanent |
| GET | `/annotations/edge/:edgeId` | Guest OK | Get all annotations for an edge across all corpuses, grouped by corpus → document (Phase 7d). ⚠️ Phase 27b replaces primary usage with new concept-scoped endpoint |
| GET | `/annotations/concept/:conceptId` | Guest OK | Get all annotations for a concept across ALL edges and corpuses; `?sort=votes\|new` (default: votes), `?tagId=N`, `?corpusIds=1,2,3`. Returns flat list with vote counts, parent context paths, corpus names. **Deduplicated across version chains** — only most recent version's annotation per lineage + corpus + creator + quote_text (Phase 27b, dedup Phase 31d) |
| GET | `/annotations/document/:documentId` | Guest OK | Get ALL annotations for a document across ALL corpuses, with duplicate merging (Phase 7e) |
| GET | `/documents/search` | Required | Search documents by title (ILIKE), with optional `excludeCorpusId` filter (Phase 7e) |
| GET | `/:corpusId/documents/:documentId/annotations` | Guest OK | Get annotations for a document within a corpus; `?filter=all|corpus_members|author` (default: all); returns provenance badges, isAuthor, isCorpusMember (Phase 7d, rewritten Phase 26d) |
| POST | `/annotations/vote` | Required | Vote (endorse) an annotation (Phase 7f) |
| POST | `/annotations/unvote` | Required | Remove endorsement from an annotation (Phase 7f) |
| POST | `/annotations/color-set/vote` | — | ⛔ Returns 410 Gone (Phase 26c) — color set voting removed |
| POST | `/annotations/color-set/unvote` | — | ⛔ Returns 410 Gone (Phase 26c) — color set voting removed |
| GET | `/annotations/:annotationId/color-sets` | — | ⛔ Returns 410 Gone (Phase 26c) — color set voting removed |
| POST | `/invite/generate` | Owner only | Generate an invite token for a corpus (Phase 7g) |
| POST | `/invite/accept` | Required | Accept an invite token to become an allowed user (Phase 7g) |
| POST | `/invite/delete` | Owner only | Revoke an invite token (Phase 7g) |
| GET | `/:corpusId/invite-tokens` | Owner only | List active invite tokens for a corpus (Phase 7g) |
| GET | `/:corpusId/allowed-users` | Required | Get corpus members — owner sees full list with usernames; others see count only (Phase 7g, updated 26b) |
| POST | `/allowed-users/remove` | Owner only | Remove an allowed user from a corpus (Phase 7g) |
| POST | `/allowed-users/display-name` | — | ⛔ Returns 410 Gone (Phase 26b) — display names retired |
| GET | `/:corpusId/removal-log` | — | ⛔ Returns 410 Gone (Phase 26c) — annotation deletion removed |
| GET | `/:corpusId/allowed-status` | Required | Check if current user is an allowed user of a corpus (Phase 7g) |
| POST | `/versions/create` | Author only | Create a new version of a document within a corpus — uploader or co-author via `document_authors`. Requires `copyrightConfirmed: true` in request body; sets `copyright_confirmed_at = NOW()` on the new version row (Phase 36). **Copies all `document_annotations` and `annotation_votes` from source to new version** (annotations are carried forward so version-aware threads and navigation work). Does NOT copy `message_threads`. (Phase 7h, updated 26a, annotation copy Phase 31d, copyright Phase 36) |
| POST | `/documents/:id/edit` | Required | ❌ REMOVED (Phase 22a) — formerly edited document body text with annotation offset adjustment |
| GET | `/versions/:documentId/history` | Guest OK | Get all versions in a document's lineage (Phase 7h) |
| POST | `/documents/favorite/toggle` | Required | Toggle favorite on a document within a corpus (returns `{ favorited: bool }`) |
| GET | `/:corpusId/document-favorites` | Required | Get list of favorited document IDs for a corpus |
| POST | `/allowed-users/leave` | Required | Self-remove from corpus membership; also removes subscription (Phase 26b) |
| POST | `/:id/transfer-ownership` | Owner only | Transfer corpus ownership to an existing allowed user. Body: `{ newOwnerId }`. New owner removed from `corpus_allowed_users` (now implicitly a member as owner); old owner added to `corpus_allowed_users`. (Phase 35b) |
| POST | `/documents/:documentId/invite/generate` | Author only | Generate an invite token for a document's co-author group (Phase 26a) |
| POST | `/documents/invite/accept` | Required | Accept an invite token to become a co-author (Phase 26a) |
| GET | `/documents/:documentId/authors` | Guest OK (count) / Author (list) | Get co-author count (all users) or full list with usernames (authors only) (Phase 26a) |
| POST | `/documents/:documentId/authors/remove` | Author only | Remove a co-author from the document; cannot remove the original uploader (Phase 26a) |
| POST | `/documents/:documentId/authors/leave` | Required | Leave as a co-author (self-removal; uploader cannot leave) (Phase 26a) |
| GET | `/orphaned-documents` | Required | Get current user's orphaned documents (Phase 9b) |
| POST | `/rescue-document` | Required | Rescue an orphaned document into a corpus (Phase 9b) |
| POST | `/dismiss-orphan` | Required | Permanently delete an orphaned document (Phase 9b) |
| ~~GET~~ | ~~`/:id/children`~~ | ~~Guest OK~~ | ~~Get direct sub-corpuses of a corpus (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~GET~~ | ~~`/:id/tree`~~ | ~~Guest OK~~ | ~~Get full recursive tree of sub-corpuses (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~POST~~ | ~~`/:parentId/add-subcorpus`~~ | ~~Owner/Allowed~~ | ~~Set an existing corpus as a sub-corpus of a parent (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~POST~~ | ~~`/:parentId/remove-subcorpus`~~ | ~~Owner/Allowed~~ | ~~Remove a sub-corpus link — corpus becomes top-level (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |

### Documents (`/api/documents`) — ✅ IMPLEMENTED (Phase 7a, extended Phase 17a, 21c, 31d)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:id` | Guest OK | Get a single document with full body text + list of corpuses it belongs to |
| GET | `/tags` | Guest OK | List all document tags with usage counts. Filtered by `ENABLED_DOCUMENT_TAGS` env var if set. |
| POST | `/tags/create` | — | ⛔ Returns 410 Gone (Phase 27e) — tag creation now admin-controlled |
| POST | `/tags/assign` | Required | Assign a tag to a document. Body: `{ documentId, tagId }`. Returns 409 if already assigned. |
| POST | `/tags/remove` | Required | Remove a tag from a document. Body: `{ documentId, tagId }`. Permission: tag assigner or corpus owner. |
| GET | `/:id/tags` | Guest OK | Get all tags for a specific document |
| GET | `/:id/version-chain` | Guest OK | Get all documents in the same version lineage — lightweight (no body text). Returns `id, title, version_number, uploaded_by, created_at` ordered by `version_number`. (Phase 21c) |
| GET | `/:id/version-annotation-map` | Guest OK | Get annotation fingerprints across all versions in a document's lineage. Returns `{annotations: [{document_id, version_number, edge_id, quote_text}, ...]}`. Uses bidirectional recursive CTE (chain_up + chain_down). Powers version navigation buttons on annotation cards. (Phase 31d) |
| POST | `/:id/delete` | Uploader only | Permanently delete a single document version. Cascades to annotations, messages, favorites, cache, corpus_documents. Downstream versions referencing this one get `source_document_id = NULL`. Returns `{ deletedDocumentId }`. (Phase 35a) |

### Moderation (`/api/moderation`) — ✅ IMPLEMENTED (Phase 16)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/flag` | Required | Flag an edge as spam/vandalism. Hides it (`is_hidden = true`) only after 10 distinct flags (Phase 30k). One flag per user per edge. |
| POST | `/unflag` | Required | Remove your flag from an edge. Added in Phase 30k. |
| GET | `/hidden/:parentId?path=...` | Required | Get hidden children for a parent in context. Returns flag counts, hide/show vote counts, user vote status, and `isAdmin` flag. |
| POST | `/vote` | Required | Vote 'hide' or 'show' on a hidden edge. Upsert — changes existing vote if present. |
| POST | `/vote/remove` | Required | Remove your hide/show vote on a hidden edge. |
| POST | `/comment` | Required | Add a moderation comment on a hidden edge. Max 2000 chars. Multiple comments per user allowed. |
| GET | `/comments/:edgeId` | Required | Get all moderation comments for a hidden edge, ordered by creation time. |
| POST | `/unhide` | Admin only | Restore a hidden edge (sets `is_hidden = false`). Admin determined by `ADMIN_USER_ID` environment variable. |

### Info Pages (`/api/pages`) — ✅ IMPLEMENTED (Phase 30g)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:slug/comments` | Guest OK (optionalAuth) | Get comments for an info page. Returns tree structure: top-level comments with nested `replies` array. Sorted by vote count desc, then chronologically. Valid slugs: `using-orca`, `constitution`, `donate`. If authenticated, includes `user_voted` boolean per comment. |
| POST | `/:slug/comments` | Required | Add a comment to an info page. Body: `{ body, parentCommentId? }`. Max 2000 chars. Cannot reply to a reply (1-level nesting enforced). Auto-votes for the creator (starts at vote_count = 1). |
| POST | `/comments/:commentId/vote` | Required | Toggle vote on a page comment. If already voted, removes vote; otherwise adds vote. Returns `{ voted, voteCount }`. |

**Frontend API methods** (`pagesAPI` in `api.js`):
- `pagesAPI.getComments(slug)` — GET `/:slug/comments`
- `pagesAPI.addComment(slug, body, parentCommentId)` — POST `/:slug/comments`
- `pagesAPI.toggleCommentVote(commentId)` — POST `/comments/:commentId/vote`

---

## File Structure


```
orca/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js       # PostgreSQL connection pool
│   │   │   ├── migrate.js        # Database schema creation
│   │   │   ├── check-dormancy.js # Background job: marks tabs dormant after 30 days (Phase 8)
│   │   │   ├── seed-diff-test.js      # Test data seeder for Phase 14a diff modal
│   │   │   ├── seed-diff-test-clean.js # Cleanup script for diff test data (--cleanup to remove)
│   │   │   ├── seed-flip-test.js      # Test data seeder for flip view testing
│   │   │   └── seed-test-data.js      # Comprehensive full-stack test data seeder
│   │   ├── controllers/
│   │   │   ├── authController.js # Auth logic (phone OTP: sendCode, verifyRegister, verifyLogin, logoutEverywhere, getMe)
│   │   │   ├── conceptsController.js # Concept CRUD operations
│   │   │   ├── corpusController.js  # Corpus & document CRUD (Phase 7a)
│   │   │   ├── moderationController.js # Moderation: flag, unflag, vote, comment, unhide (Phase 16, updated 30k)
│   │   │   ├── pagesController.js   # Informational page comments CRUD (Phase 30g)
│   │   │   └── votesController.js # Voting logic
│   │   ├── middleware/
│   │   │   └── auth.js           # JWT verification middleware
│   │   ├── utils/
│   │   │   ├── documentLineage.js # getRootDocumentId (recursive CTE) + isDocumentAuthor helper (Phase 26a)
│   │   │   └── phoneAuth.js       # Phone normalization (E.164) + Twilio Verify wrappers (Phase 32a) + computePhoneLookup HMAC (Phase 33e)
│   │   ├── routes/
│   │   │   ├── auth.js           # Auth routes
│   │   │   ├── concepts.js       # Concept routes
│   │   │   ├── corpuses.js       # Corpus & document routes (Phase 7a)
│   │   │   ├── moderation.js     # Moderation routes (Phase 16, updated 30k — added /unflag)
│   │   │   ├── documents.js     # Document routes — standalone doc + tags (Phase 7a, 17a)
│   │   │   ├── pages.js          # Informational page comment routes (Phase 30g)
│   │   │   └── votes.js          # Vote routes
│   │   └── server.js             # Express app setup
│   ├── .env                      # Environment variables (DO NOT COMMIT)
│   ├── .env.example              # Template for environment variables
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── AddConceptModal.jsx # Modal for creating concepts (legacy, still available)
    │   │   ├── AcceptInvite.jsx    # Invite acceptance page — /invite/:token route (Phase 7g)
    │   │   ├── AnnotationPanel.jsx  # Text selection → concept search → annotation creation (Phase 7d, updated 26c — layer prop removed)
    │   │   ├── AppShell.jsx         # Unified tab bar shell (header + saved tabs + graph tabs + content area)
    │   │   ├── Breadcrumb.jsx      # Navigation breadcrumb (with names)
    │   │   ├── ConceptGrid.jsx     # Grid display for concepts (Phase 14a: right-click context menu for diff; Phase 16c: flag option)
    │   │   ├── ConceptAnnotationPanel.jsx # Cross-context annotation + web links panel for concept page right column (Phase 27a-c)
    │   │   ├── CorpusDetailView.jsx # Corpus detail page — Browse overlay with corpus header + shared sub-components (Phase 7a, updated 35a)
    │   │   ├── CorpusDocumentList.jsx # Shared: document list — My/All sections, search, cards, tags, favorites, delete (Phase 35a extraction)
    │   │   ├── CorpusUploadForm.jsx   # Shared: document upload — drag-and-drop, file picker, add existing (Phase 35a extraction)
    │   │   ├── CorpusMembersPanel.jsx # Shared: members panel — invite tokens, member list, leave button, transfer ownership (Phase 35a extraction, updated 35b)
    │   │   ├── CorpusListView.jsx   # Corpus browsing and creation UI (Phase 7a)
    │   │   ├── CorpusTabContent.jsx # Inline corpus tab — persistent tab with doc viewer + annotations + shared sub-components (Phase 7c, updated 35a)
    │   │   ├── DiffModal.jsx       # Concept diff modal — side-by-side child comparison with Shared/Similar/Unique grouping, drill-down navigation with breadcrumbs (Phase 14a+14b)
    │   │   ├── DocInviteAccept.jsx  # Document co-author invite acceptance page — /doc-invite/:token route (Phase 26a)
    │   │   ├── DocumentView.jsx     # Full document text viewer (Phase 7a)
    │   │   ├── FlipView.jsx        # Flip view to show parent contexts (Phase 2, updated 30d — link votes use ▲ triangle icon)
    │   │   ├── HiddenConceptsView.jsx # Hidden concepts review panel — flag counts, hide/show voting, comments, admin unhide (Phase 16c)
    │   │   ├── InfoPage.jsx          # Informational page with community comments (Phase 30g) — Using Orca, Constitution, Donate
    │   │   ├── OrphanRescueModal.jsx # Orphan rescue modal — rescues allowed users' orphaned documents (Phase 9b)
    │   │   ├── SavedPageOverlay.jsx # Standalone Saved Page with corpus tabs (Phase 7c; dormancy UI removed Phase 30a)
    │   │   ├── ProtectedRoute.jsx  # Auth route wrapper
    │   │   ├── SearchField.jsx     # Combined Add/Search field with dropdown
    │   │   ├── LoginModal.jsx     # Phone OTP login/register modal (Phase 32c) — centered overlay with Log In/Sign Up tabs, two-step phone+code flow
    │   │   ├── SidebarDndContext.jsx # Drag-and-drop context for sidebar reordering (Phase 19c, @dnd-kit)
    │   │   ├── SwapModal.jsx       # Swap vote modal with sibling list
    │   │   └── VoteSetBar.jsx     # Vote set color swatches and filtering bar
    │   ├── contexts/
    │   │   └── AuthContext.jsx     # Global auth state
    │   ├── pages/
    │   │   ├── Login.jsx           # Login page — 💤 UNUSED (Phase 28f, replaced by LoginModal)
    │   │   ├── Register.jsx        # Registration page — 💤 UNUSED (Phase 28f, replaced by LoginModal)
    │   │   ├── Root.jsx            # Root concepts page (now renders inside AppShell graph tabs)
    │   │   ├── Concept.jsx         # Concept view with children (now renders inside AppShell graph tabs)
    │   │   ├── Saved.jsx           # Legacy Saved Page (kept as backup, no longer routed)
    │   │   └── SavedTabContent.jsx # Saved tab content (renders inside AppShell saved tabs)
    │   ├── services/
    │   │   └── api.js              # Axios API client
    │   ├── App.jsx                 # Main app with routing
    │   ├── main.jsx                # React entry point
    │   └── index.css               # Global styles
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Environment Configuration

### Backend `.env` File

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=concept_hierarchy
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Server
PORT=5000
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=90d

# Phone Lookup Key (HMAC-SHA256 for O(1) phone lookup, Phase 33e)
PHONE_LOOKUP_KEY=change_me_to_a_random_hex_string

# Twilio (Phone OTP, Phase 32)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_VERIFY_SERVICE_SID=your_twilio_verify_service_sid

# Admin & Feature Control
ADMIN_USER_ID=1
ENABLED_ATTRIBUTES=value,action,tool,question
ENABLED_DOCUMENT_TAGS=preprint,protocol,grant application,review article,dataset,thesis,textbook,lecture notes,commentary
```

**Important:** The `.env` file is gitignored. Use `.env.example` as template.

---

## Development Workflow

### Starting the Application

**Backend:**
```bash
cd backend
npm install
npm run migrate  # First time only
npm run dev      # Starts on port 5000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev      # Starts on port 3000
```

**Access:** Open browser to `http://localhost:3000`

### Stopping the Application

Press `Ctrl+C` in both terminal windows.

---

## Known Technical Issues & Workarounds

### 1. bcrypt on ARM64 Windows
**Issue:** bcrypt package doesn't compile on ARM64 Windows (Surface devices, etc.)

**Solution:** Using bcryptjs instead
- Edit `backend/package.json`: Change `"bcrypt"` to `"bcryptjs"`
- Edit `backend/src/controllers/authController.js`: Change import to `require('bcryptjs')`

### 2. Node Modules Cleanup Errors
**Issue:** Sometimes npm install shows EPERM errors during cleanup

**Solution:** These are warnings, not errors. Installation usually completes successfully. If it fails:
```bash
rmdir /s /q node_modules
npm cache clean --force
npm install
```

### 3. Path Array Includes Current Concept
**Issue:** The `path` array returned from the API includes the current concept at the end

**Example:**
- Viewing concept ID 3
- API returns: `path: [1, 2, 3]`
- For breadcrumbs, we need to exclude the last element: `path.slice(0, -1)`

**Impact:** Breadcrumb click handling needs to account for this (subtract 1 from clicked index)

### 4. Root Concepts Created Before Root Edge Feature
**Issue:** Root concepts created before the root edge feature was added (Feb 21, 2026) do not have root edges, so voting won't work on them.

**Solution:** Run this SQL to backfill root edges for existing root concepts:
```sql
INSERT INTO edges (parent_id, child_id, graph_path, created_by)
SELECT NULL, c.id, '{}', c.created_by
FROM concepts c
WHERE c.id NOT IN (SELECT DISTINCT child_id FROM edges);
```
New root concepts created after this feature automatically get root edges.

### 5. pg_trgm Extension Required for Search

### 6. Vite Restart Required After Adding New Files
**Issue:** When a brand new `.jsx` file is added to the project (e.g., `Saved.jsx`), Vite's hot module replacement may not pick it up. Navigating to the new route redirects to `/` instead.

**Solution:** Stop the frontend dev server (`Ctrl+C`) and restart it:
```bash
cd frontend
npm run dev
```
This only needs to be done once per new file. Edits to existing files are picked up automatically.
**Issue:** The Combined Add/Search field uses PostgreSQL's `pg_trgm` extension for fuzzy matching. If this extension is not enabled, search queries will fail with a database error.

**Solution:** Run this SQL once against your database (requires superuser privileges):
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_concepts_name_trgm ON concepts USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_concepts_name_lower ON concepts (LOWER(name));
```
This only needs to be done once per database. If you drop and recreate the database, you'll need to run it again.

### 7. Edge Browser Mini Menu Blocks Annotation Text Selection
**Issue:** Microsoft Edge's built-in "mini menu" (Ask Copilot, Copy, Search) pops up whenever text is selected, overlapping Orca's annotation toolbar. This makes it difficult to click the "Annotate" button after selecting text. Chrome does not have this issue.

**Solution (per-user browser setting — not fixable in code):**
- In Edge, go to **Settings → Appearance → Context Menus**
- Toggle OFF **"Show mini menu when selecting text"**
- Alternatively, add just the Orca site to the "Disallowed sites" list to disable only for Orca: Settings → Appearance → Context Menus → "Mini menu is disabled for these sites" → Add → enter the Orca URL

**Note:** This affects all Edge users. Consider mentioning this in onboarding documentation or a help tooltip if Edge users report annotation difficulty.

---

## Current Feature Status

### ✅ Completed (MVP - Phase 1)

- **User Authentication**
  - Registration with username, email, password
  - Login with JWT tokens
  - Protected routes
  - Auth context for global state

- **Root Concepts**
  - View all root concepts
  - Create new root concepts
  - Display child count on concept cards

- **Hierarchical Navigation**
  - Click into concepts to view children
  - Breadcrumb navigation with concept names
  - Breadcrumb tooltips for long names
  - Path-based routing with query parameters

- **Context-Aware Children**
  - Each concept can have different children depending on parent path
  - Graph path stored as PostgreSQL array
  - Cycle prevention (concept can't appear twice in same graph)

- **Voting System (Saves)**
  - Save child concepts (vote)
  - Save counts displayed
  - Visual indication of user's saves
  - Children sorted by save count
  - Save removal

- **Concept Reuse**
  - Same concept can exist in multiple graphs
  - Creating child checks if concept name exists (case-insensitive)
  - Reuses existing concept if found

### ✅ Completed (Phase 2)

- **Flip View**
  - Backend endpoint to get all parent contexts for a concept
  - FlipView component displays all parent contexts as cards in a grid layout
  - Toggle button in header to switch between children view and flip view
  - Two modes: contextual (with back button) and exploratory (for future search)
  - Shows save counts per parent context (inline next to parent name)
  - Shows "Saved" badge when user has saved that edge
  - Click parent card to navigate to that concept in that graph context
  - Full path displayed on hover tooltip for any parent card

- **Flip View Card Display**
  - Each parent context rendered as an individual card in a flat grid, sorted by save count descending (from backend query)
  - Each card shows: path above the immediate parent (italic, smaller text), then the immediate parent name (black, larger text), save count, and saved badge
  - Root-level parents (nothing above them) show only the parent name — no redundant path text
  - Full path displayed on hover tooltip for any card
  - Concept names for path segments resolved via existing `getConceptNames` batch endpoint

- **Display Totals**
  - Root page displays total registered users at the top (Note: Phase 8 dormancy operates at the save-vote level, not user-level — dormant users' votes are excluded from counts but the total user count is unaffected)
  - Concept view displays the current concept's save total next to the concept name (edge save count in current path context)
  - Works for both root concepts (via root edge lookup) and non-root concepts (via parent edge lookup)
  - Root concepts sorted by save count descending on root page

- **Root Concept Voting (Saves)**
  - Root concepts now have edges (`parent_id = NULL`, `graph_path = '{}'`) created automatically when a root concept is created
  - Saves attach to root edges the same as any other edge — unified save model
  - Root page ConceptGrid shows save buttons and counts, same as concept child views
  - Existing root concepts without edges need backfilling (see SQL in Known Technical Issues)

- **Browser Back Button Integration**
  - Flip View state is stored in the URL as `&view=flip` query parameter instead of React state
  - Toggling Flip View pushes a new browser history entry via `navigate()`
  - Browser back button naturally returns from Flip View to children view
  - FlipView "Back" button uses `navigate(-1)` for consistent behavior
  - Flip View state survives page refresh (URL preserves the view mode)

- **Combined Add/Search Field**
  - Persistent `SearchField.jsx` component fixed at bottom-right of both Root and Concept pages
  - Placeholder text: "Add / Search..."
  - Debounced input (300ms) triggers `GET /api/concepts/search` endpoint
  - Two-tier matching via pg_trgm: exact/substring matches shown first, then trigram similarity matches labeled with "similar" badge
  - Results that are already children in the current context show a "child" badge
  - Clicking any search result navigates to decontextualized Flip View (`/concept/{id}?view=flip`)
  - On concept pages (children view only): "Add [name] as child" option appears at top of dropdown when typed text isn't already a child
  - On root page: "Create [name] as root concept" option appears when typed text doesn't match any existing concept
  - Replaces the old floating `+ Add Child Concept` and `+ Add Root Concept` buttons
  - Dropdown closes on Escape key or clicking outside
  - pg_trgm extension required (one-time `CREATE EXTENSION IF NOT EXISTS pg_trgm` on database)
  - GIN trigram index on `concepts.name` for fast fuzzy search

---

## Known Bugs

### Fixed
- ✅ Breadcrumb navigation (immediate parent click works now)
- ✅ Breadcrumb concept names (shows names instead of IDs)
- ✅ Child count on concept cards
- ✅ Flip View path grouping trie algorithm was buggy (divergence at trie root collapsed all parents into a single ungrouped set). Resolved by removing trie entirely in favor of flat vote-sorted cards — simpler and better UX.
- ✅ Decontextualized Flip View (via search) incorrectly showed breadcrumb, Children View toggle button, and hid the Back button. Fix: detect decontextualized mode when URL has `view=flip` but no `path` param. In this mode, breadcrumb is replaced with a simple title (`"ConceptName — all parent contexts"`), the toggle button is hidden, and the Back button in FlipView.jsx now shows in both `contextual` and `exploratory` modes (changed from `mode === 'contextual' && onBack` to just `onBack`).

### Current
- None reported ✅

### Fixed (Phase 17 — via Claude Code)
- ✅ **Subscribed corpus tabs disappear from sidebar after auto-grouping.** `handleOpenConceptTab` auto-groups corpus tabs with spawned concept tabs (sets `group_id`). `ungroupedCorpusTabs` filtered these out, and `renderSidebarGroup` only rendered `graphTabs` — grouped corpus tabs vanished. Additionally, `renderSidebarCorpusItem` used `depth === 0` as proxy for "is subscribed", breaking at `depth=1` inside a group. Fix: `renderSidebarGroup` now renders both corpus and graph members. Replaced `depth === 0` with `corpusTabs.some(t => t.id === tab.id)`. Added overlay-clearing (`setCorpusView(null)`, `setSavedPageOpen(false)`) to corpus tab click. **Learning:** Never use render depth as proxy for semantic identity — use the authoritative data source. See Architecture Decisions #147, #150.
- ✅ **"Subscribe to top-level corpus" error when opening documents from sub-corpus browse.** `onOpenDocument` from `CorpusDetailView` passed the sub-corpus ID to `handleSubscribeToCorpus`. Backend correctly rejects subscribe for sub-corpuses. Fix: `CorpusDetailView` passes `parent_corpus_id`. AppShell walks up parent chain to find top-level corpus, with short-circuit against `corpusTabs`. Error fallback returns early. **Learning:** Async fallback paths must abort, not proceed with invalid inputs. See Architecture Decision #148.
- ✅ **Graph tab click does nothing while corpus browse overlay is open.** `renderSidebarGraphItem` onClick only called `setActiveTab` without clearing `corpusView`. Fix: added `setCorpusView(null)` and `setSavedPageOpen(false)`. **Learning:** Three mutually exclusive content areas must be explicitly managed on every navigation action. See Architecture Decision #146.
- ✅ **CorpusDetailView missing version/draft badges on document cards.** Simpler template than `CorpusTabContent`. Fix: added version badge, draft badge, dashed border for drafts. **Learning:** Both document card views must stay in sync. See Architecture Decision #149.
- ✅ **CorpusDetailView missing tag pills on document cards.** Backend returned tags but view never rendered them. Fix: added tag pill display.
- ✅ **No tag filtering in WebLinksView Document Annotations.** Tags showed as read-only pills but couldn't filter. Fix: added `annotationTagFilter` state, filter bar, and corpus/document-level filtering logic.

### Fixed (Phase 7h/7i)
- ✅ **Version creation failed with "Document not found in this corpus" when creating from version history.** When viewing a document version reached via version history in a corpus tab, and the version was only in a different corpus, `createVersion` rejected the request because it required the source document to be in the current corpus. Fix: `createVersion` now only checks that the document exists (not that it's in the requesting corpus). The new version is auto-added to ALL corpuses the source document belongs to, plus the current corpus.
- ✅ **New document versions only added to the requesting corpus.** When a document existed in multiple corpuses, creating a new version only added it to the corpus the user was currently in. Fix: `createVersion` now queries `corpus_documents` for all corpuses the source belongs to and adds the new version to all of them via `ON CONFLICT DO NOTHING`.
- ✅ **Concept link click opened children view instead of decontextualized Flip View.** `handleOpenConceptTab` in AppShell had `view_mode` hardcoded to `'children'`. Fix: added optional 6th `viewMode` parameter. Additionally, the wrapper arrow function on `CorpusTabContent`'s `onOpenConceptTab` prop (line 909 in AppShell) was only destructuring 4 parameters, silently dropping the `viewMode` argument. Fix: wrapper now passes `viewMode` through. **Learning:** When wrapping callbacks with arrow functions to inject extra parameters (like `sourceCorpusTabId`), always pass through all remaining parameters to avoid silently dropping new ones added later.

### Fixed (Phase 7d-3/4)
- ✅ **Annotations not visible when opening documents from Corpuses overlay.** The Corpuses button (📚) in the header opens a browsing overlay that uses `CorpusDetailView` → `DocumentView`. The `DocumentView` component was built in Phase 7a as a basic text viewer with zero annotation support — annotations were only added to `CorpusTabContent` (corpus tab document viewer) in Phase 7d-2. Fix: clicking a document in `CorpusDetailView` now subscribes to the corpus (if needed), switches to the corpus tab, and auto-opens the document there via `pendingDocumentId`. The `DocumentView` overlay is no longer used for document opens from the corpus detail view. **Learning:** Two separate document viewing paths existed (overlay `DocumentView` vs tab `CorpusTabContent`). All document viewing should go through `CorpusTabContent` to ensure annotation support.
- ✅ **Annotations sometimes missing on first document visit (race condition).** In `CorpusTabContent.handleOpenDocument`, `loadAnnotations(docId)` was called but not awaited. The `finally` block set `docLoading = false` before annotations finished loading, so the document sometimes rendered with an empty annotation array on first view. Fix: `await loadAnnotations(docId)` so the document and annotations both load before the loading spinner disappears.
- ✅ **Clicking a document name in External Links page opened the corpus tab but not the document.** Both corpus name and document name clicks called the same `handleCorpusClick` which only subscribed/switched to the corpus tab's document list. Fix: document title click now passes `doc.documentId` to `onOpenCorpusTab(corpusId, corpusName, documentId)`, and the `pendingDocumentId` mechanism auto-opens that document in the corpus tab.

### Fixed (Phase 7b misc)
- ✅ **Stray `}` in Concept.jsx (line 889)** caused Vite warning: `The character "}" is not valid inside a JSX element`. Extra closing brace after `FlipView` conditional render block. Fixed by removing the extra `}`. Harmless warning (app still ran) but cleaned up for correctness.

### Fixed (Phase 7d)
- ✅ **`document` variable shadowing in CorpusTabContent.jsx:** React state variable named `document` (the Orca document object) shadowed the browser's global `document`. Calling `document.createRange()` in `getTextOffsetInElement` failed with "Cannot read properties of null (reading 'createRange')" because it was calling `.createRange()` on the React state (null or a plain object), not the browser DOM. Fix: use `window.document.createRange()`.
- ✅ **`getConceptNames` response format mismatch in AnnotationPanel and CorpusTabContent:** The `getConceptNames` batch endpoint returns `{ concepts: [{ id, name }, ...] }` (array of objects), but the code was treating the response as `{ names: { id: name } }` (a direct ID→name lookup map). This caused all ancestor path names to render as `#1`, `#2`, etc. (the fallback for missing names). Fix: convert the concepts array into a proper `{ id: name }` lookup map before using it.

### Fixed (Phase 5 misc)
- ✅ **FlipView alt parent click did not navigate in tab mode (pre-existing from Phase 5c).** `FlipView.handleParentClick` used URL-based `navigate()` to go to `/concept/{id}?path=...`, but since Phase 5c everything runs inside AppShell's tab system — URL navigation doesn't update the active graph tab. Fix: `Concept.jsx` now passes an `onParentClick` callback to `FlipView.jsx` which calls `navigateInTab()` for proper in-tab navigation with nav history support. Falls back to URL navigation in standalone mode.
- ✅ **SearchField showed "child:undefined" badges (pre-existing).** The `childAttributes` array from the backend contains raw strings (e.g., `"action"`) but `SearchField.jsx` was treating them as objects with `.attribute_name` property. Fix: handle both string and object formats with `typeof a === 'string' ? a : a.attribute_name`.

### Fixed (Phase 5c)
- ✅ **Clicking a root concept only updated the tab label but didn't navigate into it.** Root was sending `tabType`/`conceptId` (camelCase) via `onNavigate`, but AppShell was spreading those directly onto tab objects and then checking `tab.tab_type`/`tab.concept_id` (snake_case) — so the render condition never changed. Fix: `handleGraphTabNavigate` in AppShell now normalizes camelCase keys to snake_case before applying to local state.
- ✅ **Nav history was lost when switching tabs.** AppShell was rendering only the active graph tab, so inactive tabs unmounted and lost their `navHistory` state. Fix: all graph tabs are now rendered simultaneously; inactive ones are hidden with `display: none` (hide-not-unmount).
- ✅ **Concept component remounted on every within-tab navigation**, wiping `navHistory`. The `key` prop on `<Concept>` included `concept_id` and `path`, causing a full remount on each navigation. Fix: key is now just `graph-${tab.id}`.
- ✅ **Back button didn't appear after searching from root page.** When a search result was clicked from root, AppShell switched from rendering Root to Concept (fresh mount), so `navHistory` started empty and the back button was hidden. Fix: `navHistory` is initialized with a root entry when Concept mounts with `initialViewMode === 'flip'` and no path.
- ✅ **Tab label didn't update to "Root" when navigating back to root.** `navigateBack` wasn't sending a `label` field when popping back to a root entry. Fix: `navigateBack` now sends `label: 'Root'` when `prev.conceptId` is null.
- ✅ **Closing the last graph tab created two Root tabs.** `createDefaultGraphTab` used `setGraphTabs(prev => [...prev, newTab])`, but `prev` still contained the stale (just-deleted) tab due to React's batched state updates. Fix: use `setGraphTabs([newTab])` to replace the array entirely since we know all graph tabs are gone.
- ✅ **"Open in new window" for saved tabs pointed to a non-existent `/saved-standalone` route.** Fix: removed the option from saved tab context menu; saved tabs now show only "Remove tab and unsave concepts" (when 2+ exist) or "No actions available" (last tab).

### Fixed (Phase 20)
- ✅ **Duplicate concept names in annotation path display in `DecontextualizedDocView.jsx`.** `graph_path` already includes the parent concept ID as its last element, so `ancestorNames` already contained the parent name — but the code was pushing `parentName` again, doubling it. Fix: removed the extra `push` of `parentName`/`parent_id` on lines 85–90. Same bug had been fixed earlier in `CorpusTabContent.jsx` but not in the decontextualized view.

### ✅ Completed (Phase 3)

- **Attribute System**
  - `attributes` table with four seeded values: action, tool, value, question
  - `attribute_id` column added to `edges` (NOT NULL, with foreign key to attributes)
  - All existing edges migrated to `[action]` attribute
  - Unique constraint updated to include attribute: `UNIQUE(parent_id, child_id, graph_path, attribute_id)`
  - New API endpoint: `GET /api/concepts/attributes` returns available attributes
  - `getConceptWithChildren` returns `currentAttribute` (attribute of the concept in its current path context)
  - All queries (children, parents, root concepts) return `attribute_id` and `attribute_name`
  - Search results include `childAttributes` array showing which attributes a concept already has in the current context

- **Attribute Display (Square Brackets Everywhere)**
  - ConceptGrid cards show `Name [attribute]` for every concept
  - Concept page header shows `Name [attribute]` with attribute in gray
  - Breadcrumb shows `[attribute]` on the current concept
  - Flip View parent cards show `[attribute]` after parent name
  - Search results show which attribute(s) a child already has (e.g., "child: [action]")

- **Two-Step Creation Flow with Attribute Picker**
  - Creating a concept (root or child) is now two steps: (1) click add/create, (2) pick attribute
  - Four attribute buttons appear in the search dropdown: `[action]`, `[tool]`, `[value]`, `[question]`
  - Both "Add as child" and "Create as root concept" flows use the same picker
  - Backend validates `attributeId` is required and exists

- **255-Character Name Validation**
  - `maxLength={255}` on SearchField input prevents typing beyond limit
  - Backend validates name length and returns error if > 255 characters
  - Database column `VARCHAR(255)` enforces at storage level

- **Migration Safety**
  - `migrate.js` uses IF NOT EXISTS checks throughout — safe to re-run
  - Backfill query only updates edges where `attribute_id IS NULL`
  - Old unique constraint dropped only if it exists; new constraint added only if it doesn't

---

### ✅ Completed (Phase 4)

The following Phase 4 features have been implemented.

- **Full-Path Save Model (No Double Counting)**
  - Saving a concept saves the full path above it — every edge from root to the saved concept gets one save from that user
  - Save count on any edge = number of distinct users who have that edge as part of their saved tree
  - **No double counting:** Each user contributes at most 1 save per edge, regardless of how many branches below it they've saved
  - Uses `ON CONFLICT DO NOTHING` to skip existing votes when saving path edges
  - Save totals always reflect what users see on their Saved Pages — no gaps, full context preserved

- **Cascading Unsave**
  - Unsaving a concept removes saves from that edge AND all descendant edges in that branch
  - Uses PostgreSQL array prefix matching (`graph_path[1:N] = prefix`) to find all descendant edges
  - Handles both root edges and non-root edges correctly when computing descendant paths
  - Save counts on all affected edges are subtracted accordingly

- **Sort Selector (Graph Votes / Newest / Annotations / Top Annotation) — Phase 29c flat row**
  - Available on both Root page and Concept page (children view)
  - **Flat horizontal toggle row** (replaced `<select>` dropdown in Phase 29c) matching the annotation filter style (All | Corpus Members | Author) from CorpusTabContent
  - Four options displayed inline: **Graph Votes | Newest | Annotations | Top Annotation**
  - Active state: #333 background with white text; inactive: white background with #888 text
  - `borderRight: 1px solid #eee` dividers between buttons, outer `border: 1px solid #ddd` with `borderRadius: 4px`
  - Styles: `sortRow`, `sortBtn`, `sortBtnActive` (replaced old `sortSelect`/`sortSelectActive`)
  - Backend accepts optional `sort=new`, `sort=annotations`, or `sort=top_annotation` query parameter on both `/root` and `/:id` endpoints
  - Secondary sort key for saves and new: concept name (alphabetical); for annotations: save count descending then concept name; for top annotation: save count descending then concept name
  - **Sort by Annotations (Phase 11):** Counts distinct documents (across all corpuses) where the child concept appears as an annotation via `document_annotations`. Conditional `LEFT JOIN document_annotations` and `COUNT(DISTINCT da.document_id)` only added when `sort=annotations` to avoid unnecessary join overhead on default queries.
  - **Sort by Top Annotation (Phase 29b):** Uses a `LEFT JOIN LATERAL` subquery to find all annotations on each child's edge via `document_annotations`, count votes per annotation via `annotation_votes`, and take the `MAX` vote count. Returns `top_annotation_votes` in the response. Children with no annotations get `top_annotation_votes = 0` and sort to the bottom. Conditional join pattern matches the existing `sort=annotations` approach. When active, `ConceptGrid.jsx` displays a subtle "Top annotation: N votes" indicator on each child card (only when value > 0).

- **Link Votes (Similarity Votes) — Flip View Only**
  - Available only in contextual Flip View (entered from a specific path)
  - User votes that a parent context is "linked" or helpful relative to the origin context
  - Context-specific: different origin contexts have independent link vote sets
  - Not shown in decontextualized Flip View (from search)
  - **Flip View sorting:** Primary sort is by link vote count (descending). Tiebreaker is the current concept's save count in that parent context (but save count is NOT displayed on the card — it's a hidden tiebreaker). This means Flip View is useful from day one (falls back to save-count ordering when link votes are sparse) and gets better as people use link votes.
  - The origin edge's own card is filtered out in contextual mode (user is already there)
  - 🔗 button on each card toggles link vote; "Linked" badge shows when user has voted
  - Validation prevents linking an edge to itself
  - Verifies both edges exist before creating a link vote

- **Flip View Similarity Percentage (Contextual Mode Only)**
  - In contextual Flip View, each alternative parent card displays a **similarity percentage** comparing direct children
  - Formula: `shared children count / total unique children across both contexts` (Jaccard similarity)
  - Does NOT recurse into subchildren — compares direct children only
  - Displayed at the bottom-right of each alt parent card, next to the link vote section
  - Returns `null` (no display) when both contexts have 0 children
  - **Sort toggle button** cycles through three modes: Sort by Links (default) → Sort by Similarity ↓ (highest first) → Sort by Similarity ↑ (lowest first)
  - Backend computes similarity via `Promise.all` over alt parents, querying direct children of the concept in each context
  - Files changed: `conceptsController.js`, `FlipView.jsx`

- **Move Votes (Side Votes)** — ❌ REMOVED (Phase 20b)
  - User flags a concept as belonging in a different context via "→" button on child cards
  - Move button shows total move vote count (distinct users) next to save button
  - Modal opens with two sections: existing move suggestions (with vote counts, second/un-second buttons) and search field
  - Search results show concept matches; clicking one loads all parent contexts (like Flip View cards)
  - Clicking a context opens a mini graph browser where user can navigate freely
  - "Move here" button when concept already exists as a child at the browsed location
  - "Add here & move" combined action (with attribute picker) when concept doesn't exist at the browsed location
  - Creates edge + places move vote in one click
  - Multiple users can place distinct move votes pointing to different destinations
  - Validation prevents moving an edge to itself, verifies both edges exist
  - `side_votes` table with indexes on `edge_id` and `destination_edge_id`
  - `move_count` returned as a subquery in `getConceptWithChildren` (uses `COUNT(DISTINCT sv.user_id)`)
  - Files changed: `migrate.js`, `votesController.js`, `conceptsController.js`, `votes.js` (routes), `api.js`, `ConceptGrid.jsx`, `Concept.jsx`, new `MoveModal.jsx`

- **Swap Votes (Replace Votes)**
  - User flags a concept as "should be replaced by a sibling" via ⇄ button on child cards
  - Swap button shows total swap vote count (distinct users) next to move button: `→3 ⇄2`
  - Modal opens showing two sections: existing swap suggestions (sorted by vote count, with second/un-second buttons) and remaining siblings (with "Swap" button)
  - Siblings are all other children of the same parent in the same graph context (same `parent_id` and `graph_path`)
  - Backend validates sibling relationship before accepting a swap vote — rejects if edges don't share the same parent and path
  - Multiple users can point to different replacement siblings
  - Purely informational — no automatic removal (append-only model)
  - `replace_votes` table with indexes on `edge_id` and `replacement_edge_id`
  - `swap_count` returned as a subquery in `getConceptWithChildren` (uses `COUNT(DISTINCT rv.user_id)`)
  - Files changed: `migrate.js`, `votesController.js`, `conceptsController.js`, `votes.js` (routes), `api.js`, `ConceptGrid.jsx`, `Concept.jsx`, new `SwapModal.jsx`

- **Vote Set Visualization (Layer 1: Swatches + Dots + Basic Filtering)**
  - New backend endpoint: `GET /api/concepts/:id/votesets?path=...` computes identical vote sets
  - SQL uses CTEs: first builds per-user sorted arrays of saved child edge IDs, then groups users by identical arrays
  - **No minimum threshold:** Solo vote sets (1 user) get a color swatch, so a user can always see and interact with their own vote pattern. This was changed in Phase 5f to support child ranking — users need to see their own swatch to rank their children.
  - Returns: `voteSets` (array of sets with setIndex, edgeIds, childIds, userCount, userIds, voteSetKey), `edgeToSets` (lookup mapping each edge_id to its set indices), `userSetIndex` (which set the current user belongs to, or null), and `parentEdgeId` (the edge connecting this concept to its parent, used as context key for child rankings)
  - New `VoteSetBar.jsx` component displays color swatches at top of Concept page between header and children grid
  - Curated 12-color named palette (Indigo, Teal, Crimson, Goldenrod, Forest, Coral, Slate, Sienna, Plum, Steel, Olive, Rose) — only source of color in the UI per design philosophy
  - Each swatch shows user count; tooltip shows color name and set details
  - **User's own swatch** has a bold dark border (`2px solid #333`) and tooltip includes "Your vote set" prefix for easy identification
  - `ConceptGrid.jsx` updated to accept `edgeToSets` prop and render small colored dots in top-right of each child card
  - Dots use the same color palette via shared `getSetColor()` export from VoteSetBar
  - **Basic filtering:** Clicking a swatch filters to show only children in that set. Clicking multiple swatches shows children in ANY selected set, sorted by number of matching sets (descending) then by save count. ✕ button clears all filters.
  - Filter info text shows "Showing X of Y children matching selected patterns"
  - Vote sets re-fetched whenever concept data reloads (after voting, adding children, etc.) and filters clear on reload
  - No database migration required — computed from existing `votes` and `edges` tables
  - Files changed: `conceptsController.js`, `concepts.js` (routes), `api.js`, `ConceptGrid.jsx`, `Concept.jsx`, new `VoteSetBar.jsx`

- **Vote Set Tiered Display (Layer 2: Toggle for Ranked Sections)**
  - When 2+ swatches are selected, a ☰ toggle button appears in VoteSetBar between the swatches and the ✕ clear button
  - **Default off:** Multi-swatch filtering still shows a flat sorted list by default (sorted by match count descending, then saves) — same behavior as Layer 1
  - **Toggle on:** Activates tiered view, splitting filtered children into labeled sections by match count
  - Section headers use italic serif text (e.g., "In all 3 selected patterns", "In 2 of 3", "In 1 of 3")
  - Within each section, children sorted by save count descending
  - Color dots for ALL sets (including non-selected) remain visible on each child card
  - Filter info text appends " · tiered view" when tiered mode is active
  - `ConceptGrid.jsx` updated to accept optional `tierLabel` prop — renders a styled header above the grid when present
  - Tiered view renders multiple `ConceptGrid` instances (one per tier section) vs one for flat view
  - **Smart cleanup:** Tiered view auto-disables when active sets drop below 2 (via deselecting swatches), and resets when data reloads or filters are cleared
  - ☰ button styling matches Sort by New toggle: dark background when active (#333), light when inactive
  - No backend changes or database migration required — purely frontend logic
  - Files changed: `VoteSetBar.jsx`, `ConceptGrid.jsx`, `Concept.jsx`

- **Vote Set Similarity Grouping (Layer 3: Super-Groups via Hierarchical Clustering)**
  - Backend: `getVoteSets` endpoint now computes super-groups after building individual vote sets
  - **Clustering algorithm:** Agglomerative hierarchical clustering with average-link similarity. Pairwise Jaccard similarity computed between all vote sets' edge ID arrays. Clusters merged iteratively when average inter-cluster similarity exceeds threshold. Deterministic (no randomness) — same input always produces same groups.
  - **Similarity threshold:** 0.5 (50% Jaccard overlap). Two vote sets sharing half or more of their children (by edge ID) get merged into the same super-group. Tunable if needed.
  - **Response shape expanded:** `/votesets` endpoint now returns `superGroups` (array of groups with groupIndex, setIndices, edgeIds) and `edgeToSuperGroups` (lookup mapping edge_id to group indices) alongside existing `voteSets` and `edgeToSets`
  - **Super-group color:** Blended from the first and last member set colors (RGB average). Named as "FirstColor–LastColor" (e.g., "Indigo–Teal"). Displayed as a thin (14px tall) swatch bar above member swatches.
  - **Visual layout:** `VoteSetBar.jsx` now renders two rows — super-group swatches on top (aligned above their member swatches), individual set swatches on bottom. Ungrouped sets appear first on the left, grouped sets appear together in clusters. A spacer div aligns the super-group row above its member cluster.
  - **Group cluster underline:** Grouped individual swatches are wrapped in a div with a `borderBottom` that becomes visible (in the group's blended color) on hover or when the group is active. Gap between grouped swatches is 4px (tighter than the 8px gap between ungrouped sets) to visually reinforce clustering.
  - **Hover behavior:** Hovering a super-group swatch (or its member cluster) sets `hoveredGroupIndex` state in Concept.jsx, which propagates to all `ConceptGrid` instances. Dots on child cards that belong to ANY set in the hovered group receive a glow effect (`boxShadow`) and scale up to 1.3× via CSS transitions.
  - **Group-level filtering:** Clicking a super-group swatch toggles `activeGroupIndices` in Concept.jsx. Active groups expand into their member setIndices for filtering purposes via `getEffectiveActiveSetIndices()` — a union of directly selected sets plus all sets within active groups. This unified effective set drives both flat and tiered filtering.
  - **Tiered toggle integration:** The ☰ tiered toggle appears when the total active filter count (individual sets + groups) is 2 or more. Tiered sections use the effective set count for "In X of Y" headers. Tiered view auto-disables if total filters drop below 2.
  - **Dimming logic:** When any filter is active, swatches not selected (and not part of an active group) dim to 0.35 opacity. Individual swatches within an active group stay at full opacity even if not individually selected.
  - **Clear all:** The ✕ button clears both `activeSetIndices` and `activeGroupIndices`, resets tiered view, and clears hover state.
  - **No database migration required** — super-groups computed from existing vote set data on each request. Caching is implicit: groups only change when vote sets change, which triggers a re-fetch.
  - Files changed: `conceptsController.js` (backend clustering logic), `VoteSetBar.jsx` (super-group row, group cluster layout, new props), `ConceptGrid.jsx` (hover highlighting on dots, new props), `Concept.jsx` (super-group state, group click/hover handlers, effective set computation)

---

### ✅ Completed (Phase 5a)

- **Basic Saved Page**
  - New page at `/saved` route showing all of the current user's saved concepts organized as collapsible trees
  - Trees are grouped by root concept — each root graph the user has any saves in appears as a card
  - Within each tree, children are nested with indentation and vertical connector lines
  - Children sorted by vote count descending within each tree level
  - Root trees sorted by vote count descending
  - "Saved" button added to the header on both Root page and Concept page for easy navigation

- **Tree Display Features**
  - Clickable concept names navigate to the concept in its full path context (correct `path` query parameter generated from edge's `graphPath`)
  - Attributes displayed in square brackets after each concept name (consistent with rest of app)
  - Vote count shown inline on each node as `▲ N`
  - ~~Move vote indicator shown as `→ N` in amber when move votes exist~~
  - Swap vote indicator shown as `⇄ N` in purple when swap votes exist
  - Collapse/expand toggle (▸/▾) on any node that has children
  - "Collapse All" and "Expand All" toolbar buttons
  - Summary text showing total saved edges and graph count

- **Unsave from Saved Page**
  - ✕ button on every node (including root nodes and leaf nodes)
  - Calls the existing `removeVote` endpoint which cascades to all descendants
  - Page refreshes after unsave to reflect the new state

- **Backend: `GET /api/votes/saved` Endpoint**
  - Returns all edges the current user has voted on, with full details: edge ID, parent ID, child ID, child name, graph path, attribute ID/name, total vote count, swap count
  - Also returns a `conceptNames` lookup (ID → name) for all concepts referenced in paths, avoiding N+1 queries
  - Single query with JOINs to votes, edges, concepts, attributes, plus subqueries for move/swap counts
  - No database migration required — reads entirely from existing tables

- **Known Issue (Resolved):** After adding `Saved.jsx` as a new file, Vite's dev server needs to be restarted (`Ctrl+C` then `npm run dev` in the frontend terminal) for the new file to be picked up. This is a one-time thing per new file addition.

- Files changed: `votesController.js` (new `getUserSaves` endpoint), `votes.js` routes (new `GET /saved` route), `api.js` frontend (new `getUserSaves` method), new `Saved.jsx` page, `App.jsx` (new `/saved` route), `Concept.jsx` (added "Saved" button in header), `Root.jsx` (added "Saved" button in header)

---

### ✅ Completed (Phase 5b)

> ⚠️ **Roadmap note:** The saved tabs system built in Phase 5b (`saved_tabs`, `vote_tab_links`, inline tab picker on save) will be retired when Phase 7c is built. Saved tabs will be replaced by a standalone Saved Page with dynamically generated corpus-based tabs. The implementation below documents what was built and is still running in the current codebase.

- **Saved Tabs**
  - New `saved_tabs` database table storing named tabs per user
  - New `vote_tab_links` junction table linking votes to tabs (many-to-many: a vote can appear in multiple tabs)
  - Default "Saved" tab auto-created for each new user at registration time (in `authController.js`)
  - Migration backfills default tab for all existing users and links all their existing votes to it — seamless upgrade from Phase 5a
  - Tab bar UI on the Saved Page below the header, showing all user's tabs with active tab highlighted via bottom border
  - Click a tab to switch — each tab loads its own tree of saves independently
  - Double-click a tab name to rename it inline (press Enter to confirm, Escape to cancel)
  - `+` button at end of tab bar opens an inline input to create a new tab
  - `✕` button appears on the active tab (only when user has 2+ tabs) to delete it
  - Deleting a tab removes vote-tab links; votes that lose their last link are cleaned up (fully deleted)
  - Cannot delete the last remaining tab — backend enforces this

- **Tab-Aware Saving (▲ Button Tab Picker)**
  - When a user has multiple tabs and clicks ▲ to save a concept, a small inline dropdown appears above the button showing "Save to:" with all tab names
  - Clicking a tab name in the dropdown saves to that tab and closes the picker
  - When the user has only one tab, clicking ▲ saves directly to it (no picker shown)
  - Unsaving from the Saved Page removes from the active tab only (`removeVoteFromTab` endpoint); if the vote isn't linked to any other tab, it's fully deleted
  - Regular unsave (from concept children view) still fully deletes the vote and all its tab links

- **Backend: Tab CRUD Endpoints**
  - `GET /api/votes/tabs` — returns user's tabs ordered by `display_order`
  - `POST /api/votes/tabs/create` — creates a new tab with auto-incremented display_order
  - `POST /api/votes/tabs/rename` — renames a tab (validates ownership)
  - `POST /api/votes/tabs/delete` — deletes a tab (must have 2+), cleans up orphaned votes
  - `POST /api/votes/remove-from-tab` — removes a save from a specific tab, cascading to descendants; deletes vote if no tab links remain
  - `GET /api/votes/saved?tabId=N` — filters saved edges to a specific tab via `vote_tab_links` JOIN
  - `POST /api/votes/add` — now accepts optional `tabId` parameter; defaults to user's first tab

- **Architecture: Junction Table Model**
  - Votes remain unique per `(user_id, edge_id)` — a vote is a user's endorsement of an edge
  - `vote_tab_links` is purely organizational — it says which tabs a vote appears in
  - Save counts visible to other users (`COUNT(DISTINCT user_id)`) are completely unaffected by tabs
  - This separation means tabs are a personal organizational tool that doesn't interfere with the collaborative voting system

- Files changed: `migrate.js` (new `saved_tabs` + `vote_tab_links` tables with backfill), `authController.js` (auto-create default tab on registration), `votesController.js` (tab CRUD endpoints, `removeVoteFromTab`, `tabId` on `addVote`, tab-filtered `getUserSaves`), `votes.js` routes (new tab routes + `remove-from-tab`), `api.js` frontend (new tab API methods, `tabId` on `addVote`), `Saved.jsx` (tab bar UI with switch/create/rename/delete, per-tab loading), `ConceptGrid.jsx` (inline tab picker dropdown on ▲ button), `Concept.jsx` (loads user tabs, passes to ConceptGrid, passes `tabId` on vote), `Root.jsx` (same tab support)

---

### ✅ Completed (Phase 5c-1) — Unified Tab Bar Shell

- **AppShell Architecture**
  - New `AppShell.jsx` component wraps the entire authenticated app
  - Single header with app title ("orca"), username, and logout button
  - Unified tab bar below the header containing both Saved tabs and graph tabs
  - All authenticated routes now go through AppShell (no more separate `/`, `/concept/:id`, `/saved` routes)
  - `App.jsx` simplified to: login, register, and `/*` → AppShell

- **Unified Tab Bar Layout**
  - Saved tabs appear on the left (in italic), graph tabs on the right, separated by a thin vertical divider
  - Active tab highlighted with bold text and bottom border
  - "+" button after Saved tabs creates a new named Saved tab (inline input)
  - "+" button after graph tabs opens a new Root graph tab
  - Graph tabs show an ✕ close button; Saved tabs do NOT (deliberate safety — see below)

- **Saved Tab Safety**
  - Saved tabs no longer have a simple ✕ to delete — this was too easy to accidentally unsave all concepts
  - Instead: right-click a saved tab → context menu → "Remove tab and unsave concepts" (with confirmation dialog)
  - Saved tabs can still be renamed via double-click (same as Phase 5b)
  - At least one saved tab must always exist (backend enforces this)

- **Graph Tabs (Persistent)**
  - New `graph_tabs` database table stores each user's open graph tabs with full navigation state
  - Fields: `tab_type` (root/concept), `concept_id`, `path`, `view_mode`, `label`, `display_order`
  - Graph tabs persist across sessions — survive page refresh and logout/login
  - Backend CRUD endpoints: `GET /votes/graph-tabs`, `POST graph-tabs/create`, `POST graph-tabs/update`, `POST graph-tabs/close`
  - Frontend API methods: `getGraphTabs()`, `createGraphTab()`, `updateGraphTab()`, `closeGraphTab()`

- **Right-Click Context Menu**
  - Right-click any tab (Saved or graph) to see a context menu
  - Graph tab options: "Duplicate tab", "Open in new window", "Close tab"
  - Saved tab options: "Remove tab and unsave concepts" (only when 2+ saved tabs); shows "No actions available" when only one saved tab remains
  - Context menu closes on click outside
  - Context menu position clamped to viewport to prevent off-screen overflow

- **Root.jsx & Concept.jsx Refactored for Tab Mode**
  - Both components now accept optional props: `graphTabId`, `onNavigate`, `savedTabs`, etc.
  - When `graphTabId` is provided (tab mode), navigation happens within the tab rather than via URL changes
  - Concept.jsx maintains a `navHistory` stack for in-tab back button functionality
  - Headers removed from Root.jsx and Concept.jsx — AppShell provides the single header
  - Concept.jsx has a breadcrumb sub-header bar for path navigation + flip view toggle

- **SavedTabContent.jsx (New Component)**
  - Extracted from `Saved.jsx` — renders the tree display for a single saved tab
  - Clicking a concept in the tree calls `onOpenConceptTab()` which opens a new graph tab (instead of navigating away)
  - No header — content renders directly inside AppShell's content area

- Files changed: `migrate.js` (new `graph_tabs` table), `votesController.js` (graph tab CRUD: getGraphTabs, createGraphTab, updateGraphTab, closeGraphTab), `votes.js` routes (4 new graph-tab routes), `api.js` frontend (4 new graph-tab API methods), new `AppShell.jsx`, new `SavedTabContent.jsx`, `App.jsx` (simplified routing), `Root.jsx` (removed header, accepts tab props), `Concept.jsx` (removed header, accepts tab props, navHistory for in-tab back)

---

### ✅ Completed (Phase 5c-4) — Polish & Edge Cases

- **Adjacent-Tab Switching on Close (Chrome-Style)**
  - When closing the active graph tab, focus moves to the tab that was to the right of the closed tab
  - If the closed tab was the rightmost, focus moves to the tab to the left
  - Uses `Math.min(closedIndex, remaining.length - 1)` for index calculation

- **Auto-Create Root Tab on Last Close**
  - Closing the last remaining graph tab automatically creates a fresh "Root" graph tab
  - Prevents user from being stuck with no graph tabs open
  - Uses `setGraphTabs([newTab])` (replace, not append) to avoid React stale-state duplication bug
  - Falls back to first saved tab if auto-create fails

- **Context Menu Overflow Protection**
  - Context menu position clamped to `window.innerWidth - menuWidth - 8` and `window.innerHeight - menuHeight - 8`
  - Prevents menu from extending past the right or bottom edge of the viewport

- **Saved Tab Context Menu Fix**
  - Removed broken "Open in new window" option for saved tabs (no `/saved-standalone` route exists)
  - Saved tab context menu now shows: "Remove tab and unsave concepts" (when 2+ tabs exist) or "No actions available" (when it's the last saved tab)

- Files changed: `AppShell.jsx` (close-tab logic, createDefaultGraphTab, context menu clamping, saved tab context menu)

---

### ✅ Completed (Phase 5d) — Tab Grouping

- **Tab Groups Database Table**
  - New `tab_groups` table: `id`, `user_id`, `name`, `display_order`, `is_expanded`, `created_at`
  - Nullable `group_id` column added to both `saved_tabs` and `graph_tabs` with `ON DELETE SET NULL`
  - Migration adds columns safely with `IF NOT EXISTS` checks — safe to re-run

- **Backend CRUD Endpoints (7 new endpoints)**
  - `GET /votes/tab-groups` — returns user's groups ordered by `display_order`
  - `POST /votes/tab-groups/create` — creates a new named group with auto-incremented `display_order`
  - `POST /votes/tab-groups/rename` — renames a group (validates ownership)
  - `POST /votes/tab-groups/delete` — deletes a group; explicitly sets `group_id = NULL` on all member tabs before deleting the group row
  - `POST /votes/tab-groups/toggle` — persists the expand/collapse state (`is_expanded` boolean)
  - `POST /votes/tab-groups/add-tab` — sets `group_id` on a saved or graph tab (validates both group and tab ownership)
  - `POST /votes/tab-groups/remove-tab` — sets `group_id = NULL` on a saved or graph tab

- **Tab Bar Layout (AppShell.jsx)**
  - Tab bar now shows three zones: ungrouped saved tabs (left) → groups (middle) → ungrouped graph tabs (right)
  - Each group renders as a clickable header with ▸/▾ arrow, group name, and member count badge
  - Clicking the group header expands/collapses it (persisted to DB)
  - When expanded, member tabs appear inline to the right of the group header with a left border visual indicator
  - When collapsed, the group header shows as a single tab; if the active tab is inside a collapsed group, the group header gets active styling
  - Mixed tab types allowed — a group can contain both saved tabs and graph tabs
  - Groups loaded on mount alongside saved tabs and graph tabs via `Promise.all`
  - Expand/collapse uses optimistic state update with revert on failure

- **Context Menu Integration**
  - Right-click any ungrouped tab → "Create group with this tab..." (prompts for name, creates group, adds tab)
  - Right-click any ungrouped tab when groups exist → "Add to group..." (prompts to pick group by number or type new name)
  - Right-click a grouped tab → "Remove from group" (ungroups the tab)
  - Right-click a group header → "Rename group" or "Delete group (keeps tabs)"
  - Double-click a group header to rename inline (same pattern as saved tab renaming)
  - Deleting a group shows a confirmation dialog; member tabs become ungrouped (not deleted)

- Files changed: `migrate.js` (new `tab_groups` table, `group_id` columns on `saved_tabs` and `graph_tabs`), `votesController.js` (7 new endpoints + updated `getGraphTabs`/`getUserTabs` to return `group_id` + updated RETURNING clauses), `votes.js` routes (7 new tab-group routes), `api.js` frontend (7 new tab-group API methods), `AppShell.jsx` (group state, buildTabBarItems layout logic, group rendering, group context menu, group rename, toggle, create/delete handlers)

---

### ✅ Completed (Phase 5e) — Saved Tree Reordering

- **Saved Tree Order Database Table**
  - New `saved_tree_order` table: `id`, `user_id`, `saved_tab_id`, `root_concept_id`, `display_order`, `updated_at`
  - Unique constraint on `(user_id, saved_tab_id, root_concept_id)` — one order entry per tree per tab per user
  - Index on `(user_id, saved_tab_id)` for fast lookups
  - Migration uses `IF NOT EXISTS` — safe to re-run

- **Backend Endpoints (2 new endpoints)**
  - `GET /votes/tree-order?tabId=N` — returns the custom order entries for a specific saved tab
  - `POST /votes/tree-order/update` — accepts `{ tabId, order: [{ rootConceptId, displayOrder }, ...] }` and upserts all entries using `ON CONFLICT ... DO UPDATE`
  - Both endpoints validate tab ownership before proceeding

- **Frontend: Up/Down Arrow Reordering (SavedTabContent.jsx)**
  - Each root-level tree card now has small ▲/▼ arrow buttons on the left side
  - Top tree's ▲ is disabled; bottom tree's ▼ is disabled
  - Clicking an arrow swaps the tree with its neighbor and persists the full order to the database
  - Uses optimistic state update (instant visual feedback); reverts by reloading from DB on failure
  - Tree order loaded alongside saves on tab switch (`loadTreeOrder` called in `useEffect` alongside `loadSaves`)
  - Trees with explicit order entries appear first (sorted by `display_order` ascending); trees without an entry fall to the bottom sorted by save count descending (original behavior preserved)

- Files changed: `migrate.js` (new `saved_tree_order` table), `votesController.js` (2 new endpoints: `getTreeOrder`, `updateTreeOrder`), `votes.js` routes (2 new tree-order routes), `api.js` frontend (2 new tree-order API methods), `SavedTabContent.jsx` (tree order state, `loadTreeOrder`, `moveTree` handler, ▲/▼ arrow buttons on tree cards)

---

### ✅ Completed (Phase 5f) — Child Ordering Within Vote Sets

- **Child Rankings Database Table**
  - New `child_rankings` table: `id`, `user_id`, `parent_edge_id`, `child_edge_id`, `vote_set_key`, `rank_position`, `created_at`, `updated_at`
  - Unique constraint on `(user_id, parent_edge_id, child_edge_id, vote_set_key)` — one ranking per user per child per vote set
  - Index on `(parent_edge_id, vote_set_key)` for fast aggregation queries
  - Migration uses `IF NOT EXISTS` — safe to re-run

- **Backend Endpoints (3 new endpoints)**
  - `GET /votes/rankings?parentEdgeId=N&voteSetKey=...` — returns the current user's rankings AND aggregated rankings (rank → user count map per child) for a specific vote set
  - `POST /votes/rankings/update` — upserts a ranking. Validates the user has a vote on the parent edge (only your own set can be ranked)
  - `POST /votes/rankings/remove` — deletes a single ranking

- **Vote Set Response Enhancements (conceptsController.js)**
  - `getVoteSets` now returns three additional fields: `userSetIndex` (which set index the current user belongs to, or null), `parentEdgeId` (edge connecting the current concept to its parent — context key for rankings), and `voteSetKey` on each vote set (sorted comma-separated edge IDs for ranking persistence)
  - **Solo vote sets enabled:** Removed `HAVING COUNT(*) >= 2` threshold so a single user saving children gets their own color swatch. This is necessary so users can always see and rank their own set.

- **User's Own Swatch Highlight (VoteSetBar.jsx)**
  - The swatch matching the user's vote set gets a bold `2px solid #333` border (visually distinct from the colored outline used for active/selected state)
  - Tooltip changes to "Your vote set · N users saved the same M children"
  - Works in both ungrouped and grouped (super-group) swatch positions

- **Ranking UI on Child Cards (ConceptGrid.jsx)**
  - New ranking section appears below the vote section on each card when exactly 1 swatch is selected
  - **Aggregated rank badges** (always visible when any single set is selected): pills showing "#1: 3", "#2: 1" etc. for each rank position with user counts
  - **Dropdown selector** (only when viewing your own vote set): "Rank: [—|1|2|3|...|N]" where N = number of children in the set. Selecting "—" removes the ranking.
  - Styling uses EB Garamond font, muted colors, subtle off-white background consistent with Zen aesthetic

- **Rank-Based Sorting (Concept.jsx)**
  - When rankings exist for the selected single set, children are sorted by most popular rank: rank with highest user count wins, then by user count for that rank, then by save count. Unranked children fall to the bottom.
  - Rankings loaded via `useEffect` whenever exactly 1 individual swatch is selected (no groups)
  - Filter info bar shows contextual hints: "· rank your children with the dropdown" (own set) or "· sorted by community ranking" (other set)

- **Ranking Cleanup on Unsave**
  - `removeVote`: after deleting votes on unsaved edges, deletes any `child_rankings` rows where `child_edge_id` is among the removed edges
  - `removeVoteFromTab`: when a vote is fully deleted (last tab link removed), deletes any `child_rankings` for that edge
  - This ensures stale rankings don't accumulate when users change their saves

- Files changed: `migrate.js` (new `child_rankings` table), `conceptsController.js` (`getVoteSets` response enhancements: `userSetIndex`, `parentEdgeId`, `voteSetKey`; removed 2+ user threshold), `votesController.js` (3 new ranking endpoints + ranking cleanup on unsave in `removeVote` and `removeVoteFromTab`), `votes.js` routes (3 new ranking routes), `api.js` frontend (3 new ranking API methods), `VoteSetBar.jsx` (user swatch highlight with bold border + tooltip), `ConceptGrid.jsx` (ranking section with dropdown + aggregated badges), `Concept.jsx` (ranking state, loading, rank-based sorting, filter hints)

---

## Pending Features

### Phase 5: Saved Page

- **Saved Page (formerly Voted Page)**
  - Per-user page showing all concepts the user has saved
  - **Stability:** The Saved page itself is stable — it only changes when the user explicitly saves or unsaves. There is no UI churn from graph evolution.
  - **Dynamic child sets:** The child sets of the user's saved leaf nodes evolve as other users add content, but the user's own list of bookmarks does not change.
  - Swap votes visually distinct from regular saves
  - Swap votes include links to destination concepts
  - Link votes (Flip View) also appear here
  - All vote types are assertions the user continuously maintains and alters as their experiences change

- **Unsave Cascading (from Saved Page)**
  - Each concept on the Saved page has a small **X button** to remove it and all its descendants
  - The X button functions identically to unsaving in the children view (which is already implemented)

- **Saved Page Tabs** — ✅ IMPLEMENTED (Phase 5b)
  - See "Completed (Phase 5b)" section above for full details

- **In-App Tabs for Navigation (Concept Panes)** — ✅ COMPLETE (Phase 5c)
  - ✅ Unified tab bar with saved tabs + graph tabs in AppShell
  - ✅ `graph_tabs` database table with persistent navigation state
  - ✅ Backend CRUD for graph tabs, right-click context menus, close/duplicate
  - ✅ SavedTabContent.jsx renders inside saved tabs, clicking concepts opens graph tabs
  - ✅ Within-tab navigation with back button, breadcrumb clicks, flip view toggle
  - ✅ Search results navigate within current graph tab
  - ✅ Adjacent-tab switching on close, auto-create on last close, context menu polish
  - Users can have **multiple open concept pane tabs** within the Orca app UI (like browser-style tabs at the top of the app, not actual browser tabs)
  - Each tab maintains its own navigation state — users can explore different areas of different graphs without losing their place
  - The same graph can be open on multiple tabs simultaneously
  - **Duplicate Tab:** Users can duplicate an open tab, creating a new tab at the same position in the same graph — useful for branching off in different navigational directions
  - Saved page tabs also appear as in-app tabs alongside concept pane tabs (Note: this will change in Phase 7c — saved tabs will leave the main tab bar and be replaced by persistent corpus tabs; saves will move to a standalone Saved Page)
  - **Right-click any tab** (Saved tab or concept pane tab) to open it in a new browser tab/window

- **Tab Grouping** — ✅ IMPLEMENTED (Phase 5d)
  - Users can group any combination of tabs (corpus tabs and graph/concept pane tabs) into named tab groups
  - A tab group appears as a single tab in the tab bar; clicking it expands to reveal its component tabs, which the user can then click into
  - **Flat grouping only:** Groups cannot contain other groups (one level of nesting). This keeps the UI simple and avoids deep hierarchies
  - **Mixed types allowed:** A single group can contain tabs of different types (e.g., a corpus tab and two graph pane tabs grouped together under "Work Projects")
  - Users can name groups at creation time and rename them later (double-click or right-click → Rename group)
  - Tabs can be added to/removed from groups via right-click context menu
  - Group membership, ordering, and expand/collapse state persisted server-side for cross-session stability
  - **Database:** `tab_groups` table + `group_id` foreign key on `graph_tabs` (and future `corpus_tabs` table when Phase 7 is built)
  - **Note:** Saved tabs are no longer in the main tab bar (see Phase 7c "Saved Page Overhaul"). The `saved_tabs.group_id` column from the original Phase 5d implementation will be retired when Phase 7c is built.

- **Saved Tree Reordering** — ✅ IMPLEMENTED (Phase 5e)
  - Within a saved tab, users can reorder the root-level graph trees using up/down arrow buttons
  - Order persists between sessions via `saved_tree_order` database table
  - Trees without an explicit order record fall to the bottom, sorted by save count as before
  - Each saved tab has its own independent ordering

- **Child Ordering Within Vote Sets** — ✅ IMPLEMENTED (Phase 5f)
  - When filtering to a **single** identical vote set, users can assign a numeric order (1, 2, 3…) via dropdown selector
  - Users can only rank children within their own vote set; other sets show aggregated rankings read-only
  - Your own identical vote set swatch has a bold dark border and "Your vote set" tooltip
  - Rankings are stored in the `child_rankings` table, keyed by a deterministic `vote_set_key` (sorted comma-separated edge IDs)
  - **Aggregated display:** For each child, pills show the count of users who assigned each rank number. Sort children by the most popular rank (the rank with the highest count wins)
  - **Solo sets supported:** A user with a unique save pattern gets their own swatch and can rank their children even before anyone else shares their exact set
  - Ranking cleanup on unsave prevents stale data accumulation
  - See "Completed (Phase 5f)" section above for full implementation details

- **Ctrl+F Functionality (Phase 5 — Verification)** — ✅ VERIFIED
  - Browser-native Ctrl+F works on all pages: Root, Concept (children view), Flip View, Saved tabs
  - No custom in-app search needed — rendered text is findable by the browser's built-in find

- **Read-Only Guest Access (Pre-Login)** — ✅ IMPLEMENTED (Phase 5 misc)
  - Users who are not logged in can search and navigate around graphs with read-only access
  - They can see save counts, vote information, vote set swatches/dots, and all public concept/edge data
  - They can open graph tabs in the tab bar for temporary exploration — these are ephemeral (local state only, not persisted to DB)
  - No saved tabs, no save/vote functionality, no tab persistence, no tab groups
  - Login/signup buttons visible in the header as the primary call-to-action
  - Backend uses `optionalAuth` middleware on concept GET routes; `req.user = null` for guests
  - Frontend passes `isGuest` prop through AppShell → Root/Concept/ConceptGrid/FlipView/SearchField
  - Vote buttons show read-only counts (grayed out, "Log in to save concepts" tooltip); link vote button hidden for guests
  - "Add as child" and "Create as root" hidden from SearchField for guests

- **Search Results Surfacing Saved Tabs and Corpus Annotations** — ✅ FULLY IMPLEMENTED (Phase 5 misc + Post-Phase 7 cleanup)
  - When a logged-in user searches, results that appear in their saved tabs or subscribed corpuses (via annotations) are shown at the top with an "In your saves / corpuses" section header
  - Each saved-tab result shows a green italic badge with the tab name(s) (e.g., "Research, Work")
  - Each corpus-annotation result shows a 📚 blue-tinted badge with corpus name(s)
  - Both badges can appear on the same result if a concept is both saved and annotated
  - Backend cross-references search results against `votes` → `vote_tab_links` → `saved_tabs` → `edges` for saved tabs, and `document_annotations` → `edges` → `corpuses` → `corpus_subscriptions` for corpus annotations
  - Results with any context (saved tabs or corpus annotations) sort to the top
  - Backend also returns `exactMatch` boolean

### ✅ Completed (Phase 6) — External Links

- **External Links Page (Phase 6a + 6b)**
  - New `concept_links` and `concept_link_votes` database tables
  - Users can attach external URLs to a concept in a specific parent path context
  - 🔗 **Links** button in the concept header bar (next to Flip View toggle) opens the External Links page
  - Links button only appears when `parentEdgeId` is available (after vote sets load)
  - Each link shows: upvote button + count, clickable title/URL (opens in new tab), domain, who added it and when
  - Sort toggle: by votes (default) or by newest
  - "Add external link" form for logged-in users (URL + optional title input)
  - URL validation: must start with `http://` or `https://`, max 2048 characters
  - Duplicate URL detection per edge (409 Conflict if same URL already added)
  - Auto-upvote: the user who adds a link automatically upvotes it
  - Only the user who added a link can remove it (server-side validation)
  - Guests see everything read-only (no add form, no upvote buttons)
  - View mode stored as `'links'` in tab navigation state with proper back button support
  - SearchField hidden in links view (same as flip view)
  - Backend endpoints: `GET /votes/web-links/:edgeId` (optionalAuth), `POST /votes/web-links/add`, `POST /votes/web-links/remove`, `POST /votes/web-links/upvote`, `POST /votes/web-links/unvote`
  - New `WebLinksView.jsx` component

- **Cross-Context Links Compilation (Phase 6c)**
  - 🔗 **All Links** button in the Flip View header opens a cross-context links view
  - New backend endpoint `GET /votes/web-links/all/:conceptId?path=...` fetches all web links across ALL parent contexts for a concept
  - Links grouped by parent context (edge), with parent name, full path, attribute displayed
  - Current context highlighted at top with bold border and "current" badge
  - Groups sorted: current context first, then by total link votes descending
  - Collapsible groups — auto-expanded for groups with links and the current context
  - Upvoting only interactive for links in the current context; other contexts show "view only"
  - View mode stored as `'fliplinks'` with proper nav history (back returns to Flip View)
  - New `FlipLinksView.jsx` component
  - `FlipView.jsx` updated with new `onOpenFlipLinks` callback prop

- **Shareable Concept Links (Phase 6d)**
  - 📋 **Share** button in the concept header bar (right side, next to other buttons)
  - Clicking copies a full URL like `http://localhost:3000/concept/5?path=1,2` to clipboard
  - Button text briefly changes to "✓ Copied!" for 2 seconds, then reverts
  - Uses `navigator.clipboard.writeText` with fallback for older browsers
  - Available in all view modes (children, flip, links) — hidden only in decontextualized flip view

- Files changed: `migrate.js` (2 new tables: `concept_links`, `concept_link_votes`), `votesController.js` (6 new endpoints: getWebLinks, addWebLink, removeWebLink, upvoteWebLink, removeWebLinkVote, getAllWebLinksForConcept), `votes.js` routes (6 new web-link routes with optionalAuth for GETs), `api.js` frontend (6 new web-link API methods), new `WebLinksView.jsx`, new `FlipLinksView.jsx`, `FlipView.jsx` (🔗 All Links button + onOpenFlipLinks prop), `Concept.jsx` (🔗 Links button, 📋 Share button, 'links'/'fliplinks' view modes, handleToggleLinksView, handleOpenFlipLinks, handleShareLink)

---

### Phase 7: Corpuses, Documents, Annotations & Color Sets

A major new surface for Orca. **Corpuses** are the primary organizational unit for documents. Users upload documents and place them into corpuses. Annotations, permissions, and subscriptions all operate at the corpus level. This phase is broken into sub-phases.

### ✅ Completed (Phase 7a) — Corpus & Document Infrastructure

- **Database Tables**
  - New `corpuses` table: name, optional description, annotation_mode (public/private), created_by
  - New `documents` table: title, immutable body text, format (plain/markdown), uploaded_by
  - New `corpus_documents` junction table with `UNIQUE(corpus_id, document_id)` and cascading deletes
  - All tables use `IF NOT EXISTS` — migration safe to re-run

- **Backend: Corpus CRUD (6 endpoints in `corpusController.js`)**
  - `GET /api/corpuses/` — list all corpuses with owner username and document counts (guest OK)
  - `GET /api/corpuses/mine` — list current user's own corpuses (auth required)
  - `GET /api/corpuses/:id` — get corpus details + document list (guest OK)
  - `POST /api/corpuses/create` — create a new corpus (auth required)
  - `POST /api/corpuses/:id/update` — update name/description/mode (owner only)
  - `POST /api/corpuses/:id/delete` — delete corpus with orphan document cleanup (owner only, transactional)

- **Backend: Document Endpoints (4 endpoints)**
  - `POST /api/corpuses/:id/documents/upload` — upload new document into a corpus (creates document + links in transaction)
  - `POST /api/corpuses/:id/documents/add` — add existing document to corpus (owner only)
  - `POST /api/corpuses/:id/documents/remove` — remove document from corpus with orphan cleanup (owner only, transactional)
  - `GET /api/documents/:id` — get document with full body text + list of corpuses (standalone route, guest OK)

- **Frontend: API Service Layer**
  - New `corpusAPI` export in `api.js`: listAll, listMine, getCorpus, create, update, deleteCorpus, uploadDocument, addDocument, removeDocument
  - New `documentsAPI` export in `api.js`: getDocument

- **Frontend: Corpus Browsing UI**
  - 📚 **Corpuses** button added to AppShell header (visible to both guests and logged-in users)
  - `CorpusListView.jsx` — browse all corpuses or filter to "My Corpuses", create new corpus with name/description/annotation mode
  - `CorpusDetailView.jsx` — view corpus details, document list, upload documents (text input), edit/delete corpus (owner only), remove documents from corpus
  - `DocumentView.jsx` — full document text reader with corpus membership links, back navigation
  - Corpus views render as an overlay in AppShell's content area (replaces tab content when active, tab content preserved underneath)
  - Navigation: Corpuses button → Corpus List → Corpus Detail → Document View, with ← back buttons throughout

- **Route Ordering Fix**
  - Express routes in `corpuses.js` ordered with specific paths (`/mine`, `/create`) before parameterized `/:id` to prevent route conflicts
  - Auth middleware import matches the existing export pattern (`const authenticateToken = require(...)` + `const optionalAuth = authenticateToken.optionalAuth`)

- Files changed: `migrate.js` (3 new tables), new `corpusController.js` (10 endpoints), new `routes/corpuses.js`, `server.js` (new route mount + standalone document route), `api.js` frontend (2 new API exports), `AppShell.jsx` (📚 button, corpus view state, corpus view rendering), new `CorpusListView.jsx`, new `CorpusDetailView.jsx`, new `DocumentView.jsx`

#### Core Concept: Corpuses

- **A corpus is a named collection of documents**, created and owned by a single user
- Every document must belong to at least one corpus — there are no "unattached" documents
- The same document can appear in multiple corpuses (added by different corpus owners)
- **Annotations are scoped to the corpus**, not the document globally — the same document in two different corpuses has entirely separate annotations
- **Every corpus has both a public and editorial annotation layer** (Phase 7g, renamed Phase 10a) — the public layer is open to any logged-in user; the editorial layer is maintained by allowed users invited by the corpus owner. All annotations (both layers) are visible to everyone; only creation/voting on editorial annotations is restricted to allowed users.
- **Subscriptions are per-corpus**, not per-document
- Any user can create a corpus
- Corpus owners can add and remove documents from their corpus, even documents they didn't upload
- **Allowed users** (invited by owner) can also add documents and create document versions within the corpus
- **Document lifecycle:** A document is only deleted from the system if it's not in any corpus. Deleting a corpus removes its documents only if those documents aren't in any other corpus — except documents uploaded by allowed users, which are left orphaned for rescue (Phase 9b). Documents cannot be manually deleted by anyone (except via the orphan dismiss flow) — their existence is governed entirely by corpus membership.
- **Document immutability:** Documents are immutable once finalized. New document versions (Phase 7h) start in an editable draft state; once finalized, text and annotation offsets are locked.

#### Phase 7a: Corpus & Document Upload

- **Corpus Creation**
  - Any user can create a named corpus at any time
  - Creating a corpus is a prerequisite for uploading a document (you must place it somewhere)

- **Document Upload**
  - Users upload documents to Orca (plain text or Markdown to start — no PDF/DOCX parsing in v1)
  - On upload, the user selects which corpus to place the document in (even if the corpus has no other documents yet)
  - Documents are stored server-side with metadata (title, uploader, format, created_at)
  - Each document has a unique URL within Orca
  - All documents are publicly visible to any Orca user (the public/private distinction applies to annotations, not document content)

- **Corpus Document Management**
  - Corpus owners can add existing documents to their corpus (even if uploaded by someone else)
  - Corpus owners can remove documents from their corpus
  - Removing a document from a corpus deletes all annotations for that document within that corpus
  - If removing the document leaves it in zero corpuses, the document itself is deleted

- **Database:** New `corpuses` table:
  ```sql
  CREATE TABLE corpuses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    annotation_mode VARCHAR(20) NOT NULL DEFAULT 'public', -- 'public' or 'private'
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
  New `documents` table:
  ```sql
  CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'plain', -- 'plain' or 'markdown'
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
  New `corpus_documents` junction table:
  ```sql
  CREATE TABLE corpus_documents (
    id SERIAL PRIMARY KEY,
    corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(corpus_id, document_id)
  );
  ```

### ✅ Completed (Phase 7b) — Duplicate Detection on Upload

- **Similarity Check Before Committing**
  - When a user clicks "Upload" in the corpus detail view, the system first checks existing documents for text similarity before committing the upload
  - Uses PostgreSQL's `pg_trgm` `similarity()` function on a truncated prefix (first 5,000 characters) of the document body for performance
  - Threshold: 0.3 (30% trigram similarity) — catches near-duplicates and substantially similar content without too many false positives
  - Returns up to 10 matches, sorted by similarity score descending
  - Each match includes: document title, uploader username, upload date, similarity percentage, and list of corpuses the document belongs to
  - **Two-step upload flow:** User fills in title/body/format → clicks Upload → system checks for duplicates → if matches found, a warm-toned panel appears showing the matches → user can "Upload anyway" or "Cancel"
  - If no matches found (or if the duplicate check endpoint fails gracefully), the upload proceeds immediately without showing the panel
  - **Graceful degradation:** If the `pg_trgm` similarity query fails (e.g., extension not available), the upload proceeds normally — the duplicate check is a best-effort pre-upload confirmation, not a hard gate
  - New trigram GIN index on `documents.body` (`idx_documents_body_trgm`) for fast similarity matching
  - New backend endpoint: `POST /api/corpuses/check-duplicates` (auth required)
  - New frontend API method: `corpusAPI.checkDuplicates(body)`

- **Unique Name Validation**
  - **Corpus names** are now unique (case-insensitive). Creating or renaming a corpus to an existing name returns 409 Conflict.
  - **Document titles** are now unique (case-insensitive). Uploading a document with an existing title returns 409 Conflict.
  - Corpus and document namespaces are independent — a corpus and document can share the same name.

- **Bug Fix: Stray Brace in Concept.jsx**
  - Fixed extra `}` on line 889 of `Concept.jsx` that caused a Vite warning: `The character "}" is not valid inside a JSX element`
  - Was a harmless warning (app still ran) but cleaned up for correctness

- Files changed: `migrate.js` (new `idx_documents_body_trgm` GIN index), `corpusController.js` (new `checkDuplicates` endpoint + unique name validation on corpus create/update + unique title validation on document upload), `corpuses.js` routes (new `POST /check-duplicates` route), `api.js` frontend (new `checkDuplicates` API method), `CorpusDetailView.jsx` (two-step upload flow with duplicate matches UI), `Concept.jsx` (stray brace fix)

#### Phase 7b: Duplicate Detection on Upload — ✅ COMPLETE

- ✅ **Similarity Check Before Committing**
  - As a user uploads a document, they are shown any existing documents that meet a high similarity percentage
  - Prevents unnecessary duplicate uploads — user can subscribe to a corpus containing the existing document instead
  - Uses text similarity metric (pg_trgm `similarity()` on first 5000 chars) against existing document bodies
  - Shown as a pre-upload confirmation step: "These existing documents are very similar — do you want to find a corpus with one instead?"
  - If no matches or user proceeds anyway, upload completes normally

### ✅ Completed (Phase 7c) — Corpus Subscriptions, Corpus Tabs & Saved Page Overhaul

- **Corpus Subscriptions Backend (7c-1)**
  - New `corpus_subscriptions` table with `UNIQUE(user_id, corpus_id)` and indexes on both columns
  - Three new backend endpoints: `POST /subscribe`, `POST /unsubscribe`, `GET /subscriptions`
  - `listCorpuses` now returns `subscriber_count` and `user_subscribed` per corpus
  - `getCorpus` now returns `subscriber_count` and `userSubscribed`
  - Three new frontend API methods on `corpusAPI`: `subscribe()`, `unsubscribe()`, `getMySubscriptions()`

- **Corpus Tabs in Main Tab Bar (7c-2)**
  - Subscribing to a corpus creates a persistent **📚 corpus tab** in the main tab bar
  - Corpus tabs appear alongside graph tabs — the tab bar now contains only corpus tabs and graph tabs
  - New `CorpusTabContent.jsx` component renders inside corpus tabs: corpus info, document list, upload form (with duplicate detection), and an inline document viewer with back navigation
  - `CorpusListView.jsx` updated with subscriber count and "Subscribe" button (or "subscribed" badge) on each corpus card
  - `CorpusDetailView.jsx` updated with subscriber count and Subscribe/Unsubscribe buttons
  - `AppShell.jsx` loads subscriptions on mount via `corpusAPI.getMySubscriptions()`, manages corpus tab state, handles subscribe/unsubscribe callbacks
  - Active tab type now supports `'corpus'` alongside `'graph'`
  - Unsubscribing removes the corpus tab and switches to the next available tab

- **Saved Page Overhaul (7c-3)**
  - **Saved tabs removed from the main tab bar entirely** — they no longer appear alongside corpus/graph tabs
  - New **"Saved"** button in the header (visible to logged-in users) opens a standalone Saved Page overlay
  - New `SavedPageOverlay.jsx` component contains the full saved tabs system internally: tab bar, create/rename/delete tabs, SavedTabContent rendering
  - Clicking a concept in a saved tree opens it in a new graph tab AND closes the overlay
  - The existing `saved_tabs` and `vote_tab_links` tables remain in the database — they're still used inside the Saved Page. They will be retired when Phase 7d annotations enable corpus-based organization on the Saved Page.

- **Cleanup (7c-4)**
  - Removed dead saved-tab UI state from AppShell (showNewSavedTabInput, newSavedTabName, renamingSavedTabId, renameValue, refs)
  - Removed saved tab CRUD handlers from AppShell (now in SavedPageOverlay)
  - Removed saved tab context menu rendering from main tab bar
  - Removed `type: 'saved'` from active tab fallback logic — saved tabs can no longer be active in the main tab bar
  - Simplified `renderTabButton` to graph-tabs-only (no more saved tab renaming or italic styling in main tab bar)
  - Simplified `groupContainsActiveTab` to check graph tabs only
  - Removed dead styles: `savedTabButton`, `newSavedTabButton`, `newTabInputField`, `renameInput`

- Files changed (across all 7c sub-phases): `migrate.js` (new `corpus_subscriptions` table), `corpusController.js` (3 new subscription endpoints + updated `listCorpuses`/`getCorpus` with subscriber data), `corpuses.js` routes (3 new subscription routes), `api.js` frontend (3 new subscription API methods), `AppShell.jsx` (corpus tabs, saved page button, cleanup), new `CorpusTabContent.jsx`, new `SavedPageOverlay.jsx`, `CorpusListView.jsx` (subscriber count + subscribe button), `CorpusDetailView.jsx` (subscriber count + subscribe/unsubscribe buttons)

### ✅ Completed (Phase 7d-1 + 7d-2) — Annotation Infrastructure & Annotation Creation UI

- **Database: `document_annotations` Table (7d-1)**
  - New table with `corpus_id`, `document_id`, `edge_id`, `start_position`, `end_position`, `created_by`
  - `CHECK` constraint ensures `start_position >= 0` and `end_position > start_position`
  - Three indexes: `(corpus_id, document_id)` for document view queries, `edge_id` for bidirectional linking, `document_id` for cross-corpus queries
  - `ON DELETE CASCADE` from all three FKs (corpus, document, edge)

- **Backend: 4 New Annotation Endpoints (7d-1)**
  - `POST /api/corpuses/annotations/create` — create annotation. Validates: corpus exists, annotation permission (public vs private mode), document is in corpus, edge exists, end position doesn't exceed document length
  - `GET /api/corpuses/:corpusId/documents/:documentId/annotations` — get all annotations for a document in a corpus, with edge details (concept name, attribute, parent name, graph_path), sorted by position. Guest-accessible.
  - `POST /api/corpuses/annotations/delete` — delete annotation. Public corpus: only creator can delete. Private corpus: creator or corpus owner can delete.
  - `GET /api/corpuses/annotations/edge/:edgeId` — get all annotations for an edge across all corpuses, grouped by corpus → document, with text snippets and subscriber counts. Guest-accessible. (For External Links page, Phase 7d-3/4.)
  - Route ordering: annotation-specific routes (`/annotations/create`, `/annotations/delete`, `/annotations/edge/:edgeId`) placed BEFORE `/:id` parameterized routes to avoid Express treating "annotations" as an `:id`

- **Frontend: Annotation Creation UI (7d-2)**
  - New `AnnotationPanel.jsx` component — floating panel for the annotation creation flow
  - **Two-step flow:** (1) search for a concept with 300ms debounced `searchConcepts` API, (2) pick a parent context (edge) with full resolved path display
  - Search input pre-fills with the selected text (first 40 characters)
  - **Root concept support:** Also checks `getRootConcepts` endpoint for root edges (the parents endpoint excludes them because it JOINs on `parent_id` which is NULL for roots). Root contexts appear with a "root" badge.
  - **Full path resolution:** Uses `getConceptNames` batch endpoint to resolve `graph_path` integer arrays to concept names. Displays the complete ancestor chain (e.g., *Health → Fitness →* **Exercise [action]**) not just the immediate parent.
  - Panel appears fixed at bottom-center of the viewport when user clicks "📌 Annotate"

- **Frontend: Annotation Display & Highlights (7d-2)**
  - `CorpusTabContent.jsx` document viewer updated with annotation awareness
  - **Highlight rendering:** Annotations appear as highlighted text regions (warm amber underline, `rgba(232, 217, 160, 0.35)` background) — consistent with Orca's no-color-except-vote-sets philosophy
  - **Non-overlapping segments:** Frontend builds segments from sorted annotations; overlapping annotations take first-wins approach
  - **Click to inspect:** Clicking a highlighted annotation opens a right-side detail panel showing the full resolved path (ancestors in italic gray → leaf concept in bold), creator username, date, and "Remove annotation" button
  - **Full path in sidebar:** Path names resolved via `getConceptNames` batch endpoint on annotation load (same approach as AnnotationPanel)
  - Annotations reload automatically after creation or deletion
  - Guests see highlights but cannot create annotations (toolbar hidden for guests)

- **Text Selection Flow**
  - User selects text in the document body → floating "📌 Annotate" toolbar appears at bottom-center
  - Toolbar has Annotate button + ✕ dismiss button
  - Character offset calculation uses DOM Range API (`window.document.createRange()`) to compute exact positions within the document body text node
  - Selection state cleared on annotation creation, panel close, or explicit dismiss

- **Bug Fix: `document` Variable Shadowing**
  - React state variable named `document` (the Orca document object) shadowed the browser's global `document` (DOM). Calling `document.createRange()` failed with "Cannot read properties of null" because it was calling `.createRange()` on the Orca document state (which could be null), not the browser DOM.
  - Fix: use `window.document.createRange()` to explicitly reach the browser API
  - **Learning:** Avoid naming React state variables `document` in components that need DOM APIs

- **Known Limitation: Corpus Tab State Not Persisted on Refresh**
  - Refreshing the browser while viewing a document inside a corpus tab returns the user to a graph tab. Corpus tab sub-view state (which document is open) is only in React state, not persisted to the database. The active tab selection also isn't persisted. This is consistent with how corpus tabs have worked since Phase 7c — a future polish pass could add persistence similar to `graph_tabs`.

- Files changed: `migrate.js` (new `document_annotations` table with indexes + CHECK constraint), `corpusController.js` (4 new annotation endpoints: createAnnotation, getDocumentAnnotations, deleteAnnotation, getAnnotationsForEdge), `corpuses.js` routes (4 new annotation routes with correct ordering before `/:id`), `api.js` frontend (4 new annotation API methods on `corpusAPI`), `CorpusTabContent.jsx` (annotation loading with path name resolution, text selection handler with DOM Range offset calculation, annotation highlights, detail sidebar with full path, AnnotationPanel integration), new `AnnotationPanel.jsx` (two-step annotation creation: concept search + context picker with root edge support and full path display)

### ✅ Completed (Phase 7d-3 + 7d-4) — Annotation Display Polish & Bidirectional Linking

- **Annotation Detail: Navigate to Concept (7d-3)**
  - Annotation detail sidebar in `CorpusTabContent` now has a **"Navigate to concept →"** button
  - Clicking it opens the annotated concept in a new graph tab using the annotation's edge data (`child_id` as concept ID, `graph_path` for path context)
  - Uses `onOpenConceptTab` callback threaded from AppShell → CorpusTabContent
  - Guests don't see the button (no graph tab creation for guests from this context)

- **Document Annotations Section on External Links Page (7d-4)**
  - `WebLinksView.jsx` now has two sections: **Web Links** (Phase 6, unchanged) and **Document Annotations** (new)
  - Document Annotations section calls `corpusAPI.getAnnotationsForEdge(edgeId)` — the endpoint built in 7d-1
  - **Corpus-grouped display:** Annotations are grouped by corpus, each corpus is a collapsible group (▸/▾ toggle)
  - Each corpus group shows: 📚 icon, corpus name (clickable — subscribes and opens corpus tab), annotation count, subscriber count
  - Each document within a corpus shows: document title (clickable — opens the specific document in the corpus tab), annotation count
  - Each annotation shows: quoted text snippet (up to 200 chars, with amber left-border consistent with annotation highlight styling), creator username, date
  - **Two sort modes:** ↓ Newest (corpuses ordered by most recent annotation, documents within each corpus also by recency) and ↓ Subscribers (corpuses ordered by subscriber count)
  - Sort buttons use the same active/inactive toggle styling as the rest of the app (dark background when active)
  - All corpuses auto-expanded on load

- **Pending Document Navigation (7d-4 infrastructure)**
  - New `pendingCorpusDocumentId` state in AppShell — stores a document ID to auto-open after switching to a corpus tab
  - `handleSubscribeToCorpus` now accepts optional third parameter `documentId`
  - `CorpusTabContent` accepts `pendingDocumentId` prop; a `useEffect` auto-calls `handleOpenDocument` once the corpus finishes loading
  - `onPendingDocumentConsumed` callback clears the pending state after consumption
  - Used by both External Links page (clicking a document title) and Corpuses overlay (clicking a document in `CorpusDetailView`)

- **Corpus Overlay Document Opens Redirected to Corpus Tab (7d-4 bug fix)**
  - Previously, clicking a document in `CorpusDetailView` (Corpuses overlay) opened the Phase 7a `DocumentView` component which had no annotation support
  - Now redirects to the corpus tab: subscribes (or switches), passes `pendingDocumentId`, closes the overlay
  - `CorpusDetailView.jsx` updated to pass `corpus.name` as second argument in `onOpenDocument(docId, corpusName)` for proper tab labeling
  - All document viewing now goes through `CorpusTabContent`, ensuring consistent annotation support

- **Annotation Loading Race Condition Fix (7d-4 bug fix)**
  - `handleOpenDocument` in CorpusTabContent now `await`s `loadAnnotations(docId)` before setting `docLoading = false`
  - Ensures annotations are fully loaded before the document renders, preventing the empty-annotations-on-first-visit issue

- **Prop Threading (7d-3 + 7d-4)**
  - `AppShell.jsx` → `Concept.jsx`: new props `onOpenCorpusTab` (for subscribing/switching to corpus tabs from External Links) and `onOpenConceptTab` (for opening concepts from annotation detail)
  - `AppShell.jsx` → `CorpusTabContent.jsx`: new props `onOpenConceptTab`, `pendingDocumentId`, `onPendingDocumentConsumed`
  - `Concept.jsx` → `WebLinksView.jsx`: passes through `onOpenCorpusTab` and `onOpenConceptTab`

- Files changed: `AppShell.jsx` (new `pendingCorpusDocumentId` state, updated `handleSubscribeToCorpus` with optional `documentId`, new props on CorpusTabContent and Concept, corpus overlay document click redirected to corpus tab), `Concept.jsx` (accepts and passes through `onOpenCorpusTab`/`onOpenConceptTab` to WebLinksView), `WebLinksView.jsx` (imports `corpusAPI`, new Document Annotations section with corpus-grouped collapsible display, sort modes, annotation snippets), `CorpusTabContent.jsx` (accepts `onOpenConceptTab`/`pendingDocumentId`/`onPendingDocumentConsumed`, "Navigate to concept →" button in annotation sidebar, `pendingDocumentId` auto-open effect, `await loadAnnotations` fix), `CorpusDetailView.jsx` (passes `corpus.name` in `onOpenDocument` callback)

#### Phase 7c: Corpus UI & Document Viewing

- **Corpus Tabs Are Persistent (Subscription = Tab)**
  - Subscribing to a corpus adds it as a persistent tab in the main tab bar (alongside graph tabs)
  - Unsubscribing from a corpus removes it from the tab bar
  - Corpus tabs replace saved tabs as the persistent elements in the tab bar — saved tabs no longer appear in the main tab bar (see "Saved Page Overhaul" in Phase 7c notes below)
  - The tab bar now contains only two types: **corpus tabs** (persistent, subscription-based) and **graph tabs** (persistent, user-created)
  - Corpus tabs can be placed into tab groups (Phase 5d)
  - Corpus tabs are NOT closeable with ✕ — unsubscribing is the way to remove them (closing the tab would be confusing since it implies unsubscribing)
  - When you open a corpus tab, you see a list of documents in that corpus with search functionality
  - Selecting a document opens it on screen in **contextualized view** — this is where you see annotations scoped to that corpus

- **Document View — Contextualized (Inside Corpus Tab)**
  - Annotations are highlighted portions of the document text, scoped to the corpus you're viewing
  - Clicking an annotation reveals it in a right-side panel (like Google Docs comments)
  - The right panel shows: the full path from root to the leaf concept selected as the annotation, the number of votes the annotation has, and the color sets voted for by the author or other users
  - **Color set on annotations:** The color set represents the vote set of the leaf concept's children that users who vote for that color set on the annotation prefer — same color set / vote set system used elsewhere in Orca
  - Users can **favorite** documents within a corpus — favorited docs appear at the top of the document list for that user in that corpus (per-corpus favoriting, not global)
  - No "view in other corpuses" button needed in contextualized view — the document belongs to the corpus you have open

- **Document View — Decontextualized**
  - For any document, users can open a decontextualized view that shows ALL annotations from ALL corpuses the document belongs to
  - Annotations display one at a time — clicking a highlighted text region shows that annotation's details in the right-side panel
  - The right panel shows: the full path from root to the leaf concept, vote count, and color sets (same as contextualized view)
  - **Cross-corpus annotation attribution:** Each annotation in decontextualized view shows which corpus (or corpuses) it belongs to. If the same text range is annotated with the same edge in multiple corpuses, ALL those corpuses are listed
  - **Jump to corpus:** Each listed corpus is clickable — clicking opens that corpus as a new corpus tab in the main tab bar (subscribing the user if not already subscribed, or just switching to the existing tab if already subscribed)
  - Decontextualized view is **read-only** — no voting, no adding annotations

- **View in Other Corpuses (from contextualized view)**
  - From the contextualized document view, users can click "View in other corpuses" to see all corpuses containing this document
  - Corpuses listed by title and subscriber count
  - Clicking a corpus opens the document within that corpus as a new corpus tab (showing that corpus's annotations)
  - Some corpuses may have private-layer annotations — non-allowed users will only see the public layer's annotations for those corpuses

- **Saved Page Overhaul (Replaces Saved Tabs in Tab Bar)**
  - Saved tabs are removed from the main tab bar entirely
  - A single **Saved Page** is accessible via a button from the Root page or Concept pages (a separate page with a back button to return to docs/graph)
  - Within the Saved Page, saves are organized into tabs based on **corpus association:**
    1. **One tab per subscribed corpus** — a tree appears in a corpus tab if any concept in the tree exists as an annotation in that corpus. "Exists as an annotation" means the concept (or any concept further down the same path as the annotation) has been saved by the user. Saves that are ancestors of an annotation but not at or below the annotation level go in the uncategorized tab instead.
    2. **One tab for "unsubscribed" corpuses** — if the user unsubscribes from a corpus but still has saves associated with it, that corpus tab remains on the Saved Page marked "Unsubscribed." If all associated saves are removed, the unsubscribed tab disappears automatically.
    3. **One "Uncategorized" tab** — saves that don't appear in any corpus (or are only ancestors above annotation level) go here.
  - The same tree can appear in multiple corpus tabs (if the annotation concept exists in multiple corpuses). Unsaving removes it from all relevant tabs.
  - **No tab picker on save** — when saving a concept, it just saves. The tree automatically appears in the appropriate corpus tabs based on annotation membership.
  - **Tree reordering** is supported in all tabs on the Saved Page (same up/down arrow UI as before)
  - The existing `saved_tree_order` table continues to work, keyed per Saved Page tab
  - **Database implications:** The `saved_tabs` and `vote_tab_links` tables from Phase 5b are retired. Saved Page corpus tabs are dynamically generated views based on `corpus_subscriptions` + `document_annotations` + `votes`/`edges` relationships. The `subscription_tab_links` table from Phase 9a is no longer needed. The `saved_tree_order` table needs a new keying mechanism (corpus_id instead of saved_tab_id, plus a special key for the uncategorized tab).

#### Phase 7d: Annotation Creation & Edge Linking

- **Text Selection → Edge Annotation**
  - Users select a portion of text (or the whole document) and attach an edge as an annotation
  - Annotations store character offsets (start_position, end_position) against the immutable document body
  - **Annotations are scoped to the corpus** — the same document in different corpuses has entirely separate annotation sets
  - The attached edge represents a concept-in-context (specific path + attribute), linking the annotation into the graph
  - Clicking any annotation navigates to that concept in context in a graph tab

- **Concept Suggestion (Keyword Matching)**
  - When creating an annotation, Orca suggests existing concepts that match the selected text using pg_trgm trigram matching (same infrastructure as the existing search field)
  - User can accept a suggestion or manually search for a different concept to attach
  - **Future:** Semantic similarity suggestions via pgvector embeddings when the corpus is large enough

- **Bidirectional Linking — External Links Page (Corpus/Document Section)**
  - When an edge is attached as an annotation, the document (within its corpus) appears in that edge's **External Links** page in a "Document Annotations" section (separate from the "Web Links" section built in Phase 6)
  - Documents are **grouped by corpus** — each corpus that contains documents annotated with this concept appears as a collapsible group
  - Each document entry shows: document title, a snippet of the annotated text, and a link to jump to the annotation
  - **Clicking a corpus** opens that corpus as a standalone corpus tab (inline with other tabs in the tab bar)
  - **Clicking a doc** within a corpus opens that corpus tab and automatically navigates to the document, scrolling to the annotation of this concept
  - Users can vote on specific document annotations using the `annotation_votes` table (Phase 7f — ✅ IMPLEMENTED) — these votes drive sort order

- **Corpus/Document Sort Modes (External Links Page)**
  - Three sort modes for the corpus/document section:
    1. **By votes** (default) — Corpuses ordered by their top document's annotation vote count; documents within each corpus also sorted by annotation votes descending
    2. **By newest annotation** — Corpuses ordered by their most recently annotated document (for this concept); documents within each corpus also sorted by annotation recency
    3. **By subscriber count** — Corpuses ordered by number of subscribers; documents within each corpus sorted by annotation votes descending
  - **Corpus groups are atomic in sorting** — all documents in a corpus stay together regardless of sort mode. A lower-voted or older document remains within its corpus group even if individually it would rank below docs in other corpuses. The corpus group's position is determined by its top-ranked document (for votes/new sorts) or subscriber count.
  - Within each corpus group, if multiple documents have this concept annotated, they are ordered by the active sort's secondary criterion (votes for modes 1 and 3, recency for mode 2)

- **Database:** New `document_annotations` table:
  ```sql
  CREATE TABLE document_annotations (
    id SERIAL PRIMARY KEY,
    corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
    start_position INTEGER NOT NULL,
    end_position INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

### ✅ Completed (Phase 7e) — Decontextualized Document View + Add Existing Document

- **Backend: Cross-Corpus Annotations Endpoint**
  - `GET /api/corpuses/annotations/document/:documentId` — returns ALL annotations for a document across ALL corpuses, guest-accessible
  - Duplicate merging: annotations with the same text range (start_position + end_position) and same edge_id in multiple corpuses are merged into a single entry with a `corpuses` array listing all corpus attributions
  - Response includes `totalAnnotations` (raw count) and `uniqueAnnotations` (after merging)

- **Backend: Document Search Endpoint**
  - `GET /api/corpuses/documents/search?q=QUERY&excludeCorpusId=N` — searches documents by title using case-insensitive partial match (ILIKE)
  - Excludes documents already in the specified corpus
  - Returns up to 10 results, each with a list of corpuses the document currently belongs to
  - Used by the "Add Existing Document" UI in both CorpusDetailView and CorpusTabContent

- **Frontend: DecontextualizedDocView Component (NEW)**
  - Read-only document viewer showing ALL annotations from ALL corpuses
  - Blue-tinted annotation highlights (vs gold in contextualized view) to visually distinguish the mode
  - Multi-corpus annotations shown with dashed underline
  - Right-side detail panel shows full concept path, "Navigate to concept →" button, and corpus attribution section listing every corpus where the annotation exists
  - Each corpus in the panel is clickable — subscribes to the corpus and switches to its tab with the document auto-opened
  - "All corpuses view" badge and "read-only" notice displayed in header
  - "In corpuses:" links in the document info header are clickable, opening that corpus tab

- **Frontend: "All Corpuses View" Toggle (CorpusTabContent)**
  - Blue pill button appears in the contextualized document viewer header when the document exists in 2+ corpuses
  - Clicking switches to DecontextualizedDocView; back button returns to the contextualized view within the same corpus

- **Frontend: Clickable Corpus Links (CorpusTabContent)**
  - "In corpuses:" list in document info header now has clickable links for non-current corpuses
  - Clicking subscribes to that corpus and opens the document there via the pending document pattern

- **Frontend: "Add Existing Document" UI (CorpusDetailView + CorpusTabContent)**
  - "+ Add Existing Document" button appears next to "+ Upload Document" for corpus owners
  - Opens a search panel: type a document title, press Enter or click Search
  - Results show document title, format, uploader, date, and which corpuses the document is already in
  - Documents already in the current corpus are excluded from results
  - "+ Add" button on each result adds the document to the corpus immediately
  - Available in both CorpusDetailView (Corpuses overlay) and CorpusTabContent (corpus tabs)

- **Prop Threading**
  - `onOpenCorpusTab` prop added to CorpusTabContent (passed from AppShell as `handleSubscribeToCorpus`)
  - DecontextualizedDocView receives: `documentId`, `onBack`, `onOpenCorpusTab`, `onOpenConceptTab`, `backLabel`

- **Files Changed**
  - `corpusController.js` — 2 new endpoints: `getAllDocumentAnnotations`, `searchDocuments`
  - `corpuses.js` routes — 2 new routes: `GET /annotations/document/:documentId`, `GET /documents/search`
  - `api.js` frontend — 2 new API methods: `getAllDocumentAnnotations`, `searchDocuments`
  - New `DecontextualizedDocView.jsx` — full read-only cross-corpus annotation viewer
  - `CorpusTabContent.jsx` — decontextualized view toggle, clickable corpus links, add-existing-document UI
  - `CorpusDetailView.jsx` — add-existing-document UI
  - `AppShell.jsx` — passes `onOpenCorpusTab` to CorpusTabContent

#### Phase 7e: Decontextualized Document View — ✅ COMPLETE

- **Cross-Corpus Annotation View**
  - Full specification is in Phase 7c under "Document View — Decontextualized"
  - Key behavior: shows ALL annotations from ALL corpuses, one at a time in a right-side panel, with corpus attribution and clickable corpus links to jump into corpus tabs
  - This view is **read-only** — no voting, no adding annotations
  - **Duplicate annotation handling:** If the exact same text range is associated with the exact same edge in multiple corpuses, all corpuses are listed together on that annotation's panel entry (each clickable)

### ✅ Completed (Phase 7f) — Annotation Voting, Color Set Voting, Corpus Tab Grouping

- **Backend: Annotation Votes (7f-1)**
  - `annotation_votes` table: `UNIQUE(user_id, annotation_id)`, index on `annotation_id`
  - `POST /annotations/vote` — endorse an annotation (insert or no-op on conflict), returns updated `voteCount`
  - `POST /annotations/unvote` — remove endorsement, returns updated `voteCount`
  - `getDocumentAnnotations` query updated to include `vote_count` and `user_voted` per annotation (uses subquery for count, EXISTS for user status)

- **Backend: Color Set Voting (7f-2)**
  - `annotation_color_set_votes` table: `UNIQUE(user_id, annotation_id)`, stores `vote_set_key` (sorted comma-separated edge IDs)
  - `POST /annotations/color-set/vote` — upsert user's preferred vote set key, returns all color set votes grouped by key
  - `POST /annotations/color-set/unvote` — remove preference, returns remaining votes
  - `GET /annotations/:annotationId/color-sets` — guest-accessible, returns grouped votes + user's current preference

- **Backend: Corpus Tab Grouping**
  - `group_id` column added to `corpus_subscriptions` table (nullable FK to `tab_groups`, `ON DELETE SET NULL`)
  - `getMySubscriptions` now returns `group_id` in response
  - `addTabToGroup` / `removeTabFromGroup` / `deleteTabGroup` in votesController updated to handle `tabType === 'corpus'` via `corpus_subscriptions` table

- **Frontend: Annotation Voting UI (7f-1)**
  - Annotation detail sidebar shows vote button: △ (unvoted) / ▲ (voted) with count and "endorsements" label
  - Guest users see read-only vote count (no button)
  - Annotation highlights show small amber vote count badge (superscript) when vote_count > 0
  - Local state updates optimistically on vote/unvote (annotations array + selectedAnnotation)

- **Frontend: Color Set Picker (7f-2)**
  - "🎨 Color set preference" button in annotation detail sidebar (below vote button, above navigate button)
  - Clicking fetches both the concept's vote sets (`getVoteSets`) and existing color set votes (`getAnnotationColorSets`) in parallel
  - Shows clickable color swatches from the VoteSetBar palette (imports `getSetColor`)
  - Selected swatch gets outline highlight; clicking again removes preference
  - Shows "Your preference: [color name]" and "Leading: [color name] (N votes)" when applicable
  - Empty state message when the concept has no children vote sets (needs 2+ users saving same children)
  - Resets when changing selected annotation

- **Frontend: Corpus Tab Grouping**
  - Corpus tabs now load `group_id` from subscription data
  - `buildTabBarItems` places grouped corpus tabs inside their group (ungrouped ones remain at top)
  - New `renderCorpusTabButton` function with right-click context menu support (Add to group / Remove from group)
  - `handleAddTabToGroup` / `handleRemoveTabFromGroup` / `handleDeleteGroup` all handle `tabType === 'corpus'`
  - `groupContainsActiveTab` checks corpus tabs
  - Context menu renders group actions for corpus tabs

- **Frontend: Auto-Group on Navigate-to-Concept**
  - `handleOpenConceptTab` accepts optional 5th parameter `sourceCorpusTabId`
  - When called from CorpusTabContent annotation sidebar, passes the corpus tab ID
  - If corpus tab is already in a group → new graph tab joins the same group
  - If corpus tab is ungrouped → creates a new group named after the corpus, adds both corpus tab and graph tab to it
  - Other callers (Concept page, Saved page) pass no 5th arg → no grouping (backward compatible)

- **Frontend: Document Persistence on Tab Switch**
  - Corpus tabs now render like graph tabs: all mounted simultaneously, hidden with `display: none` when inactive
  - Previously, only the active corpus tab rendered (conditional mount), causing document state to reset when switching tabs
  - Now switching to a graph tab and back to a corpus tab preserves the open document, scroll position, selected annotation, etc.

- **Files Changed (7f-1 + 7f-2 combined)**
  - `migrate.js` — 2 new tables (`annotation_votes`, `annotation_color_set_votes`), `group_id` column on `corpus_subscriptions`
  - `corpusController.js` — `getDocumentAnnotations` updated with vote_count/user_voted; `getMySubscriptions` returns group_id; 5 new endpoints (voteOnAnnotation, unvoteAnnotation, voteAnnotationColorSet, unvoteAnnotationColorSet, getAnnotationColorSets)
  - `votesController.js` — `addTabToGroup`, `removeTabFromGroup`, `deleteTabGroup` updated for corpus tab type
  - `corpuses.js` routes — 5 new routes for annotation voting + color set voting
  - `api.js` frontend — 5 new API methods
  - `CorpusTabContent.jsx` — annotation vote handlers + UI, color set handlers + picker UI, imports `getSetColor`
  - `AppShell.jsx` — corpus tab grouping, auto-group on navigate, document persistence (display:none rendering), renderCorpusTabButton, context menu for corpus tabs

#### Phase 7f: Color Set Selection & Voting on Annotations — ✅ COMPLETE

- **Annotation Endorsement Voting (7f-1)**
  - On public-annotation corpuses, any logged-in user can see all annotations added by anyone
  - Users can endorse specific annotations (endorsing the connection between that text and that edge)
  - Annotation votes use the same simple endorsement model as web link upvotes (one vote per user per annotation)
  - Vote count displayed on annotation highlights (small amber badge) and in the annotation detail sidebar

- **Color Set Selection (Deferred, Not On-Creation) (7f-2)**
  - Color set selection does NOT happen during annotation creation — creation stays fast with no extra step
  - Instead, users click "🎨 Color set preference" in the annotation detail sidebar at any time
  - This fetches the annotated concept's children's vote sets and shows clickable color swatches
  - Users can navigate to the concept in a graph tab first (via "Navigate to concept →") to explore color sets, then return to the document and pick one
  - The annotator's chosen color set is the default view unless outvoted

- **Color Set Voting**
  - Other users can vote for the annotator's color set or vote for alternative color sets
  - Color set votes are per-annotation, consistent with all other voting in Orca
  - The winning color set (most votes) is displayed; annotator's choice stands if no one else votes
  - Users can change their preference at any time (upsert model)

- **Corpus Tab Grouping (UX Enhancement)**
  - Corpus tabs can now join tab groups alongside graph tabs
  - `group_id` column added to `corpus_subscriptions` table
  - Right-click context menu on corpus tabs supports group management
  - When "Navigate to concept →" is clicked from an annotation sidebar, the new graph tab is auto-grouped with the source corpus tab

- **Document Persistence on Tab Switch (UX Fix)**
  - Corpus tabs are now rendered simultaneously with `display: none` (matching graph tab pattern)
  - Open documents, scroll position, and selected annotations survive tab switching

- **Database:** `annotation_votes` table, `annotation_color_set_votes` table (both new), `group_id` column on `corpus_subscriptions`

#### Phase 7g: Combined Public/Private Model with Allowed Users

Every corpus exists in a **combined state** — it always has both a public layer and a private (allowed-users) layer. There is no binary public/private toggle.

- **Allowed Users (Corpus-Level)**
  - The corpus owner can generate an invite link to add **allowed users** to the corpus
  - Allowed users can: add documents to the corpus, add annotations, add annotation votes (including color set votes) to the **private layer** of any document in the corpus
  - Allowed users can also create new document versions (see Phase 7h: Document Versioning)
  - The allowed-user concept lives at the corpus level and applies uniformly to all documents within it
  - Allowed users can create a display username visible only within that corpus's annotation layer, only to other allowed users
  - Usernames are NOT displayed anywhere else in Orca — this was always the design intent

- **Public Layer (Always Present)**
  - Any logged-in Orca user can add annotations, votes, and color set votes to the **public layer** of any document in any corpus
  - The public layer is always visible by default

- **Private Layer Filtering**
  - Allowed users can toggle a filter to show **only** annotations, votes, and color set votes added by other allowed users of the corpus
  - This filter hides all public-layer content that wasn't contributed by allowed users
  - Non-allowed users cannot see or access the private layer — they only see the public layer

- **Allowed User Annotation Removal with Changelog**
  - Allowed users can remove annotations from documents in the corpus
  - Every removal is logged in a changelog: who removed it, when, and what the annotation was (concept, text selection, creator)
  - The changelog is visible to all allowed users of the corpus
  - This provides accountability for curation decisions within the allowed-user group

- **Corpus Owner Powers**
  - Only the corpus owner can: add/remove allowed users, remove documents from the corpus, delete the corpus
  - Corpus owners can remove docs from their corpus; the doc is only deleted if no other corpus contains it (unless uploaded by an allowed user — those are left orphaned for rescue per Phase 9b)

- **Hiding Does Not Apply to Annotations**
  - If a concept is spammy/abusive, it should be hidden at the graph level, which prevents it from being used as an annotation
  - No separate hiding mechanism needed for annotations themselves

- **Database:** New `corpus_allowed_users` table:
  ```sql
  CREATE TABLE corpus_allowed_users (
    id SERIAL PRIMARY KEY,
    corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(255),
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(corpus_id, user_id)
  );
  ```
  New `annotation_removal_log` table:
  ```sql
  CREATE TABLE annotation_removal_log (
    id SERIAL PRIMARY KEY,
    corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    edge_id INTEGER REFERENCES edges(id) ON DELETE SET NULL,
    start_position INTEGER NOT NULL,
    end_position INTEGER NOT NULL,
    original_creator INTEGER REFERENCES users(id) ON DELETE SET NULL,
    removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
  Annotations also need a new `layer` column:
  ```sql
  ALTER TABLE document_annotations ADD COLUMN layer VARCHAR(10) NOT NULL DEFAULT 'public';
  -- layer is 'public' or 'private'
  ```

#### Phase 7h: Document Versioning

Users can copy a document to a new version within the same corpus. Versions are tracked separately from the document title to avoid naming collisions.

- **Creating a New Version**
  - Any allowed user of a corpus can click a document and copy it to a new version
  - The new version is automatically added to the same corpus as the source document
  - Text content and annotations copy over from the source version
  - The new version's owner is the user who created it (not the original document's uploader)
  - The owner can edit the text content of their new version

- **Version Numbering**
  - Version numbers are stored as a separate field on the `documents` table, not embedded in the title
  - This prevents naming collisions (e.g., someone else titling a document "My Doc v2" independently)
  - Version numbers are auto-incremented per document lineage (v1, v2, v3...)
  - A `source_document_id` field tracks which document a version was copied from, forming a version chain

- **Annotation Behavior on Versioned Documents**
  - Annotations from the source document are copied to the new version at creation time
  - The owner can edit the new version's text. If editing removes or modifies the highlighted text region for an annotation, that annotation is removed from both public and private layers
  - Annotations on the new version's **public layer** cannot be directly removed by the owner — only by editing away the underlying text
  - Annotations on the **private layer** follow normal allowed-user removal rules (with changelog)

- **Document Immutability Exception**
  - Documents are still immutable once finalized — but newly created versions start in an **editable draft state** until the owner marks them as finalized
  - Once finalized, the document becomes immutable (same as all other documents), and character offsets for annotations are locked
  - This preserves the annotation offset guarantee while allowing version owners to make changes before committing

- **Database changes:**
  ```sql
  ALTER TABLE documents ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE documents ADD COLUMN source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
  -- is_draft column was added in Phase 7h and removed in Phase 21a
  ```

### ✅ Completed (Phase 7i-1 + 7i-2) — Concept Linking Backend & Underline Display

- **Backend: `POST /api/concepts/find-in-text` Endpoint (7i-1)**
  - Accepts `{ text }` in the POST body, returns all concept names found as whole words in the text
  - Loads all concepts sorted by name length descending (longer matches take priority)
  - Uses regex with `\b` word boundaries for case-insensitive whole-word matching
  - Escapes regex special characters in concept names
  - Returns non-overlapping matches sorted by position (earlier/longer match wins)
  - Each match includes `conceptId`, `conceptName`, `start`, `end` (character offsets)
  - Guest-accessible via `optionalAuth`
  - No database migration required — reads from existing `concepts` table

- **Frontend: Concept Link Underlines on Finalized Documents (7i-2)**
  - New state: `conceptLinks`, `conceptLinksLoading` in CorpusTabContent
  - `handleOpenDocument` calls `loadConceptLinks(doc.body)` for finalized (non-draft) documents
  - `buildAnnotatedBody` rewritten to weave concept link underlines into plain-text gaps between annotations — annotations always take priority over concept links
  - New `addTextWithConceptLinks` helper splits plain-text segments into sub-segments with `type: 'conceptLink'`
  - Rendering handles `seg.type === 'conceptLink'` with a subtle dotted underline (`borderBottom: '1px dotted rgba(100, 100, 100, 0.45)'`)
  - Clicking a concept link opens **decontextualized Flip View** in a new graph tab via `onOpenConceptTab` with `viewMode: 'flip'`
  - Concept links cleared on back navigation to document list

- **AppShell: `handleOpenConceptTab` viewMode Parameter**
  - `handleOpenConceptTab` now accepts optional 6th parameter `viewMode` (default: `'children'`)
  - Both guest and logged-in code paths use `effectiveViewMode` instead of hardcoded `'children'`
  - `tabType` logic changed from `path.length === 0 ? 'root' : 'concept'` to `conceptId ? 'concept' : 'root'` — ensures a concept with no path context (decontextualized) still creates a `'concept'` type tab
  - Wrapper arrow function on CorpusTabContent's `onOpenConceptTab` prop updated to pass `viewMode` through (was previously silently dropping it)

- **Bug Fix: Version Creation Across Corpuses (Phase 7h)**
  - `createVersion` no longer requires the source document to be in the requesting corpus — supports cross-corpus version history navigation
  - New versions are auto-added to ALL corpuses the source document belongs to (via loop over `corpus_documents` rows with `ON CONFLICT DO NOTHING`)
  - Current corpus also gets the new version as a safety net (in case source was reached via version history from a corpus it wasn't in)

- Files changed: `conceptsController.js` (new `findConceptsInText` endpoint), `concepts.js` routes (new `POST /find-in-text` route), `api.js` frontend (new `findConceptsInText` API method), `CorpusTabContent.jsx` (concept link state, loading, segment building, rendering, click handler), `AppShell.jsx` (`handleOpenConceptTab` viewMode parameter, tabType logic fix, wrapper arrow function fix), `corpusController.js` (`createVersion` cross-corpus fix)

### ✅ Completed (Phase 7i-3) — Disambiguation Picker — SKIPPED

- **Decision:** Disambiguation is unnecessary under the current data model. Concept names are globally unique in the `concepts` table — the same text string maps to exactly one concept row. Different attributes ([action], [tool], [value], [question]) exist on edges, not on the concept itself. The decontextualized Flip View already shows all attribute contexts for a concept, which aligns better with Orca's creative exploration philosophy (showing users more rather than forcing them to narrow down upfront).

### ✅ Completed (Phase 7i-4) — Live Concept Linking During Draft Editing & Upload

- **Debounced Live Matching**
  - New state: `draftConceptLinks` (for draft editing), `uploadConceptLinks` (for document upload)
  - Two `useEffect` hooks with 500ms debounce timers that call `findConceptsInText` when `draftBody` or `uploadBody` changes
  - Auto-clear when respective mode is exited (save, cancel, upload complete, back-to-list)

- **Preview Panels**
  - New `buildConceptLinkSegments(text, links)` helper — takes raw text and concept link matches, returns array of `{ type: 'text' }` and `{ type: 'conceptLink' }` segments
  - **Draft editing:** Below the textarea and action buttons, a "Concept links found (N)" preview panel shows the full text with dotted underlines on matched concepts. Clickable — opens decontextualized Flip View.
  - **Upload form:** Same preview panel between the Upload button and the duplicate matches panel
  - Preview body has max 200px height with scroll, uses same `conceptLinkUnderline` style as finalized document underlines

- **Finalization Trigger**
  - After `handleFinalizeDraft` completes, concept links are loaded for the now-finalized document so underlines appear immediately without a page refresh

- Files changed: `CorpusTabContent.jsx` (new state variables, debounced effects, buildConceptLinkSegments helper, preview panel JSX in both draft editing and upload sections, cleanup in save/cancel/back handlers, conceptLinkPreview styles)

### ✅ Completed (Phase 7i-5) — Concept Link Caching for Finalized Documents

- **New Table: `document_concept_links_cache`**
  - Stores pre-computed concept link matches for finalized (immutable) documents
  - Columns: `document_id` (FK), `concept_id`, `concept_name`, `start_position`, `end_position`, `computed_at`
  - Indexed on `document_id` for fast lookups

- **New Endpoint: `GET /api/concepts/document-links/:documentId`**
  - Checks if document is finalized (drafts return empty — frontend uses `findConceptsInText` directly for those)
  - If cached entries exist, compares `computed_at` against `MAX(concepts.created_at)` — if no newer concepts exist, serves from cache
  - If cache is stale or missing, recomputes using same regex matching logic as `findConceptsInText`, stores results in cache (atomic DELETE + INSERT in transaction), returns results
  - Guest-accessible via `optionalAuth`
  - Graceful degradation: if cache write fails, computed results are still served

- **Frontend: `loadConceptLinks` Updated**
  - `loadConceptLinks` now takes `documentId` instead of `bodyText` and calls the cached `getDocumentConceptLinks` endpoint
  - Both call sites updated: `handleOpenDocument` (document open) and `handleFinalizeDraft` (post-finalization)
  - Live linking during editing (7i-4) still uses `findConceptsInText` directly — only finalized documents use the cache

- Files changed: `migrate.js` (new `document_concept_links_cache` table), `conceptsController.js` (new `getDocumentConceptLinks` endpoint), `concepts.js` routes (new `GET /document-links/:documentId` route), `api.js` frontend (new `getDocumentConceptLinks` API method), `CorpusTabContent.jsx` (`loadConceptLinks` updated to use cached endpoint by document ID)

### Phase 7i: COMPLETE ✅

### ✅ Completed (Phase 7c Saved Page Overhaul) — Corpus-Based Save Grouping

- **Saved Page Auto-Grouping by Corpus**
  - The Saved Page now automatically groups saves into tabs based on corpus annotation membership
  - No more manual tab picker on the ▲ save button — clicking ▲ just saves, placement is automatic
  - One tab per corpus that has matching saves (subscribed or unsubscribed), plus an "Uncategorized" tab for saves not in any corpus
  - Unsubscribed corpus tabs show an "unsubscribed" badge and italic styling
  - An edge belongs to a corpus if it (or any descendant saved edge) has an annotation in that corpus
  - The backend propagates corpus associations upward from annotated edges to ancestor saved edges

- **New Backend Endpoint: `GET /api/votes/saved-by-corpus`**
  - Returns all user saves grouped by corpus (via annotation lookup), with an uncategorized bucket
  - Step 1: fetch all user saves (same query as `getUserSaves`)
  - Step 2: find all annotations on saved edges via `document_annotations`
  - Step 3: propagate corpus associations upward through ancestor saved edges
  - Step 4: group edges by corpus, look up corpus names and subscription status
  - Response: `{ corpusTabs: [{ corpusId, corpusName, isSubscribed, edges }], uncategorizedEdges, conceptNames }`

- **New Database Table: `saved_tree_order_v2`**
  - Replaces `saved_tree_order` (which keyed on `saved_tab_id` from the retired manual tabs)
  - Keyed on `(user_id, corpus_id, root_concept_id)` — NULL corpus_id for Uncategorized tab
  - Uses PostgreSQL partial unique indexes to handle NULL vs non-NULL corpus_id
  - New endpoints: `GET /tree-order-v2`, `POST /tree-order-v2/update`

- **Simplified Save Flow (Tab Picker Removed)**
  - `addVote` no longer accepts `tabId` parameter
  - `vote_tab_links` insertion removed from save flow (backwards-compat linking to first tab retained during transition)
  - `ConceptGrid.jsx` tab picker dropdown removed entirely; `userTabs` prop removed
  - `Root.jsx` and `Concept.jsx` no longer accept or thread `savedTabs` prop
  - `AppShell.jsx` no longer passes `savedTabs` to Root/Concept components

- **Rewritten Components**
  - `SavedPageOverlay.jsx` — completely rewritten: loads saves via `getUserSavesByCorpus`, auto-generates corpus tabs + uncategorized tab, passes pre-grouped edges to `SavedTabContent`
  - `SavedTabContent.jsx` — rewritten to receive edges as props (instead of fetching internally), uses v2 tree ordering keyed by `corpusId`
  - Unsaving from the Saved Page uses `removeVote` (full unsave with cascade) and reloads all data since unsaving affects corpus grouping

- **Tables Functionally Retired (Still in DB)**
  - `saved_tabs` — no longer drives tab organization (tabs are now auto-generated from corpus membership)
  - `vote_tab_links` — no longer used for save organization (saves are grouped dynamically)
  - `saved_tree_order` — replaced by `saved_tree_order_v2`
  - These tables remain in the database for backwards compatibility but are no longer actively written to by the new code path

- Files changed: `migrate.js` (new `saved_tree_order_v2` table with partial unique indexes), `votesController.js` (new `getUserSavesByCorpus` endpoint, `getTreeOrderV2`/`updateTreeOrderV2` endpoints, simplified `addVote` removing tabId), `votes.js` routes (3 new routes: `saved-by-corpus`, `tree-order-v2`, `tree-order-v2/update`), `api.js` frontend (new `getUserSavesByCorpus`/`getTreeOrderV2`/`updateTreeOrderV2` methods, simplified `addVote` signature), `SavedPageOverlay.jsx` (complete rewrite for corpus-based tabs), `SavedTabContent.jsx` (rewritten to receive edges as props + v2 tree order), `ConceptGrid.jsx` (tab picker removed, `userTabs` prop removed), `AppShell.jsx` (`savedTabs` prop removed from Root/Concept), `Root.jsx` (`savedTabs` prop removed, `handleVote` simplified), `Concept.jsx` (`savedTabs` prop removed, `userTabs` state removed, `handleVote` simplified)

### ✅ Completed (Post-Phase 7 cleanup) — Dead Code Removal, Document Favoriting, Search Corpus Annotations

- **Dead `savedTabs` Code Removed from AppShell**
  - `savedTabs` / `setSavedTabs` state removed entirely
  - `votesAPI.getUserTabs()` call removed from `loadAllTabs` (saves one API call per page load)
  - `savedTabs` removed from `useCallback` dependency array
  - `tabType === 'saved'` branches removed from `handleDeleteGroup`, `handleAddTabToGroup`, `handleRemoveTabFromGroup`
  - Files changed: `AppShell.jsx`

- **Per-Corpus Document Favoriting**
  - New `document_favorites` table: `UNIQUE(user_id, corpus_id, document_id)`
  - ☆/★ star button on each document card in corpus tabs (not visible to guests)
  - Clicking toggles favorite — favorited docs sort to the top of the document list
  - Per-corpus: favoriting in Corpus A doesn't affect the doc's position in Corpus B
  - Warm amber (goldenrod) color for filled star, consistent with Orca's design language
  - Backend: `toggleDocumentFavorite` (toggle insert/delete), `getDocumentFavorites` (returns list of favorited doc IDs)
  - Frontend: favorites loaded on corpus load, optimistic state update on toggle, sort applied client-side
  - Files changed: `migrate.js` (new `document_favorites` table), `corpusController.js` (2 new endpoints), `corpuses.js` routes (2 new routes), `api.js` frontend (2 new API methods), `CorpusTabContent.jsx` (favorite state, toggle handler, star button, sort logic)

- **Search Results Surface Corpus Annotations**
  - When a logged-in user searches, results that appear as annotations in their subscribed corpuses now show a 📚 badge with corpus names
  - Backend: new query joins `document_annotations` → `edges` → `corpuses` → `corpus_subscriptions` to find which search results have annotations in subscribed corpuses
  - Returns `corpusAnnotations` array per result: `[{ corpusId, corpusName }, ...]`
  - Sort updated: results with saved tabs OR corpus annotations float to the top (previously only saved tabs)
  - Frontend: section header changed from "In your saved tabs" to "In your saves / corpuses"
  - Corpus badge uses subtle blue-tinted background (`#e8e8f0`), visually distinct from green saved-tab badges (`#e8f0e8`)
  - Both badges can appear on the same result if a concept is both saved and annotated in a corpus
  - Files changed: `conceptsController.js` (new corpus annotation query in `searchConcepts`, updated sort logic), `SearchField.jsx` (corpus badge rendering, updated section header/divider logic, new `corpusBadge` style)

### ✅ Completed (Phase 8) — Inactive Corpus Tab Dormancy

Replaces the original "inactive user filtering" concept. Instead of tracking user-level activity, Orca tracks **per-corpus-tab** activity on the Saved Page. Corpus tabs that haven't been opened for 30 days go dormant via a background job. A simplified dormancy model excludes all of a user's votes from public save totals only when every one of their tabs is dormant.

- **Phase 8a: Backend Infrastructure**
  - New `saved_page_tab_activity` table with `UNIQUE(user_id, corpus_id)` constraint and partial unique index for NULL corpus_id (Uncategorized tab)
  - Migration backfills activity rows for all existing users (`last_opened_at = NOW()`) so nobody is instantly dormant
  - Required `NULL::INTEGER` cast for PostgreSQL type inference in the backfill INSERT (bare `NULL` caused a "column is of type integer but expression is of type text" error)
  - 3 new endpoints: `GET /tab-activity`, `POST /tab-activity/record`, `POST /tab-activity/revive`
  - New `check-dormancy.js` background job script — marks tabs dormant when `last_opened_at` is older than 30 days
  - New npm script: `npm run check-dormancy` (meant to be run via cron/Task Scheduler daily)
  - Files changed: `migrate.js`, `votesController.js`, `votes.js` routes, `package.json`, new `check-dormancy.js`

- **Phase 8b: Save Count Exclusion**
  - `DORMANT_USERS_SUBQUERY` constant defined in both `conceptsController.js` and `votesController.js` — reusable SQL snippet that finds users where ALL `saved_page_tab_activity` rows have `is_dormant = true`
  - **Architecture Decision #43 — Simplified Dormancy Model:** A user's votes are excluded from ALL public save counts if and only if every one of their `saved_page_tab_activity` rows is dormant. If even one tab is active, all votes count everywhere. Users with zero activity rows are NOT dormant. This avoids per-edge, per-corpus filtering complexity while still achieving inactive-user vote suppression.
  - Filter applied to 13 queries total: root page save counts, children save counts, current edge vote count (root + non-root), flip view (contextual + exploratory), vote set membership, addVote/removeVote/removeVoteFromTab response counts, getUserSaves (tab-filtered + unfiltered), getUserSavesByCorpus
  - Move, swap, and link votes are unaffected — only save vote counts are filtered
  - Files changed: `conceptsController.js`, `votesController.js`

- **Phase 8c: Frontend — Activity Tracking, Dormancy Display & Revival**
  - 3 new API methods in `api.js`: `getTabActivity`, `recordTabActivity`, `reviveTabActivity`
  - `SavedPageOverlay.jsx` rewritten with dormancy support:
    - Loads saves and tab activity in parallel on mount
    - Records activity when switching to a non-dormant tab (keeps it active)
    - Dormant tabs dimmed to 45% opacity with gray "dormant" badge
    - Smart initial tab selection: picks first non-dormant tab; if all dormant, shows "All your saved tabs are dormant" message
    - Clicking a dormant tab opens a revival modal: "Revive my votes" or "View without reviving"
    - "View without reviving" shows tab contents with a persistent info bar and inline "Revive" button
    - `allTabsDormant` computed flag drives context-aware messaging: if all tabs dormant, modal says "your save votes are currently not counted"; if only some dormant, says "your votes still count because you have other active tabs"
  - Styling follows Orca's Zen aesthetic: EB Garamond serif font, off-white modal, black/gray tones, warm amber for dormant info bar
  - Files changed: `api.js`, `SavedPageOverlay.jsx`

### Phase 9: Corpus Deletion & Orphan Rescue

#### Phase 9a: Corpus Subscriptions — ✅ ALREADY IMPLEMENTED (Phase 7c)

Corpus subscriptions were built in Phase 7c. This sub-phase is retained for reference only.

- **Corpus Subscriptions**
  - Users can subscribe to any corpus
  - **Subscribing adds the corpus as a persistent tab** in the main tab bar (see Phase 7c "Corpus Tabs Are Persistent")
  - **Subscribing also creates a corresponding corpus tab on the Saved Page** (but only if the user has saves associated with that corpus — otherwise only the main tab bar tab appears)
  - Unsubscribing removes the corpus from the main tab bar; any saves associated with that corpus remain on the Saved Page in an "Unsubscribed" corpus tab until the user removes those saves
  - Subscriber count is displayed on corpus listings (e.g., in "View in other corpuses")

#### Phase 9b: Corpus Deletion with Orphan Rescue — ✅ COMPLETE

When a corpus is deleted (or a document is removed from a corpus), orphaned documents uploaded by allowed users are no longer auto-deleted. Instead they persist in the database with zero corpus memberships until the author rescues or dismisses them.

- **Modified Corpus Deletion (`deleteCorpus` in `corpusController.js`)**
  - Before deleting, identifies documents that will become orphaned (in this corpus only, not in any other)
  - Checks each orphan's `uploaded_by` against `corpus_allowed_users` for the corpus
  - If uploader is an allowed user (not the corpus owner): document is left orphaned (not deleted)
  - If uploader is the corpus owner (or not an allowed user): document is deleted as before
  - Response includes `documentsAwaitingRescue` count alongside existing `orphanedDocumentsRemoved`

- **Modified Document Removal (`removeDocumentFromCorpus` in `corpusController.js`)**
  - Same orphan rescue logic applied when removing a single document from a corpus
  - Also now deletes annotations for the document within the corpus before removing the link
  - Response includes `documentOrphaned` boolean alongside existing `documentDeleted`

- **Three New Backend Endpoints**
  - `GET /api/corpuses/orphaned-documents` — returns orphaned documents uploaded by the current user (documents with zero `corpus_documents` rows)
  - `POST /api/corpuses/rescue-document` — adds an orphaned document to a chosen corpus (user must own the doc and be owner/allowed user of the target corpus)
  - `POST /api/corpuses/dismiss-orphan` — permanently deletes an orphaned document (user must own the doc, doc must have zero corpus memberships)

- **Frontend: Orphan Rescue Modal (`OrphanRescueModal.jsx`)**
  - On app load, AppShell checks for orphaned documents (logged-in users only, non-blocking)
  - If orphans exist, modal pops up automatically listing each orphaned document
  - Per document: dropdown to select a target corpus (user's own corpuses + subscribed corpuses), "Rescue" button, "Dismiss" button
  - Inline "Create a new corpus" flow within the modal for users who need a new corpus to rescue into
  - "Dismiss all" button for bulk deletion (with confirmation prompt)
  - "Decide later" closes the modal; orphans persist and modal reappears on next app load
  - No expiry timer or background job — orphaned documents sit indefinitely until the user acts

- **Design Decisions**
  - No `pending_orphan_rescues` table needed — orphaned documents are simply documents with zero rows in `corpus_documents`, queried on the fly
  - No rescue window or expiry — simplifies implementation significantly vs. the original spec's deferred-deletion approach
  - Only `uploaded_by` is checked for rescue eligibility (not `added_by`) — covers the case where the actual author might lose their work
  - Zombie documents (orphans from users who never log in again) are negligible and can be cleaned up manually if needed

- **Files Changed**
  - `corpusController.js` — modified `deleteCorpus` and `removeDocumentFromCorpus`, added 3 new functions (`getOrphanedDocuments`, `rescueOrphanedDocument`, `dismissOrphanedDocument`)
  - `routes/corpuses.js` — 3 new routes (before parameterized `/:id` routes)
  - `api.js` frontend — 3 new methods on `corpusAPI` (`getOrphanedDocuments`, `rescueDocument`, `dismissOrphan`)
  - New `OrphanRescueModal.jsx` component
  - `AppShell.jsx` — import + state + mount useEffect for orphan check + modal rendering

### ✅ Completed (Phase 10) — Editorial Layer Rename + Quick Fixes

Small but important cleanup phase that addressed accumulated design debt.

- **Phase 10a: Rename "Private" Layer to "Editorial"**
  - Database migration: `UPDATE document_annotations SET layer = 'editorial' WHERE layer = 'private'`; same for `annotation_removal_log.annotation_layer`
  - **Visibility change:** Editorial-layer annotations are now visible to ALL users. Any user can read them and filter to see the editorial view. Only allowed users can *create* or *vote on* editorial-layer annotations.
  - Backend: `createAnnotation` accepts `'editorial'` instead of `'private'`; `getDocumentAnnotations` no longer hides editorial annotations from non-allowed users (removed `canSeePrivate` filtering); `deleteAnnotation` error messages updated; `voteOnAnnotation` and `voteAnnotationColorSet` now check editorial-layer permission (only allowed users can vote on editorial annotations)
  - Frontend: Layer filter toggle visible to ALL logged-in users (was restricted to allowed users); filter button text "Private" → "Editorial"; annotation highlights use `annotationHighlightEditorial` style (same green tint); layer badge shows "editorial"; annotation vote/color-set buttons hidden for non-allowed users on editorial annotations; read-only vote count shown for non-allowed users on editorial annotations
  - `AnnotationPanel.jsx`: header text "(private layer)" → "(editorial layer)"
  - Files changed: `migrate.js`, `corpusController.js`, `CorpusTabContent.jsx`, `AnnotationPanel.jsx`

- **Phase 10b: Remove Public/Private Toggle from Corpus Creation**
  - Removed `newMode` state and "Annotation mode: Public / Private" toggle from corpus creation form in `CorpusListView.jsx`
  - Hardcoded `'public'` in `corpusAPI.create()` call
  - Removed `annotation_mode` badge from corpus cards in the list (no longer meaningful)
  - Cleaned up 5 unused style objects (`modeRow`, `modeLabel`, `modeButton`, `modeButtonActive`, `modeBadge`)
  - The `annotation_mode` column on `corpuses` remains functionally retired (not dropped); creation defaults to `'public'` harmlessly
  - Files changed: `CorpusListView.jsx`

- **Phase 10c: Dormancy Warning on Login**
  - On AppShell mount (for logged-in users), calls `votesAPI.getTabActivity()` and counts dormant tabs
  - If any dormant tabs exist, shows a warm amber-tinted dismissable banner between the header and tab bar
  - Banner text: "You have X dormant saved tab(s). Visit them to confirm you still endorse these concepts."
  - Clicking the banner text opens the Saved Page overlay and dismisses the banner
  - ✕ button dismisses the banner; does not reappear until next login/page refresh (state-based, not persisted)
  - Frontend-only change — uses existing `getTabActivity` endpoint (response field: `res.data.activity`, dormant flag: `isDormant` camelCase)
  - Files changed: `AppShell.jsx`

### ✅ Completed (Phase 11) — Sort by Annotation Count

Adds a third sort option for child concepts: sort by how many corpus documents contain the child concept as an annotation.

- **Sort Dropdown UI** *(Note: dropdown replaced by flat horizontal toggle row in Phase 29c)*
  - Originally replaced the old cycling sort button with a `<select>` dropdown on both Root page and Concept page
  - Three options at Phase 11: `↓ Saves` (default), `↓ New`, `↓ Annotations` (fourth option `Top Annotation` added in Phase 29b; dropdown converted to flat button row in Phase 29c)
  - Frontend state changed from boolean `sortByNew` to string `sortMode` ('saves' | 'new' | 'annotations' | 'top_annotation')

- **Backend: `sort=annotations` Query Parameter**
  - `getRootConcepts`: Conditional `LEFT JOIN document_annotations da ON da.edge_id = root_e.id` and `COUNT(DISTINCT da.document_id) as annotation_count` — only added when `sort=annotations`
  - `getConceptWithChildren`: Same conditional join pattern on child edges
  - Order clause: `annotation_count DESC, vote_count DESC, c.name` (tiebreaker is save count, then alphabetical)
  - Conditional join avoids unnecessary overhead when sorting by saves or new

- **Files Changed**
  - `conceptsController.js` — conditional annotation join/select/order in `getRootConcepts` and `getConceptWithChildren`
  - `Root.jsx` — `sortByNew` boolean → `sortMode` string, button → select dropdown, new `sortSelect`/`sortSelectActive` styles
  - `Concept.jsx` — same `sortByNew` → `sortMode` refactor, button → select dropdown, matching styles

### ✅ Completed (Phase 12a) — Nested Corpus Infrastructure

- **Single-parent model:** `parent_corpus_id` column added to `corpuses` table (nullable, self-referencing FK with `ON DELETE SET NULL`). Simpler than the originally spec'd multi-parent junction table — a corpus can have only one parent. If someone needs a corpus accessible from two places, they can add the same documents to two separate corpuses.
- **Index on `parent_corpus_id`** for fast child lookups
- **Cycle prevention:** `isAncestor()` helper walks up the parent chain before allowing a new nesting link. Rejects if adding the link would create A→B→...→A loops.
- **Permission model:** Parent corpus owner AND allowed users can add/remove sub-corpuses (parallels document management)
- **Independent permissions:** Nesting is purely organizational — being an allowed user of a parent does NOT grant access to sub-corpuses
- **`createCorpus` updated** to accept optional `parentCorpusId` parameter (validates parent exists and user has permission)
- **`listCorpuses` and `getCorpus` updated** to return `parent_corpus_id` in response; `getCorpus` also returns `childCorpuses` array
- **4 new backend endpoints:** `POST /:parentId/add-subcorpus`, `POST /:parentId/remove-subcorpus`, `GET /:id/children`, `GET /:id/tree` (recursive CTE)
- **`corpus_subscriptions.group_id` retired:** Migration clears all existing values. Corpus tabs are now positioned by the tree structure, not flat groups.
- Files changed: `migrate.js`, `corpusController.js`, `corpuses.js` routes, `api.js` frontend

### ✅ Completed (Phase 12b) — Sidebar Redesign (⚠️ Superseded by Phase 19b/19c)

A major UI restructuring that replaces the horizontal tab bar with a vertical sidebar. **Note:** The three-section layout (CORPUSES / GRAPH GROUPS / GRAPHS) described below was replaced in Phase 19b with a single unified list, and drag-and-drop was added in Phase 19c.

- **Layout change:** `header → horizontal tab bar → content` replaced with `header → (sidebar + content)`. The sidebar is 220px wide on the left; the content area fills the rest.
- **Sidebar structure (three sections):**
  1. **Top:** "Saved" and "📚 Browse" action buttons (moved from the header)
  2. **Middle (scrollable tree):** Three labeled sections — **CORPUSES** (subscribed corpus tabs with 📚 icons, expandable for placed graph tabs and future sub-corpuses), **GRAPH GROUPS** (flat expandable groups containing graph tabs), **GRAPHS** (ungrouped, unplaced graph tabs with ⬡ icons)
  3. **Bottom:** "« Hide" button to collapse the sidebar
- **Active item highlighting:** Left border highlight + bold text (replaces old bottom-border active tab)
- **Collapsible sidebar:** Collapses to a thin 24px bar with a » expand button
- **Graph tabs** have a small ✕ close button; corpus tabs do not (unsubscribe to remove)
- **Tab groups** expand/collapse with ▾/▸ arrows (same functionality, now vertical layout). Rename via double-click and right-click context menus still work.
- **"+ New tab"** button at the bottom of the tree
- **Header simplified:** "Saved" and "📚 Corpuses" buttons removed from header (now in sidebar). Header shows only "orca" title + username + logout (or login/signup for guests).
- **Corpus tab context menu simplified:** Now shows only "Unsubscribe" since corpus tabs no longer participate in flat groups
- **All existing functionality preserved:** Content rendering (corpus tabs, graph tabs, overlays, modals) unchanged — only navigation presentation changed.
- Files changed: `AppShell.jsx` (complete rewrite of render section and styles)

### ✅ Completed (Phase 12c) — Graph Tab Placement in Corpus Tree

- **New `user_corpus_tab_placements` table** with `UNIQUE(user_id, graph_tab_id)` — a graph tab can be in at most one corpus per user
- **3 new backend endpoints:** `GET /votes/tab-placements`, `POST /votes/tab-placements/place` (upserts, also removes from flat group), `POST /votes/tab-placements/remove`
- **Placements loaded on mount** alongside graph tabs and groups via `Promise.all` in `loadAllTabs`
- **Right-click graph tab → "Place in corpus..."** opens a styled dropdown listing subscribed corpuses with 📚 icons. Clicking a corpus places the tab.
- **Placed graph tabs** appear indented under their corpus in the sidebar (with ⬡ icon). Corpus nodes auto-show expand arrow when they have placed graph tabs.
- **Right-click a placed graph tab** → "Remove from corpus" (returns to ungrouped GRAPHS section) or "Move to different corpus..." (reopens picker)
- **Mutual exclusion:** Placing in a corpus removes from flat group; adding to a flat group removes corpus placement. Backend handles both directions.
- **Learning: Always run `npm run migrate` before restarting the server** when new tables are added. Otherwise endpoints querying those tables fail, and `Promise.all` chains that include those endpoints will fail silently — causing unrelated data (like corpus subscriptions) to not load.
- Files changed: `migrate.js`, `votesController.js`, `votes.js` routes, `api.js`, `AppShell.jsx`

### ✅ Completed (Phase 12d) — Corpus Browsing UI Updates (⚠️ Sub-corpus UI removed in Phase 19a)

**Note:** The sub-corpus section, parent path display, and `onSelectCorpus` prop threading described below were all removed in Phase 19a when sub-corpus infrastructure was eliminated.

- **CorpusDetailView — Sub-corpuses Section**
  - New "Sub-corpuses" section appears above the Documents section when the corpus has children or the user is owner/allowed
  - Each sub-corpus card shows: 📚 name, document count, subscriber count, owner, sub-corpus count
  - Clicking a sub-corpus card navigates into that corpus's detail view (via new `onSelectCorpus` prop)
  - "✕" button removes a sub-corpus (makes it top-level) — owner/allowed only, with confirmation dialog
  - **"+ Add Sub-corpus" button** opens a panel with two options:
    1. **Search existing corpuses** — type a name, click Search, results show corpus name/docs/owner. Corpuses that already have a parent show "already nested" and are disabled. Click "+ Add" to nest.
    2. **Create new sub-corpus** — inline form (name + optional description) below an "or create new" divider. Creates the corpus directly as a child of the current corpus via `parentCorpusId` parameter.

- **CorpusListView — Parent Path Display**
  - Nested corpuses in the corpus list now show a small italic "↳ nested in ParentName" label above the corpus name
  - Parent name resolved from the loaded corpuses list via `parent_corpus_id`

- **AppShell — New Prop Threading**
  - `onSelectCorpus` prop passed to `CorpusDetailView` — maps to `setCorpusView({ view: 'detail', corpusId: id })` for sub-corpus navigation

- **api.js — `corpusAPI.create` Updated**
  - Now accepts optional 4th parameter `parentCorpusId` for creating corpuses directly as children (used by the inline create form in CorpusDetailView)

- Files changed: `CorpusDetailView.jsx`, `CorpusListView.jsx`, `AppShell.jsx`, `api.js`

### ✅ Completed (Phase 12e) — Sub-Corpus Expansion in Sidebar (⚠️ Removed in Phase 19a)

**Note:** All sub-corpus expansion infrastructure described below (lazy-load, subCorpusCache, recursive rendering, icon differentiation) was removed in Phase 19a when sub-corpus infrastructure was eliminated.

- **Lazy-load sub-corpuses on expand:** Clicking the ▸ arrow on a subscribed corpus in the sidebar calls `GET /api/corpuses/:id/children` (built in Phase 12a) and renders sub-corpuses indented below the parent
- **New state:** `subCorpusCache` (maps corpus ID → array of `{ id, name, childCount }`) and `loadingCorpusIds` (tracks which nodes are currently fetching)
- **Loading indicator:** Arrow shows "…" while children are being fetched
- **Cache behavior:** Children are fetched once per corpus per session; subsequent expand/collapse is instant. On fetch error, empty array is cached to prevent retry loops.
- **Arrow visibility logic:** Top-level subscribed corpuses always show ▸ initially (collapses to no arrow once loading confirms zero children). Sub-corpuses show ▸ only when `childCount > 0`.
- **Icon differentiation:** Top-level subscribed corpuses use 📚 icon; nested sub-corpuses use 📁 icon
- **Click behavior:** Top-level corpuses activate as corpus tabs (existing behavior). Sub-corpuses open in the corpus detail overlay (since they're not subscribed tabs).
- **Recursive rendering:** Sub-corpuses can themselves be expanded to reveal deeper children, with 16px indentation per depth level
- **Context menu:** Right-click menu only shown on top-level subscribed corpuses (depth 0); sub-corpuses suppress the context menu
- **No backend changes or database migrations needed** — uses existing `GET /api/corpuses/:id/children` endpoint
- **Frontend-only change** — `AppShell.jsx` only
- Files changed: `AppShell.jsx` (new `subCorpusCache` + `loadingCorpusIds` state, updated `toggleCorpusExpand` with lazy loading, new `loadSubCorpuses` helper, rewritten `renderSidebarCorpusItem` with recursive sub-corpus rendering)

### ✅ Completed (Phase 13) — Cross-Annotation Path Linking

A display enhancement for the document annotation sidebar. When a document has multiple annotations from the same concept graph, the path display becomes interactive.

- **Phase 13-1: Clickable Ancestor Annotations**
  - Annotation enrichment now stores `resolvedPathIds` (parallel to `resolvedPathNames`) — an array of concept IDs for each path segment, built from `graph_path` + `parent_id`
  - When viewing an annotation's detail sidebar, each ancestor in the path is checked against all other annotations in the document (comparing ancestor concept ID against each annotation's `child_id`)
  - If a match is found, the ancestor renders as an underlined clickable link using `pathSegmentLinked` style
  - Clicking jumps to that annotation (calls `handleAnnotationClick` which selects it in the sidebar)
  - CorpusTabContent uses warm amber linked style (`#7a6520`); DecontextualizedDocView uses blue tint (`#4a6a8a`) matching their respective highlight themes

- **Phase 13-2: Descendant Path Extension**
  - After rendering the current annotation's leaf concept (bold `pathLeaf`), the code searches for annotations whose `graph_path` contains the current concept's `child_id`
  - For each descendant found, renders the chain from current concept down to the descendant: intermediate concepts (lighter gray `pathSegmentDescendant`) → annotated descendant (underlined `pathSegmentLinked`, clickable)
  - Intermediate concepts that are themselves annotated also get the clickable linked style
  - Multiple descendants show as separate branch lines (each prefixed with →)
  - Branching correctly handles cases where multiple children of the same concept are annotated

- **Frontend-only change:** Cross-references the loaded annotations array to find path overlaps and descendant relationships. No new tables or endpoints needed — all data is already present in the annotation load response (each annotation includes `child_id` with `graph_path`).
- **Scope:** Works in both contextualized (within-corpus) and decontextualized (cross-corpus) document views.
- **New styles:** `pathSegmentLinked` (clickable annotated ancestor/descendant), `pathSegmentDescendant` (intermediate non-annotated concept in descendant chain), `descendantPathRow` (inline container for descendant branch)
- Files changed: `CorpusTabContent.jsx` (resolvedPathIds enrichment, path rendering with clickable ancestors + descendant extension, 3 new styles), `DecontextualizedDocView.jsx` (same changes with blue-tinted linked style)

### Phase 14: Concept Diffing

A dedicated modal for comparing child concept sets across multiple concepts side by side. Users can drill down through levels, comparing how different parts of the ontology organize similar ideas.

### ✅ Completed (Phase 14a) — Basic Diff Modal

- **Entry Point: Right-Click Context Menu on Concept Cards**
  - Right-clicking any concept card in ConceptGrid (Root page or Concept children view) shows a context menu with "Compare children…"
  - ConceptGrid receives new `onCompareChildren` prop; context menu state managed internally with click-away dismissal
  - Both Root.jsx and Concept.jsx pass `handleCompareChildren` handler and render `<DiffModal>`

- **New Backend Endpoint: `POST /api/concepts/batch-children-for-diff`**
  - Accepts `{ panes: [{ conceptId, path }, ...] }` — max 10 panes
  - For each pane, builds `graphPath = [...path, conceptId]` (same convention as `getConceptWithChildren`)
  - Returns children with save counts (dormancy-filtered) plus grandchildren name+attribute strings for Jaccard computation
  - Guest-accessible via `optionalAuth`

- **DiffModal Component (`DiffModal.jsx`)**
  - Full-screen overlay modal with side-by-side pane layout (horizontally scrollable)
  - Each pane shows a concept header (name, attribute, resolved path names) and its children grouped into three sections:
    1. **Shared** (green dot) — children whose name + attribute appears in at least one other pane
    2. **Similar** (amber dot) — children with different names but whose grandchild sets meet the Jaccard threshold. Each similar child shows "≈ OtherName [attr] (X%)" tags
    3. **Unique** (gray dot) — children that are neither shared nor similar
  - When only one pane exists, children are listed without grouping (grouping appears when 2+ panes are present)
  - **Similarity threshold** configurable via dropdown (30%–80%, default 50%)
  - **Grandchild preview** shown on each child card (first 5 grandchildren, italicized)
  - **Search to add panes:** Click "+ Add concept" → search field → select concept → pick a parent context (shows all parent edges + root if applicable) → pane added
  - Path names resolved via `getConceptNames` batch endpoint for both initial concept and added concepts
  - Panes removable via ✕ button (minimum 1 pane)

- **Jaccard Similarity Computation (Frontend)**
  - `jaccardSimilarity(setA, setB)` computes |A ∩ B| / |A ∪ B| on grandchild name+attribute strings
  - `computeGroups(panes, threshold)` classifies each pane's children into shared/similar/unique relative to all other panes
  - Recomputed whenever panes load or threshold changes

- **Styling:** Consistent with Orca's Zen aesthetic — EB Garamond font, off-white (#faf9f6) background, muted green/amber/gray group colors, warm hover states

- **No new database tables.** Reads from existing `edges`, `concepts`, `attributes` tables. Grandchild data fetched server-side for efficiency.

- **Architecture Decision #135 — Batch Endpoint Builds graph_path Internally:** The frontend sends the "context path" (same path value available in Concept.jsx state), and the backend appends `conceptId` to form the actual `graph_path` — matching the same convention used by `getConceptWithChildren`. This avoids requiring the frontend to compute graph paths differently for the diff endpoint.

- **Test Data Script:** `backend/src/config/seed-diff-test-clean.js` creates isolated test hierarchies (ZDiff_ prefixed) with known Shared/Similar/Unique relationships. Run with `--cleanup` flag to remove.

- Files changed: `conceptsController.js` (new `getBatchChildrenForDiff` endpoint), `routes/concepts.js` (new POST route), `api.js` frontend (new `getBatchChildrenForDiff` method), new `DiffModal.jsx`, `ConceptGrid.jsx` (new `onCompareChildren` prop, right-click context menu with state + click-away handler), `Concept.jsx` (DiffModal import, state, handler, prop threading to ConceptGrid, modal rendering), `Root.jsx` (same DiffModal integration pattern)

#### ✅ Completed (Phase 14b) — Drill-Down Navigation

- **Clickable Child Cards:** Every child card in a diff pane is now clickable. Clicking drills into that child — replacing the pane's children with the clicked child's own children, re-grouped into Shared/Similar/Unique relative to all other panes' current levels. A small ▸ arrow on each card indicates drill-down is available. Hover highlights the card.

- **Independent Per-Pane Drill-Down:** Drilling down in one pane does not affect other panes. Each pane tracks its own depth independently. Groups are recomputed across all panes at whatever level each is currently showing (cross-level comparison).

- **Drill Stack & Cached Back-Navigation:** Each pane maintains a `drillStack` array. Drilling pushes the current state (conceptId, name, attribute, path, pathNames, children) onto the stack. Navigating back restores from the stack instantly (no re-fetch needed — children are cached).

- **Breadcrumb Trail Per Pane:** When a pane has been drilled down at least once, a breadcrumb bar appears below the pane header showing the drill-down path. Each ancestor name is clickable (underlined, hover darkens) and navigates back to that level. The current concept name appears bold at the end.

- **Path Construction for Drill-Down:** When drilling from concept C (at path P) into child D, the new path sent to the batch endpoint is `[...P, C]` — the endpoint then builds `graphPath = [...P, C, D]` internally (same convention as Phase 14a, Architecture Decision #135).

- **Child Concept ID Resolution:** The drill-down handler resolves the child's concept ID using a fallback chain: `child.childId || child.conceptId || child.id`. This handles whatever field name the backend returns. A console warning fires if no ID is found.

- **No Backend Changes:** Reuses the existing `POST /api/concepts/batch-children-for-diff` endpoint. Drill-down just calls it with the new concept + updated path.

- **No New Database Tables.**

- **Files changed:** `DiffModal.jsx` only (new `drillStack` state per pane, `handleDrillDown` and `handleBreadcrumbClick` handlers, `ChildCard` receives `onDrillDown` prop, new breadcrumb bar UI, drill arrow indicator on child cards)

#### ✅ Completed (Phase 14c) — Cross-Level Selection

- **Already covered by Phase 14b breadcrumbs.** The original spec envisioned keeping all drill-down levels visible simultaneously and letting users click any visible level to reset a pane. The breadcrumb trail implemented in 14b achieves the same goal more cleanly — clicking any breadcrumb ancestor resets the pane to that level, collapses deeper drill-downs, and triggers group recomputation across all panes at their current levels (mixed-level grouping).

- **Uneven depth alignment skipped.** The original spec called for visual alignment of panes at different depths. In practice, each pane scrolls independently and groups are clearly labeled, so vertical alignment adds complexity without meaningful benefit. Skipped by design.

- **No additional code changes.** Phase 14c functionality is fully covered by the Phase 14b implementation.

### ✅ Completed (Phase 15) — Bug Fixes & Quick Wins

Six fixes addressing regressions, incorrect behavior, and UX improvements.

- **Phase 15a: Sidebar Naming Regression** ✅
  - Sidebar section header "TABS" changed to "GRAPHS"; "GRAPH GROUPS" header added above tab groups section; "+ New tab" button changed to "+ New graph"
  - These labels were correctly defined in Phase 12b (Architecture Decision #42) but regressed in a later session
  - Files changed: `AppShell.jsx`

- **Phase 15b: Sub-Corpus Subscription Bug** ✅
  - Sub-corpuses (corpuses with a non-null `parent_corpus_id`) are no longer independently subscribable
  - Users subscribe to top-level corpuses only; sub-corpuses are accessed by expanding the parent in the sidebar
  - Backend: `listCorpuses` now filters `WHERE parent_corpus_id IS NULL` so only top-level corpuses appear in the browse list
  - Backend: `subscribe` endpoint rejects sub-corpuses with 400 ("Subscribe to the top-level corpus instead")
  - Frontend: Subscribe/Unsubscribe buttons and subscriber count hidden on `CorpusDetailView` when `corpus.parent_corpus_id` is set
  - Files changed: `corpusController.js`, `CorpusDetailView.jsx`

- **Phase 15c: Sub-Corpus Document Opening Bug** ✅
  - No longer applicable as a separate fix — sub-corpuses cannot be subscribed to, so no separate corpus tab is created for them. Documents in sub-corpuses are accessed through the parent corpus's tab context via sidebar expansion.

- **Phase 15d: Duplicate Concept in Parent Path Display** ✅
  - **Root cause:** `graph_path` stores the path from root to parent *inclusive of the parent at the end*. Multiple components were resolving all IDs in `graph_path` to names AND then appending `parentName` separately, causing the parent to appear twice (e.g., "Health → Fitness → Fitness → Cardio [action]").
  - **Fix:** Removed the separate `parentName` append in enrichment code since `graph_path` already includes it. In components where the parent is displayed separately (MoveModal), path names are resolved from `graph_path.slice(0, -1)` (all but the last element).
  - **Affected files:** `CorpusTabContent.jsx` (annotation sidebar path enrichment), `AnnotationPanel.jsx` (context picker path enrichment), `MoveModal.jsx` (MoveDestinationCard + ContextCard path resolution)
  - **Not affected:** `FlipView.jsx` (already correctly used `graph_path.slice(0, -1)` for path display above parent)
  - **Learning:** When resolving `graph_path` to display names, remember that `graph_path` includes the parent as the last element. Never append the parent again. The leaf concept (the child of the edge) is the only thing appended after the resolved path.

- **Phase 15e: Show Destination Concept in Move Vote Path** ✅
  - The MoveModal `ContextCard` now shows the full destination: `ParentName → SelectedConcept [attr]` instead of just `ParentName [attr]`
  - `ContextCard` accepts new `selectedConceptName` prop, displays parent in lighter color with the selected concept (the actual destination) in bold
  - For root contexts, only the concept name is shown (no parent above it) with a "root" badge
  - Files changed: `MoveModal.jsx`

- **Phase 15f: Root Concept as Pickable Card in Move Destination** ✅
  - When searching for a move destination, `handleSearchResultClick` now also checks for root edges (same pattern as AnnotationPanel) and includes them in the context options
  - Root concepts appear as normal clickable context cards with a "root" badge, consistent with non-root context cards
  - Removed the special-case "No parent contexts found. This concept is only a root." message and separate "Browse from here →" button
  - Clicking a root context card opens the mini graph browser from root (same end result, consistent UX)
  - Files changed: `MoveModal.jsx`

- **Files changed (across all Phase 15 sub-phases):** `AppShell.jsx` (sidebar labels, GRAPH GROUPS header), `corpusController.js` (listCorpuses WHERE filter, subscribe rejection), `CorpusDetailView.jsx` (hide subscribe/unsubscribe/subscriber count on sub-corpuses), `CorpusTabContent.jsx` (annotation path enrichment fix), `AnnotationPanel.jsx` (context picker path enrichment fix), `MoveModal.jsx` (path resolution fixes, selectedConceptName on ContextCard, root edge lookup, root badge style)
- **No database migrations required** — all changes are backend logic + frontend display

---

### ✅ Completed: Phase 16 — Moderation / Spam Flagging

A basic moderation mechanism for hiding spam/vandalism. Designed for manual admin oversight initially, with community voting infrastructure for future scaling.

- **Phase 16a: Backend Infrastructure** ✅
  - New `concept_flags` table, `concept_flag_votes` table, `moderation_comments` table, and `is_hidden` column on `edges` (see schema above)
  - New `moderationController.js` with 7 endpoints under `/api/moderation`: flag, getHiddenChildren, voteOnHidden, removeVoteOnHidden, addComment, getComments, unhideEdge
  - New `routes/moderation.js` route file registered in `server.js`
  - Admin user determined by `ADMIN_USER_ID` environment variable in `.env` (not hardcoded)
  - `getHiddenChildren` returns `isAdmin` boolean so frontend can conditionally show the Unhide button
  - Frontend `moderationAPI` methods added to `api.js`
  - Files changed: `migrate.js`, `server.js`, `api.js`; new files: `moderationController.js`, `moderation.js` (routes)

- **Phase 16b: Hide/Show Mechanics** ✅
  - 13 queries across `conceptsController.js` updated with `AND e.is_hidden = false` or `AND ... .is_hidden = false` on JOIN conditions:
    - `getRootConcepts`: root edge join + child count join filter hidden; root-detection subquery intentionally NOT filtered (a concept that's a child somewhere, even hidden, shouldn't appear as a root)
    - `getConceptWithChildren`: children query + child_count (grandchild edges) both filter hidden
    - `getConceptParents`: both contextual and exploratory queries + both Jaccard similarity queries filter hidden
    - `searchConcepts`: child-check query filters hidden (so hidden children don't show "already exists")
    - `getVoteSets`: vote set computation excludes hidden edges
    - `getBatchChildrenForDiff`: children + grandchildren queries both filter hidden
  - Hidden namespace blocking in `createChildConcept`: if an edge exists with same name+attribute+path but is hidden, returns 409 "This concept exists but has been hidden by the community"
  - Write protection: `addVote` (400 "Cannot save a hidden concept"), `addWebLink` (400 "Cannot add web links to a hidden concept"), `createAnnotation` (400 "Cannot annotate with a hidden concept")
  - Files changed: `conceptsController.js`, `votesController.js`, `corpusController.js`

- **Phase 16c: Hidden Concepts UI** ✅
  - New `HiddenConceptsView.jsx` component — modal overlay accessed via "🚫 N hidden" badge in concept/root header
  - Shows hidden concepts with: name + attribute, flag count badge, creator username, hide/show vote buttons (toggle), expandable comment threads with add-comment form, admin-only "↩ Unhide" button
  - "🚫 N hidden" badge appears in `Concept.jsx` concept header and `Root.jsx` top bar when hidden count > 0 and user is logged in
  - Right-click context menu on concept cards in `ConceptGrid.jsx` now includes "🚩 Flag as spam" option (red, with confirmation dialog)
  - Flagging immediately hides the concept and refreshes the page + hidden count
  - Closing the hidden panel refreshes both the hidden count and the concept/root list (so unhidden concepts reappear)
  - Files changed: `Concept.jsx`, `Root.jsx`, `ConceptGrid.jsx`; new file: `HiddenConceptsView.jsx`

---

### ✅ Completed: Phase 17 — Document Types / Tags

User-generated tags for documents to categorize research material (preprint, outline, grant application, protocol, review, etc.).

- **Phase 17a: Backend Infrastructure** ✅
  - New `document_tags` table: `id`, `name` (VARCHAR(100), UNIQUE case-insensitive), `created_by` (FK to users), `created_at`
  - New `document_tag_links` table: `id`, `document_id` (FK to documents), `tag_id` (FK to document_tags), `added_by` (FK to users), `created_at`. `UNIQUE(document_id, tag_id)`.
  - New `routes/documents.js` route file — consolidates the old standalone `GET /api/documents/:id` route (previously inline in `server.js`) with the new tag endpoints
  - `server.js` updated: old standalone document route removed, new `documentRoutes` mounted at `/api/documents`
  - New endpoints:
    - `GET /api/documents/tags` — list all tags (with usage counts). Guest-accessible.
    - `POST /api/documents/tags/create` — create a new tag. Auth required. Case-insensitive uniqueness check; returns 409 with existing tag if duplicate.
    - `POST /api/documents/tags/assign` — assign a tag to a document. Auth required. Body: `{ documentId, tagId }`. Returns 409 if already assigned.
    - `POST /api/documents/tags/remove` — remove a tag from a document. Auth required (link creator or owner of any corpus the document belongs to). Body: `{ documentId, tagId }`.
    - `GET /api/documents/:id/tags` — get tags for a specific document. Guest-accessible.
  - Frontend API methods added to `documentsAPI`: `listTags`, `createTag`, `assignTag`, `removeTag`, `getDocumentTags`
  - `getCorpus` endpoint updated: now returns a `tags` array (via `json_agg` subquery) on each document in the corpus response
  - `getAnnotationsForEdge` endpoint updated: now fetches and attaches tags to each document in the annotation response (for WebLinksView display)
  - Files changed: `migrate.js` (2 new tables + indexes), `corpusController.js` (5 new tag endpoints + updated `getCorpus` and `getAnnotationsForEdge`), new `routes/documents.js`, `server.js` (route consolidation), `api.js` frontend (extended `documentsAPI`)

- **Phase 17b: Frontend — Tag UI** ✅
  - **Upload form tag picker** (`CorpusTabContent.jsx`): optional tag picker between the format selector and body textarea. Search existing tags or type a new name and press Enter to create. Selected tags display as blue pills with ✕ to remove. Tags are assigned to the document after successful upload.
  - **Tag pills on document cards** (`CorpusTabContent.jsx`): each document card shows its tags as small blue pills below the metadata line. Logged-in users see ✕ on each pill to remove tags.
  - **🏷 add tag button** on each document card: opens an inline dropdown to search/create tags and assign them to existing documents. Visible to all logged-in users.
  - **Filter by tag** (`CorpusTabContent.jsx`): a tag filter bar appears above the document list when any documents have tags. Click a tag pill to filter the list to only matching documents; click again to deselect. "Clear" link resets the filter.
  - **External Links page** (`WebLinksView.jsx`): document entries in the Document Annotations section now show tag pills (read-only) below each document title.
  - Note: "Sort by tag" grouping was planned but deferred — the filter-by-tag approach provides the core functionality. Can be added later if needed.
  - Files changed: `CorpusTabContent.jsx` (tag state, tag handlers, upload tag picker, doc card tag pills, filter bar, inline tag add menu, new styles), `WebLinksView.jsx` (tag pills on document annotation entries, new styles)

- **Phase 17 Bug Fixes** (6 bugs fixed post-implementation, via Claude Code)
  - ✅ **Bug: Subscribed corpus tabs disappear from sidebar.** `handleOpenConceptTab` auto-groups corpus tabs with concept tabs it spawns (sets `group_id` on corpus subscription). `ungroupedCorpusTabs` filtered these out, and `renderSidebarGroup` only rendered `graphTabs` inside groups — never corpus tabs. Additionally, `renderSidebarCorpusItem` used `depth === 0` as proxy for "is subscribed corpus", which broke at `depth=1` inside a group. Fix: `renderSidebarGroup` now renders both corpus and graph tabs within groups. Replaced `depth === 0` checks with `corpusTabs.some(t => t.id === tab.id)` to use the actual subscription list as source of truth. Added `setCorpusView(null)` and `setSavedPageOpen(false)` to the corpus tab click handler. (`AppShell.jsx`)
  - ✅ **Bug: "Subscribe to top-level corpus" error when opening sub-corpus documents.** `onOpenDocument` from `CorpusDetailView` called `handleSubscribeToCorpus` with the sub-corpus ID. Backend correctly rejects subscribe for sub-corpuses. Fix: `CorpusDetailView` now passes `parent_corpus_id` in `onOpenDocument`. AppShell's handler walks up the parent chain via `getCorpus` to find the top-level corpus, with a short-circuit check against `corpusTabs` (known subscriptions) to avoid unnecessary API calls. Error fallback returns early instead of falling through to subscribe. (`AppShell.jsx`, `CorpusDetailView.jsx`)
  - ✅ **Bug: Graph tab click does nothing while corpus browse overlay is open.** `renderSidebarGraphItem` onClick only called `setActiveTab` but never cleared `corpusView`. The corpus overlay renders when `corpusView !== null`, blocking graph tab content. Fix: added `setCorpusView(null)` and `setSavedPageOpen(false)` to graph tab click handler. (`AppShell.jsx`)
  - ✅ **Bug: CorpusDetailView missing version/draft info.** Document cards in the Corpuses browse page had a simpler template than `CorpusTabContent` — no version badge, no draft badge, no dashed border for drafts. Fix: added `docTitleRow` wrapper, version badge, draft badge, and `docCardDraft` border style to match `CorpusTabContent`. (`CorpusDetailView.jsx`)
  - ✅ **Bug: CorpusDetailView missing tag pills on document cards.** Backend `getCorpus` returned tags via `json_agg` subquery, but `CorpusDetailView` never rendered them. Fix: added tag pill display matching `CorpusTabContent`'s style. (`CorpusDetailView.jsx`)
  - ✅ **Bug: No tag filtering in WebLinksView Document Annotations.** Tags displayed as read-only pills but couldn't filter. Fix: added `annotationTagFilter` state, a "Filter by tag" bar above the corpus list, and filtering logic that hides non-matching documents and entire corpuses with no matching documents. (`WebLinksView.jsx`)
  - Files changed across all bug fixes: `AppShell.jsx` (graph tab click handler, corpus tab click handler, grouped corpus tab rendering, `groupContainsActiveTab`, sub-corpus document open walk-up), `CorpusDetailView.jsx` (version/draft badges, tag pills, `onOpenDocument` passes `parent_corpus_id`), `WebLinksView.jsx` (tag filter bar, tag pill rendering, tag filter styles)

---

### ✅ Completed: Phase 18 — Flip View Shared Path Highlighting

A hover-based highlighting feature for Flip View cards. When a user hovers over a concept name in any card's path, the longest contiguous shared path segment containing that concept is highlighted across all other visible cards that share it.

- **Frontend-only change** — no backend modifications or new tables needed
- **Hover model (revised from original click-based spec):** The original design called for click-based selection with Ctrl+click for multi-segment support. This was revised to hover-based because the entire Flip View card is clickable for navigation — click-based path selection would conflict with card navigation. Hover is zero-commitment, instantly discoverable, and requires no mode switching.
- **Single concept hover:** Hovering a concept name in any card's path identifies that concept ID. Every other card containing the same concept ID in its `graph_path` highlights that concept name with warm amber background (`rgba(232, 217, 160, 0.5)`).
- **Contiguous shared segment extension:** The highlight isn't limited to the single hovered concept — it extends to the longest contiguous shared subsequence between the hovered card's path and each other card's path that includes the hovered concept. E.g., if Card A has path [Research, Methods, Analysis] and Card C has [Biology, Research, Methods, Analysis], hovering "Methods" on Card A highlights the full "Research → Methods → Analysis" segment on both cards.
- **Multiple simultaneous matches:** A single hover may match different segments on different cards. All matches highlight simultaneously.
- **Algorithm:** `getSharedSegments(pathA, pathB)` finds all maximal contiguous runs of concept IDs that appear identically (same values, same order, adjacent) in both arrays. `computeHighlightMap()` builds a per-card `Set<conceptId>` of IDs to highlight based on current hover state, running shared segment detection against all other cards.
- **Path rendering refactored:** The old `getPathAboveParent()` (which returned a plain string) is replaced by `renderAncestorPath()` which renders each ancestor concept as its own `<span>` with `onMouseEnter`/`onMouseLeave`. The parent name (last element of `graph_path`) also participates in hover highlighting.
- **No interference with card clicks:** Hover spans do not use `stopPropagation` or `preventDefault`. Card `onClick` navigation continues to work unchanged.
- **Preserves vote-based card ordering** — highlighting is purely visual overlay, does not reorder cards
- **Test data:** `seed-flip-test.js` creates ZFlip_ prefixed concepts with 7 overlapping paths to exercise single-concept matches, 2-segment shared segments, and 3-segment shared segments. Run with `--cleanup` to remove.
- Files changed: `FlipView.jsx`

---

### ✅ Completed: Phase 19 — Sidebar Redesign & Sub-Corpus Removal

**Goal:** Removed sub-corpus infrastructure entirely. Redesigned the sidebar into a single unified list where corpuses, groups, and loose graph tabs coexist freely with no section headers. Users can drag and drop graph tabs into/out of groups, reorder everything, and organize their workspace however they want.

**Philosophy:** Prioritize graphs over folder structures. The sidebar is a workspace for organizing graph exploration, not a document filing system. Corpuses remain important (they hold documents and annotations) but in the sidebar they function as containers for related graph tabs, sitting alongside groups and loose tabs as equals.

- **Phase 19a: Sub-Corpus Removal (Backend + Frontend Cleanup) ✅**
  - **Backend:**
    - Migration: `ALTER TABLE corpuses DROP COLUMN IF EXISTS parent_corpus_id` + `DROP INDEX IF EXISTS idx_corpuses_parent`
    - `corpusController.js`: Removed `parentCorpusId` param from `createCorpus`, `parent_corpus_id` from `listCorpuses` SELECT and its `WHERE parent_corpus_id IS NULL` filter, `parent_corpus_id` from `getCorpus` SELECT, entire `childCorpuses` subquery + response field, `parent_corpus_id` check in `subscribe`, and entire `isAncestor` / `addSubcorpus` / `removeSubcorpus` / `getCorpusChildren` / `getCorpusTree` functions + exports
    - `corpuses.js`: Removed 4 routes: `GET /:id/children`, `GET /:id/tree`, `POST /:parentId/add-subcorpus`, `POST /:parentId/remove-subcorpus`
  - **Frontend:**
    - `api.js`: Removed `addSubcorpus`, `removeSubcorpus`, `getCorpusChildren`, `getCorpusTree` from `corpusAPI`
    - `AppShell.jsx`: Removed `expandedCorpusIds`, `subCorpusCache`, `loadingCorpusIds` state; `toggleCorpusExpand`, `loadSubCorpuses` functions; simplified `renderSidebarCorpusItem` to flat rendering without expand arrows; removed parent-walk-up logic from `onOpenDocument`
    - `CorpusDetailView.jsx`: Removed all sub-corpus state, search/add/remove/create handlers, entire Sub-corpuses JSX section, `parent_corpus_id` conditionals on subscriber count and subscribe/unsubscribe buttons
    - `CorpusListView.jsx`: Removed "↳ nested in…" parentPath display
  - **Non-destructive:** Existing sub-corpuses became top-level corpuses — no data deleted
  - Files changed: `migrate.js`, `corpusController.js`, `corpuses.js`, `api.js`, `AppShell.jsx`, `CorpusDetailView.jsx`, `CorpusListView.jsx`

- **Phase 19b: Unified Sidebar Layout (Remove Section Headers) ✅**
  - Merged three sidebar sections (CORPUSES / GRAPH GROUPS / GRAPHS) into one unlabeled scrollable list
  - **New `sidebar_items` table** with unified ordering: `user_id`, `item_type` ('corpus'|'group'|'graph_tab'), `item_id`, `display_order`. `UNIQUE(user_id, item_type, item_id)`.
  - **Backend:**
    - `corpusController.js`: `subscribe` now inserts into `sidebar_items` (at MAX+10 order); `unsubscribe` deletes from `sidebar_items`
    - `votes.js`: Added `GET /sidebar-items` and `POST /sidebar-items/reorder` routes
  - **Frontend:**
    - `api.js`: Added `votesAPI.getSidebarItems()` and `votesAPI.reorderSidebarItems(items)`
    - `AppShell.jsx`: Added `sidebarItems` state; `loadAllTabs` fetches `getSidebarItems()` as 4th parallel call; added `refreshSidebarItems()` helper; all mutation handlers (create/close graph tab, duplicate, open concept tab, subscribe/unsubscribe corpus, create/delete group) call `refreshSidebarItems()` after success; sidebar rendering replaced 3 labeled sections with single unified `sidebarItems.map(...)` loop; guest mode unchanged
  - **Bug fix:** `getSidebarItems` failure in `Promise.all` was taking down the entire `loadAllTabs` call, preventing corpus tabs from loading (user appeared unsubscribed). Fixed by wrapping `getSidebarItems` in `.catch(() => ...)` fallback. Also fixed: on 409 in subscribe (already subscribed), now refreshes corpus list from server.
  - Files changed: `migrate.js`, `corpusController.js`, `votes.js`, `votesController.js`, `api.js`, `AppShell.jsx`

- **Phase 19c: Drag-and-Drop with @dnd-kit ✅**
  - **New dependency:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` in frontend `package.json`
  - **New file: `SidebarDndContext.jsx`** — three exported components sharing one `DndContext`:
    - `SidebarDndContext` (default) — wraps sidebar tree with `DndContext` + top-level `SortableContext`. Uses `PointerSensor` with 8px activation distance so normal clicks never accidentally start a drag. Renders a `DragOverlay` ghost during drag.
    - `SortableGroupWrapper` — uses `setActivatorNodeRef` to restrict drag activation to group header only, so grabbing a tab inside an expanded group doesn't pick up the whole group.
    - `GroupMemberContext` — inner `SortableContext` placed inside each expanded group, allowing member tabs to be independently draggable.
    - `SortableItem` — lightweight `useSortable` wrapper, fades to 35% opacity while dragging.
  - **AppShell.jsx changes:**
    - New state: `activeDragId`, `overGroupItemId`
    - Computed: `topLevelSidebarItems`, `topLevelSortableIds`, `activeDragOverlay` (ghost label)
    - Three drag handlers:
      - `handleDragStart` — sets `activeDragId`
      - `handleDragOver` — sets `overGroupItemId` when graph tab hovers over group header
      - `handleDragEnd` — three cases: (a) graph tab dropped on group → `addTabToGroup` + optimistic update; (b) grouped tab dropped on non-group → `removeTabFromGroup`, becomes loose; (c) top-level reorder → `arrayMove` + `reorderSidebarItems` API call. All with rollback on failure.
    - Sidebar tree wrapped in `<SidebarDndContext>` with each top-level item in `<SortableItem>`
    - Groups wrapped in `<SortableGroupWrapper>` with expanded members in `<GroupMemberContext>` + per-member `<SortableItem>`
    - Context menu: "Add to group / Create group with this tab" kept alongside drag support. "Remove from group" kept.
    - New styles: `sidebarDropTarget` (warm amber `rgba(232,217,160,0.5)` highlight on valid drop target), `dragOverlay` (ghost card)
  - Files changed: `AppShell.jsx`, new `SidebarDndContext.jsx`, `package.json`, `api.js`

- **Phase 19d: Cleanup & Migration Safety ✅**
  - `migrate.js`: `ALTER TABLE corpus_subscriptions DROP COLUMN IF EXISTS group_id` — column was cleared to NULL in Phase 12, now fully removed
  - `votesController.js`: `addTabToGroup` and `removeTabFromGroup` now return 400 for `tabType === 'corpus'` instead of trying to write the dropped column
  - `corpusController.js`: Removed `cs.group_id` from `getMySubscriptions` SELECT
  - `AppShell.jsx`:
    - `loadAllTabs`: corpus tabs now load with `group_id: null` (removed stale `sub.group_id` reference)
    - Removed auto-grouping block from `handleOpenConceptTab` — opening a concept from a corpus no longer silently creates a group (was always creating a fresh group since `corpusTab.group_id` was always null after column drop)
    - `renderSidebarGroup`: removed `memberCorpus` — corpus tabs can't be group members anymore
    - `handleDeleteGroup`: removed corpus tab ungroup step
    - Removed dead `sidebarSectionHeader` style (leftover from old 3-section sidebar)
  - Files changed: `migrate.js`, `votesController.js`, `corpusController.js`, `AppShell.jsx`

- **Architecture Decision #152 — Unified Sidebar with @dnd-kit:** The sidebar is redesigned from three labeled sections (CORPUSES / GRAPH GROUPS / GRAPHS) to a single unlabeled list. Corpuses, groups, and loose graph tabs are peers — all freely reorderable via drag-and-drop. A `sidebar_items` table provides unified ordering. `@dnd-kit` chosen for its sortable + nestable container pattern, which matches the sidebar's drag semantics precisely. Sub-corpus infrastructure (Phase 12a/d/e) removed entirely — document organization is handled by corpuses as flat containers. `corpus_subscriptions.group_id` removed — corpus tabs no longer participate in flat tab groups.
- **Architecture Decision #153 — Promise.all Fault Tolerance for Sidebar Loading:** When `loadAllTabs` uses `Promise.all` to fetch corpus tabs, graph tabs, groups, and sidebar items in parallel, a failure in any one member (e.g., `getSidebarItems` returning 500 before migration runs) rejects the entire batch, causing the app to think the user has no subscriptions. Fixed by wrapping non-critical calls in `.catch()` fallbacks with empty-array defaults. Rule: any newly added `Promise.all` member in `loadAllTabs` must have a `.catch()` fallback so existing data still loads.

---

### ✅ Completed: Phase 20 — Graph & Vote Simplification

Fundamental simplification of the data model and vote system: enforce single-attribute-per-graph, remove move votes, make saves and swaps mutually exclusive, and expand annotation context in external links.

**Philosophy:** Reduce conceptual overhead for users. A graph is one attribute — you pick it at root creation and everything inherits it. Move votes are redundant with Flip View link votes. Saves and swaps represent opposing stances on a concept's placement, so they shouldn't coexist.

- **Phase 20a: Single-Attribute Graphs**
  - **Core change:** Every graph has exactly one attribute, determined by the root edge's `attribute_id`. All descendant edges must have the same attribute.
  - **Storage model (Architecture Decision #151):** `attribute_id` remains on every edge (not just root edges) for query simplicity — avoids adding root-edge joins to every read query. Consistency is enforced on write: when adding a child, backend looks up the root edge's attribute (via `graph_path[0]`) and sets the new edge's `attribute_id` to match. Users no longer select an attribute when adding non-root concepts.
  - **Root concept creation:** User selects an attribute when creating a root concept (existing behavior). This attribute applies to the entire graph.
  - **Adding children:** Attribute selection UI removed from child-add flow. Backend auto-assigns the graph's attribute.
  - **UI changes — attribute display removal:**
    - Remove `[attribute]` square bracket tags from concept names everywhere: child lists, search results, flip view cards, breadcrumbs, Saved page, diff modal, annotation cards
    - Add attribute display in the **concept page header** — prominent placement near the breadcrumb path (e.g., "action" displayed as a styled label)
    - Add attribute display in the **root page** — each root concept card shows its attribute
    - Add attribute display in **annotation cards** — the annotation's concept path includes the graph attribute somewhere visible, but not as a bracket tag after every concept name
    - Flip View cards: remove attribute brackets from path display. The attribute can be shown once per card or in a header since all contexts for the same concept may span different-attribute graphs.
  - **Search results:** Remove `[attribute]` from search result display. Since the same concept can appear in graphs of different attributes, search results link to the decontextualized Flip View (existing behavior) where the user sees all contexts — the attribute is visible per-context, not per-concept.
  - **Migration:** For each graph (identified by root concept): count edges per attribute, pick the most common, UPDATE all edges in the graph to use the winning attribute. Run as a migration script.
  - **UNIQUE constraint on edges:** Remains `(parent_id, child_id, graph_path, attribute_id)`. Since all edges in a graph share the same attribute, this is effectively `(parent_id, child_id, graph_path)` — but keeping `attribute_id` in the constraint is harmless and avoids a constraint migration.
  - Files expected to change: `migrate.js` (migration script), `conceptsController.js` (enforce attribute on child creation, remove attribute selection from add-child), `SearchField.jsx` / `AddConceptModal.jsx` (remove attribute picker from child-add flow), `ConceptGrid.jsx` (remove bracket tags), `Concept.jsx` (add attribute to header), `Root.jsx` (show attribute on root cards), `FlipView.jsx` (remove bracket tags), `SavedPageOverlay.jsx` / `SavedTabContent.jsx` (remove bracket tags), `DiffModal.jsx` (remove bracket tags), `CorpusTabContent.jsx` (annotation card attribute display), `DecontextualizedDocView.jsx` (same), `WebLinksView.jsx` (same)

- **Phase 20b: Remove Move Votes**
  - **Rationale:** Move votes ("this concept belongs in a different context") are functionally redundant with Flip View link votes ("this other context is relevant/better"). A user who thinks a concept should be moved can click into the concept, open Flip View, and link-vote the destination context. The signal is the same.
  - **Drop `side_votes` table** (migration)
  - **Remove all move vote endpoints:** `GET /move/:edgeId`, `POST /move/add`, `POST /move/remove`
  - **Remove `move_count`** from children queries in `conceptsController.js` (`getConceptWithChildren`, `getRootConcepts`)
  - **Remove MoveModal.jsx** entirely
  - **Remove move vote UI** from `ConceptGrid.jsx` (→ N indicator), `Concept.jsx` (move button), `SavedPageOverlay.jsx` / `SavedTabContent.jsx` (→ N indicator on saved trees)
  - **Remove move vote references** from `api.js` frontend
  - Files expected to change: `migrate.js`, `votesController.js`, `votes.js`, `conceptsController.js`, `api.js`, `ConceptGrid.jsx`, `Concept.jsx`, `SavedPageOverlay.jsx`, `SavedTabContent.jsx`, delete `MoveModal.jsx`

- **Phase 20c: Save/Swap Mutual Exclusivity**
  - **Rule:** A user can either save an edge OR swap-vote it, but not both. Saving an edge automatically removes any existing swap vote by that user on that edge. Swap-voting an edge automatically removes any existing save by that user on that edge.
  - **Backend enforcement:**
    - `addVote` (save): before inserting the vote, DELETE any `replace_votes` row where `user_id` matches and `edge_id` matches. (Note: a swap vote has `edge_id` = the edge being replaced, so we match on that.)
    - `addSwapVote`: before inserting the swap vote, DELETE any `votes` row where `user_id` and `edge_id` match. Also trigger cascading unsave logic (since removing a save may cascade to descendants).
  - **Frontend:** When a user saves, the swap indicator on that concept updates immediately (swap removed). When a user swaps, the save indicator updates (save removed). No confirmation dialog — automatic.
  - **No migration needed:** Existing data where users have both a save and swap on the same edge can be left as-is (grandfathered) or cleaned up. Since it's test data, a cleanup script that removes the save when both exist is simplest.
  - Files expected to change: `votesController.js` (addVote, addSwapVote), `api.js` (response handling), `ConceptGrid.jsx` (UI updates after save/swap), `Concept.jsx` (same)

- **Phase 20d: Annotation Sentence Expansion in External Links**
  - When annotations are displayed in `WebLinksView.jsx` (External Links page), currently only the annotated text selection is shown
  - **Change:** Expand the displayed text to show the **full sentence** containing the annotation, with the annotated portion **bolded** within it
  - **Sentence detection:** From the annotation's `start_position`, scan backward to the nearest sentence boundary (`.` `?` `!` or start of document). From `end_position`, scan forward to the nearest sentence boundary (or end of document). Extract that range from the document body.
  - **Rendering:** The full sentence is displayed, with the annotated substring wrapped in `<strong>` (or bold styling) so it stands out
  - **Backend change:** The existing annotation response already includes `start_position`, `end_position`, and the document `body` is available. Sentence expansion can be computed either backend (new field in response) or frontend (from the loaded document body). Frontend is simpler since the body is already loaded for display.
  - **Applies to:** `WebLinksView.jsx` and `DecontextualizedDocView.jsx` (anywhere annotations are shown outside the document reader)
  - Files expected to change: `WebLinksView.jsx`, possibly `DecontextualizedDocView.jsx`

- **Architecture Decision #151 — Single-Attribute Graphs with Redundant Edge Storage:** Graphs are now single-attribute: the root edge's `attribute_id` determines the graph's attribute, and all descendant edges must match. Rather than storing the attribute only on the root edge (which would require root-edge joins on every read query), `attribute_id` is kept on every edge for query simplicity. Consistency is enforced at write time. This means the `attribute_id` column on non-root edges is technically redundant but avoids rewriting the entire query layer. The UNIQUE constraint on edges retains `attribute_id` to avoid a constraint migration.

- **Architecture Decision #152 — Move Votes Removed as Redundant with Flip View Links:** Move votes ("this concept belongs elsewhere") and Flip View link votes ("this other context is relevant") express the same signal — that a different parent context is important. Move votes required a destination-picking modal and complex UI; link votes achieve the same thing with a single click in Flip View. Removing move votes simplifies the vote system from four types to three (save, swap, link) and removes a significant chunk of UI complexity (MoveModal, destination search, mini graph browser).

- **Architecture Decision #153 — Save/Swap Mutual Exclusivity:** Saving endorses a concept's placement; swapping asserts it should be replaced. These are contradictory stances on the same edge. Making them mutually exclusive (saving removes swaps, swapping removes saves) ensures vote signals are clean. The automatic removal (no confirmation dialog) keeps interaction fast — users can always re-vote if they change their mind.

---

### ✅ Completed: Phase 21 — Document Experience Overhaul

Consolidates several document UX improvements: always-editable documents with annotation-safe diff-and-rebase, "My Documents" section in corpus views, version consolidation on document cards, and editor cleanup.

**Philosophy:** Documents should be living artifacts, not frozen snapshots. Users should be able to edit their documents at any time without losing community annotations. The annotation system adapts to text changes rather than requiring immutability.

- **Phase 21a: Always-Editable Documents with Diff-and-Rebase** ✅ ⚠️ PARTIALLY REVERSED BY PHASE 22a
  - **Note:** The edit endpoint, `adjustAnnotationOffsets` helper, and `diff-match-patch` dependency introduced in this phase are removed in Phase 22a (file-upload-only pivot). The `is_draft` removal and migration from this phase remain in effect. The always-editable concept is replaced by version uploads.
  - **New dependency:** `diff-match-patch` (~8KB, Google's open-source diff library) installed in backend — **REMOVED in Phase 22a**
  - **Core change:** Documents are always editable by their original uploader. There is no finalization step. The `is_draft` column and all draft/finalize logic are removed.
  - **Migration:** Finalizes any remaining drafts (`UPDATE documents SET is_draft = false WHERE is_draft = true`), then drops `is_draft` column. Phase 20a migration made idempotent to survive re-runs.
  - **Annotation offset adjustment:** When a document is saved after editing, the backend computes a diff between old and new text using `diff-match-patch`. All annotations on the document (across all corpuses) have their `start_position` and `end_position` adjusted based on the diff. Annotations whose anchored text was partially or fully deleted are removed.
  - **New backend helper:** `adjustAnnotationOffsets(oldText, newText, documentId)` — computes diff, maps positions to new offsets, adjusts shifted annotations, deletes invalidated annotations, returns count of adjusted and deleted annotations
  - **New endpoint:** `POST /api/corpuses/documents/:id/edit` — accepts `{ body }`. Only the original uploader (`uploaded_by`) can edit. Calls `adjustAnnotationOffsets`, updates document body, invalidates `document_concept_links_cache`. Returns `{ success, adjusted, deleted }`.
  - **Concept link cache:** Invalidated (DELETE rows) whenever a document is edited. Recomputed on next view. Draft-check logic removed from cache endpoint.
  - **Removed:** `updateDraft` and `finalizeDraft` endpoints and their routes. All `is_draft` references removed from active queries. `createVersion` now creates regular (non-draft) documents.
  - **Frontend:** Added `corpusAPI.editDocument(documentId, body)`. Removed `updateDraft`/`finalizeDraft` API methods. CorpusTabContent: replaced draft state (`docEditing`/`editBody`/`savingEdit`) with Edit button shown only to original uploader; edit panel with Save/Cancel; after save reloads annotations and concept links; removed draft badges, dashed borders, finalize button, concept links preview panel below editor, read-only document copy below editor. CorpusDetailView: removed draft badges and dashed borders.
  - **Naming fix:** Document body edit handlers named `handleStartDocEdit`/`handleSaveDocEdit` to avoid conflicting with existing corpus name/description edit handlers (`handleStartEdit`).
  - Files changed: `migrate.js`, `corpusController.js`, `corpuses.js` routes, `api.js`, `CorpusTabContent.jsx`, `CorpusDetailView.jsx`

- **Phase 21b: My Documents Section in Corpus View** ✅
  - When a logged-in user views any corpus, a collapsible "My Documents" section appears at the top of the document list showing all documents where `uploaded_by` matches the current user
  - Section always visible for logged-in users, even when empty (shows subtle italic hint)
  - Documents in "My Documents" also appear in their normal position in the full list below (convenience duplicate)
  - **Collapsible:** `myDocsCollapsed` state (default expanded). Header has ▾/▸ toggle arrow.
  - **"All Documents" header** added above the main document list for visual separation
  - **Tag filter applied:** My Documents section respects the active document tag filter (bug fixed post-implementation)
  - Full doc card interactivity in CorpusTabContent (favorites, tags, tag menu, remove button). Simpler cards in CorpusDetailView.
  - **Guest users:** Section not shown
  - **Backend:** No new endpoints — `uploaded_by` already in the `getCorpus` SELECT query
  - Files changed: `CorpusTabContent.jsx`, `CorpusDetailView.jsx`

- **Phase 21c: Version Consolidation on Document Cards** ✅
  - Documents in a version chain (sharing `source_document_id` lineage) are consolidated into a single card showing the latest version's title with a "vN" badge
  - **New backend endpoint:** `GET /api/documents/:id/version-chain` — lightweight recursive CTE (same logic as `getVersionHistory` but no body text or username join). Returns `id, title, version_number, uploaded_by, created_at` ordered by `version_number`. Guest-accessible.
  - **Frontend grouping:** `groupDocsByLineage(docs)` helper walks `source_document_id` chains, groups by root, returns only the latest version per chain with `_chainLength`. Applied to both "All Documents" and "My Documents" lists.
  - **Version navigator in document view:** When `versionChain.length > 1`, shows `← v1 | v2 | [v3] →` bar at top. Current version highlighted. Clicking ←/→ arrows or version pills loads adjacent version via `handleOpenVersion`.
  - **`getAnnotationsForEdge` updated:** Now returns `document_version_number` per document in the annotations response, used by WebLinksView to show version badges.
  - **WebLinksView:** Version badge ("vN") shown next to document title in Document Annotations section when `documentVersionNumber > 1`.
  - Files changed: `corpusController.js`, `routes/documents.js`, `api.js`, `CorpusTabContent.jsx`, `CorpusDetailView.jsx`, `WebLinksView.jsx`

- **Architecture Decision #154 — Diff-and-Rebase for Annotation Offset Adjustment:** Rather than requiring document immutability (which creates friction via draft/finalize flow) or auto-creating versions on every edit (which creates version clutter), Orca uses Google's `diff-match-patch` library to compute text diffs on save and adjust all annotation offsets accordingly. Annotations whose anchored text was destroyed are deleted. This preserves the character-offset annotation model while allowing documents to be freely edited. The tradeoff is that annotations may occasionally be invalidated by edits that remove their anchored text — this is acceptable because it mirrors the natural expectation that if you delete the text someone annotated, the annotation goes away.

- **Architecture Decision #155 — Version Consolidation Is Frontend-Only Grouping:** The backend continues to return all documents for a corpus (including all versions). The frontend's `groupDocsByLineage` helper walks `source_document_id` chains to find version families, then shows only the latest version per lineage. This keeps the backend simple and avoids complex version-aware document listing queries. The version-chain endpoint is lightweight (no body text) and called on demand when viewing a specific document.

---

### ✅ Completed: Phase 22 — File Upload Workflow & Document-Level Annotations

Two sub-features: replacing the text editor with a file-upload-only document workflow, and replacing offset-based annotations with document-level annotations.

**Philosophy:** Researchers already have documents — preprints, grant applications, protocols, outlines. Orca's value is in annotating and exploring those documents against concept graphs, not in being a text editor. Removing the editor eliminates a major source of bugs (contentEditable cursor/line-break issues) and focuses the product on its core use case: upload → annotate → explore.

- **Phase 22a: File Upload Workflow (replaces text editor)** ✅
  - **Core change:** Removed the in-app text editor entirely. Documents are created exclusively by uploading files. The Phase 21a edit button and `editDocument` endpoint are removed — document updates happen by uploading a new version (existing version chain system from Phase 21c).
  - **Supported file types:** `.txt`, `.md`, `.pdf`, `.docx`
  - **Text extraction (backend):**
    - `.txt` and `.md` — read file content directly as UTF-8 text
    - `.pdf` — extract text using `pdf-parse` v1.1.1 (v2.x crashes in Node.js — see Architecture Decision #167)
    - `.docx` — extract text using `mammoth` (`extractRawText`)
    - Other extensions rejected with 400 error
  - **Upload UI:** Drag-and-drop zone + "Choose file" button in both `CorpusTabContent.jsx` and `CorpusDetailView.jsx`. User provides a document title (auto-populated from filename, editable). Optional tag selection (existing tag system). Format is auto-detected from file extension.
  - **Drag-and-drop implementation:** HTML5 `ondragover`/`ondrop` handlers on a styled drop zone div. Visual feedback on drag-over (border highlight, warm brown accent). Zen-aesthetic dashed border. Same file processing pipeline as the file picker button.
  - **Upload endpoint:** `POST /api/corpuses/:corpusId/documents` updated to accept `multipart/form-data` via `multer` (memory storage) with a `file` field. Backend extracts text from the file, stores it in the `body` column. The `format` column stores the detected file type (`'plain'`, `'markdown'`, `'pdf'`, `'docx'`). Optional `title` and `tags` form fields.
  - **Version upload:** `POST /api/corpuses/versions/create` also accepts `multipart/form-data` with file upload + text extraction (replaces the old "copy source body" approach).
  - **File size limit:** 10MB enforced by multer `limits: { fileSize: 10 * 1024 * 1024 }`. Custom error middleware catches `LIMIT_FILE_SIZE` and returns 413 with user-friendly message.
  - **Loading indicator:** Spinner + "Uploading…" text in the drop zone during upload. Upload button disabled during upload to prevent double-submission.
  - **Error handling:** All three upload paths (new doc in CorpusTabContent, new doc in CorpusDetailView, version upload) display `err.response?.data?.error` to the user via alert.
  - **Removed:**
    - The `<textarea>` / `contentEditable` document editor in `CorpusTabContent.jsx`
    - The Edit button and edit panel from Phase 21a
    - The `POST /api/corpuses/documents/:id/edit` endpoint
    - The `adjustAnnotationOffsets` helper and `diff-match-patch` dependency
    - The `corpusAPI.editDocument()` frontend method
    - The plain text / markdown format toggle on the upload form
    - Upload body/format state, duplicate check state, live concept links during upload state
  - **Preserved:**
    - Live concept linking on document upload (Phase 7i-4 debounced matching runs after text extraction)
    - Version creation via "Upload new version" (existing Phase 21c flow, now the only way to update a document)
    - All annotation functionality
  - **New backend dependencies:** `pdf-parse` v1.1.1, `mammoth`, `multer`
  - **Removed dependency:** `diff-match-patch`
  - **New frontend state:** `uploadFile`, `uploadDragOver`, `uploadFileError`, `showVersionUpload`, `versionFile`, `versionDragOver`, `versionFileError`, `uploadFileInputRef`, `versionFileInputRef`
  - **New frontend functions:** `validateFileExtension`, `handleFileSelect`, `doFileUpload`, `handleToggleVersionUpload`, `handleVersionFileSelect`, `doVersionUpload`
  - **Removed frontend state:** `uploadBody`, `uploadFormat`, `duplicateMatches`, `checkingDuplicates`, `uploadConceptLinks`, `docEditing`, `editBody`, `savingEdit`
  - **Removed frontend functions:** `handleCheckAndUpload`, `doUpload`, `handleStartDocEdit`, `handleSaveDocEdit`, debounced upload concept links useEffect
  - Files changed: `corpusController.js`, `corpuses.js` routes, `api.js`, `CorpusTabContent.jsx`, `CorpusDetailView.jsx`, `package.json`

- **Phase 22b: Document-Level Annotations with Quote Navigation & Concept Detection Panel** ✅
  - **Core change:** Replaced the offset-based text-selection annotation system with document-level annotations. Annotations attach a concept-in-context to the whole document, with an optional freeform comment and an optional text quote. No character offsets are stored. Text quotes enable clickable navigation to the quoted passage in the document.
  - **Annotation model (new schema):**
    - `quote_text` — optional string quoted from the document. Stored as plain text, not character offsets. Used for click-to-navigate.
    - `comment` — optional freeform text explaining the connection
    - `quote_occurrence` — optional integer indicating which occurrence of the quote string (1-indexed). Stored when the user selects a specific occurrence.
    - `start_position` and `end_position` columns dropped. `valid_positions` CHECK constraint dropped.
  - **Annotation creation — two entry points:**
    1. **"📌 Annotate" button** — always visible in the annotation sidebar header. Opens a form with: quote textarea (optional), comment textarea (optional), concept search field (full graph search). Then context/edge picker (step 2).
    2. **Text selection shortcut** — user selects text in the document body. A small floating 📌 button appears near the selection (positioned via `getBoundingClientRect()`). Clicking it opens the same form with the quote field pre-filled with the selected text.
  - **Quote navigation (click-to-navigate):**
    - Each annotation with a `quote_text` displays the quote in italics in the annotation list. Clicking the quote triggers a runtime string search using `TreeWalker` to find text nodes in the document body, then inserts a `<mark>` element with a fade-out highlight (CSS animation).
    - **Single occurrence:** Navigates directly, scrolls into view with temporary highlight.
    - **Zero occurrences (stale quote):** Quote displays as plain non-clickable text with a "not found" indicator.
  - **Concept detection panel (replaces persistent underlines):**
    - **Removed** persistent concept link underlines from the document body. Documents render as clean, undecorated text.
    - The annotation panel includes a "Concepts in this document" section listing all graphed concept names detected in the document text (same matching logic as `findConceptsInText` — whole-word, case-insensitive, longest-first).
    - Each detected concept shows: concept name with attribute badge, clickable name that opens decontextualized Flip View.
    - **Step-through navigation for concepts:** Down-arrow button (↓) navigates to the first occurrence. Once navigated, shows `‹ n/total ›` with prev/next step buttons. Prev/next wrap around. Case-insensitive matching. State resets when navigating to a different document.
    - "Not found" note appears briefly if the concept name doesn't appear in the document.
    - Uses `document_concept_links_cache` infrastructure repurposed to feed the panel.
  - **Annotation list display:** Each annotation shows concept name (with attribute badge), quote in italics (clickable to navigate), comment text, vote count, layer indicator. Clicking expands inline with full voting/path/color-set/delete UI.
  - **Migration from offset-based annotations:**
    - `quote_text` populated from `SUBSTRING(body FROM start_position + 1 FOR end_position - start_position)` for all existing annotations
    - `quote_occurrence` set to 1 for all migrated annotations
    - `start_position`, `end_position` columns and `valid_positions` CHECK constraint dropped
    - `annotation_removal_log`: `quote_text` column added, `start_position`/`end_position` made nullable (historical records preserved)
  - **Removed:**
    - `buildAnnotatedBody` segment rendering logic (annotation highlights over text spans)
    - Annotation-vs-concept-link priority/overlap logic
    - Character offset storage for annotations
    - `handleTextSelect`, `getTextOffsetInElement`, the old selection toolbar
    - All offset-based state variables
  - **Preserved:**
    - `document_concept_links_cache` table — retained, repurposed to feed concept detection panel
    - Annotation voting (color sets, vote counts) — works the same, displayed alongside comment/quote
    - Public/editorial layer distinction
    - Full graph concept search for annotation creation
  - **Key implementation detail:** The `navigateToQuote` function uses `window.document` explicitly (not `document`) because a React state variable named `document` shadows the global DOM API. The `TreeWalker` approach (`window.document.createTreeWalker`) finds text nodes, creates a `Range`, inserts a `<mark>` element for the highlight, and removes it after a CSS fade-out animation.
  - Files changed: `document_annotations` table (migration), `annotation_removal_log` table (migration), `corpusController.js`, `AnnotationPanel.jsx` (complete redesign), `CorpusTabContent.jsx` (major rewrite — removed buildAnnotatedBody, added quote navigation, text selection handler, concept detection panel), `DecontextualizedDocView.jsx`, `api.js`

- **Architecture Decision #162 — File Upload Only, No In-App Text Editor:** The original Phase 22a planned a `contentEditable` overlay to show concept underlines during editing. Implementation revealed persistent cursor positioning and line-break bugs inherent to `contentEditable`. More fundamentally, Orca's target users (researchers) already have documents in standard formats — the app's value is annotation and exploration, not authoring. Removing the editor eliminates a major bug surface, simplifies the codebase, and focuses the product on its core loop: upload → annotate → explore value graphs. Document updates happen via version uploads (Phase 21c), which is actually a better model for research documents that go through discrete revision cycles.

- **Architecture Decision #163 — Edit Endpoint Removed, Versioning Replaces Editing:** The Phase 21a `editDocument` endpoint (with `diff-match-patch` annotation offset adjustment) is removed because documents can no longer be edited in-place. The version chain system (Phase 21c) replaces it: authors upload a new version, which creates a clean document with fresh annotation opportunities. This is simpler and avoids the complexity of offset rebasing. The `diff-match-patch` dependency is also removed. Note: existing annotations on old versions remain intact and viewable — they simply aren't carried forward to new versions, which is the correct behavior for distinct document revisions.

- **Architecture Decision #164 — Document-Level Annotations Replace Offset-Based Highlighting:** The original annotation system stored character offsets (`start_position`, `end_position`) and rendered colored highlights over text spans. This was replaced with document-level annotations that attach a concept-in-context to the whole document, with an optional freeform comment and optional text quote. The quote is stored as a plain string, not offsets — navigation to the quoted passage uses runtime string search. This eliminates the fragile offset model (which broke on document edits and complicated rendering with overlap logic), simplifies `buildAnnotatedBody` out of existence, and better fits value-graph annotation where the connection between a concept and a document is conceptual rather than tied to a specific character range. Existing offset-based annotations are migrated by extracting the highlighted substring into `quote_text`.

- **Architecture Decision #165 — Concept Detection Panel Replaces Persistent Underlines:** Graphed concept names found in document text were previously shown as persistent underlines throughout the document body, with complex priority logic to avoid overlapping with annotation highlights. This is replaced by a "Concepts in this document" panel in the annotation sidebar, where each detected concept has a clickable name (opens decontextualized Flip View) and a step-through navigator (↓ button to first occurrence, then `‹ n/total ›` prev/next with wrapping). This keeps the document body clean, eliminates the annotation-vs-concept-link overlap logic, and makes concept detection more discoverable and actionable. The panel is always visible to all users, not just during annotation creation. Concept name matching is case-insensitive.

- **Architecture Decision #166 — Quote Occurrence Picker for Ambiguous Navigation:** When a text quote or concept name appears multiple times in a document, clicking "navigate" shows an occurrence picker dropdown with surrounding context (~5-6 words on each side). The annotator selects which occurrence they mean, and the index is stored as `quote_occurrence`. This avoids the need for character offsets while still allowing precise navigation. If a document is versioned and occurrences shift, the worst case is navigating to a different occurrence of the same string — acceptable graceful degradation.

- **Architecture Decision #167 — pdf-parse v1.1.1 Required (Not v2.x):** The `pdf-parse` npm package v2.x completely rearchitected its API. The `/node` entry exported only `{ getHeader }` (not a callable function), and the main entry crashed with `DOMMatrix is not defined` because it assumed a browser environment. v1.1.1 exports the parse function directly and works in Node.js CJS environments. Always use `require('pdf-parse')` (not `require('pdf-parse/node')`).

- **Architecture Decision #168 — Remove process.exit from pg Pool Error Handler:** The `database.js` file had `process.exit(-1)` inside the pg pool's `error` event handler. Any transient PostgreSQL client error (network hiccup, idle timeout) would instantly kill the entire backend process. The Vite proxy would then get connection refused and return 500 for every subsequent API call — including login and root concept loading, which had nothing to do with DB errors. The pg pool already handles reconnection automatically when an idle client drops. The error is now just logged.

- **Architecture Decision #169 — window.document vs React State Variable Shadowing:** In `CorpusTabContent.jsx`, a React state variable named `document` (holding the opened document object `{ id, title, body, ... }`) shadows the global `window.document` DOM API. All DOM API calls in navigation functions (`createTreeWalker`, `createRange`, `createElement`) must use `window.document.*` explicitly. This has caused a `createTreeWalker is not a function` error when `document` resolved to the React state object.

---

### ❌ Cancelled: Phase 23 (formerly) — User-Generated Attributes

**Cancelled.** The original plan to open attribute creation to all users has been replaced by owner-controlled attribute enablement (Phase 25e). The app owner (Miles) will observe how users work with "value" concepts and manually add new attributes as needed by inserting rows into the `attributes` table and updating the `ENABLED_ATTRIBUTES` environment variable. The `user_default_attributes` table is no longer planned. Architecture Decision #137 (user-created attributes are identity-defining) remains valid for any future attributes added by the owner.

---

### ✅ Completed: Phase 23 — Vote Set Drift Tracking

Tracks how users' vote set memberships change over time, enabling users to see where former set-mates have migrated. Hover a vote set swatch to see "top destinations" — the most common current sets among users who previously shared this exact set.

- **Phase 23a: Event Log Infrastructure ✅**
  - New `vote_set_changes` table: append-only event log with `id`, `user_id`, `parent_edge_id`, `child_edge_id`, `action` ('save'/'unsave'), `created_at`
  - Index: `(parent_edge_id, user_id, created_at)` for efficient reconstruction queries
  - Logging wired into `votesController.js`:
    - `addVote`: converted `for...of` to indexed `for` loop so `parent_edge_id = edgeIdsToSave[i-1]` (NULL at index 0 for root edge). Only logs when INSERT actually creates a new vote.
    - `removeVote`: LEFT JOIN maps each removed edge to its parent edge (via `child_id = parent_id` AND `graph_path = graph_path[1:N-1]` with attribute matching). Bulk-inserts 'unsave' events via `unnest`.
    - `addSwapVote`: same parent-edge mapping for Phase 20c cascade removal — logs 'unsave' for saves removed when a swap vote is added.
  - Files changed: `migrate.js`, `votesController.js`

- **Phase 23b: Drift Reconstruction Query ✅**
  - New endpoint: `GET /api/votes/drift/:parentEdgeId` — auth required
  - Implementation in `votesController.js` (`getVoteSetDrift`):
    1. Fetches parent edge to derive child edge criteria (`parent_id = child_id`, `graph_path = path || [child_id]`)
    2. Gets requesting user's current vote set from `votes` table (source of truth)
    3. Loads all `vote_set_changes` events at this parent, grouped by user
    4. Replays each user's events sequentially using a Set — checks if set ever matched requesting user's current set key (sorted edge IDs joined by comma)
    5. For users who ever matched, fetches their actual current vote set from `votes` (handles pre-deployment votes)
    6. Groups departed users by current set key, skips users who re-converged to the same set
    7. Fetches concept names for all involved edge IDs in one query
  - Response: `{ currentSet: [edgeIds], departures: [{ currentSet, userCount, added, removed, conceptNames }] }` sorted by userCount desc
  - Files changed: `votesController.js`, `routes/votes.js`, `api.js`

- **Phase 23c: Drift UI ✅**
  - `VoteSetBar.jsx`:
    - New `driftData` prop, `hoveredSwatchIndex` local state
    - Each swatch wrapped in a `div` with `onMouseEnter`/`onMouseLeave` handlers
    - `onMouseLeave` uses `e.currentTarget.contains(e.relatedTarget)` to keep popover visible as mouse moves from swatch into popover
    - `renderDriftPopover()`: renders only when driftData has departures (up to 3); shows colored dot per departure (matched to existing swatch colors by comparing edgeIds), user count, and `+added; −removed` diff using concept names
    - Clicking a departure dot triggers `onSetClick` for the matched swatch (existing filter behavior)
    - **Popover only renders on the swatch whose child edge IDs match `driftData.currentSet`** — sorted key comparison ensures set equality regardless of order
    - Popover skips rendering entirely if driftData is null or has 0 departures
  - `Concept.jsx`:
    - New `driftData` state; `loadVoteSets` calls `loadDriftData(parentEdgeId)` after successful vote set fetch
    - Only fetches for logged-in users when parentEdgeId is non-null; fire-and-forget with silent error handling
    - Drift data passed to `VoteSetBar`
  - Files changed: `VoteSetBar.jsx`, `Concept.jsx`

- **Bug fix: Drift popover showing on all swatches**
  - Initial implementation showed the same departure data on every swatch. Fixed by comparing the hovered swatch's edge IDs against `driftData.currentSet` — `renderDriftPopover` returns null immediately if they don't match. The popover only appears on the one swatch whose composition equals the current user's vote set.

- **Architecture Decision #155 — Vote Set Drift Uses Append-Only Event Log:** Rather than periodic snapshots (storage-heavy, lossy between snapshots) or modifying existing tables (couples tracking to vote logic), drift tracking uses a dedicated append-only event log. One row per save/unsave event. This is the simplest approach with the best tradeoffs: negligible write overhead (one INSERT per user action), efficient reconstruction (indexed by parent + user + time), no background jobs, and data accumulates naturally from the moment of deployment. Reconstruction queries replay events using window functions to compute historical set membership.

- **Architecture Decision #170 — Drift Popover Only on Matching Swatch:** The drift endpoint returns departure data relative to the requesting user's current vote set. The popover must only appear on the swatch whose child edge composition matches `driftData.currentSet`. Other swatches (including destination sets where departed users landed) show no drift info — they never had members leave. Set equality uses sorted-and-joined edge ID keys for order-independent comparison.

---

### ✅ Completed: Phase 25 — Document & Browse Experience Improvements

Five independent sub-features improving document organization, root page filtering, annotation views, the External Links page, and attribute launch configuration.

- **Phase 25a: Single Tag Per Document** ✅
  - **Schema change:** Added nullable `tag_id` column (FK to `document_tags`) on the `documents` table. Dropped `document_tag_links` junction table after migration.
  - **Migration:** Idempotent `ALTER TABLE documents ADD COLUMN tag_id`. If `document_tag_links` existed, copied earliest assigned tag per document (by `created_at`), then dropped the junction table.
  - **Permission change:** Only the document uploader (`uploaded_by`) can assign or change the tag. Returns 403 for non-uploaders. Replaces the previous model where any logged-in user could assign tags.
  - **Backend changes (corpusController.js — 6 functions updated):**
    - `getCorpus` — replaced junction table subquery with `LEFT JOIN document_tags dt ON dt.id = d.tag_id`, returns `json_build_array(...)` or `'[]'`
    - `uploadDocument` — replaced `INSERT INTO document_tag_links` loop with `UPDATE documents SET tag_id = tagIds[0]`
    - `assignDocumentTag` — checks `uploaded_by === userId` (403 for non-uploader), uses recursive CTE to propagate tag across full version chain (walks up via `source_document_id` to root, then down to all versions)
    - `removeDocumentTag` — same uploader check and recursive CTE, sets `tag_id = NULL` across all versions
    - `getDocumentTags` — queries `documents JOIN document_tags ON d.tag_id`
    - `getAnnotationsForEdge` — tags fetched via `documents JOIN document_tags ON d.tag_id`; also added `d.uploaded_by` to the query (used by Phase 25d)
    - `listDocumentTags` — usage count via `COUNT(d.id)` from `documents` instead of junction table
  - **Version chain tag propagation:** `createVersion` fetches `tag_id` from source doc and passes it into the INSERT, so new versions inherit the tag automatically. `assignDocumentTag` and `removeDocumentTag` use recursive CTEs to update all versions in a chain simultaneously.
  - **Frontend (CorpusTabContent.jsx):**
    - Upload form: label → "Tag (optional):", `handleAddUploadTag` replaces (not appends), `handleCreateAndAddUploadTag` sets single tag
    - Tag assignment/removal state updates replace (not append/filter from) the tags array
    - 🏷 button and ✕ pill gated on `doc.uploaded_by === user?.id`; 🏷 title says "Change tag" when tag is set
  - **CorpusDetailView.jsx & WebLinksView.jsx:** No changes required — both already display tags as read-only pills, and the `doc.tags` array format (now ≤1 item) is handled correctly by existing code.
  - Files changed: `migrate.js`, `corpusController.js`, `routes/documents.js`, `api.js`, `CorpusTabContent.jsx`

- **Phase 25e: Value-Only Launch Mode (Attribute Shelving)** ✅
  - **Migration:** UPDATEs all edges to set `attribute_id` to the "value" attribute's ID (idempotent, skips rows already set to value). One collision was deduplicated (105 → 104 edges), votes were reassigned to the kept edge.
  - **Environment variable:** Added `ENABLED_ATTRIBUTES` to backend `.env` and created `.env.example` with sanitized config. Currently set to `value,action,tool,question` (all four attributes enabled).
  - **Backend (conceptsController.js):** `getAttributes` reads `ENABLED_ATTRIBUTES` env var. If set, filters returned attributes to only those names (comma-separated). If unset, returns all attributes (backwards compatible).
  - **Frontend (SearchField.jsx):** When only one attribute is returned from the endpoint, `handleCreateRootClick` skips the attribute picker and auto-assigns the single attribute directly. The `handleAttributeSelect` function accepts an optional `actionOverride` parameter to support this bypass.
  - **Changing enabled attributes:** Update `.env` `ENABLED_ATTRIBUTES` to any comma-separated subset (e.g., `value,action,tool,question`), restart the backend. Existing concepts are unaffected. New root concepts can choose from enabled attributes.
  - Files changed: `migrate.js`, `.env`, `.env.example`, `conceptsController.js`, `SearchField.jsx`

- **Phase 25b: Root Page Attribute Filter** ✅
  - Filter bar on the root page: **All | Action | Tool | Value**. Default selection: **Value**.
  - Filters root concept cards client-side by the attribute on their root edge (`attribute_id`).
  - **Persistence:** Stored in `localStorage` under key `orca_root_attribute_filter`. Persists across sessions and page reloads. Defaults to "Value" if stored value is invalid or missing.
  - **Phase 25e interaction:** Filter bar does not render when only one attribute is enabled (nothing to filter). When the owner enables more attributes via `ENABLED_ATTRIBUTES`, the filter bar appears automatically.
  - Files changed: `Root.jsx`

- **Phase 25c: Author Annotation View & Author-Only Versioning** ✅
  - **New annotation filter:** Fourth option added to the layer filter toggle: **All | Public | Editorial | Author**
  - "Author" shows only annotations where `document_annotations.created_by` matches the document's `documents.uploaded_by` (via subquery). Visible to all users viewing the document, not just the author.
  - **Layer badges:** Collapsed annotation headers now show "editorial" badge (green, was previously abbreviated "ed") and "public" badge (blue-ish, `#5a5a7a` text / `#f0f0f8` background) for visual distinction.
  - **Author-only version creation:** `POST /corpuses/versions/create` restricted to the document's `uploaded_by` user only. Returns 403 with message "Only the document author can create new versions" for non-uploaders.
  - Files changed: `corpusController.js`, `CorpusTabContent.jsx`

- **Phase 25d: WebLinksView Annotation Cleanup & Surfaced Sections** ✅
  - **Annotation display fix:** The annotation system was migrated from character-offset excerpts to document-level annotations (quote_text/comment) in Phase 22b, but WebLinksView was still referencing the old excerpt format (showing empty strings). Fixed:
    - `getAnnotationSentence` rewritten to work with the document-level model — now takes `(body, quoteText, quoteOccurrence)` instead of `(body, startOffset, endOffset)`. Locates the Nth occurrence of the quote text in the document body, then expands outward to sentence boundaries using the same logic as before.
    - Annotation rendering replaced legacy `ann.textSnippet`/`ann.startPosition`/`ann.endPosition` references with: if `ann.quoteText` exists → show it (with sentence expansion); if `ann.comment` exists → show it below; if neither → fallback to "Annotation on [document title]".
    - Extracted rendering into a shared `renderAnnotations(doc)` helper used consistently in all three sections.
    - New styles: `snippetComment` (darker, non-italic for comments), `snippetFallback` (grey italic for fallback).
  - **Backend:** Added `d.uploaded_by` to the `getAnnotationsForEdge` query, passed as `uploadedBy` on each document object (used by My Documents filtering).
  - **New "My Documents" section:** Collapsible section at top of Document Annotations area. Filters documents where `uploadedBy === user.id`. Shows corpus context label. Default expanded with ▾/▸ toggle.
  - **New "Documents in My Corpuses" section:** Below My Documents. Filters documents from subscribed corpuses (fetched via `corpusAPI.getMySubscriptions` on mount), excluding documents already in "My Documents." Grouped by corpus with headers. Default expanded, collapsible.
  - **Main listing unchanged:** The full "Document Annotations" listing below remains complete and unfiltered — items may appear in both surfaced sections and the main listing (intentional, see Architecture Decision #159).
  - **Guest users:** Neither surfaced section renders for guests.
  - Files changed: `corpusController.js`, `WebLinksView.jsx`

- **Architecture Decision #156 — Single Tag Per Document Is a Type, Not an Attribute:** Document tags in Orca represent document *types* (preprint, protocol, grant application, outline). A document has exactly one type. The multi-tag junction table model was replaced with a direct `tag_id` column because the many-to-many relationship encouraged ambiguous classification. Only the document uploader can assign/change the type, ensuring the author controls how their work is categorized.

- **Architecture Decision #157 — Root Page Attribute Filter Defaults to Value:** The root page filter defaults to "Value" rather than "All" because value-attribute graphs represent the highest-level motivational concepts (principles, goals, differentiators) that are the most natural entry point for new users exploring the ontology. Users who want to see tool or action graphs can switch with one click. The filter persists in `localStorage` so returning users see their preferred view.

- **Architecture Decision #158 — Author Annotation View Is Universally Visible:** The "Author" annotation filter shows annotations created by the document's uploader, and this filter is available to all users — not just the author. This supports Orca's transparency philosophy: any reader can see what the author themselves considered worth annotating, which provides useful signal about the document's intended emphasis and structure.

- **Architecture Decision #159 — WebLinksView Surfaced Sections Duplicate the Main Listing:** The "My Documents" and "My Corpuses" sections in WebLinksView are convenience shortcuts that surface relevant content at the top. They do NOT exclude items from the main "Document Annotations" listing below. This means some documents appear twice on the page. The alternative (excluding from the main listing) would mean collapsing the top sections hides content from view, which violates the principle that the full dataset should always be accessible in one place.

- **Architecture Decision #160 — Author-Only Version Creation:** Only the original document uploader (`uploaded_by`) can create new versions of their document. This tightens the previous permission model where any allowed user of a corpus could create versions. The rationale: versioning represents the author's own revision of their work, not community editing. Community input happens through annotations, not through modifying the document itself.

- **Architecture Decision #161 — Environment Variable Toggle for Attribute Enablement:** Rather than removing the multi-attribute infrastructure, Orca controls which attributes are available via an `ENABLED_ATTRIBUTES` environment variable. All four attributes (action, tool, value, question) are enabled at launch. The `attributes` table, `attribute_id` column on edges, and all display code remain intact. The owner enables or disables attributes by updating the environment variable and restarting — no code changes or migrations needed. The original Phase 23 (user-generated attributes open to all users) was cancelled in favor of this owner-controlled model.

- **Architecture Decision #162 — WebLinksView Annotation Display Uses Shared Renderer:** After Phase 22b migrated annotations from character-offset excerpts to document-level annotations (quote_text/comment), WebLinksView was still referencing legacy fields and showing empty strings. The fix extracted annotation rendering into a shared `renderAnnotations(doc)` helper used by all three sections (My Documents, My Corpuses, main listing). The `getAnnotationSentence` function was rewritten to accept `(body, quoteText, quoteOccurrence)` and locate the Nth occurrence of quote text in the document body before expanding to sentence boundaries. This ensures consistent rendering across the entire page.

- **Architecture Decision #163 — Version Chain Tag Propagation Via Recursive CTE:** When a document's tag is assigned or removed, the change must propagate to all versions in the chain. Rather than requiring the frontend to track all version IDs, the backend uses a recursive CTE that walks up via `source_document_id` to find the root document, then walks back down to collect all descendant versions, and updates `tag_id` on the whole chain in a single query. This keeps tag consistency automatic regardless of which version the user is viewing when they change the tag.

---

### Phase 26: Annotation Model Overhaul (✅ COMPLETE)

A comprehensive rework of the annotation system to align annotations with Orca's core philosophy: nothing is deleted, quality emerges from community voting, and identity-based filtering replaces stored layer categories. Also introduces document co-authorship and simplifies corpus member management UI.

**Key Principles:**
- Annotations are permanent (like concepts) — no deletion, vote-based sorting buries low-quality annotations
- The annotation filter (All | Corpus Members | Author) is computed at query time from user identities, not from a stored `layer` column
- "Author" means the document uploader OR any co-author (stored at the version-chain level)
- "Corpus Member" means the corpus owner OR any allowed user (existing `corpus_allowed_users` table)
- Any user can vote on any annotation; voting restrictions by layer are removed
- Auto-vote on annotation creation (creator automatically endorses their annotation)
- Provenance badges ("Added by author", "Voted by corpus member", etc.) replace layer badges
- View-gated annotation creation prevents the UX confusion of adding an annotation invisible in the current filter

#### Phase 26a: Co-Author Infrastructure

**New Tables:**

```sql
CREATE TABLE document_authors (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);

CREATE INDEX idx_document_authors_document ON document_authors(document_id);
CREATE INDEX idx_document_authors_user ON document_authors(user_id);
```

**Key Points:**
- `document_id` references the **root document** in the version chain (where `source_document_id IS NULL`). Co-authorship applies to the entire lineage, not individual versions.
- When checking co-author status for any version, the backend walks up the `source_document_id` chain to find the root, then checks `document_authors` for that root ID. Same recursive CTE pattern used for tag propagation.
- The original uploader (`documents.uploaded_by`) is implicitly an author — not stored in `document_authors`, checked by ownership (same pattern as corpus owner vs `corpus_allowed_users`).
- Any author (uploader or co-author) can generate invite tokens and remove other co-authors.
- Co-authors can create new versions (updates the Phase 25c/Architecture Decision #160 restriction to check `uploaded_by` OR `document_authors` membership via root document lookup).
- No document locking or version conflict warnings needed — uploading a new version just adds a new row to the chain; parallel uploads by different co-authors are fine.

```sql
CREATE TABLE document_invite_tokens (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_document_invite_tokens_document ON document_invite_tokens(document_id);
CREATE INDEX idx_document_invite_tokens_token ON document_invite_tokens(token);
```

**Key Points:**
- Modeled identically to `corpus_invite_tokens` but with `document_id` instead of `corpus_id`.
- `document_id` references the root document in the version chain (same as `document_authors`).
- `token` is a 48-character URL-safe random string generated via `crypto.randomBytes`.
- Any author (uploader or co-author) can generate tokens.
- Accepting a token adds the user to `document_authors` for the root document.

**New Endpoints (on `/api/corpuses` or a new `/api/documents` sub-route):**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/documents/:documentId/invite/generate` | Author only | Generate an invite token for a document's co-author group |
| POST | `/documents/invite/accept` | Required | Accept an invite token to become a co-author |
| GET | `/documents/:documentId/authors` | Author only (list), Guest (count) | Get co-author count (all users) or full list with usernames (authors only) |
| POST | `/documents/:documentId/authors/remove` | Author only | Remove a co-author from the document |
| POST | `/documents/:documentId/authors/leave` | Required | Leave as a co-author (self-removal) |

**Version creation permission update:**
- `POST /corpuses/versions/create` currently checks `uploaded_by === userId`. Will be updated to also check `document_authors` membership via root document lookup. Co-authors can create versions from any corpus the document appears in.

**Frontend changes:**
- New invite acceptance route (e.g., `/doc-invite/:token`) — similar to `/invite/:token` for corpuses
- Co-author count display visible to all users in the document viewer header
- Author management panel visible only to authors: shows co-author usernames with remove buttons, invite token generation
- "Leave" button for co-authors to remove themselves

#### Phase 26b: Corpus Member UI Simplification

**Changes to Allowed Users panel in CorpusDetailView:**
- **Public-facing display:** Count only ("N corpus members") — replaces the full member list visible to all allowed users
- **Corpus owner view:** Retains username list with remove buttons (owner needs to identify members for removal)
- **Member self-service:** "Leave corpus" button for members to remove themselves
- **Retire `display_name` functionality:** Stop reading/writing `corpus_allowed_users.display_name` — column stays in database (dormant)
- **Remove removal log display:** The annotation removal log panel is removed from the Allowed Users UI since annotation deletion is being removed in Phase 26c. The `annotation_removal_log` table stays dormant.
- **Remove `POST /allowed-users/display-name` endpoint** (or leave dormant)
- **Update `GET /:corpusId/allowed-users`:** Returns full list only if requester is corpus owner; returns count only for other allowed users and non-members

#### Phase 26c: Annotation Permanence + Auto-Vote + Cleanup

**Annotation permanence:**
- Remove `POST /annotations/delete` endpoint (or return 410 Gone)
- Remove all annotation deletion UI: delete buttons in AnnotationPanel, confirmation dialogs, deletion handlers in CorpusTabContent
- Retire `annotation_removal_log` code references — remove the `GET /:corpusId/removal-log` endpoint (or leave dormant), remove frontend removal log display
- The `annotation_removal_log` table remains in the database (append-only philosophy — don't drop tables)

**Auto-vote on annotation creation:**
- When `createAnnotation` succeeds, also INSERT into `annotation_votes` (same transaction or immediately after)
- This ensures the creator's annotation starts with 1 vote and appears in any filter view that includes the creator's identity
- If the creator later wants to "un-endorse" their own annotation, they can remove their vote like any other voter

**Remove editorial-layer voting restriction:**
- Currently, `voteOnAnnotation` and `voteAnnotationColorSet` check if the annotation is on the editorial layer and reject non-allowed users. Remove this check — any logged-in user can vote on any annotation.

**Remove color set voting from annotations:**
- Remove backend endpoints: `POST /annotations/color-set/vote`, `POST /annotations/color-set/unvote`, `GET /annotations/:annotationId/color-sets`
- Remove frontend: "🎨 Color set preference" button, color set picker UI, related state variables in CorpusTabContent
- Leave `annotation_color_set_votes` table dormant in database

**Layer column handling:**
- Stop writing meaningful `layer` values on new annotations. The column has `NOT NULL DEFAULT 'public'`, so new annotations will get `'public'` harmlessly.
- The `layer` column is ignored by the new filter logic (Phase 26d) — it no longer drives any behavior.
- Do not drop the column (append-only philosophy).

#### Phase 26d: New Filter Model (Backend)

**Rewrite `getDocumentAnnotations` query:**

The current `?layer=public|editorial|author` parameter is replaced with `?filter=all|corpus_members|author`.

- **`filter=all` (default):** Returns ALL annotations for the document in this corpus, sorted by vote count descending. Each annotation is enriched with four boolean badges:
  - `addedByAuthor` — true if the annotation's `created_by` is the document uploader (`documents.uploaded_by`) OR is in `document_authors` for the root document
  - `votedByAuthor` — true if any author (uploader or co-author) has a row in `annotation_votes` for this annotation
  - `addedByCorpusMember` — true if the annotation's `created_by` is the corpus owner (`corpuses.created_by`) OR is in `corpus_allowed_users` for this corpus
  - `votedByCorpusMember` — true if any corpus member (owner or allowed user) has a row in `annotation_votes` for this annotation

- **`filter=corpus_members`:** Returns annotations WHERE:
  - The creator (`created_by`) is a corpus member (corpus owner or in `corpus_allowed_users`), OR
  - At least one corpus member has voted for it (EXISTS in `annotation_votes` joined with `corpus_allowed_users` / `corpuses.created_by`)
  - Sorted by vote count descending
  - Enriched with `addedByAuthor` and `votedByAuthor` badges (corpus member status is implicit in this view)

- **`filter=author`:** Returns annotations WHERE:
  - The creator (`created_by`) is an author (document uploader or in `document_authors` via root doc), OR
  - At least one author has voted for it (EXISTS in `annotation_votes` joined with `document_authors` / `documents.uploaded_by`)
  - Sorted by vote count descending
  - No provenance badges needed (author status is implicit in this view)

**Author identity resolution:**
- For any document version, walk up `source_document_id` to find the root document
- Check `documents.uploaded_by` on the root document (original uploader)
- Check `document_authors` for the root document ID (co-authors)
- This set of user IDs = "authors" for filtering and badge computation

**Corpus member identity resolution:**
- Check `corpuses.created_by` for the current corpus (corpus owner)
- Check `corpus_allowed_users` for the current corpus (allowed users)
- This set of user IDs = "corpus members" for filtering and badge computation

**Promotion behavior:**
- When a public user becomes a corpus member (added to `corpus_allowed_users`), their existing annotations and votes on documents in that corpus automatically appear in the Corpus Members filter — no data migration needed, because the filter is computed at query time from current user identities.
- When a user becomes a co-author (added to `document_authors`), their existing annotations and votes on that document automatically appear in the Author filter — same query-time computation.

#### Phase 26e: New Filter Model (Frontend)

**Filter toggle:**
- **All | Corpus Members | Author** (replaces old All | Public | Editorial | Author)
- Default: **All**

**Provenance badges on annotations (italic EB Garamond):**
- In **All** view: show applicable badges — "(author)", "(author endorsed)", "(corpus member)", "(corpus member endorsed)". "Endorsed" variant only shows if the annotation wasn't directly added by that identity (avoids redundancy).
- In **Corpus Members** view: show author-related badges only — "(author)", "(author endorsed)" (corpus member status is implicit)
- In **Author** view: no provenance badges needed (author status is implicit)

**Auto-jump on annotation creation (replaces originally planned view-gating):**
- The annotation creation button is visible to ALL logged-in users in ALL filter views — capability is never hidden.
- After creating an annotation, the frontend checks whether the creator belongs to the current filter's identity group. If not (e.g., a non-author creates while viewing the Author filter), the filter automatically switches to "All" before reloading annotations. If the creator does belong, the view stays.
- Rationale: instead of hiding the creation button (which removes capability), the UI adapts to always show the user what they just did.

**Co-author management UI:**
- Placement: in the document viewer header, consistent with corpus member management in CorpusDetailView
- All users see: co-author count ("N co-authors" or "1 author")
- Authors see: clickable count that toggles a management panel — co-author usernames with remove buttons, invite token generation, "Leave" button (for co-authors, not the original uploader)

**Members panel in CorpusTabContent:**
- Members button added to CorpusTabContent action row (matching CorpusDetailView)
- Owner sees invite links + full member list with remove buttons
- Non-owners see count only + leave button for allowed users
- Delete Corpus button also added to CorpusTabContent action row

**Architecture Decisions (Phase 26):**

- **Architecture Decision #171 — Lineage-Level Co-Authorship Via Root Document:** Co-authorship is stored against the root document in the version chain (`source_document_id IS NULL`), not against individual versions. The `document_authors` table references the root document ID. When checking co-author status for any version, the backend walks up the `source_document_id` chain via recursive CTE to find the root, then checks `document_authors`. This ensures the co-author group identity persists across all versions — it belongs to the project/lineage, not to individual revision snapshots. Invite tokens also reference the root document. When a new version is created by any author, the co-author list automatically applies to it.

- **Architecture Decision #172 — Annotation Permanence (No Deletion, Vote-Based Sorting):** Annotations can no longer be deleted. This mirrors the concept model where nothing is ever removed, only buried by community voting. Bad or irrelevant annotations naturally sink to the bottom via low vote counts. The `annotation_removal_log` table and all deletion UI are retired. The `POST /annotations/delete` endpoint is removed. This eliminates the moderation complexity of tracking who removed what and why — the community curates through endorsement, not removal.

- **Architecture Decision #173 — Filter-By-Identity Replaces Stored Layer Column:** The annotation filter system shifts from a stored `layer` column (`public`/`editorial`) to query-time identity resolution. The three filter views (All, Corpus Members, Author) are computed by checking whether the annotation's creator or any of its voters belong to the relevant identity group (authors = uploader + `document_authors`; corpus members = corpus owner + `corpus_allowed_users`). This means the same annotation can appear in multiple filter views without duplication — a public user's annotation that receives a corpus member's vote appears in both All and Corpus Members views. The `layer` column on `document_annotations` is retained but ignored; new annotations default to `'public'` harmlessly.

- **Architecture Decision #174 — Auto-Vote On Annotation Creation:** Creating an annotation automatically inserts a vote in `annotation_votes` for the creator. This ensures every annotation starts with at least 1 vote, the creator's annotation appears in any identity-based filter that includes them (e.g., an author's annotation immediately appears in the Author view), and the creator can later remove their vote if they change their mind — unlike the old model where creation was permanent endorsement, this model allows the creator to "withdraw support" from their own annotation while the annotation itself remains (permanence).

- **Architecture Decision #175 — Co-Author/Corpus Member Management Shows Counts Publicly, Usernames to Members/Authors (Updated Phase 28e):** The public-facing display for both corpus members and document co-authors shows only a count ("N corpus members", "N co-authors"). For corpus members: usernames are visible to ALL corpus members (owner + allowed users), not just the owner. The owner retains remove buttons; non-owner members see the list read-only (plus their own "Leave" button). For co-authors: usernames are visible to all authors (uploader + co-authors), who can also remove other co-authors. Non-members/non-authors see counts only. The `display_name` field on `corpus_allowed_users` is retired — invite tokens handle identity coordination in real life. *(Originally, only the corpus owner could see member usernames; relaxed in Phase 28e.)*

- **Architecture Decision #176 — Auto-Jump Replaces View-Gated Annotation Creation:** The original Phase 26e plan called for hiding the annotation creation button when the user didn't belong to the current filter's identity group (e.g., hiding it from non-authors in the Author view). This was replaced with an auto-jump approach: the creation button is always visible to all logged-in users, and after creation the filter automatically switches to a view where the new annotation is visible. This preserves capability (users can always annotate) while ensuring they see their work. The principle: capability is never hidden; the UI adapts to show you what you did.

---

**Key Bug Patterns (Phase 26):**

- **Naive one-level-up root lookup causes duplicate version numbers:** The `createVersion` endpoint originally used `sourceDoc.source_document_id || sourceDoc.id` to find the "root" — but this only goes one level up, not to the actual root. For a chain v1←v2←v3←v4, creating from v3 would compute rootDocId = v2, missing parts of the chain. Fix: always use `getRootDocumentId()` (recursive CTE utility) for any operation that needs the root document. This pattern applies to co-author lookups, tag propagation, and version number computation.
- **Frontend document lineage grouping breaks with gaps in corpus membership:** `groupDocsByLineage` walked the `source_document_id` chain using only documents present in the corpus. When intermediate versions are missing from the corpus (e.g., v1 and v3 are in the corpus but v2 is not), the chain walk breaks. Fix: backend now computes `root_document_id` via recursive CTE over the full `documents` table and returns it with each document. Frontend uses `root_document_id` for reliable grouping regardless of corpus membership gaps.
- **"My Documents" filter must account for version chain uploaders:** Filtering `documents.filter(doc => doc.uploaded_by === user.id)` breaks chain resolution because it excludes versions uploaded by other users in the same chain. Fix: group ALL documents into chains first, track `_chainUploaders` (set of all uploaders in the chain), then filter chains where the user is any uploader.

### Phase 27: Annotations Panel Overhaul (✅ COMPLETE)

Transforms annotations from a separate page (behind a 🔗 Links button) into an always-visible right panel on the concept page. The concept page becomes a two-column layout: children/flip view on the left, annotation panel on the right. Annotations are aggregated across ALL parent contexts for the leaf concept (cross-context), shown in a flat vote-sorted list. The panel has two tabs: **Annotations** (default) and **Web Links**. Retires `WebLinksView.jsx`, `FlipLinksView.jsx`, and the `'links'`/`'fliplinks'` view modes.

#### Phase 27a: Two-Column Layout + View Mode Retirement
**Layout change (`Concept.jsx`):**
- Split the concept page into a two-column layout: left side renders children grid (or Flip View cards), right side renders a new annotation panel component
- The annotation panel is always visible in both Children view and Flip View — it's scoped to the leaf concept, not the current edge
- Remove the 🔗 **Links** button from the concept header bar entirely
- Remove the `'links'` view mode and `handleToggleLinksView` handler
- Remove the `'fliplinks'` view mode and `handleOpenFlipLinks` handler
- Remove the 🔗 **All Links** button from `FlipView.jsx`

**Component retirement:**
- `WebLinksView.jsx` — retired. Its annotation display and web links display are absorbed into the new panel component
- `FlipLinksView.jsx` — retired. Cross-context web links are now handled by the Web Links tab in the panel (using the existing `getAllWebLinksForConcept` endpoint)

**New component:**
- Create `AnnotationPanel.jsx` (or similar name — note: there is an existing `AnnotationPanel.jsx` used inside `CorpusTabContent` for annotation *creation*; the new panel component needs a distinct name, e.g., `ConceptAnnotationPanel.jsx`)
- The panel has two tabs at the top: **Annotations** | **Web Links**
- Annotations tab is the default view
- Web Links tab uses the existing `getAllWebLinksForConcept` endpoint to show cross-context web links

**Files expected:** `Concept.jsx` (layout split, remove Links button/view modes), `FlipView.jsx` (remove All Links button), new `ConceptAnnotationPanel.jsx`, retire `WebLinksView.jsx` and `FlipLinksView.jsx`

#### Phase 27b: Cross-Context Annotation Endpoint + Panel Rendering
**New backend endpoint (`corpusController.js`):**
- `GET /api/corpuses/annotations/concept/:conceptId` — new endpoint that fetches all annotations for a concept across ALL edges (parent contexts) and ALL corpuses
- Joins `document_annotations` → `edges` (where `edges.child_id = :conceptId`) → `documents` → `corpuses` to aggregate cross-context
- Each annotation object in the response includes:
  - `annotationId`, `quoteText`, `comment`, `createdAt`
  - `voteCount`, `userVoted` (if logged in)
  - `documentId`, `documentTitle`, `documentVersionNumber`
  - `corpusId`, `corpusName`
  - `tagId`, `tagName` (document's type tag)
  - `creatorUsername`
  - `edgeId`, `parentConceptName`, `parentPath` (parent context provenance — so the card can show which parent context this annotation is from)
- Query parameters:
  - `?sort=votes` (default): `ORDER BY vote_count DESC, created_at DESC`
  - `?sort=new`: `ORDER BY created_at DESC`
  - `?tagId=N`: filter to annotations on documents with this tag
  - `?corpusIds=1,2,3`: filter to annotations in these corpuses (comma-separated)
- Guest-accessible (optionalAuth — `userVoted` is null for guests)
- The existing `getAnnotationsForEdge` endpoint is preserved (still used by `CorpusTabContent` for edge-scoped annotation loading within a document viewer) but is no longer called from the concept page

**Frontend panel rendering (`ConceptAnnotationPanel.jsx`):**
- Annotations tab shows a flat list of annotation cards, each displaying:
  - Document title (clickable — navigates to corpus tab + document)
  - Corpus name
  - Parent context path (e.g., "Root > Parent > [leaf concept]") — shows which edge/context the annotation is from
  - Quote text (if present), comment (if present)
  - Vote count with vote/unvote button (for logged-in users)
  - Creator username, date
  - Tag pill (if the document has a type tag)
- Two sort toggle buttons: **Annotation Votes** (default) and **Newest**
- The panel calls the new endpoint on mount, passing `conceptId` (the leaf concept being viewed)

**Frontend API (`api.js`):**
- New `getAnnotationsForConcept(conceptId, { sort, tagId, corpusIds })` API method

**Route registration (`corpuses.js`):**
- New route `GET /annotations/concept/:conceptId` — must be placed before `/:id` parameterized routes (same pattern as other annotation routes)

#### Phase 27c: Tag Filter + My Corpuses Filter + Pending Annotation Navigation
**Tag filter:**
- Tag filter pills in the annotation panel (same UX as before — pills for each document type tag, clickable to filter)
- Passes `tagId` to the backend via the updated API call

**My Corpuses filter:**
- **"My Corpuses"** toggle button/pill in the filter area (near tag filter, independent of it)
- When toggled ON:
  - Fetch the user's subscribed corpuses via `corpusAPI.getMySubscriptions` (already available)
  - Display subscribed corpus names as clickable pills below the toggle
  - With no specific corpus pill selected: filter to annotations from ALL subscribed corpuses (pass all subscribed corpus IDs as `corpusIds`)
  - Clicking a specific corpus pill: filter to only that corpus (pass single corpus ID)
  - Clicking the active corpus pill again: deselect, return to all subscribed corpuses
- Tag filtering and My Corpuses filtering are independent — both can be active at the same time
- "My Corpuses" toggle hidden for guest users

**Pending annotation navigation (new infrastructure):**
- Extends the existing `pendingDocumentId` pattern (Architecture Decision #80) with a new `pendingAnnotationId`
- When a user clicks an annotation card in the panel to navigate to the document:
  - `onOpenCorpusTab(corpusId, corpusName, documentId, annotationId)` — passes the annotation ID alongside the document ID
  - `AppShell` stores `pendingAnnotationId` in state (alongside existing `pendingCorpusDocumentId`)
  - `CorpusTabContent` receives `pendingAnnotationId` as a prop
  - After the document loads and annotations are fetched, `CorpusTabContent` finds the annotation with the matching ID in the annotation list, expands/selects it in the annotation panel, and scrolls it into view
  - `pendingAnnotationId` is cleared via callback after consumption (same pattern as `onPendingDocumentConsumed`)
- If the annotation has a `quoteText`, the existing quote-navigation mechanism (runtime string search → `<mark>` highlight) should also fire so the user sees both the annotation panel selection AND the highlighted quote in the document body

**Files expected:** `ConceptAnnotationPanel.jsx` (filter UI), `api.js` (query param passing), `Concept.jsx` (prop threading), `AppShell.jsx` (new `pendingAnnotationId` state), `CorpusTabContent.jsx` (pending annotation consumption + scroll-to-annotation logic)

#### Phase 27d: Responsive Layout
- On narrow screens (mobile / small browser windows), the two-column layout stacks vertically: children/flip grid on top, annotation panel below
- CSS breakpoint determines the threshold (implementation decision for Claude Code — likely around 768px or 900px)
- The panel retains full functionality when stacked; it just takes full width instead of the right column

**Files expected:** `Concept.jsx` (responsive CSS), `ConceptAnnotationPanel.jsx` (responsive adjustments if needed)

**Architecture Decisions (Phase 27):**

- **Architecture Decision #177 — Annotations as Always-Visible Panel, Not Separate Page:** The External Links page (WebLinksView.jsx) is retired in favor of an always-visible annotation panel on the right side of the concept page. This positions document annotations front-and-center during graph navigation — the purpose of exploring graphs is to find and explore documents, so annotations should be immediately visible rather than hidden behind a button click. The panel persists across Children view and Flip View, reinforcing that annotations are a primary output of the concept hierarchy, not a secondary feature.

- **Architecture Decision #178 — Cross-Context Annotation Aggregation for Leaf Concept:** The annotation panel aggregates annotations from ALL parent contexts (edges) for the current leaf concept, not just the current edge. This is the annotation equivalent of what FlipView does for parent contexts and what FlipLinksView did for web links. Each annotation card shows its parent context path so users know which edge the annotation came from. The underlying data model is unchanged — annotations are still stored per-edge in `document_annotations`. The new `getAnnotationsForConcept` endpoint simply joins across all edges where the concept appears as a child. The existing `getAnnotationsForEdge` endpoint is preserved for use within `CorpusTabContent` (document-level annotation viewing).

- **Architecture Decision #179 — Flat Vote-Sorted Annotation List Replaces Corpus-Grouped Display:** Individual annotations are the atomic unit in a flat, vote-sorted list. Previously, annotations were grouped by corpus → document in collapsible sections. The flat model aligns with Orca's voting philosophy: the best annotations rise to the top regardless of which corpus or parent context they belong to. Corpus and parent context are still visible on each annotation card (provenance), but they no longer drive organizational structure. Architecture Decision #159 (surfaced sections duplicate the main listing) is retired — the "My Documents" and "Documents in My Corpuses" sections are removed entirely, replaced by a "My Corpuses" filter toggle.

- **Architecture Decision #180 — My Corpuses as Filter, Not Section:** The Phase 25d approach of surfacing "My Documents" and "Documents in My Corpuses" as separate sections above the main listing is replaced by a "My Corpuses" toggle filter. When active, it restricts the flat list to annotations from the user's subscribed corpuses, with optional narrowing to a specific corpus via clickable pills. This is simpler (one list, one sort order) and composable (My Corpuses + tag filter can both be active). The user always sees a single sorted list; they just control what's in it.

- **Architecture Decision #181 — Server-Side Filtering for Corpus and Tag:** Tag and corpus filtering are handled by query parameters on the `getAnnotationsForConcept` endpoint rather than client-side filtering. This keeps the frontend simple, avoids loading all annotations and filtering in JavaScript, and is pagination-ready if annotation counts grow large.

- **Architecture Decision #182 — Pending Annotation Navigation Extends Pending Document Pattern:** Clicking an annotation card in the panel to navigate to the document not only opens the document in the corpus tab (existing `pendingDocumentId` pattern) but also auto-selects and scrolls to the specific annotation in the corpus tab's annotation sidebar (new `pendingAnnotationId`). This extends Architecture Decision #80's cross-component navigation pattern. The annotation sidebar selection and the quote-text highlight (if applicable) both fire, giving the user visual confirmation of exactly which annotation they clicked through to see.

- **Architecture Decision #183 — Annotations | Web Links Tab Toggle in Panel:** The right panel uses a tab toggle (Annotations | Web Links) rather than stacking web links below annotations in a single scrolling list. This prevents web links from being buried below a long annotation list and gives each content type its own clean space. The Web Links tab uses the existing `getAllWebLinksForConcept` endpoint (cross-context aggregation, already built in Phase 6c for FlipLinksView).

- **Architecture Decision #184 — WebLinksView and FlipLinksView Retired:** `WebLinksView.jsx` (edge-scoped External Links page) and `FlipLinksView.jsx` (cross-context web links compilation) are both retired. Their functionality is absorbed into the new `ConceptAnnotationPanel.jsx`: annotations tab replaces WebLinksView's document annotations section, web links tab replaces both WebLinksView's web links section and FlipLinksView's cross-context compilation. The `'links'` and `'fliplinks'` view modes in tab navigation state are retired. This reduces the number of distinct view modes and eliminates two components.

- **Architecture Decision #185 — Admin-Controlled Document Tags Mirror Attribute Model:** Document type tags shift from user-generated to owner-controlled, matching the attribute pattern established in Phase 25e. The `ENABLED_DOCUMENT_TAGS` environment variable (comma-separated tag names) gates which tags appear in the picker. The `GET /api/documents/tags` endpoint filters by enabled tags. The `POST /documents/tags/create` endpoint is retired (410 Gone). New tags are added by the owner via database row insertion + env var update + restart. This prevents tag proliferation and gives the owner full control over the document taxonomy, just as they control the concept attribute taxonomy.

---

### Phase 28: Visual Polish, UI Cleanup & Bug Fixes (✅ COMPLETE)

A sweep of visual refinements, feature removals, and bug fixes to bring Orca to launch-quality polish. Organized into seven sub-phases that can each be committed independently.

**Key Principles:**
- Strip remaining visual clutter (icons, colors) to match Zen aesthetic — only vote set swatches provide color
- Ensure EB Garamond typography is consistent everywhere
- Remove vestigial features (ranking, supergroups, back buttons) that are no longer needed
- Fix bugs found during pre-launch testing
- Convert login from a standalone page to an inline modal for seamless guest-to-user transition
- Expand concept name limit to support research questions (now the [question] attribute)

#### Phase 28a: Visual Cleanup — Icons, Fonts, Colors

**Icon Removal:**
- Remove 📚 icon from corpus items in the sidebar
- Remove 📚 icon from the Browse button in the sidebar
- Remove the icon from the Flip View / Children View toggle button (keep text only)
- Remove the icon from the Share button (📋) — keep text "Share" only
- Remove the 📌 icon from the Annotate button — change to the word "Annotate"
- Remove the icon from the document tag button (🏷) — change to the word "Add tag" (or "Change tag" when a tag is already set)
- Remove the icon from the Members button when viewing a corpus — keep text "Members" only
- Remove 📚 icon next to corpuses on the Saved (→ "Graph Votes") page
- **Keep:** Save button (▲) and Swap button (⇄) icons — these are simple and non-colorful

**Font Consistency — ensure EB Garamond everywhere:**
- Breadcrumb path concept names
- Flip View / Children View toggle button text
- Username and "Logout" text in the header
- "Login" / "Sign Up" text in the header (guest view)
- Parent concept names in children view (concept pane)
- Children concept names and child count in children view
- "No children yet" placeholder text (when a concept has no children)

**Color Removal — Zen style only (black on off-white):**
- Flip View / Children View toggle: remove green styling, use black text on off-white (with subtle distinction for active state, e.g., slightly darker background or underline — no color)
- Logout button: remove red color, use standard black text
- Save button active state: remove bright blue fill. Use a subtle visual difference (e.g., filled vs outlined, or slightly darker shade of the off-white background) instead of color. The unsaved state should still be visually distinct from saved, just not with bright color.

**Files likely changed:** `AppShell.jsx`, `Concept.jsx`, `ConceptGrid.jsx`, `FlipView.jsx`, `Root.jsx`, `CorpusTabContent.jsx`, `SavedPageOverlay.jsx`, `ConceptAnnotationPanel.jsx`

#### Phase 28b: UI Removals — Back Buttons, Ranking & Supergroups

**Remove Back Buttons:**
- Remove the ← back button from the breadcrumb path area (concept header)
- Remove the ← back button from Flip View
- Navigation still works via breadcrumb clicks, sidebar, and browser back — explicit back buttons are redundant

**Remove Ranking/Ordering Functionality:**
- Remove the ranking dropdown UI from ConceptGrid child cards (the "Rank: [—|1|2|...|N]" selector)
- Remove aggregated rank badges (#1: N, #2: N) from child cards
- Remove ranking-related sort logic from the vote set filter flow
- Remove or retire backend endpoints: `GET /votes/rankings`, `POST /votes/rankings/update`, `POST /votes/rankings/remove` (return 410 Gone, consistent with other retirements)
- Leave `child_rankings` table in database (append-only philosophy — don't drop tables)
- Remove ranking loading useEffect and state variables from `Concept.jsx`
- Remove ranking-related props passed to `ConceptGrid.jsx` and `VoteSetBar.jsx`
- Clean up the filter info text that references ranking ("rank your children with the dropdown", "sorted by community ranking")

**Remove Vote Set Supergroups (Layer 3):**
- Remove the super-group row above individual swatches in `VoteSetBar.jsx` (the 14px tall blended-color swatches that group similar vote sets)
- Remove the agglomerative clustering logic that computes super-groups (Jaccard threshold grouping)
- Remove super-group hover highlighting (glow + 1.3× scale on member dots)
- Remove super-group filtering logic from `getEffectiveActiveSetIndices()` — clicking a super-group swatch currently expands to all member sets
- Remove the sort toggle mode "Sort by Similarity" that cycles through similarity-based ordering in Flip View (if it interacts with super-groups)
- Keep individual vote set swatches (Layer 1) and tiered display (Layer 2) — only Layer 3 (super-groups) is removed
- No backend changes needed — super-groups are computed client-side from the existing `getVoteSets` response
- No tables to retire — super-groups have no database storage

**Files likely changed:** `Concept.jsx`, `ConceptGrid.jsx`, `FlipView.jsx`, `VoteSetBar.jsx`, `votesController.js`, `routes/votes.js`

#### Phase 28c: Rename & Title Changes

**Rename Saved Page to "Graph Votes":**
- Header button text: "Saved" → "Graph Votes"
- `SavedPageOverlay.jsx` title/header: "Saved" → "Graph Votes"
- Any references in the dormancy banner text ("dormant saved tab(s)" → "dormant Graph Votes tab(s)" or similar)
- Internal component names and file names can stay as-is (avoid unnecessary refactor churn)

**Browser Tab Title:**
- Change `<title>` in `index.html` from "concept hierarchy" (or whatever it currently says) to "orca"

**Files likely changed:** `AppShell.jsx`, `SavedPageOverlay.jsx`, `index.html`

#### Phase 28d: Bug Fixes

**Fix Decontextualized Document View Repeating Document:**
- Bug: The document body is rendered once per annotation, causing the full text to repeat multiple times
- Root cause: likely a `.map()` over annotations array that renders the document body inside each iteration instead of rendering the body once and the annotations separately
- Fix: Render document body once, then render annotation list separately below or alongside
- **File:** `DecontextualizedDocView.jsx`

**Fix Document Search in Add-Existing-Document:**
- Bug: Searching by document title when adding an existing document to a corpus only returns one result ("document2")
- Root cause: likely a query issue — possibly `LIMIT 1`, a missing `%` wildcard in the `LIKE`/`ILIKE` clause, or the search endpoint not using trigram/fuzzy matching for document titles
- Fix: Ensure the search query uses `ILIKE '%query%'` or similar and returns multiple results
- **Files:** `corpusController.js` (the endpoint that handles document search for add-existing), possibly `CorpusTabContent.jsx` or `CorpusDetailView.jsx` (whichever hosts the add-existing-document UI)

**Fix Missing Children View Button on Root Concept Flip View:**
- Bug: When viewing Flip View for a root concept, there is no button to switch back to Children View
- Root cause: the Children View toggle likely checks for a path/parent context and hides itself when path is empty (root concepts have empty paths)
- Fix: Show the toggle button for root concepts too — they have children and should be navigable in children view
- **File:** `Concept.jsx` (or wherever the view mode toggle renders)

**Fix Duplicate Document Tag "preprint" vs "Preprint":**
- Bug: Two rows exist in `document_tags` — one lowercase "preprint" and one capitalized "Preprint"
- Fix: Migration step in `migrate.js` to:
  1. Find the ID of the lowercase "preprint" tag (the keeper)
  2. Find the ID of the capitalized "Preprint" tag (the duplicate)
  3. Update any `documents.tag_id` pointing to the duplicate → point to the keeper
  4. Delete the duplicate row from `document_tags`
  5. Wrap in IF EXISTS checks for idempotency
- Also consider adding a UNIQUE index on `LOWER(name)` to prevent future case-insensitive duplicates (the current schema has `UNIQUE NOT NULL` on `name` but that's case-sensitive)
- **File:** `migrate.js`

#### Phase 28e: Corpus Member Visibility Update

**Allow All Members to See Other Members:**
- Current behavior: Non-owner corpus members see only a count ("N corpus members"). Only the owner sees the full member list with usernames.
- New behavior: ALL corpus members (owner AND allowed users) can see the full member list with usernames. Non-members still see count only. Owner retains the remove button; non-owner members see the list read-only (plus their own "Leave" button).
- Backend change: `GET /:corpusId/allowed-users` — currently returns full list only for corpus owner. Update to return full list for any user who is a corpus member (owner OR in `corpus_allowed_users`).
- Frontend change: The members panel in `CorpusTabContent.jsx` and `CorpusDetailView.jsx` already renders usernames when the backend provides them — the gating is on the backend response.

**Architecture Decision Updates:**
- Architecture Decision #39 updated in-place (see above)
- Architecture Decision #175 updated in-place (see above)

**Files likely changed:** `corpusController.js`, `CorpusTabContent.jsx`, `CorpusDetailView.jsx`

#### Phase 28f: Login Panel Redesign

**Convert Login from Standalone Page to Inline Modal:**
- Current: Login is a full separate page (`/login` route). Guest users leave whatever they're viewing to log in.
- New: Clicking "Login" in the header opens a dropdown/modal overlay on the current page. The modal has two tabs/toggles: "Login" and "Sign Up".
- Login tab: username + password fields + "Log in" button
- Sign Up tab: username + email + password fields + "Sign up" button
- Error messages displayed inline within the modal
- On successful login/register: modal closes, current page reloads with authenticated state (user's sidebar items load, guest restrictions lift)
- The `/login` and `/register` routes in `App.jsx` can remain as fallbacks (for direct URL access or invite acceptance flows that redirect to login), but the primary flow is now the modal
- Styling: EB Garamond font, black on off-white, consistent with Zen aesthetic. No colored buttons — use subtle borders/backgrounds.

**Files likely changed:** `AppShell.jsx` (new modal state + render), new `LoginModal.jsx` component (or inline in AppShell), `App.jsx` (keep routes as fallbacks)

#### Phase 28g: Expand Concept Name Character Limit

**Increase concept name limit from 40 → 255 characters:**
- With the [question] attribute, concepts like "How does institutional review board process design influence the reproducibility of findings across biomedical disciplines?" need room
- 255 characters is the classic VARCHAR default — generous enough for full research questions while still clearly a label, not a document

**Database migration (migrate.js):**
- `ALTER TABLE concepts ALTER COLUMN name TYPE VARCHAR(255)` — idempotent, PostgreSQL allows widening VARCHAR without data loss
- `ALTER TABLE document_concept_links_cache ALTER COLUMN concept_name TYPE VARCHAR(255)` — this cache table also stores concept names

**Backend changes:**
- `conceptsController.js`: Update the validation check from `name.length > 40` to `name.length > 255`
- Update any error message text referencing "40 characters"

**Frontend changes:**
- `SearchField.jsx`: Update `maxLength={40}` to `maxLength={255}` on the input element ✅
- Consider whether the search/create input field needs to be wider or allow wrapping for longer names
- Concept cards in `ConceptGrid.jsx` may need text wrapping or truncation for very long names — ensure they don't overflow their containers
- Breadcrumb path in `Concept.jsx` should handle long names gracefully (truncation with title tooltip, or wrapping)
- Flip View cards in `FlipView.jsx` — verify long concept names don't break card layout
- Root page cards in `Root.jsx` — same layout check

**Files likely changed:** `migrate.js`, `conceptsController.js`, `SearchField.jsx`, `ConceptGrid.jsx`, `Concept.jsx`, `FlipView.jsx`, `Root.jsx`

#### Implementation Order

28a → 28b → 28c → 28d → 28e → 28f → 28g

Each sub-phase should end with a clean build (`npm run build` passes with no errors) and a git commit before proceeding to the next.

#### Git Commits (Phase 28 — Suggested)
1. `feat: 28a, visual cleanup — remove icons, fix font consistency, remove button colors for Zen aesthetic`
2. `feat: 28b, remove back buttons, ranking/ordering, and vote set supergroups`
3. `feat: 28c, rename Saved page to Graph Votes, set browser tab title to orca`
4. `fix: 28d, bug fixes — decontextualized doc view repeat, document search, root flip view toggle, duplicate preprint tag`
5. `feat: 28e, allow all corpus members to view member usernames, update architecture decisions`
6. `feat: 28f, convert login from standalone page to inline modal with login/register tabs`
7. `feat: 28g, expand concept name character limit from 40 to 255`

#### Architecture Decisions (Phase 28)
- **Architecture Decision #186 — Icons Removed From UI Except Save/Swap:** Emoji icons (📚, 📌, 📋, 🏷) are removed from buttons and labels throughout the UI. Text labels replace them for clarity and consistency with the Zen aesthetic. The save (▲) and swap (⇄) buttons retain their simple non-emoji symbols as they're already minimal and widely understood.
- **Architecture Decision #187 — Ranking System and Vote Set Supergroups Retired:** The child ranking feature (Phase 5f) and vote set super-group similarity grouping (Phase 4, Layer 3) are both retired. Ranking endpoints return 410 Gone. The `child_rankings` table remains in the database (append-only philosophy). Ranking was designed for granular ordering within vote sets, but in practice the vote set swatch filtering provides sufficient signal. Super-groups (agglomerative clustering of similar vote sets into blended-color parent swatches) added visual complexity without proportionate insight — individual swatches with tiered display (Layer 2) are sufficient. Removing both simplifies the VoteSetBar and ConceptGrid UI significantly.
- **Architecture Decision #188 — Login Modal Replaces Login Page:** Guest users can log in or register via a modal overlay without leaving their current view. This is critical now that guest access is a primary entry path — users should be able to browse the graph and decide to log in without losing their place. The `/login` and `/register` routes remain as fallbacks for direct links and invite acceptance flows.
- **Architecture Decision #189 — Corpus Member Usernames Visible to All Members:** All corpus members (owner + allowed users) can see each other's usernames in the members panel. This relaxes the original design (Architecture Decision #39) where only the owner saw usernames. The change reflects that collaborative corpuses benefit from members knowing who else is participating. Non-members still see only a count. Graph-level voting (saves, swaps, links) remains anonymous. Updates Architecture Decisions #39 and #175.
- **Architecture Decision #190 — Saved Page Renamed to "Graph Votes":** The "Saved" page is renamed to "Graph Votes" to better communicate what it shows — the user's save votes organized by corpus. "Saved" was ambiguous (saved documents? saved searches?). "Graph Votes" directly describes the content: edges the user has voted to save in the concept graph.
- **Architecture Decision #191 — Concept Name Limit Expanded to 255 Characters:** The concept name character limit is raised from 40 to 255 to accommodate the [question] attribute. Research questions like "How does institutional review board process design influence the reproducibility of findings across biomedical disciplines?" easily exceed 40 characters. 255 is the classic VARCHAR default — generous enough for full research questions while clearly still a label, not a document. The limit is enforced at three levels: database column (`VARCHAR(255)`), backend validation, and frontend `maxLength`. The `document_concept_links_cache.concept_name` column is also widened to match.

---

### Phase 29: Web Link Comments, Top Annotation Sort & Flat Sort Selector (✅ COMPLETE)

Three features improving web link usability, concept child sorting, and sort UI visibility.

#### ✅ Completed (Phase 29a) — Web Link Creator Comments + Web Link UI Improvements

- **Schema changes (migrate.js):**
  - Added nullable `comment` TEXT column to `concept_links` table (idempotent ALTER TABLE)
  - Added `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP column to `concept_links` table (idempotent ALTER TABLE)

- **Backend changes (votesController.js):**
  - `getWebLinks`: Now returns `comment` and `updatedAt` for each link
  - `addWebLink`: Accepts optional `comment` field from request body, stores it on the new column
  - `getAllWebLinksForConcept`: Now returns `comment` and `updatedAt` for each link
  - New `updateConceptLinkComment`: PUT endpoint at `/web-links/:linkId/comment`. Auth required. Verifies creator (`added_by === userId`, returns 403 otherwise). Updates `comment` column. **Smart `updated_at` handling:** only updates `updated_at` if the link already had a comment — first-time comment additions leave `updated_at` unchanged so "(edited)" only appears for genuine modifications to an existing comment.

- **Route registration (votes.js):**
  - New route `PUT /web-links/:linkId/comment` with auth middleware

- **Frontend API (api.js):**
  - New method `updateLinkComment(linkId, comment)` calling the PUT endpoint

- **Frontend UI (ConceptAnnotationPanel.jsx — Web Links tab):**
  - Uses `useAuth()` to get current user ID for creator check
  - Displays comment below each web link in smaller font with creator username
  - Shows "(edited)" indicator when `updatedAt` differs from `createdAt`
  - Creator sees "Edit" text button (or "Add comment" if no comment exists); clicking opens inline textarea with Save/Cancel buttons
  - Non-creators see comment read-only with no edit button
  - Optimistic update on save with error rollback
  - **New "+ Add Web Link" button** at the top of the Web Links tab (only shown to logged-in users when a `currentEdgeId` exists). Opens inline form with URL input, optional title input, optional comment textarea, and Add/Cancel buttons. URL validation (must start with `http://` or `https://`), error display from backend (e.g., duplicate URL). On success, new link prepended to list and form closes.
  - **Clickable vote toggle:** The ↑ N vote count on each web link is now clickable. Toggles vote optimistically (calls `upvoteWebLink`/`removeWebLinkVote`). Voted state shows darker/bolder text. Guests get the login modal instead.
  - **Auto-resort on vote:** Web links re-sort by vote count after each vote toggle, keeping highest-voted links at the top.
  - All styled in EB Garamond, black-on-off-white Zen aesthetic

- Files changed: `migrate.js` (new columns), `votesController.js` (updated getWebLinks, addWebLink, getAllWebLinksForConcept + new updateConceptLinkComment), `votes.js` (new PUT route), `api.js` (new updateLinkComment method), `ConceptAnnotationPanel.jsx` (comment display, inline edit UI, add link form, clickable vote toggle, auto-resort)

#### ✅ Completed (Phase 29b) — "Top Annotation" Sort for Children

- **Backend changes (conceptsController.js):**
  - Both `getRootConcepts` and `getConceptWithChildren` now accept `sort=top_annotation` query parameter
  - Uses a `LEFT JOIN LATERAL` subquery that: finds all annotations on each edge via `document_annotations`, counts votes per annotation via `annotation_votes`, and takes the `MAX` vote count
  - Sorts descending by `top_annotation_votes`, with tiebreakers: save count descending, then concept name alphabetical
  - Returns `top_annotation_votes` in the response; edges with no annotations get 0 and sort to the bottom
  - Conditional join pattern matches the existing `sort=annotations` approach — no overhead on default queries

- **Frontend changes:**
  - `Concept.jsx` and `Root.jsx`: Added `'top_annotation'` to the sort options (initially added to dropdown, converted to flat row in 29c)
  - `ConceptGrid.jsx`: When `top_annotation_votes` is present and > 0 on a concept, displays a subtle "Top annotation: N votes" indicator below the child count

- Files changed: `conceptsController.js` (new sort parameter handling with LEFT JOIN LATERAL), `Concept.jsx`, `Root.jsx` (new sort option), `ConceptGrid.jsx` (top annotation votes indicator)

#### ✅ Completed (Phase 29c) — Flat Horizontal Sort Selector

- **UI change (Concept.jsx + Root.jsx):**
  - Replaced the `<select>` dropdown with a flat horizontal button row matching the `layerToggle` pattern from CorpusTabContent
  - Four options displayed inline: **Graph Votes | Newest | Annotations | Top Annotation**
  - Active state: `#333` background with white text; inactive: white background with `#888` text
  - `borderRight: 1px solid #eee` dividers between buttons, outer `border: 1px solid #ddd` with `borderRadius: 4px`
  - Removed old `sortSelect` and `sortSelectActive` styles, added `sortRow`, `sortBtn`, `sortBtnActive`
  - Identical markup and styling in both `Root.jsx` and `Concept.jsx`

- Files changed: `Concept.jsx`, `Root.jsx` (replaced select dropdown with flat toggle row + matching styles)

#### Architecture Decisions (Phase 29)

- **Architecture Decision #192 — Web Link Comments Are Editable by Creator:** Web link comments are the one exception to Orca's immutability philosophy. Unlike document annotations (which reference immutable document content), web link comments describe external URLs whose destinations can genuinely change over time. Allowing the creator to update their comment ensures the context remains accurate as external content evolves. The `updated_at` timestamp and "(edited)" indicator maintain transparency — users can see that a comment was modified. Only the original link creator can edit; other users see the comment read-only. First-time comment additions do NOT trigger "(edited)" — only subsequent modifications do. This follows the same creator-only pattern used for link removal (Phase 6).

- **Architecture Decision #193 — Top Annotation Sort Uses MAX Single Annotation Votes:** The "Top Annotation" sort orders children by the highest vote count on any single annotation for that concept, not by total votes across all annotations or by annotation count. This provides a quality signal: which concepts have annotations the community found most valuable? The existing "Annotations" sort (Phase 11) provides the complementary breadth signal (most distinct annotated documents). Together they let users find concepts that are either widely annotated (breadth) or deeply endorsed (quality). The MAX approach avoids favoring concepts that simply have many mediocre annotations.

- **Architecture Decision #194 — Flat Horizontal Sort Selector Replaces Dropdown:** The `<select>` dropdown for children sort is replaced with a flat horizontal toggle row matching the annotation filter style (All | Corpus Members | Author). Dropdown menus hide options; a flat row makes all sort options immediately visible and discoverable. The four options (Graph Votes, Newest, Annotations, Top Annotation) fit comfortably on one line. This follows the principle that key navigation controls should be visible, not buried in menus.

- **Architecture Decision #195 — Inline Web Link Creation in Annotation Panel:** The "+ Add Web Link" form is embedded inline in the Web Links tab of the ConceptAnnotationPanel, rather than in a modal or separate page. This keeps web link management co-located with web link viewing, consistent with how annotation creation works inline in corpus tabs. The form only appears when logged in and when a `currentEdgeId` exists (web links are edge-scoped).

- **Architecture Decision #196 — Clickable Web Link Vote Toggle with Auto-Resort:** Web link vote counts are clickable to toggle the user's vote (previously vote toggling may have required a separate button). After each vote toggle, the link list re-sorts by vote count to maintain vote-descending order. This gives users immediate visual feedback that their vote affected the ranking. Guests clicking the vote count are shown the login modal.

#### Git Commits (Phase 29)
1. `feat: 29a, web link creator comments with inline edit UI and updated_at transparency`
2. `feat: 29a, add inline web link creation form with optional comment in annotation panel`
3. `feat: 29a, clickable web link vote toggle, comment on creation, smart edited indicator, auto-resort`
4. `feat: 29b, top annotation sort for children — sort by highest single annotation vote count`
5. `feat: 29c, flat horizontal sort selector replacing dropdown, matching annotation filter style`

---


### Phase 30: Pre-Launch Bug Fixes & Enhancements (✅ COMPLETE)

Batch of cleanup items, bug fixes, and small features addressed before public launch. Phase 30i (duplicate search results) was skipped — bug could not be reproduced.

#### ✅ Completed (Phase 30b) — Fix "Active Users" Text
- `Root.jsx`: Changed `{totalUsers} active {totalUsers === 1 ? 'user' : 'users'}` to `{totalUsers} {totalUsers === 1 ? 'user' : 'users'}`
- Files changed: `Root.jsx`

#### ✅ Completed (Phase 30e) — Fix "Allowed User" Badge to "Member"
- `CorpusTabContent.jsx`: Changed badge text from "allowed user" to "Member" for non-owner corpus members. Also capitalized "Owner" badge to match.
- Files changed: `CorpusTabContent.jsx`

#### ✅ Completed (Phase 30f) — Browser Title Safeguard
- `index.html`: Verified `<title>` tag already says "orca"
- `AppShell.jsx`: Added `document.title = 'orca';` at the top of the mount useEffect to prevent any title reversion
- Files changed: `AppShell.jsx`

#### ✅ Completed (Phase 30h) — Remove Children View Button from Decontextualized Flip View
- `Concept.jsx`: Wrapped the flip/children view toggle button with `{!isDecontextualized && (...)}` so it doesn't render in decontextualized flip view (search-originated, no path context)
- Added `userToggledFlip` ref to distinguish between "user manually clicked flip toggle" and "concept opened in decontextualized flip view from search" — the button stays hidden only when the concept was opened decontextualized, but reappears if a root concept was manually flipped
- Files changed: `Concept.jsx`

#### ✅ Completed (Phase 30k) — Change Flag-to-Hide Threshold to 10
- `moderationController.js`: Flag endpoint now only sets `is_hidden = true` when `COUNT(*) >= 10` on `concept_flags` for that edge (was immediate hide on single flag)
- **New unflag endpoint:** `POST /api/moderation/unflag` — allows a user to remove their own flag from an edge. Added to `moderationController.js` and `moderation.js` routes.
- `conceptsController.js`: Added `flag_count` and `user_flagged` subqueries to both `getRootConcepts` and `getConceptWithChildren` so the frontend can display flag status per concept
- **Frontend flag count display:** `ConceptGrid.jsx` shows "X user(s) have flagged this as spam" in red text for concepts with 1–9 flags. Concepts with 0 flags show nothing; 10+ are hidden.
- **Unflag context menu:** `ConceptGrid.jsx` right-click context menu shows "Unflag as spam" when the current user has already flagged a concept, "Flag as spam" otherwise
- `Root.jsx` and `Concept.jsx`: Updated flag confirmation dialogs from "This will immediately hide it from all users" to "Once 10 users have flagged it, it will be hidden from all users". Added `handleUnflag` handlers passed to both ConceptGrid instances.
- `api.js`: Added `moderationAPI.unflagEdge(edgeId)` method
- Files changed: `moderationController.js`, `moderation.js`, `conceptsController.js`, `ConceptGrid.jsx`, `Concept.jsx`, `Root.jsx`, `api.js`

#### ✅ Completed (Phase 30a) — Remove Dormant Tab Functionality
- **Backend (`conceptsController.js`):** Removed `DORMANT_USERS_SUBQUERY` constant and all 8 usages of `AND v.user_id NOT IN (${DORMANT_USERS_SUBQUERY})` from vote counting queries. Removed `FILTER (WHERE v.user_id NOT IN ...)` from diff query. Vote counts now include ALL users with no dormancy filtering.
- **Backend (`votesController.js`):** Removed `DORMANT_USERS_SUBQUERY` constant and all usages. Replaced `recordTabActivity`, `getTabActivity`, and `reviveTabActivity` with 410 Gone stubs.
- **Frontend (`AppShell.jsx`):** Removed `dormantTabCount` and `showDormancyBanner` state, the useEffect that fetched tab activity on mount, and the amber dormancy warning banner JSX + styles.
- **Frontend (`SavedPageOverlay.jsx`):** Removed all dormancy state (`tabActivity`, `dormancyModal`, `reviving`, `viewingDormant`), removed `recordActivity`/`handleRevive`/`handleViewWithoutReviving` functions, removed dormant tab styling/badge/info bar/all-dormant message/revival modal, removed ~12 dormancy-related styles. Simplified tab click to `setActiveTabKey`.
- **Frontend (`api.js`):** Removed `getTabActivity`, `recordTabActivity`, `reviveTabActivity` methods.
- Database tables and `migrate.js` left untouched per append-only policy.
- Build ~6KB smaller after removal.
- Files changed: `conceptsController.js`, `votesController.js`, `AppShell.jsx`, `SavedPageOverlay.jsx`, `api.js`

#### ✅ Completed (Phase 30d) — Flip View Vote Display Overhaul
- `FlipView.jsx`: Replaced "Link" text button and "Linked" badge with ▲ triangle vote button styled to match ConceptGrid's save vote buttons
- **Unvoted state:** Light gray background, tooltip "Vote this context as helpful"
- **Voted state:** Dark filled background, no tooltip
- **Guest state:** Dimmed non-clickable button with "Log in to vote on links" tooltip
- Only renders in contextual flip view (the `isContextual &&` guard was already in place)
- Each card now shows: existing save count (▲ {vote_count}) in the parent row, plus the link vote triangle (▲ {link_count}) in the bottom row alongside similarity percentage
- Removed styles: `linkSection`, `linkButton`, `linkButtonActive`, `linkedBadge`
- Files changed: `FlipView.jsx`

#### ✅ Completed (Phase 30j) — Remove Vote Set Drift + Sort Swatches by Similarity

**Part 1 — Drift removal:**
- `VoteSetBar.jsx`: Removed `driftData` prop, `hoveredSwatchIndex` state, `renderDriftPopover()`, `swatchHoverProps()`, and all drift styles
- `Concept.jsx`: Removed `driftData` state, `loadDriftData()` function, and drift prop passing to VoteSetBar
- `votesController.js`: `getVoteSetDrift` returns 410 Gone. Removed all 3 `INSERT INTO vote_set_changes` statements and their associated `parentEdgeMap`/`swapParentEdgeMap` lookups from `addVote`, `removeVote`, and `addSwapVote`
- `api.js`: Removed `getVoteSetDrift` method
- `vote_set_changes` table left in database (append-only philosophy)

**Part 2 — Jaccard similarity sorting:**
- `conceptsController.js` (`getVoteSets`): After computing vote sets, reorders them using nearest-neighbor with Jaccard similarity. Starts with the largest set (first from `ORDER BY user_count DESC`), then greedily picks the most similar unplaced set. `setIndex` values and `edgeToSets` mapping are rebuilt after reordering.
- Effect: Vote sets with similar child compositions get adjacent swatches and therefore adjacent colors from the palette, making visual patterns more meaningful.

- Files changed: `VoteSetBar.jsx`, `Concept.jsx`, `votesController.js`, `conceptsController.js`, `api.js`

#### ✅ Completed (Phase 30c) — Fix Browser Back Button Navigation

**Implementation in `AppShell.jsx`:**
- Added `popstateInProgressRef` + `activeTabRef` refs to prevent infinite loops and access current active tab in the popstate event listener
- New `buildGraphTabUrl()` helper builds URL with query params (`?gtab=5&c=123&p=1,2&v=flip`)
- Popstate listener (`window.addEventListener('popstate', ...)`) on browser back/forward: reads stored state, switches to the correct tab, updates the graph tab's concept/path/viewMode, persists to DB, and sets `document.title = 'orca'`
- Initial history seed: `replaceState` on first load so there's a base entry to return to
- Modified `handleGraphTabNavigate`: after updating state, if it's a navigation change (not label-only) and not from a popstate, calls `pushState` with merged tab state
- Tab switching does NOT push history (only in-tab navigation does)
- Label-only updates (concept name loading) do NOT push history
- Flip view toggle is included in history (`&v=flip` in URL)
- Guest mode works for navigation but skips DB persistence

**Implementation in `Concept.jsx`:**
- Expanded sync effect: now watches `initialConceptId`, serialized `initialPath`, and `initialViewMode` instead of just `initialConceptId`, so popstate-driven path/viewMode changes are properly synced to internal state

- Files changed: `AppShell.jsx`, `Concept.jsx`

#### ✅ Completed (Phase 30g) — Informational Pages with Comment System

**Backend:**
- `migrate.js`: Added `page_comments` table (with nullable `parent_comment_id` self-referencing FK with `ON DELETE CASCADE` for replies) and `page_comment_votes` table with indexes
- New `pagesController.js` with three endpoints:
  - `getPageComments`: Validates slug ('using-orca', 'constitution', 'donate'), joins with users for username, counts votes, includes `userVoted` for authenticated users, sorted by `vote_count DESC` then `created_at DESC`. Fetches all comments in one query, then builds tree in JS: top-level comments with `replies[]` arrays sorted by votes.
  - `addPageComment`: Validates slug + body (non-empty, max 2000 chars), accepts optional `parentCommentId` (validates parent exists on same slug and is top-level — returns 400 "Cannot reply to a reply" if parent is itself a reply), inserts comment, auto-votes for creator
  - `togglePageCommentVote`: Checks existing vote — if exists DELETE, if not INSERT. Returns new voted state and count. Works for both top-level comments and replies.
- New `routes/pages.js`: `GET /:slug/comments` (optionalAuth), `POST /:slug/comments` (auth), `POST /comments/:commentId/vote` (auth)
- `server.js`: Mounted at `app.use('/api/pages', pageRoutes)`
- `api.js`: Added `pagesAPI` with `getComments(slug)`, `addComment(slug, body, parentCommentId)`, `toggleCommentVote(commentId)`

**Frontend:**
- New `InfoPage.jsx` component:
  - Renders page title based on slug ("Using Orca", "Constitution", "Donate")
  - Placeholder body text: "This page is under construction. Content coming soon."
  - Community Comments section with:
    - Textarea + "Add Comment" button for logged-in users
    - Vote toggles (filled ▲ / unfilled △) on each comment
    - Relative timestamps (just now, 5m ago, 2h ago, 3d ago, etc.)
    - "Log in to add comments and vote" note for guests
    - Optimistic vote updates with rollback on error
  - **Comment replies (1 level deep):**
    - Top-level comments show a "Reply" toggle button (logged-in only)
    - Clicking "Reply" opens inline textarea + Reply/Cancel buttons below the comment
    - Replies render indented (40px left margin) with subtle 2px solid #eee left border
    - Replies have vote toggles but no "Reply" button (enforcing 1-level max depth)
    - Replies sorted by vote count descending within each parent
    - Vote toggle searches both top-level and nested replies via recursive `toggleVoteInList` helper
  - Styled in EB Garamond, black on off-white (#faf9f7), neutral border buttons

- `AppShell.jsx` header dropdown:
  - Small ▾ arrow next to "orca" title opens dropdown with "Using Orca", "Constitution", "Donate"
  - Click-outside closes dropdown
  - Clicking a link navigates to the route and closes dropdown
  - Clicking "orca" while on an info page navigates back to /
  - When on an info page route (`/using-orca`, `/constitution`, `/donate`), the normal sidebar + tab content is replaced with InfoPage
  - Routing handled via `useLocation` in AppShell (no changes to App.jsx needed)
  - Both logged-in users and guests can access all three pages

- Files changed: `migrate.js`, new `pagesController.js`, new `routes/pages.js`, `server.js`, `api.js`, new `InfoPage.jsx`, `AppShell.jsx`

**Updated `page_comments` schema (with replies):**
```sql
CREATE TABLE page_comments (
  id SERIAL PRIMARY KEY,
  page_slug VARCHAR(50) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  parent_comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_page_comments_page ON page_comments(page_slug);

CREATE TABLE page_comment_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, comment_id)
);
CREATE INDEX idx_page_comment_votes_comment ON page_comment_votes(comment_id);
```

**New backend endpoints (`/api/pages`):**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/:slug/comments` | Guest OK | Get all comments for a page with nested replies, sorted by vote count desc. Returns `user_voted` for logged-in users. |
| POST | `/:slug/comments` | Required | Add a comment or reply. Body: `{ body, parentCommentId? }`. Max 2000 chars. Replies must target a top-level comment on the same slug. |
| POST | `/comments/:commentId/vote` | Required | Toggle vote on a comment or reply (insert if not voted, delete if already voted). |

#### Phase 30i: Duplicate Search Results — ⏭ SKIPPED
Bug could not be reproduced. No changes made.

#### Architecture Decisions (Phase 30)

- **Architecture Decision #197 — Dormant Tab Functionality Removed:** The dormancy tracking system (Phase 8) is removed from the active codebase. The feature added complexity (background jobs, conditional vote exclusion across 13+ queries, revival modals, dormancy banners) without proportionate value at launch scale. The `saved_page_tab_activity` table remains in the database. If vote hygiene becomes important at scale, a simpler mechanism (e.g., account-level inactivity rather than per-tab tracking) can be designed with real user data.

- **Architecture Decision #198 — Link Votes Use Same Triangle Icon as Save Votes:** Flip View link votes are restyled to use the same ▲ triangle icon as save votes, replacing the previous "Linked" badge. This creates visual consistency across the two vote types that appear on Flip View cards. The filled/unfilled state communicates voted/not-voted without needing a separate badge. Tooltip on unvoted: "Vote this context as helpful"; no tooltip when voted. Guest users see a dimmed non-clickable button with "Log in to vote on links" tooltip.

- **Architecture Decision #199 — Informational Pages with Community Comments and Replies:** Static informational pages (Using Orca, Constitution, Donate) include a community comment system with one level of threaded replies. This aligns with Orca's philosophy of productive contestation — even meta-level pages about the platform itself benefit from community input. Comments and replies are vote-sorted (same pattern as annotations) and permanent (no deletion, consistent with append-only philosophy). Replies are limited to one level deep — cannot reply to a reply. The `parent_comment_id` column on `page_comments` is nullable (NULL for top-level, FK to parent for replies). Backend validates reply depth and same-slug constraint.

- **Architecture Decision #200 — Vote Set Drift Tracking Removed:** The vote set drift feature (Phase 23) is removed from the active codebase. The hover popover showing "where former set-mates migrated to" added UI complexity (popover positioning, swatch matching, departure rendering) without clear user value at launch scale. The `vote_set_changes` table remains in the database. Event logging into the table is also removed since drift was the only consumer.

- **Architecture Decision #201 — Vote Set Swatches Sorted by Compositional Similarity:** Vote set swatches are reordered so that sets with similar child compositions (high Jaccard similarity on voted-for child edge IDs) are placed adjacent to each other. This uses nearest-neighbor ordering: start with the largest set, then always place the most similar unplaced set next. The result is that users who saved similar subsets of children get adjacent colored swatches, making visual patterns in the swatch bar more meaningful. Colors are still assigned by index position from the static 12-color palette — the palette order is unchanged, but since sets are now sorted by similarity, adjacent sets naturally get adjacent colors.

- **Architecture Decision #202 — Flag-to-Hide Threshold Raised to 10:** The single-flag-hides model (Phase 16) was designed for early development when any spam needed immediate removal. With real users, a single flag is too aggressive — it allows any user to unilaterally hide content. Raising to 10 flags requires community consensus before content is hidden. Admin unhide remains available for false positives. The threshold can be adjusted via future configuration if needed.

- **Architecture Decision #203 — Unflag Endpoint for Flag Reversal:** Users can remove their own flag from a concept via `POST /api/moderation/unflag`. The context menu on concept cards dynamically shows "Flag as spam" or "Unflag as spam" based on the `user_flagged` boolean returned in children queries. This prevents users from being permanently committed to a flag they may have cast by mistake.

- **Architecture Decision #204 — Flag Count Visible on Concept Cards Below Threshold:** Concepts with 1–9 flags (below the hide threshold) display a red "X user(s) have flagged this as spam" indicator on their cards. This provides transparency about community sentiment before the hide threshold is reached. Concepts with 0 flags show nothing; concepts with 10+ flags are hidden and appear in the HiddenConceptsView.

- **Architecture Decision #205 — Browser History Integration for Graph Tab Navigation:** In-tab concept navigation now pushes entries to the browser history via `window.history.pushState`. URL query parameters (`?gtab=`, `&c=`, `&p=`, `&v=`) encode the active graph tab, concept, path, and view mode. A `popstate` listener handles browser back/forward by restoring the graph tab state from the history entry. Tab switching does NOT push history — only in-tab navigation does. This resolves the longstanding issue where browser back/forward buttons were non-functional during graph exploration.

- **Architecture Decision #206 — Phone OTP Authentication Replaces Email + Password (Phase 32):** Phone OTP authentication replaces email + password. Motivation: vote integrity (phone numbers harder to multiply than emails) + reduced data exposure (only bcrypt-hashed phones stored, no plaintext). Twilio Verify API handles OTP delivery — no codes stored in Orca's database. Rate limiting: 5 requests per IP per 15 minutes on /send-code. JWT extended to 90d (reduces OTP frequency; Orca's threat model doesn't require short-lived tokens). `token_issued_after` column enables 'Log out everywhere' as safety net for long-lived tokens. `email` and `password_hash` columns retained but functionally retired (append-only philosophy).

- **Architecture Decision #207 — HMAC Phone Lookup Replaces O(n) Bcrypt Scan (Phase 33e):** Login and registration previously fetched ALL user rows and ran `bcrypt.compare()` against each phone hash — O(n) scaling that would time out at ~10,000 users. Fixed by adding a `phone_lookup` column storing HMAC-SHA256 of the normalized phone number (keyed by `PHONE_LOOKUP_KEY` env var). HMAC is deterministic (same input + same key = same output), so it can be indexed with a UNIQUE constraint and queried in O(1). The bcrypt `phone_hash` column is retained (append-only philosophy) but no longer used for lookup. Security tradeoff: HMAC is weaker than bcrypt against brute-force (no salt rounds), but phone numbers are already partially public identifiers — the HMAC prevents reverse lookup without the server key, and the UNIQUE constraint replaces the bcrypt-based uniqueness check.

#### Git Commits (Phase 30)
1. `fix: 30b, change "active users" to "users" on root page`
2. `fix: 30e, change "allowed user" badge to "member" in corpus UI`
3. `fix: 30f, add browser title safeguard in AppShell mount effect`
4. `fix: 30h, remove children view button from decontextualized flip view`
5. `feat: 30k, raise flag-to-hide threshold from 1 to 10, add unflag endpoint, show flag counts on cards`
6. `feat: 30a, remove dormant tab functionality — retire dormancy checks, banner, revival UI`
7. `feat: 30d, flip view link votes use triangle icon — remove linked badge, add vote tooltips`
8. `feat: 30j, remove vote set drift, sort vote set swatches by compositional similarity`
9. `fix: 30c, fix browser back button navigation within graph tabs`
10. `feat: 30g-backend, add page comments tables, endpoints, and API methods`
11. `feat: 30g, add informational pages (Using Orca, Constitution, Donate) with comment system and replies`

---

### Future Considerations

- **Robust Similar-Results Functionality**
  - Applied broadly whenever net new concepts or attribute tags are being added
  - Prevents proliferation of near-duplicate entries

- **Community-Threshold Unhiding**
  - Phase 16 ships with admin-only unhide. Future enhancement: if show votes exceed hide votes by a configurable threshold, auto-unhide. Requires careful design to prevent vote-brigading on moderation decisions.

- **Attribute Governance**
  - The original Phase 23 (user-generated attributes) was cancelled. The owner will manually add new attributes as needed. Future enhancement if user-generated attributes are ever opened: admin approval for new attributes, community proposal process, or attribute merge/alias tools to consolidate near-duplicates (e.g., merging "instrument" and "instruments" into a single attribute).

---

## Data Model Concepts

### Graphs vs Concepts vs Edges

**Graphs:**
- Not stored as explicit entities
- Implicitly defined by unique root concepts
- Identified by the path of concept IDs
- Example: `[1, 2, 3]` represents one graph path

**Concepts:**
- Globally unique by name
- **255-character maximum** for concept names (raised from 40 in Phase 28g)
- Can appear in many graphs
- Can have different children in different contexts

**Edges:**
- Define parent-child relationships
- Context-specific (tied to a graph path)
- Multiple edges can exist for same parent-child pair in different contexts
- Carry a required attribute tag (Phase 3)

**Attributes:**
- Discrete, reusable category labels — NOT key-value metadata pairs
- Three default/seeded attributes: **action**, **tool**, **value**. A fourth attribute, **question**, has been added for research questions. All four are enabled at launch via `ENABLED_ATTRIBUTES=value,action,tool,question`. The owner will manually add new attributes as needed (identity-defining, same mechanics as the defaults).
- Applied to edges at creation time and immutable thereafter
- Same concept can carry different attributes in different contexts
- A concept with multiple attributes in the same context appears as multiple separate entries
- Same concept name + different attribute = completely separate contextual entities (independent saves, children, paths)
- **Required:** Every concept must have an attribute. No unattributed concepts.
- **Display:** Always shown in square brackets: `Concept Name [attribute]`

**Example:**
```
Concept "Microscopy" (ID: 5) appears in:

Graph 1: Methods(1) → Microscopy [tool](5)
  - graph_path: [1]
  - children: Fluorescence [tool], Electron [tool]

Graph 2: Cell Biology(2) → Microscopy [tool](5)
  - graph_path: [2]
  - children: Confocal [tool], Live Imaging [action]

Same concept, different contexts, different children.
```

**Attribute Example:**
```
In path: Research Design(1) → Experiment Planning [action](2)

Children:
  - Hypothesis Generation [action]  ← edge has attribute_id pointing to "action"
  - Statistical Software [tool]     ← edge has attribute_id pointing to "tool"
  - Reproducibility [value]         ← edge has attribute_id pointing to "value"

These display as separate entries. Each can have its own children,
save counts, and branching paths. The hierarchical relationship
represents the order in which these things are thought about
during real decision making.
```

### Vote Types

| Type | Short Name | Purpose | Scope | Destination Required |
|------|------------|---------|-------|---------------------|
| Save | Save | Endorse a concept in context; saves full path to Saved Page | Full path (max 1 per user per edge) | No |
| ~~Move~~ | ~~Move~~ | ~~Assert concept belongs elsewhere~~ | ~~Single edge~~ | ~~Yes — user specifies destination context~~ |
| Swap | Swap | Assert concept should be replaced by a sibling | Single edge | Yes — user specifies sibling |
| Link | Link | Assert a parent context is helpful relative to origin context | Contextual Flip View only | No — applied to existing parent context |

### Flip View Modes

| Mode | Entry Point | Primary Sort | Secondary Sort (Tiebreaker) | Link Votes | Use Case |
|------|-------------|-------------|----------------------------|------------|----------|
| Contextual | Click flip button from a concept in a specific path | Link vote count (descending) | Save count of concept in each parent context (hidden — not displayed) | Yes — users can link a parent context as helpful relative to origin | Exploring alternate paths for a concept you're already viewing |
| Decontextualized | Select a concept from search | By save count (most saves first) | N/A | No | General exploration of where a concept appears |

**Flip View Card Layout:** Parent contexts are displayed as a flat grid of cards. In contextual mode, cards are sorted by link vote count descending, with save count as a hidden tiebreaker for ties (including all cards with 0 link votes). In decontextualized mode, cards are sorted by save count descending. Each card shows the full ancestor path above the immediate parent (smaller text) and the parent name (larger black text).

---

## Testing Checklist

When testing new features, verify:

1. **Authentication**
   - [ ] Can register new user
   - [ ] Can login with credentials
   - [ ] Protected routes redirect to login
   - [ ] Logout clears token

2. **Root Concepts**
   - [ ] Root page loads
   - [ ] Can create root concept
   - [ ] Root concepts display correctly
   - [ ] Child count shows on cards
   - [ ] Total active users displayed at top of root page

3. **Navigation**
   - [ ] Can click into concept
   - [ ] Breadcrumbs show full path with names
   - [ ] Can click breadcrumb to navigate back
   - [ ] Immediate parent click works
   - [ ] Two+ levels back works
   - [ ] Browser back button works with navigation

4. **Concept Creation**
   - [ ] Can add child to concept
   - [ ] Concept name limited to 255 characters (frontend validation)
   - [ ] Backend rejects names > 255 characters
   - [ ] Duplicate names reuse existing concept
   - [ ] Case-insensitive matching works
   - [ ] Cycles are prevented

5. **Saves (Voting)**
   - [ ] Can save a child concept
   - [ ] Save count increases
   - [ ] Visual indication of user save
   - [ ] Children resort after saving
   - [ ] Can't save twice on same edge

6. **Sort by New**
   - [ ] "Sort by New" option visible on Root page
   - [ ] "Sort by New" option visible on Concept page (children view)
   - [ ] Toggling sorts children by newest edge first
   - [ ] Toggling back returns to sort by saves
   - [ ] Default is sort by saves (not sort by new)

7. **Flip View**
   - [ ] "Flip View" button appears in header
   - [ ] Click button switches to flip view
   - [ ] Contextual mode: cards sorted by link vote count, then by save count as tiebreaker
   - [ ] Decontextualized mode: cards sorted by save count
   - [ ] Link vote button visible on each card in contextual mode
   - [ ] Link vote count displayed on each card in contextual mode
   - [ ] No link vote buttons in decontextualized mode
   - [ ] "Voted" badge appears when applicable
   - [ ] Click parent card navigates to that context
   - [ ] "← Back" button returns to children view
   - [ ] Works with concepts that have no parents (shows message)
   - [ ] Each card shows ancestor path above parent (smaller text) + parent name (black)
   - [ ] Root-level parents show only name, no redundant path text
   - [ ] Full path displayed on hover tooltip
   - [ ] Similarity percentage shown on each card in contextual mode (Jaccard: shared children / total unique)
   - [ ] Can sort by similarity percentage (ascending and descending)
   - [ ] Similarity percentage does NOT appear in decontextualized mode

8. **Search & Add** (Phase 2)
   - [ ] Search field visible at bottom-right on Root page
   - [ ] Search field visible at bottom-right on Concept page
   - [ ] Typing triggers debounced search (300ms delay)
   - [ ] Exact/substring matches appear first in dropdown
   - [ ] Trigram similarity matches appear with "similar" badge
   - [ ] Results already in current child set show "child" badge
   - [ ] Clicking a result opens decontextualized Flip View
   - [ ] On concept page (children view): "Add [name] as child" option appears for new names
   - [ ] On concept page (flip view): "Add as child" option does NOT appear
   - [ ] On root page: "Create [name] as root concept" option appears for new names
   - [ ] Adding a child via search refreshes the concept page
   - [ ] Creating a root concept via search refreshes the root page
   - [ ] Escape key closes dropdown
   - [ ] Clicking outside closes dropdown
   - [ ] pg_trgm extension is enabled (search returns fuzzy matches)

9. **Display Totals** (Phase 2)
   - [ ] Current concept's save total displayed in concept view (edge save count in current path context)
   - [ ] Total active users displayed on root page
   - [ ] Child count displayed on each child concept card

10. **Attributes** (Phase 3)
    - [ ] Must select an attribute (action, tool, value, or question) when creating/adding any concept
    - [ ] Four default attributes available: action, tool, value, question
    - [ ] Cannot create a concept without selecting an attribute
    - [ ] Attribute displayed in square brackets everywhere: `Concept [attribute]`
    - [ ] Search results show attribute in square brackets
    - [ ] Same concept with different attributes displays as separate children
    - [ ] Existing edges migrated to [action] attribute
    - [ ] Breadcrumbs show attribute in square brackets

11. **Expanded Voting** (Phase 4)
    - [ ] Saving a concept saves the full path (every edge from root to saved concept)
    - [ ] Each user contributes max 1 save per edge (no double counting)
    - [ ] Save count = number of distinct users with that edge in their saved tree
    - [ ] Unsaving cascades to all descendants in the branch
    - ~~[ ] Move vote modal allows search/navigate to destination~~
    - ~~[ ] Move vote visible to all users on concept (move_count on child cards)~~
    - ~~[ ] Move vote "→" button shows total move count~~
    - ~~[ ] Can second/un-second existing move suggestions in modal~~
    - ~~[ ] Can add new move destination via search → context selection → mini graph browser~~
    - ~~[ ] "Move here" when concept exists at destination~~
    - ~~[ ] "Add here & move" when concept doesn't exist (with attribute picker)~~
    - [x] Swap vote allows selecting a sibling
    - [ ] Flip View link votes work in contextual mode
    - [ ] Link votes do not appear in decontextualized mode
    - [ ] Flip View primary sort is link votes in contextual mode
    - [ ] Flip View tiebreaker is save count (hidden) in contextual mode

12. **Vote Set Visualization & Filtering** (Phase 4 — ✅ IMPLEMENTED)
    - [x] Color swatches displayed at top of concept page for identical vote sets
    - [x] Save count per set displayed next to each swatch
    - [x] Color dots on each child concept for every set it belongs to
    - [x] Clicking a swatch filters to that set's children
    - [x] Multi-swatch selection shows tiered display (all sets → some → one)
    - [x] Within tiers, children sorted by save count
    - [x] Non-selected color dots remain visible during filtering
    - [x] Individual child save totals unaffected by filtering
    - [x] Super-groups cluster similar vote sets above individual swatches
    - [x] Hovering super-group highlights member dots on child cards
    - [x] Clicking super-group filters to all member sets' children
    - [x] Tiered toggle works with both group-level and individual set filters

13. **Saved Page — Basic Display** (Phase 5a — ✅ IMPLEMENTED)
    - [x] Saved Page accessible per user at `/saved`
    - [x] "Saved" button in header on Root and Concept pages
    - [x] Saved concepts displayed as collapsible trees grouped by root graph
    - [x] X button on each concept removes it and all descendants (cascading unsave)
    - [x] X button subtracts save counts from all affected edges
    - [x] Click any concept to navigate to it in context
    - [x] Collapsible/expandable nodes (any portion of a tree)
    - [x] "Collapse All" shows only root-level nodes
    - [x] "Expand All" shows all nodes
    - [x] Move votes visually indicated (→ count in amber)
    - [x] Swap votes visually indicated (⇄ count in purple)
    - [x] Trees sorted by vote count descending; children within trees also sorted by vote count
    - [x] Backend endpoint `GET /api/votes/saved` returns all user's saved edges with concept names, attributes, move/swap counts
    - [x] No database migration required — reads from existing tables

14. **Saved Tabs** (Phase 5b — ✅ IMPLEMENTED)
    - [x] Default "Saved" tab created automatically for new users
    - [x] Existing users get default tab via migration backfill
    - [x] Existing votes linked to default tab via migration backfill
    - [x] Can create additional named Saved tabs
    - [x] Can rename Saved tabs (double-click to edit)
    - [x] Can delete Saved tabs (only when 2+ tabs exist)
    - [x] Deleting a tab cleans up orphaned votes
    - [x] When saving a concept with 2+ tabs, inline tab picker dropdown appears
    - [x] When saving a concept with 1 tab, saves directly (no picker)
    - [x] Saved Page shows tab bar with active tab highlighted
    - [x] Switching tabs loads that tab's saves independently
    - [x] Unsave from Saved Page removes from active tab only
    - [x] If vote has no remaining tab links after unsave, vote is fully deleted
    - [x] `saved_tabs` table in database
    - [x] `vote_tab_links` junction table in database

15. **In-App Tabs — Shell** (Phase 5c-1 — ✅ IMPLEMENTED)
    - [x] Unified tab bar visible at top of Orca app (below header)
    - [x] Saved tabs appear on left side (italic style)
    - [x] Graph tabs appear on right side with ✕ close button
    - [x] Divider between saved tabs and graph tabs
    - [x] "+" button creates new saved tab (inline input)
    - [x] "+" button creates new Root graph tab
    - [x] `graph_tabs` database table created
    - [x] Backend CRUD endpoints for graph tabs (get/create/update/close)
    - [x] Right-click context menu on graph tabs (Duplicate, Open in new window, Close)
    - [x] Right-click context menu on saved tabs (Open in new window, Remove tab and unsave)
    - [x] Saved tabs NOT removable via simple ✕ (safety — right-click only)
    - [x] AppShell wraps entire authenticated app
    - [x] Root.jsx and Concept.jsx render inside AppShell without own headers

16. **In-App Tabs — Navigation** (Phase 5c-2 + 5c-3 — ✅ COMPLETE)
    - [x] Clicking a concept in graph tab updates that tab's state in DB
    - [x] Tab label updates dynamically as user navigates (shows current concept name + attribute)
    - [x] Back button within graph tabs works (navHistory stack, `←` in concept header bar)
    - [x] Breadcrumb clicks work within tab mode
    - [x] Flip view toggle works within tab mode
    - [x] SearchField results navigate current tab to decontextualized flip view
    - [x] Clicking concept in Saved tab tree opens new graph tab at correct position
    - [x] Nav history preserved when switching between tabs (hide-not-unmount pattern)
    - [ ] Duplicate tab creates new tab at same position (5c-4)

17. **Tab Grouping** (Phase 5d — ✅ IMPLEMENTED)
    - [ ] Can create a new group from right-click context menu on any tab
    - [ ] Group appears in tab bar with ▸/▾ arrow and member count
    - [ ] Clicking group header expands/collapses member tabs
    - [ ] Expand/collapse state persists across page refresh
    - [ ] Can add additional tabs to existing group via right-click → "Add to group..."
    - [ ] Can remove a tab from a group via right-click → "Remove from group"
    - [ ] Mixed tab types allowed in a single group (saved + graph tabs)
    - [ ] Can rename a group (double-click or right-click → Rename group)
    - [ ] Can delete a group (right-click → "Delete group (keeps tabs)" with confirmation)
    - [ ] Deleting a group ungroups member tabs (they reappear as ungrouped)
    - [ ] `tab_groups` table created in database
    - [ ] `group_id` column on `saved_tabs` and `graph_tabs`
    - [ ] Collapsed group shows active styling if active tab is inside it

17. **Saved Tree Reordering** (Phase 5e — ✅ IMPLEMENTED)
    - [ ] Up/down arrow buttons visible on each root tree card in saved tab view
    - [ ] Clicking ▲ moves tree up; clicking ▼ moves tree down
    - [ ] Top tree's ▲ is disabled; bottom tree's ▼ is disabled
    - [ ] Order persists after page refresh
    - [ ] Each saved tab has its own independent ordering
    - [ ] Trees without explicit order fall to the bottom, sorted by save count
    - [ ] `saved_tree_order` table created in database

18. **Child Ordering Within Vote Sets** (Phase 5f — ✅ IMPLEMENTED)
    - [ ] Solo user (unique save pattern) sees their own color swatch
    - [ ] User's own swatch has bold dark border and "Your vote set" tooltip
    - [ ] Clicking own swatch shows dropdown selector on each child card
    - [ ] Can assign rank (1 to N) via dropdown; selecting "—" removes ranking
    - [ ] Rankings persist after page refresh
    - [ ] Aggregated rank badges (#1: N, #2: N) visible on child cards when any single set is selected
    - [ ] Children sorted by most popular rank when rankings exist
    - [ ] Unranked children appear at bottom
    - [ ] Viewing someone else's single set: aggregated ranks visible, no dropdown
    - [ ] Rankings only appear in single-set filter mode (not multi-select or super-groups)
    - [ ] Filter info shows "rank your children with the dropdown" (own set) or "sorted by community ranking" (other set)
    - [ ] Unsaving a child cleans up that child's rankings from `child_rankings` table
    - [ ] `child_rankings` table created in database
    - [ ] Backend rejects ranking attempt if user doesn't have a vote on the parent edge

19. **External Links** (Phase 6 — ✅ IMPLEMENTED)
    - [ ] 🔗 Links button visible in concept header bar (next to Flip View toggle)
    - [ ] Links button appears after vote sets load (parentEdgeId available)
    - [ ] Clicking Links button switches to external links view
    - [ ] Can add a URL with optional title
    - [ ] URL validation: rejects URLs not starting with http:// or https://
    - [ ] Duplicate URL on same edge shows error
    - [ ] Auto-upvote on link creation (creator's vote count starts at 1)
    - [ ] Can upvote/un-upvote links
    - [ ] Sort toggle: by votes (default) vs by newest
    - [ ] Only the adder can remove their own link
    - [ ] Guests see links read-only (no add form, no upvote buttons)
    - [ ] Back button returns to children view
    - [ ] 🔗 All Links button visible in Flip View header
    - [ ] Cross-context view shows links grouped by parent context
    - [ ] Current context highlighted with border and "current" badge
    - [ ] Upvoting only works for links in current context
    - [ ] Other contexts show "view only" hint
    - [ ] Back button from cross-context view returns to Flip View
    - [ ] 📋 Share button visible in concept header bar
    - [ ] Clicking Share copies URL to clipboard
    - [ ] "✓ Copied!" feedback appears briefly
    - [ ] Shareable URL works when pasted in a new browser tab

20. **Inactive Corpus Tab Dormancy** (Phase 8 — ✅ COMPLETE)
    - [ ] `saved_page_tab_activity` table tracks `last_opened_at` per corpus tab on Saved Page
    - [ ] `last_opened_at` updates when user switches to / opens a corpus tab on the Saved Page
    - [ ] Corpus tabs dormant after 30 days of inactivity (`is_dormant = true`)
    - [ ] Dormant corpus tab save votes excluded from public save totals
    - [ ] Dormant tab votes excluded from vote set calculations
    - [ ] Move, swap, and link votes unaffected by dormancy
    - [ ] Opening a dormant corpus tab on Saved Page shows revival modal ("Revive votes" / "View without reviving")
    - [ ] "Revive" sets `is_dormant = false`, updates `last_opened_at`, save totals restored
    - [ ] "View without reviving" allows read-only browsing, votes stay dormant
    - [ ] Save in multiple corpus tabs only dormant when ALL corpus tabs containing it are dormant
    - [ ] Deleting a dormant tab follows standard deletion behavior (orphaned votes permanently deleted)

21. **Editorial Layer Rename** (Phase 10a — ✅ IMPLEMENTED)
    - [x] `document_annotations.layer` values migrated from 'private' to 'editorial'
    - [x] All users can see editorial-layer annotations (no longer filtered out for non-allowed users)
    - [x] Only allowed users can create editorial-layer annotations
    - [x] Only allowed users can vote on editorial-layer annotations
    - [x] UI filter toggle shows "All / Public / Editorial" (not "Private")
    - [x] Annotation badges show "editorial" (not "private")
    - [x] Green-tinted highlights still used for editorial annotations

22. **Corpus Creation Toggle Removal** (Phase 10b — ✅ IMPLEMENTED)
    - [x] Corpus creation form has no annotation_mode selector
    - [x] Corpus still creates with default 'public' annotation_mode harmlessly

23. **Dormancy Warning on Login** (Phase 10c — ✅ IMPLEMENTED)
    - [x] Dormancy banner appears on AppShell mount when dormant tabs exist
    - [x] Banner shows count of dormant tabs
    - [x] Clicking banner opens Saved Page overlay
    - [x] Banner dismissable via ✕ button
    - [x] Banner does not reappear until next login/refresh

24. **Sort by Annotation Count** (Phase 11 — ✅ COMPLETE)
    - [x] Sort dropdown visible on Concept page (children view) with three options: Saves, New, Annotations
    - [x] Sort dropdown visible on Root page
    - [x] Children sorted by annotation count descending
    - [x] Tiebreaker is save count descending
    - [x] Backend accepts `sort=annotations` query parameter (conditional JOIN — no overhead on default queries)
    - [x] Count reflects distinct documents across all corpuses

25. **Nested Corpuses & Sidebar** (Phase 12a-c — ✅ PARTIALLY COMPLETE)
    - [x] `parent_corpus_id` column on `corpuses` table (single-parent model)
    - [x] Cycle prevention rejects circular nesting
    - [x] Backend endpoints for add/remove subcorpus, get children, get tree
    - [x] `createCorpus` accepts optional `parentCorpusId`
    - [x] `listCorpuses` and `getCorpus` return `parent_corpus_id` and child corpuses
    - [x] Vertical sidebar replaces horizontal tab bar
    - [x] Sidebar sections: CORPUSES, GRAPH GROUPS, GRAPHS
    - [x] "Saved" and "📚 Browse" buttons moved to sidebar
    - [x] Sidebar collapsible with « Hide / » toggle
    - [x] `user_corpus_tab_placements` table created
    - [x] Can place graph tabs inside a corpus via styled dropdown picker
    - [x] Placed graph tabs appear indented under corpus in sidebar
    - [x] Mutual exclusion: placing in corpus removes from flat group (and vice versa)
    - [x] `corpus_subscriptions.group_id` retired (cleared in migration)
    - [x] Flat tab groups remain for corpus-unaffiliated graph tabs
    - [x] Sub-corpuses visible in parent corpus detail view (Phase 12d)
    - [x] Can search and add existing corpus as sub-corpus (Phase 12d)
    - [x] Can create new sub-corpus inline (Phase 12d)
    - [x] Can remove sub-corpus (becomes top-level) (Phase 12d)
    - [x] Clicking sub-corpus navigates into its detail view (Phase 12d)
    - [x] Nested corpuses show parent path in corpus list (Phase 12d)
    - [x] Sub-corpus expansion in sidebar (Phase 12e)

26. **Cross-Annotation Path Linking** (Phase 13 — ✅ COMPLETE)
    - [x] Ancestor concepts in annotation path underlined if also annotated in same document
    - [x] Clicking underlined ancestor scrolls to that annotation
    - [x] Descendant annotations extend the path display downward
    - [x] Current annotation concept visually distinguished from extended path
    - [x] Intermediate non-annotated descendants shown in lighter style
    - [x] Multiple descendant branches rendered separately
    - [x] Works in contextualized (within-corpus) view
    - [x] Works in decontextualized (cross-corpus) view

27. **Concept Diffing** (Phase 14 — ✅ COMPLETE)
    - [ ] Right-click any concept → "Compare children..." opens Diff modal
    - [ ] Initial pane shows the right-clicked concept with its children in three groups
    - [ ] Can add additional concepts via search (in context) as additional panes
    - [ ] Group 1 (Unique): children not shared and not meeting similarity threshold with other panes
    - [ ] Group 2 (Similar): children meeting similarity threshold (50% Jaccard on grandchildren) but different name
    - [ ] Group 3 (Shared): children with same name + attribute appearing in other panes
    - [x] Can drill down by clicking a child — shows that child's children in three groups
    - [x] Independent drill-down per pane (don't need to drill all panes)
    - [x] Breadcrumb trail per pane for navigating back up
    - [x] Cross-level comparison works (panes at different depths still compute groups correctly)
    - [x] Can select a concept at any level to reset that pane
    - [x] Uneven depth display — skipped; breadcrumb approach is cleaner

---

## Notes for Future Claude Sessions

### When Starting a New Session

Provide this context:
1. "We're building Orca - a collaborative action ontology platform"
2. Current phase (e.g., "Phase 4 complete, next up: Phase 5 — Saved Page")
3. Today's goal (e.g., "Implement swap votes")
4. Relevant files (upload if making changes)

### Key Architecture Decisions

1. **Public/Collaborative:** All graphs are public, no user ownership
2. **Context-Dependent Identity:** Path + attribute = unique contextual identity. Same concept name in different paths = completely different entities with independent save counts, children, and attributes.
3. **Graph Path Array:** PostgreSQL array stores full path from root
4. **Concept Reuse:** Creating concepts checks for existing names first
5. **Concept Name Limit:** 255 characters maximum for concept names (raised from 40 in Phase 28g to support research questions). Enforced at frontend (`maxLength={255}` on SearchField and AnnotationPanel concept search inputs), backend (application-level check `> 255`), and database level (`VARCHAR(255)` on `concepts.name` and `document_concept_links_cache.concept_name`).
6. **Append-Only / Never Delete:** No deletion of concepts or edges. Content is only hidden (for spam/abuse), never removed. Hidden items retain talk pages for accountability. Low-saved content stays visible — hiding and voting are completely separate systems.
7. **bcryptjs:** Using bcryptjs instead of bcrypt for ARM64 compatibility
8. **Attributes on Edges (Single-Attribute Graphs, Phase 20a):** Every graph has exactly one attribute, determined by the root edge's `attribute_id`. All descendant edges must match. `attribute_id` is stored on every edge (redundant but avoids root-edge joins). Consistency enforced at write time — backend looks up `graph_path[0]` to find the root edge's attribute. Users select an attribute only when creating root concepts; child creation auto-inherits.
9. **Attributes Are Required at Root Creation:** Every root concept must have one of the four released attributes (action, tool, value, question) selected at creation time. Children inherit the graph's attribute automatically.
10. **Four Released Attributes — All Enabled at Launch:** Four attributes exist in the database (`action`, `tool`, `value`, `question`) and all four are enabled at launch. The owner controls which attributes are available via the `ENABLED_ATTRIBUTES` environment variable. No user-created attributes.
11. **Attribute Display Format (Phase 20a):** Bracket tags (`[attribute]`) removed from all concept name displays. Attribute badges now appear only in: concept page header, root page cards, Flip View cards (one per card), and annotation cards.
12. **Full-Path Saves:** Saving a concept saves the entire path above it. Save count on any edge = number of distinct users who have that edge in their saved tree. Max 1 save per user per edge — no double counting across branches. Totals always reflect what users see on their Saved Pages.
13. **Three Vote Types (Phase 20b):** Save, Swap, and Link — each serves a distinct organizational purpose. All are visible signals, not automated actions. Move votes were removed in Phase 20b (redundant with link votes). Database tables retain original names (`votes`, `replace_votes`, `similarity_votes`) while UI uses short names. Save and swap are mutually exclusive per user per edge (Phase 20c).
14. **Inactive Saved Tab Dormancy:** Save totals and vote set calculations exclude votes linked to dormant saved tabs (tabs not opened for 30+ days). Only save votes are affected — swap and link votes are independent of saved tabs. Dormant votes are restored immediately when the user opens the tab and chooses to revive. A vote linked to multiple tabs goes dormant only when ALL its linked tabs are dormant. (✅ IMPLEMENTED — Phase 8) **❌ REMOVED in Phase 30a** — feature retired for launch simplification. Vote counts now include all users unconditionally.
15. **Root Edges for Unified Saving:** Root concepts have edges with `parent_id = NULL` and `graph_path = '{}'` so that all saving goes through the edge model. This avoids a separate saving mechanism for roots.
16. **Flip View State in URL:** Flip View toggle is stored as a `&view=flip` query parameter rather than React state, so browser back/forward buttons work naturally with view mode changes.
17. **Flip View Sorting (Contextual):** Primary sort by link vote count descending. Tiebreaker: save count of concept in that parent context (hidden — not displayed on cards). This ensures Flip View is useful even with zero link votes.
18. **Hidden Namespace Blocking:** If a concept is hidden in a specific path + attribute context, that namespace is blocked — cannot recreate an identically-named concept with the same attribute in that path until unhidden.
19. **pg_trgm for Fuzzy Search:** Using PostgreSQL's pg_trgm extension for concept name search. Provides trigram similarity matching (handles typos, partial matches) with no external dependencies. Plan to add pgvector-based embedding search later for true semantic matching (e.g., "jogging" → "running") when the concept corpus is large enough to justify it.
20. **Unified Add/Search Field:** The SearchField component replaces separate "Add" buttons on both Root and Concept pages. Adding concepts and searching are combined into a single input field. On concept pages, "Add as child" appears in the search dropdown. On the root page, "Create as root concept" appears instead. Search results always navigate to decontextualized Flip View.
21. **Decontextualized Flip View Detection:** A concept page is in decontextualized Flip View when the URL has `view=flip` but no `path` parameter — meaning the user arrived via search, not by navigating the graph. In this mode: no breadcrumb, no Children View toggle, no search field, and FlipView receives `mode="exploratory"`. The Back button (`navigate(-1)`) is the only navigation. This detection pattern (`const isDecontextualized = viewMode === 'flip' && !hasPath`) should be reused wherever contextual vs decontextualized behavior diverges.
22. **Saved Tree Reordering:** Within each saved tab, users can reorder root-level graph trees via up/down arrow buttons on each tree card. Order persists between sessions via the `saved_tree_order` database table. Each saved tab has its own independent ordering. Trees without an explicit order record fall to the bottom, sorted by save count. Uses optimistic state updates with DB persistence via upsert.
23. **Sort by New:** Secondary sort option on Root and Concept pages. Default is always sort by saves. "Sort by New" sorts by edge creation timestamp (newest first) for ad hoc discovery.
24. **"Link" Terminology Scope:** "Link" refers to the vote type used in Flip View (formerly "similarity vote"). External URLs attached to concepts are called "external links" to avoid confusion.
25. **Unsave Cascading:** Unsaving a concept (in children view or via X button on Saved page) cascades to all descendants in that branch. Save counts on all affected edges are subtracted accordingly. Uses PostgreSQL array prefix matching to find descendant edges.
26. **In-App Tab System:** Orca uses in-app tabs (within one browser tab) for both concept navigation panes and Saved page tabs. Users can have multiple concept panes open in different graph areas, duplicate tabs to branch navigation, and maintain multiple named Saved tabs. Right-click any tab to open in a new browser tab/window.
27. **Saved Tab Selection on Save:** When saving a concept, the user selects which Saved tab to save it to. One tab per save action (can repeat for additional tabs). A default "Saved" tab is auto-created per user.
28. **Vote-Tab Junction Table Model:** Votes remain unique per `(user_id, edge_id)` — a vote is a user's endorsement of an edge. The `vote_tab_links` junction table maps votes to tabs (many-to-many). This means tabs are purely organizational and don't affect save counts visible to other users. Deleting a tab removes links; votes that lose their last link are cleaned up. This is preferred over adding `saved_tab_id` to the votes table (which would require duplicate vote rows per tab and complicate count queries).
29. **Tab-Scoped Unsave:** Unsaving from the Saved Page uses `removeVoteFromTab` which removes the vote-tab link for that tab and cascades to descendants. If the vote has no remaining tab links, the vote itself is deleted. This differs from `removeVote` (used in children view) which deletes the vote entirely regardless of tabs.
28. **Saved Page Tree Building:** The Saved Page backend returns a flat list of all edges the user has saved. The frontend builds trees client-side by: (1) separating root edges (parentId === null) from non-root edges, (2) building a childrenMap keyed by "parentId-graphPath" to find children of any node, (3) recursively assembling trees from each root edge. This avoids complex recursive SQL and keeps the backend query simple.
28. **Flip View Similarity Percentage:** In contextual Flip View, each alt parent card displays a Jaccard similarity score: `shared direct children / total unique direct children across both contexts`. Sortable ascending or descending. Does not recurse into subchildren.
29. **Vote Set Threshold Removed (Phase 5f):** Vote sets originally required a minimum of 2 users sharing the exact same saved children set to get a color swatch. This was removed in Phase 5f so that solo users (1 person who saved a unique set of children) also get a swatch. This is necessary for child ranking — users need to see their own swatch to rank their children even before anyone else joins their set. The `HAVING COUNT(*) >= 2` clause was removed from the `getVoteSets` SQL query.
30. **Vote Set Color Palette:** A curated 12-color named palette (Indigo, Teal, Crimson, Goldenrod, Forest, Coral, Slate, Sienna, Plum, Steel, Olive, Rose) is the sole source of color in the UI. Colors cycle if more than 12 sets exist. Color assignment is index-based (deterministic per page load, but not persisted across sessions — this is acceptable for now and will be addressed when similarity grouping adds color stability requirements).
31. **Sort by Annotation Count (Future):** Child concepts can be sorted by how many corpus documents contain them as annotations. This sort option becomes available after Phase 7 (corpus/annotation infrastructure). Complements existing sort-by-saves and sort-by-new options.
32. **Vote Set Similarity Grouping — 💤 RETIRED (Phase 28b):** Similar-but-not-identical vote sets were grouped into super-groups using agglomerative hierarchical clustering. **Super-group UI and computation were removed in Phase 28b.** Individual vote set swatches and filtering remain. The original design: average-link similarity (deterministic, not random), threshold 50% Jaccard overlap on edge IDs, super-group swatches (14px tall, blended color) above component swatches in a two-row layout, hover highlighting, unified `getEffectiveActiveSetIndices()` function. Group assignments were recomputed on each votesets request.
33. **Tab Grouping (Flat Only):** Tabs of any type (Saved, graph pane, corpus) can be grouped into named tab groups. Groups appear as expandable headers in the tab bar — click to expand/collapse. One level of nesting only — no groups within groups. Mixed tab types allowed within a single group. Group membership managed via right-click context menus (create group, add to group, remove from group). Expand/collapse state and group membership persisted server-side via `tab_groups` table + `group_id` FK on `saved_tabs`, `graph_tabs`, and `corpus_subscriptions` (Phase 7f). Deleting a group ungroups its tabs (sets `group_id = NULL`), does not delete them.
34. **Documents Are Always Editable by Original Uploader (Phase 21a):** Documents can be edited at any time by their original uploader. Annotation offsets are adjusted via `diff-match-patch` on save. The previous immutability model (draft/finalize with `is_draft` column) was removed in Phase 21a. Annotations whose anchored text is removed by an edit are automatically deleted.
35. **Annotations Are Edge Links, Scoped to Corpus:** Document annotations attach a specific edge (concept-in-context) to a text selection. Annotations are scoped to the corpus, not the document globally — the same document in different corpuses has entirely separate annotations. This creates a bidirectional link: the annotation is clickable into the graph, and the document (within its corpus) appears in the edge's External Links page.
36. **No Algorithmic Change Logs:** The Phase 9 change log feature was dropped. Instead, users explore documents and graphs using color sets and annotation color set votes to understand how concepts are used in specific communities. Corpus subscriptions (Phase 7c) provide the structural basis for community exploration. The allowed-user annotation removal changelog (Phase 7g) provides accountability for curation within private layers.
37. **All Documents Are Publicly Visible:** Every document in Orca is viewable by any user. The public/private distinction applies only to the annotation layer — who can add and vote on annotations — not to the document content itself.
38. **Combined Public/Editorial Model (Corpus-Level):** Every corpus has both a public layer (any logged-in user can annotate/vote) and an editorial layer (only allowed users can annotate/vote, but visible to all). The corpus owner invites allowed users via invite link. Allowed users can filter to see only editorial-layer content. Allowed users can remove annotations with a changelog for accountability. This replaces the original binary public/private toggle. Renamed from "private" to "editorial" in Phase 10a.
39. **Usernames Visible to Corpus Members (Updated Phase 28e):** Within a corpus, all corpus members (owner and allowed users) can see each other's usernames in the members panel. Non-members see only a member count. Usernames also appear on annotations (as creator attribution) and are visible to all users. Votes on concepts (saves, swaps, links) remain anonymous — no usernames are shown on graph-level voting actions. The backend returns `isOwner` and `isMember` flags so the frontend can show invite links and remove buttons only for owners, while showing the member list to all members.
40. **Hiding Does Not Apply to Annotations:** Problematic concepts are hidden at the graph level, which prevents them from being used as annotations. No separate annotation-level hiding mechanism is needed.
41. **Color Set Voting Per Annotation:** When annotating a document (within a corpus), users specify a preferred color set for the annotated concept's children. Other users can vote for alternative color sets. Votes are per-annotation (per edge), consistent with all other voting. The annotator's choice is the default if no one else votes.
42. **Duplicate Detection on Upload:** Before committing a document upload, Orca checks for existing documents with high text similarity and shows matches to the user. This encourages finding an existing corpus rather than creating duplicates.
43. **Corpus Subscription = Persistent Tab:** Subscribing to a corpus creates a persistent tab in the main tab bar (for document browsing) and a corresponding tab on the Saved Page (for viewing saves associated with that corpus's annotations). Unsubscribing removes the main tab bar tab; saves remain on the Saved Page in an "Unsubscribed" tab until removed by the user. No explicit saved tab association is needed — save organization on the Saved Page is determined automatically by corpus annotation membership.
44. **Corpuses Are the Organizational Unit for Documents:** Documents always live inside corpuses. A document can be in multiple corpuses. Annotations, permissions, and subscriptions all operate at the corpus level, not the document level. Document lifecycle is governed by corpus membership — a document is deleted only when it's in zero corpuses. Corpus owners can add/remove documents (even ones they didn't upload) and delete the entire corpus.
45. **Decontextualized Document View — ❌ REMOVED (Phase 28, post-28f):** The standalone decontextualized document view (showing all annotations from all corpuses in a read-only view) was removed entirely. `DecontextualizedDocView.jsx` and `DocumentPage.jsx` were deleted. The `/documents/:id` route was removed from App.jsx. Guest annotation clicks now open the login modal (Phase 28f) instead of the decontextualized view. Cross-corpus annotation exploration is handled by the ConceptAnnotationPanel (Phase 27). The `getAllDocumentAnnotations` backend endpoint remains in place but is no longer called from the frontend.
46. **Document Favoriting Is Per-Corpus:** Users can favorite documents within a specific corpus to float them to the top of that corpus's document list. Favoriting in one corpus does not affect the document's position in other corpuses.
47. **External Links Page Has Two Sections Built in Different Phases:** The External Links page for a concept has two distinct sections: "Web Links" (user-submitted URLs with upvote voting, built in Phase 6) and "Document Annotations" (documents grouped by corpus showing where this concept is annotated, built in Phase 7d). Phase 6 ships with web links only; the corpus/document section is added once the corpus infrastructure exists.
48. **Corpus Groups Are Atomic in External Links Sorting:** When viewing document annotations on the External Links page, documents are grouped by corpus and corpus groups never break apart during sorting. A corpus group's position is determined by its top-ranked document (for vote/recency sorts) or by subscriber count. Lower-ranked documents within a corpus stay with their group even if individually they'd rank below docs in other corpuses.
49. **Web Link Voting Is Simple Upvotes:** Web links use a simple one-vote-per-user upvote system (`concept_link_votes` table), not the four-type vote system (save/move/swap/link) used for edges. This keeps the web link interaction lightweight.
37. **Tiered View Is Opt-In:** When filtering by multiple vote set swatches, the default is a flat sorted list (match count descending, then saves). Tiered view (ranked sections with headers) is behind a ☰ toggle that only appears when 2+ swatches are selected. This keeps the simple case simple while offering deeper analysis on demand. *(Note: Super-group swatches were retired in Phase 28b — only individual vote set swatches remain.)*
38. **AppShell Architecture:** All authenticated routes go through a single `AppShell.jsx` component that provides the header (title, Graph Votes button, Corpuses button, username, logout, logout everywhere) and the unified tab bar. The tab bar contains corpus tabs and graph tabs only — saved tabs were moved to a standalone Saved Page overlay in Phase 7c. Root.jsx, Concept.jsx, and CorpusTabContent.jsx render inside AppShell's content area based on the active tab. `App.jsx` only handles the AppShell catch-all — login/register routes were replaced by an inline `LoginModal.jsx` (Phase 28f, rewritten Phase 32c for phone OTP) with Log In / Sign Up tabs, dismissable via backdrop click or Escape. The `/login` and `/register` routes now redirect to `/`.
39. **Graph Tabs Are Persistent:** Graph tabs are stored in the `graph_tabs` database table and survive page refresh, logout, and login. Each tab stores `tab_type`, `concept_id`, `path`, `view_mode`, and `label`. When the user navigates within a graph tab, the backend is updated via `POST /votes/graph-tabs/update`. This differs from Saved tabs which are purely organizational — graph tabs track live navigation state.
40. **Saved Tab Deletion Safety:** Saved tabs cannot be deleted via a simple ✕ button (too easy to accidentally unsave all concepts). Instead, deletion requires right-click → context menu → "Remove tab and unsave concepts" with a confirmation dialog. This mirrors the philosophy that destructive actions on saved data should require deliberate intent.
41. **Concept.jsx Dual Mode:** Concept.jsx operates in two modes: "tab mode" (inside AppShell, receives `graphTabId` and `onNavigate` props, navigation happens via state + API calls) and "standalone mode" (URL-routed, used when opening a concept in a new browser window). Tab mode is detected by the presence of `graphTabId`. In tab mode, Concept.jsx maintains a `navHistory` array for in-tab back button support.
42. **Sidebar Layout (Phase 12b, replaces horizontal tab bar, updated Phase 19b/28a):** The app uses a vertical sidebar on the left (220px, collapsible) instead of a horizontal tab bar. After Phase 19b, the three labeled sections were merged into a single unlabeled unified list. "Graph Votes" and "Browse" buttons are in the sidebar top section (not the header). Active items have a left border highlight. The sidebar collapses to a 24px bar with a » expand button. Graph tabs have ✕ close buttons; corpus tabs do not (unsubscribe to remove). Right-click any item for context menu. All emoji icons (📚) were removed from sidebar items in Phase 28a.
50. **Sort by Annotation Count (Future):** A third sort option for child concepts (alongside sort-by-saves and sort-by-new) that orders children by how many distinct corpus documents contain them as annotations. Depends on Phase 7 infrastructure. Uses `document_annotations` table to count distinct `document_id` per child edge.
51. **Concept Diffing Uses Grandchild Jaccard Similarity:** The Diff modal compares child concepts across panes by computing Jaccard similarity on their own children (the parent concept's grandchildren). Two children from different panes are "similar" (Group 2) if their child sets overlap by ≥ 50%. Children with the same name + attribute across panes are "shared" (Group 3). Children that are neither shared nor similar are "unique" (Group 1). This reuses the same Jaccard formula as Flip View similarity percentage.
52. **Diff Modal Is Independent of Graph Navigation:** The Diff modal is a dedicated overlay opened via right-click on any concept. It does not affect the user's graph tabs or navigation state. Concepts are selected in context (specific path) within the modal. No new database tables are required — the modal reads from existing `edges`, `concepts`, and `attributes` tables with on-the-fly similarity computation.
53. **Child Rankings — 💤 RETIRED (Phase 28b):** The ranking UI was removed. Users could assign numeric rankings to children within their own vote set, with aggregated display for other sets. The `child_rankings` table, backend endpoints, and ranking cleanup logic remain but are no longer exercised by the frontend. Rankings were: own set only (backend validated), aggregated read-only for other sets, 1-to-N selector, stored with `vote_set_key` for staleness detection.
54. **Guest Access Uses `optionalAuth` Middleware:** Read-only GET endpoints for concepts use `optionalAuth` (extracts user if token present, proceeds with `req.user = null` otherwise). Write endpoints (POST for creating concepts, all vote routes) remain behind `authenticateToken`. SQL queries pass `-1` as user ID for guests, ensuring `BOOL_OR(v.user_id = $1)` always returns false. This avoids separate query branches for guests vs logged-in users.
55. **Guest Graph Tabs Are Ephemeral:** Guest users get local-only graph tabs that exist only in React state. Tab IDs use string format (`guest-1`, `guest-2`, etc.) to avoid collisions with DB integer IDs. No API calls for tab CRUD in guest mode. Tabs are lost on page refresh — this is by design per the status doc spec.
56. **Search Surfacing Saved Tabs:** The search endpoint cross-references results against the logged-in user's saved edges via a join through `votes` → `vote_tab_links` → `saved_tabs` → `edges`. Returns a `savedTabs` array per result with `{tabId, tabName}`. Results are sorted so saved-tab matches appear first. Guests get empty `savedTabs` arrays (the query is skipped when `req.user` is null). Corpus annotation surfacing will reuse this same pattern when Phase 7 infrastructure exists.
57. **FlipView Navigation Requires Callback in Tab Mode:** FlipView accepts an `onParentClick` callback prop from Concept.jsx. In tab mode, clicking an alt parent card calls this callback which runs `navigateInTab()` for proper in-tab navigation with nav history. In standalone mode (no callback), falls back to URL-based `navigate()`. This pattern matches how SearchField already handles tab-mode navigation.
58. **Web Links Are Context-Specific (Edge-Tied):** External web links attach to edges, not concepts globally. The same concept in different parent contexts can have entirely different sets of web links. This is consistent with how all other data in Orca (saves, swaps, attributes) is context-specific. The `concept_links` table has a foreign key to `edges(id)` with `ON DELETE CASCADE`.
59. **Web Link Voting Is Simple Upvotes:** Web links use a one-vote-per-user upvote system (`concept_link_votes` table), not the four-type vote system (save/move/swap/link) used for edges. This keeps the web link interaction lightweight. Auto-upvote on creation ensures the adder's vote is counted. Only the adder can remove a link.
60. **Cross-Context Links View Is Read-Only for Non-Current Contexts:** The FlipLinksView (🔗 All Links in Flip View) shows all web links across all parent contexts, but upvoting is only interactive for links in the current context. Other contexts are read-only with a "view only" hint. This prevents users from voting on links they may not have full context for.
61. **External Links Page Access Depends on parentEdgeId — ⚠️ Moot (Phase 27a):** The External Links page was retired in Phase 27a and replaced by the ConceptAnnotationPanel's Web Links tab. The old 🔗 Links button was removed. Web links are now accessible via the right-column annotation panel.
62. **Shareable Concept Links Use Standalone Mode URLs:** The Share button generates URLs in the format `/concept/:id?path=...` which works in standalone mode (direct URL navigation, outside the tab system). When someone opens a shared link, they get a fresh AppShell with the concept loaded in a new graph tab. The path parameter uses `effectivePath.slice(0, -1)` to exclude the current concept ID (matching how the `path` query param works in the routing system).
63. **View Modes in Concept.jsx (Updated Phase 27a):** Concept.jsx now supports two view modes: `'children'` (default) and `'flip'` (Flip View). Both modes are stored in tab navigation state, support nav history (back button), and persist in the `graph_tabs` database table via `view_mode` column. The URL also supports `?view=flip` for standalone mode. *(Phase 27a retired `'links'` and `'fliplinks'` view modes — web links and cross-context annotations are now served by ConceptAnnotationPanel in the right column. Migration updates stale graph_tabs rows.)*
64. **Corpus View Is an AppShell Overlay (Phase 7a):** The corpus browsing UI (list → detail → document) renders as an overlay in AppShell's content area, replacing tab content while active. Tab content is preserved underneath (not unmounted) via a `corpusView` state object: `null` (not showing), `{ view: 'list' }`, `{ view: 'detail', corpusId }`, or `{ view: 'document', documentId, corpusId }`. The Corpuses button in the sidebar toggles this overlay. This is a temporary architecture for Phase 7a — in Phase 7c, corpus tabs will become persistent tab-bar elements alongside graph tabs, and the overlay pattern will be retired.
65. **Corpus Ownership Enforced Server-Side:** All ownership checks (update, delete, add/remove documents) are validated on the backend by comparing `req.user.userId` against `corpuses.created_by`. The frontend shows owner controls to all logged-in users for simplicity, relying on the backend to reject unauthorized actions. This avoids passing user IDs through component props.
66. **Document Orphan Cleanup Is Transactional:** When removing a document from a corpus or deleting a corpus, the backend uses a database transaction to (1) remove the corpus-document link, (2) check if the document is in zero corpuses, and (3) delete the orphaned document if so. This prevents race conditions where a document could be left in limbo.
67. **Unique Corpus Names (Case-Insensitive):** No two corpuses can share the same name (compared case-insensitively). Enforced at the application level on both create and rename. Returns 409 Conflict if a duplicate name is found. Corpus and document namespaces are independent — a corpus and document can share the same name.
68. **Unique Document Titles (Case-Insensitive):** No two documents can share the same title (compared case-insensitively). Enforced at the application level on upload. Returns 409 Conflict if a duplicate title is found.
69. **Duplicate Detection Uses Truncated Prefix:** The duplicate detection endpoint compares the first 5,000 characters of document bodies using `pg_trgm` `similarity()`. This balances accuracy (5,000 chars captures the distinctive content) with performance (full-body trigram comparison on very long documents is expensive). The threshold is 0.3 (30% similarity). If the check fails for any reason, the upload proceeds normally — it's a best-effort confirmation step, not a hard gate.
70. **Corpus Subscriptions Create Persistent Tabs:** Subscribing to a corpus via `POST /api/corpuses/subscribe` creates a persistent corpus tab in the main tab bar. Unsubscribing via `POST /api/corpuses/unsubscribe` removes it. The `corpus_subscriptions` table is the source of truth — corpus tabs are loaded from `GET /api/corpuses/subscriptions` on mount. Corpus tabs are not closeable with ✕ (unlike graph tabs) — unsubscribing is the way to remove them.
71. **Graph Votes Page Is a Standalone Overlay (Phase 7c, renamed Phase 28c):** Saved tabs were removed from the main tab bar and moved into a standalone page (now called "Graph Votes") accessible via a "Graph Votes" button in the sidebar. The page renders as a full-page overlay containing its own internal tab bar with corpus-based tabs (dynamically generated from annotation membership). Clicking a concept opens it in a graph tab and closes the overlay. The old `saved_tabs`/`vote_tab_links` tables are functionally retired — tabs are now auto-generated from corpus annotation membership.
72. **Main Tab Bar Contains Only Corpus + Graph Tabs (Phase 7c):** After the Saved Page Overhaul, the main tab bar contains only two tab types: corpus tabs (subscription-based, persistent) and graph tabs (user-created, persistent, closeable). Tab groups can contain graph tabs. The active tab type is either `'corpus'` or `'graph'` — `'saved'` is no longer a valid active tab type in the main tab bar.
73. **Saved Tabs Still Needed for Vote Action:** Even though saved tabs are no longer in the main tab bar, the `savedTabs` state is still loaded in AppShell and passed to Root.jsx/Concept.jsx as a prop. This is because the ▲ vote button's tab picker needs to know which saved tabs exist. The vote action targets a specific saved tab via the `tabId` parameter on `POST /api/votes/add`.
74. **Annotations Are Three-Way Links (Corpus × Document × Edge):** Each annotation links a corpus, a document, and an edge (concept-in-context). The corpus scoping means the same document in different corpuses has entirely separate annotation sets. Character offsets (start_position, end_position) are stored against the immutable document body, which guarantees offsets remain valid over time.
75. **Annotation Permission Follows Combined Model:** Every corpus has a public layer (any logged-in user can annotate) and an editorial layer (only allowed users can annotate; visible to all). Allowed users can remove annotations with a changelog. The `layer` column on `document_annotations` tracks which layer an annotation belongs to (`'public'` or `'editorial'`). This replaces the original binary annotation_mode.
76. **Root Edges Not Returned by Parents Endpoint:** The `getConceptParents` backend endpoint uses `JOIN concepts c ON e.parent_id = c.id`, which excludes root edges (where `parent_id IS NULL`). The AnnotationPanel works around this by separately checking `getRootConcepts` to find root edges for the selected concept. This ensures root-level concepts can be used as annotations.
77. **Full Path Resolution Uses `getConceptNames` Batch Endpoint:** Both AnnotationPanel (context picker) and CorpusTabContent (annotation detail sidebar) resolve `graph_path` integer arrays to human-readable names by calling the `getConceptNames` batch endpoint. The response format is `{ concepts: [{ id, name }, ...] }` which must be converted to an `{ id: name }` lookup map before use.
78. **Avoid Naming React State `document`:** The browser global `document` is needed for DOM APIs like `createRange()`. Naming a React state variable `document` shadows it, causing runtime errors. Use `window.document` to explicitly reach the browser API, or rename the state variable.
79. **All Document Viewing Goes Through CorpusTabContent (Phase 7d-4):** The Phase 7a `DocumentView` component (used in the Corpuses overlay) has no annotation support. After Phase 7d, clicking a document in `CorpusDetailView` subscribes to the corpus and redirects to the corpus tab with `pendingDocumentId`, ensuring annotations are always visible. The `DocumentView` overlay is retained in AppShell rendering (for backward compatibility) but is no longer the primary document viewing path from the Corpuses overlay.
80. **Pending Document Pattern for Cross-Component Navigation:** When one component needs to tell another component (that may not be mounted yet) to open a specific document, AppShell stores a `pendingCorpusDocumentId` in state. The target component (`CorpusTabContent`) watches for this prop and auto-opens the document once its corpus data finishes loading. The pending state is cleared via a callback after consumption. This pattern avoids complex ref threading or event buses.
81. **External Links Page — ⚠️ RETIRED (Phase 27a):** The External Links page (`WebLinksView.jsx`) with separate "Web Links" and "Document Annotations" sections was deleted in Phase 27a. Its functionality is now served by ConceptAnnotationPanel in the right column of the concept page, with Annotations and Web Links tabs.
82. **Combined Public/Private Replaces Binary Toggle:** The original `annotation_mode` column ('public'/'private') on `corpuses` is retired in Phase 7g. Every corpus always has both a public layer (any logged-in user) and a private layer (allowed users only). Annotations get a `layer` column ('public'/'private') to track which layer they belong to. Allowed users can filter to see only private-layer content. This is a fundamental design change — there is no longer a binary choice at corpus creation time.
83. **Allowed User Annotation Removal with Changelog:** Allowed users can remove annotations from documents in their corpus, but every removal is logged in an `annotation_removal_log` table (who removed it, when, what the annotation was). This provides accountability within the allowed-user group. The changelog is visible to all allowed users of the corpus.
84. **Document Versioning Is Within-Corpus:** New document versions are auto-added to the same corpus as the source. Version numbers are tracked via `version_number` column (auto-incremented per lineage) and `source_document_id` (self-referencing FK forming a version chain). This keeps version numbering separate from the document title to avoid naming collisions. Only the document's original uploader can create versions (Phase 25c tightens from previously allowing any allowed user).
85. **Draft State Removed (Phase 21a):** The `is_draft` column and all draft/finalize logic were removed in Phase 21a. Documents are now always editable by their original uploader. Annotation offsets are adjusted via `diff-match-patch` on each edit. The previous model (drafts start editable, finalized = immutable) was replaced by the always-editable model.
86. **Annotation Offset Adjustment on Document Edit (Phase 21a):** When a document is edited, the backend computes a diff using `diff-match-patch` and adjusts all annotation offsets accordingly. Text inserted before an annotation shifts offsets forward; text deleted shifts backward; text inserted within an annotated region expands the end offset; annotated text partially or fully deleted causes annotation removal. This replaces the previous model where only draft versions could trigger annotation removal.
87. **Live Concept Linking in Documents:** As users type or paste text into a document (during draft editing or initial upload), text matching existing concept names is automatically underlined. Clicking an underline opens a decontextualized Flip View for that concept in a new graph tab. On finalized documents, concept links are pre-computed and cached. Links are invalidated when new matching concepts are created.
88. **Orphan Rescue for Allowed Users' Documents (Phase 9b):** When a corpus is deleted or a document is removed, if the document would become orphaned AND was uploaded by an allowed user (not the corpus owner), the document is left in the database with zero corpus memberships instead of being auto-deleted. The author sees a rescue modal on next app load, where they can add the doc to another corpus, create a new corpus, or dismiss (permanently delete). No expiry timer or background job — orphans persist indefinitely. Only `uploaded_by` is checked (not `added_by`) since the goal is protecting actual authors' work.
89. **Phase 9 Change Log Dropped:** The Phase 9c change log feature was removed from the roadmap. Users are expected to explore documents and graphs using color sets and annotation color set votes to understand how concepts are used in specific communities. The allowed-user annotation removal changelog (Phase 7g) provides accountability for curation decisions within the private layer.
90. **Decontextualized Document View — ❌ REMOVED (Phase 28):** The decontextualized document view (parallel to decontextualized Flip View) was removed. The original design allowed cross-corpus annotation browsing via a standalone overlay, but the ConceptAnnotationPanel (Phase 27) now serves this discovery purpose more effectively. Guest users who click annotation cards in the ConceptAnnotationPanel see a login modal prompting them to log in for full document access.
91. **Annotation Duplicate Merging in Decontextualized View — ⚠️ Moot (Phase 28):** This feature was part of the decontextualized document view which has been removed. The backend `getAllDocumentAnnotations` endpoint still contains this merging logic but is no longer called from the frontend.
92. **Add Existing Document Flow:** Corpus owners can add an existing document (already uploaded into another corpus) to their corpus via a title search. The backend endpoint (`GET /documents/search`) uses ILIKE for case-insensitive partial matching and excludes documents already in the target corpus. This is the frontend for the `POST /:id/documents/add` endpoint that existed since Phase 7a but had no UI.
93. **Annotation Voting Uses Simple Endorsements:** Annotation votes are simple endorsements (one vote per user per annotation) via the `annotation_votes` table, similar to web link upvotes (`concept_link_votes`). This is separate from edge save votes. Vote count and user_voted status are returned inline with annotation data by the `getDocumentAnnotations` query.
94. **Color Set Voting Is Per-Annotation, Not Per-Edge:** Users pick a preferred children vote set (color set) for each individual annotation, not globally for an edge. This is intentional — different annotations of the same concept in different documents/corpuses may warrant different color set preferences depending on the document's context.
95. **Color Set Selection Is Deferred, Not On-Creation:** When creating an annotation, no color set is selected. The annotator (or any user) picks a color set later from the annotation detail sidebar. This keeps annotation creation fast and avoids forcing users to understand vote sets before they can annotate. Users can navigate to the concept in a graph tab to browse color sets, then come back and pick one.
96. **Corpus Tabs Are Groupable (Phase 7f):** Corpus tabs can now be placed in tab groups alongside graph tabs. The `group_id` column on `corpus_subscriptions` tracks group membership. Backend `addTabToGroup`/`removeTabFromGroup`/`deleteTabGroup` handle `tabType === 'corpus'`. This allows corpus tabs and related graph tabs to be visually grouped together in the tab bar.
97. **Auto-Group on Navigate-to-Concept from Annotation:** Clicking "Navigate to concept →" in the annotation detail sidebar creates a new graph tab and automatically groups it with the source corpus tab. If the corpus tab is already in a group, the graph tab joins that group. If not, a new group is created (named after the corpus) containing both tabs. This keeps related corpus + graph exploration visually adjacent.
98. **Corpus Tabs Rendered with Display:None (Not Conditional Mount):** All corpus tabs are mounted simultaneously and hidden with `display: none` when inactive, matching the pattern used for graph tabs. This preserves open document state, scroll position, and selected annotations when switching between tabs. Previously, only the active corpus tab was mounted, causing state loss on tab switch.
99. **Annotation Scoping Gotcha:** Annotations are scoped to their corpus — the same document in different corpuses has separate annotation sets. When testing annotations, verify you're viewing the document through the correct corpus tab. An annotation created in Corpus A won't appear when viewing the document through Corpus B.
100. **Frontend User Object Uses `id`, Not `userId`:** The auth context's `user` object comes from the backend's `/auth/login` and `/auth/me` responses, which return database rows with `id` as the primary key. The JWT payload internally uses `userId`, but this is only relevant on the backend (`req.user.userId`). On the frontend, always use `user.id`. This caused a subtle bug where `isOwner` comparisons using `user?.userId` returned `undefined`.
101. **Invite Token Flow:** Corpus owners generate invite tokens (random 48-char URL-safe strings). The invite URL is `{origin}/invite/{token}`. The frontend `AcceptInvite.jsx` component handles `/invite/:token` — if logged in, it calls `POST /corpuses/invite/accept`; if not logged in, it redirects to `/login?returnTo=/invite/{token}`. Tokens can optionally have expiry dates and max-use limits.
102. **Layer Filter Reloads Annotations:** Changing the layer filter (All/Public/Private) in CorpusTabContent triggers a `useEffect` that calls `loadAnnotations` with the new filter value. The backend's `getDocumentAnnotations` accepts `?layer=public|private` to filter, or returns all visible annotations (public + private for allowed users, public-only for others) when no filter is specified.
103. **Editorial Annotations Use Green-Tinted Highlights:** To visually distinguish editorial-layer annotations from public ones, editorial annotations use a green-tinted background (`rgba(90, 122, 90, 0.15)`) with a green underline, compared to the default gold/yellow for public annotations. An "editorial" badge also appears in the annotation detail sidebar.
104. **Annotation Creation Layer Follows Active Filter:** When the layer filter is set to "Editorial" and the user is an allowed user, new annotations are created in the editorial layer. The annotate button shows "Annotate (editorial)" and the AnnotationPanel header confirms "(editorial layer)". When the filter is "All" or "Public", annotations default to the public layer.
105. **`annotation_mode` Column Functionally Retired:** The `corpuses.annotation_mode` column ('public'/'private') still exists in the database but is no longer used for permission checks as of Phase 7g. All permission logic now uses the `layer` column on `document_annotations` plus `corpus_allowed_users` membership. The column was not dropped to avoid a breaking migration, but it should not be referenced in new code.
106. **Allowed User Deletion Logging:** When an allowed user (or corpus owner) removes an annotation they didn't create, the removal is logged in `annotation_removal_log`. Creators removing their own annotations are NOT logged. The log captures the annotation's position, layer, original creator, and remover, using `ON DELETE SET NULL` FKs so entries survive entity deletion.
107. **Version History Uses Recursive CTE:** The `getVersionHistory` endpoint finds all versions in a document's lineage using two recursive CTEs: first walking UP from the requested document to find the root (the original v1 with no `source_document_id`), then walking DOWN from the root to find all descendants. This handles arbitrarily deep version chains without knowing the full lineage structure ahead of time.
108. **Version History Is Universally Accessible:** All users (owners, allowed users, regular users, and guests) can view a document's version history and navigate between versions. The "Version history" button appears on every document view unconditionally. Creating new versions is restricted to the document's original uploader (Phase 25c tightens from previously allowing owner/allowed users), but reading version history is read-only public information.
109. **Annotation Auto-Adjustment on Document Edit (Phase 21a):** When a document's body text is edited via `POST /corpuses/documents/:id/edit`, the backend uses `diff-match-patch` to compute positional diffs and adjust all annotation offsets. Annotations whose anchored text was removed or changed beyond recognition are deleted. Each removal is logged in `annotation_removal_log` for accountability. This replaces the old `updateDraft` approach that simply checked if text at offsets had changed.
110. **Version Numbers Are Lineage-Global:** When creating a new version, the backend finds the maximum `version_number` across all documents in the lineage (using both `id` and `source_document_id` relationships) and increments it. This ensures version numbers are unique and monotonically increasing across the entire chain, even if versions are created from different branch points.
111. **New Versions Propagate to All Source Corpuses:** When creating a new document version, the new version is automatically added to every corpus the source document belongs to (not just the requesting corpus). This ensures version lineages stay consistent across corpuses. The requesting corpus is also included as a safety net for cross-corpus version history navigation.
112. **Concept Links Are Non-Overlapping, Annotation-Subordinate:** In document rendering, annotations always take priority over concept link underlines. The `buildAnnotatedBody` function first lays out annotation segments, then weaves concept link underlines into the plain-text gaps between annotations. If a concept name falls within an annotated region, it does not get a separate underline — the annotation highlight takes precedence.
113. **Concept Link Matching Uses Whole-Word Regex:** The `findConceptsInText` backend endpoint uses `\b` word boundaries for case-insensitive matching against all concept names. Names are processed longest-first so longer matches take priority. Non-overlapping filtering (earlier/longer match wins) prevents double-linking. Special regex characters in concept names are escaped.
114. **`handleOpenConceptTab` Supports Optional `viewMode` Parameter:** The 6th parameter to `handleOpenConceptTab` controls what view mode the new graph tab opens in. Default is `'children'`; passing `'flip'` opens decontextualized Flip View. **Gotcha:** When wrapping `handleOpenConceptTab` with an arrow function to inject `sourceCorpusTabId`, all remaining parameters must be passed through — otherwise new parameters added later get silently dropped.
115. **`tabType` Determined by `conceptId` Presence, Not Path Length:** In `handleOpenConceptTab`, `tabType` is `'concept'` when a `conceptId` is provided (even with empty path for decontextualized views), and `'root'` only when no `conceptId` is given. The previous logic (`path.length === 0 ? 'root' : 'concept'`) incorrectly created root-type tabs for decontextualized concept views.
116. **Disambiguation Picker Unnecessary Under Current Schema:** Concept names are globally unique in the `concepts` table. Different attributes exist on edges, not concepts. The decontextualized Flip View already shows all attribute contexts for a concept. Forcing users to pick an attribute before seeing anything would contradict Orca's exploration-first philosophy. If concept names become non-unique in the future, disambiguation can be added then.
117. **Live Concept Linking Uses 500ms Debounce:** During document editing and document upload, concept link matching fires 500ms after the user stops typing (same debounce pattern as SearchField). This balances responsiveness with avoiding excessive API calls.
118. **Concept Link Caching Uses Timestamp Comparison for Staleness:** Rather than eagerly invalidating caches when new concepts are created, the cache uses lazy invalidation: on document open, compare `computed_at` against `MAX(concepts.created_at)`. If any concept is newer, recompute. The cache is also invalidated (all rows deleted) whenever a document is edited (Phase 21a). First view after cache invalidation pays the recomputation cost; subsequent views are instant.
119. **Concept Links Use Cached Endpoint, Editing Uses Direct Matching:** Two distinct code paths serve concept links. Documents viewed normally call `GET /concepts/document-links/:documentId` (cache-backed, reads from DB). Document editing and upload call `POST /concepts/find-in-text` with the text body directly (live, no caching). This separation is clean because the cache is invalidated on every edit (Phase 21a) and recomputed on next view.
120. **Graph Votes Page Tabs Are Auto-Generated from Corpus Membership (Phase 7c Overhaul, renamed Phase 28c):** The Graph Votes page (formerly "Saved Page") no longer uses manually created tabs (`saved_tabs` / `vote_tab_links`). Instead, tabs are dynamically computed: one per corpus where the user has votes associated via annotations, plus an Uncategorized tab. Association is determined by walking annotations: if an edge (or any descendant voted edge) has an annotation in a corpus, the entire voted branch appears in that corpus tab. The backend propagates corpus associations upward from annotated edges to ancestor voted edges. No tab picker on the ▲ button — votes just vote.
121. **Corpus Association Propagates Upward Through Saved Ancestors:** When determining which corpus tab a saved edge belongs to on the Saved Page, the backend checks not only whether the edge itself has an annotation, but also whether any descendant saved edge in the same branch has an annotation. If child edge C has an annotation in Corpus X, then parent edge P (which is also saved) also appears in the Corpus X tab on the Saved Page. This ensures complete tree context is visible in each corpus tab.
122. **Partial Unique Indexes for NULL Corpus ID:** The `saved_tree_order_v2` table uses PostgreSQL partial unique indexes to handle the Uncategorized tab (NULL `corpus_id`). One index covers rows `WHERE corpus_id IS NOT NULL` (standard unique on `user_id, corpus_id, root_concept_id`), another covers rows `WHERE corpus_id IS NULL` (unique on `user_id, root_concept_id`). This avoids the PostgreSQL issue where NULL values are treated as distinct in regular UNIQUE constraints.
123. **Unsubscribed Corpus Tabs on Saved Page:** If a user unsubscribes from a corpus but still has saves associated with it via annotations, the corpus still appears as a tab on the Saved Page with an "unsubscribed" badge. The tab disappears automatically when all associated saves are removed. Each unsubscribed corpus gets its own tab (not a single "Unsubscribed" bucket).
124. **Backwards-Compatible Vote Tab Links During Transition:** The simplified `addVote` still creates `vote_tab_links` entries (linking new votes to the user's first `saved_tabs` tab) for backwards compatibility during the transition period. This keeps the old `removeVoteFromTab` endpoint functional if needed. Once the old saved tabs system is fully cleaned up, this backwards-compat code can be removed.
125. **Document Favoriting Is Per-Corpus, Per-User:** The `document_favorites` table uses `UNIQUE(user_id, corpus_id, document_id)` — favoriting a document in one corpus doesn't affect its position in other corpuses. This is intentional: different corpuses serve different purposes, and a document that's important in one context may be irrelevant in another. The toggle endpoint inserts or deletes in a single call (check-then-act pattern). Favorites are loaded alongside corpus data and sorted client-side.
126. **Search Surfacing Uses Two Independent Context Sources:** Search results can show both saved-tab badges (green, from `votes` → `vote_tab_links` → `saved_tabs`) and corpus annotation badges (blue, from `document_annotations` → `edges` → `corpus_subscriptions`). These are independent queries — a concept can appear in saved tabs without being annotated, or be annotated without being saved. Results with any context (either or both) sort to the top. The section header "In your saves / corpuses" covers both.
127. **Orphan Detection Is Query-Based, Not Table-Based:** No `pending_orphan_rescues` table is needed. Orphaned documents are detected on the fly by querying for documents where `uploaded_by = current_user` and no rows exist in `corpus_documents`. This avoids tracking deferred state, expiry windows, or background cleanup jobs. The tradeoff is a small number of zombie documents from users who never log in again, which is negligible.
128. **"Editorial" Layer Replaces "Private" Layer:** The formerly "private" annotation layer is renamed to "editorial" to reflect its actual purpose: a curated annotation layer maintained by allowed users. The key change: editorial-layer annotations are now **visible to ALL users** — anyone can read them. Only allowed users can *create* or *vote on* editorial-layer annotations. This aligns with Orca's transparency philosophy (everything public and inspectable). The `document_annotations.layer` column values change from `'private'` to `'editorial'`. The backend no longer filters out editorial annotations for non-allowed users — it only restricts write operations.
129. **Nested Corpuses Used Single-Parent Model (Phase 12a) — ⚠️ Removed in Phase 19a:** Corpuses were nested via a `parent_corpus_id` column. This was removed in Phase 19a — all corpuses are now flat/top-level. The original rationale is preserved here for historical context: single-parent model was chosen over multi-parent junction table for simplicity. The feature was ultimately removed because document organization is better handled by corpuses as flat containers, with users navigating between documents via graphs rather than folder hierarchies.
130. **Corpus Permissions Do Not Cascade Through Nesting:** Nesting corpuses is purely organizational. Being an allowed user of a parent corpus does NOT grant any special access to sub-corpuses. Each sub-corpus retains its own owner, allowed users, and invite tokens independently. This keeps permissions simple and predictable.
131. **Corpus Subscriptions Show Parent Only (Manual Expand):** Subscribing to a corpus shows only the parent in the sidebar. Users expand to discover sub-corpuses. This prevents tab bar clutter for large corpus trees and matches familiar file explorer UX. Expand/collapse state stored locally in React state (`expandedCorpusIds`).
132. **Graph Tabs Mixed Into Corpus Tree (Private Placement):** Users can place their graph tabs inside any corpus node in the sidebar tree. These placements are private — only visible to the placing user. A graph tab can only be placed in one corpus at a time (`UNIQUE(user_id, graph_tab_id)`). Placing in a corpus removes from any flat tab group (and vice versa). The `user_corpus_tab_placements` table tracks these placements.
133. **Tab Groups Retained for Corpus-Unaffiliated Graph Tabs:** The existing flat `tab_groups` system survives for graph tabs not placed in any corpus. The sidebar layout is: CORPUSES (with placed graph tabs inside) → GRAPH GROUPS → GRAPHS (ungrouped). Corpus tabs are no longer placed in flat tab groups — `corpus_subscriptions.group_id` is retired (cleared in migration).
134. **Cross-Annotation Path Linking Is Frontend-Only:** When a document has multiple annotations from the same concept graph, the annotation detail sidebar's path display becomes interactive — ancestor concepts that are also annotations become clickable, and descendant annotation concepts extend the path downward. This requires no new tables or endpoints; it cross-references the already-loaded annotations array to find path overlaps.
135. **Tab Activity API Response Uses camelCase:** The `GET /votes/tab-activity` endpoint returns `{ activity: [...] }` (not `activities`), and each activity object uses camelCase fields: `isDormant`, `corpusId`, `corpusName`, `lastOpenedAt`. This was discovered during Phase 10c when the dormancy banner initially didn't appear due to mismatched field names (`is_dormant` vs `isDormant`, `activities` vs `activity`).
136. **Annotation Path Cross-Referencing Requires Parallel ID Array (Phase 13):** The annotation enrichment stores `resolvedPathNames` (human-readable) and `resolvedPathIds` (concept IDs) as parallel arrays. Both are built from `graph_path` + `parent_id`. The ID array is essential for cross-referencing annotations in the sidebar — without it, name-based matching would be unreliable (same name could appear at different points in different graphs). Descendant detection uses `annotations.filter(a => a.graph_path.includes(currentChildId))` — checking if the current concept's `child_id` appears anywhere in another annotation's ancestor chain.
137. **`graph_path` Includes the Parent — Never Append Parent Separately (Phase 15d):** The `graph_path` array on every edge stores the full path from root to the parent concept, *inclusive of the parent at the end*. For example, edge `parent_id: 3, child_id: 4, graph_path: [1, 2, 3]` — the path includes parent concept 3. When resolving `graph_path` to display names, do NOT also append `parentName` or `parent_id` — the parent is already the last element. If displaying the parent separately from its ancestors (as FlipView does), use `graph_path.slice(0, -1)` for the ancestor chain above the parent. The leaf concept (child of the edge) is the only thing that should be appended after the resolved path. This was the root cause of duplicate concept names appearing in annotation paths, move vote paths, and annotation panel context pickers.
138. **Sub-Corpuses Are Not Independently Subscribable (Phase 15b) — ⚠️ Moot after Phase 19a:** This restriction is no longer relevant since sub-corpus infrastructure was removed entirely in Phase 19a. All corpuses are now top-level and subscribable.
139. **Sidebar Section Labels — ⚠️ Moot after Phase 19b:** The three sidebar sections (CORPUSES, GRAPH GROUPS, GRAPHS) were removed in Phase 19b and replaced with a single unlabeled unified list. Section header verification is no longer needed.
140. **Admin User Via Environment Variable (Phase 16):** The admin user for moderation (unhide) is determined by `ADMIN_USER_ID` in the backend `.env` file, not hardcoded. The `getHiddenChildren` endpoint returns an `isAdmin` boolean so the frontend conditionally renders the Unhide button without needing to know the admin ID itself. This keeps admin identity server-side only.
141. **Single-Flag Immediate Hide (Phase 16):** One flag from any logged-in user immediately hides an edge (`is_hidden = true`). This is intentionally aggressive for spam prevention — the community voting (hide/show) and admin unhide provide the correction mechanism. Future enhancement: community-threshold auto-unhide when show votes exceed hide votes by a configurable margin.
142. **Auth Middleware Default Export Pattern:** The auth middleware (`middleware/auth.js`) exports `authenticateToken` as the default export (`module.exports = authenticateToken`) and `optionalAuth` as a named property (`module.exports.optionalAuth = optionalAuth`). All route files must import as `const authenticateToken = require('../middleware/auth')` — NOT destructured `{ authenticateToken }`. This has caused startup crashes when forgotten (Phase 16a).
143. **Hidden Edge Filtering Scope (Phase 16b):** The `is_hidden` filter is applied to all public-facing *display* queries (children, roots, parents, vote sets, diff, search child-check, Jaccard similarity) but NOT to user-specific data queries (Saved Page, vote removal). Users can still see and unsave their own saved edges even if the edge is subsequently hidden. Write operations (save, web link, annotation) are blocked on hidden edges as a safety net.
144. **Root Concept Root-Detection Subquery Is NOT Hidden-Filtered (Phase 16b):** The `getRootConcepts` query uses `WHERE c.id NOT IN (SELECT DISTINCT child_id FROM edges WHERE parent_id IS NOT NULL)` to find concepts that aren't children anywhere. This subquery intentionally does NOT filter `is_hidden` — a concept that's a child somewhere (even if that child edge is hidden) should not suddenly appear as a new root concept. Only the root *edge* join (`root_e`) filters hidden.
145. **Document Tags Are Global, Not Per-Corpus (Phase 17):** Tags live on documents, not on corpus–document links. A tag assigned to a document is visible everywhere that document appears (all corpuses, External Links page). This reflects the design principle that a document's type (preprint, protocol, etc.) is an intrinsic property of the document, not of its membership in a particular corpus. Any logged-in user can create tags and assign them. Removal is restricted to the user who assigned the tag or any owner of a corpus the document belongs to. The `documents.js` route file was created in Phase 17a, consolidating the previously standalone `GET /api/documents/:id` route from `server.js` with the new tag endpoints. **Updated Phase 27e:** Tag creation is now admin-controlled — `POST /tags/create` returns 410 Gone; tags are seeded in migrate.js and filtered by `ENABLED_DOCUMENT_TAGS` env var.
146. **Overlay/Tab Visibility Coupling — Three Mutually Exclusive Content Areas (Phase 17 bugfix):** The app has three mutually exclusive content areas: saved page (`savedPageOpen`), corpus overlay (`corpusView`), and graph/corpus tab content (shown when the other two are falsy). **Any click handler that switches between these modes must explicitly clear the other two states.** Failing to do so causes the old overlay to render on top, making the new content invisible. This was the root cause of graph tabs being unclickable while the corpus browse was open. Rule: whenever adding a new navigation action (sidebar click, button, etc.), verify it resets all three of `activeTab`, `corpusView`, and `savedPageOpen` as appropriate.
147. **Don't Use Render Depth as Proxy for Semantic Identity (Phase 17 bugfix):** `renderSidebarCorpusItem` used `depth === 0` to mean "this is a subscribed top-level corpus" and `depth > 0` to mean "this is a sub-corpus". But a subscribed corpus tab can render at `depth=1` inside a group. **Always use the authoritative data source (`corpusTabs`) to classify items, not their position in the visual tree.** The fix replaced all `depth === 0` guards with `corpusTabs.some(t => t.id === tab.id)`.
148. **Error Fallback Paths Must Be Safe for Destructive Actions (Phase 17 bugfix):** The sub-corpus document opening walk-up had a catch block that logged a warning then fell through to `handleSubscribeToCorpus` with the sub-corpus ID — which the backend was guaranteed to reject. **When a try/catch guards an action whose inputs depend on async resolution, the catch should abort the action (`return`), not silently proceed with whatever the inputs happen to be.**
149. **CorpusDetailView and CorpusTabContent Document Cards Must Show Identical Information (Phase 17 bugfix):** Two separate views render document cards: `CorpusDetailView` (Corpuses browse page) and `CorpusTabContent` (corpus tabs in sidebar). Both must display the same metadata: title, format, uploader, date, version badge, draft badge, and tag pills. When adding a new document-level feature (like tags), both components must be updated. This has already regressed once (version/draft badges were in `CorpusTabContent` but missing from `CorpusDetailView`).
150. **Grouped Corpus Tabs Must Render Inside Groups (Phase 17 bugfix):** `renderSidebarGroup` must render both `graphTabs` and `corpusTabs` that have matching `group_id`. The auto-grouping flow in `handleOpenConceptTab` sets `group_id` on corpus subscriptions, moving them out of the ungrouped CORPUSES section. If `renderSidebarGroup` only renders graph tabs, grouped corpus tabs disappear entirely. `groupContainsActiveTab` must also check corpus tabs, not just graph tabs.
151. **Flip View Path Highlighting Uses Hover, Not Click (Phase 18):** The original spec called for click-based path segment selection with Ctrl+click for multi-segment support. This was revised to hover because Flip View cards are entirely clickable for navigation — adding click-based path selection would create a UX conflict (users would accidentally navigate when trying to highlight, or vice versa). Hover is zero-commitment, instantly discoverable, and needs no mode switching. The tradeoff is that multi-segment selection (Ctrl+click) is not possible with hover, but this is acceptable because the contiguous shared segment extension already shows the most useful information automatically. The `getSharedSegments` algorithm has O(n×m) complexity per card pair, but Flip View rarely exceeds ~30 cards, so performance is not a concern.
152. **`graph_path` Parent Duplication Is a Recurring Bug Pattern (Phase 20 fix):** When building annotation path displays from `graph_path`, the parent concept is already the last element of the array. Code that then separately pushes `parentName`/`parent_id` causes duplicate names. This bug has appeared in at least three places: `CorpusTabContent.jsx`, `DecontextualizedDocView.jsx`, and annotation panel context pickers. When writing new path display code, always check: does the array already end with the parent? If so, do NOT append it again. See Architecture Decision #137 for the canonical rule.
153. **Annotation Sentence Expansion Capped at 200 Characters (Phase 20d):** When showing annotation context in the former `WebLinksView.jsx` (now retired in Phase 27a), the sentence boundary scan was capped at 200 characters in each direction from the annotation. If no punctuation was found within the cap, an ellipsis (`…`) was appended. This pattern may still be referenced in annotation display code elsewhere.
154. **Document-Level Annotations Replace Offset-Based Highlighting (Phase 22b):** Annotations no longer store `start_position`/`end_position` character offsets. Instead they attach a concept-in-context to the whole document with an optional `quote_text` string and optional `comment`. Quote navigation uses runtime string search, not stored offsets. This eliminates offset fragility on document edits/versions, removes `buildAnnotatedBody` segment rendering, and better fits value-graph annotation where the concept–document connection is conceptual. Existing offset-based annotations are migrated by extracting the highlighted substring into `quote_text`.
155. **Concept Detection Panel Replaces Persistent Underlines (Phase 22b):** Graphed concept names in document text were previously rendered as persistent underlines with complex annotation-vs-concept-link priority logic. Replaced by a sidebar panel listing detected concepts with navigate buttons (scroll-to and temporary highlight). Keeps the document body clean, eliminates overlap logic, and makes concept detection more actionable.
156. **Quote Occurrence Picker for Ambiguous Navigation (Phase 22b):** When a text quote or concept name appears multiple times in a document, clicking "navigate" shows an occurrence picker with surrounding context. The annotator selects which occurrence they mean, stored as `quote_occurrence`. Avoids character offsets while allowing precise navigation. Stale quotes (post-versioning) gracefully degrade to non-clickable context text.
157. **pdf-parse v1.1.1 Required, Not v2.x (Phase 22a):** The `pdf-parse` npm package v2.x rearchitected its API — the `/node` entry exported only `{ getHeader }` and the main entry crashed with `DOMMatrix is not defined` (browser-only). v1.1.1 exports the parse function directly and works in Node.js. Always `require('pdf-parse')` (not `require('pdf-parse/node')`).
158. **Remove process.exit from pg Pool Error Handler (Phase 22a):** The `database.js` pg pool `error` event handler had `process.exit(-1)` which killed the backend on any transient PostgreSQL client error (network hiccup, idle timeout). The pg pool handles reconnection automatically — the process should log errors, not exit. This caused all API calls (including login) to return 500 after any transient DB error.
159. **window.document Shadowed by React State Variable (Phase 22b):** In `CorpusTabContent.jsx`, the React state variable `document` (holding `{ id, title, body, ... }`) shadows the global `window.document` DOM API. All DOM API calls (`createTreeWalker`, `createRange`, `createElement`) must use `window.document.*` explicitly. This caused a `createTreeWalker is not a function` crash in the quote navigation feature.
160. **Two-Column Concept Layout with Context-Scoped Annotations (Phase 27a):** The concept page now splits into a 65/35 flex layout when viewing a specific concept (not root). Left column: children or flip view. Right column: `ConceptAnnotationPanel.jsx` with Annotations and Web Links tabs. The header (breadcrumb, attribute badge, save button) stays full-width above both columns. Both columns scroll independently. The right panel only renders when `effectiveConceptId` is set — root page stays full-width. The panel accepts a `viewMode` prop: in children view, annotations are scoped to the current edge only (`?edgeId=N`); in flip view, annotations from all contexts are shown.
161. **Cross-Context Annotation Aggregation (Phase 27b):** `GET /api/concepts/:id/annotations` finds all `document_annotations` joined through edges where `child_id = :conceptId` and `is_hidden = false`. Each annotation includes a `context` object (`edgeId`, `parentId`, `parentName`, `pathNames`, `attributeName`) so the user can see which parent context each annotation came from. The endpoint supports composable filters: `?edgeId=N` (single context), `?corpusIds=1,2,3`, `?tagId=N`, `?sort=votes|newest`. Path names are resolved via batch concept name lookup. The context path displayed in the panel includes the leaf concept name (appended in frontend `renderContextPath`).
162. **Annotation Panel Shows Read-Only Vote Counts (Phase 27b):** The ConceptAnnotationPanel shows annotation endorsement counts and web link vote counts as plain text, not interactive buttons. Users must navigate to the document in a corpus tab to vote. This keeps the panel focused on discovery/navigation rather than duplicating the voting UI.
163. **Auto-Subscribe on Annotation Click-Through (Phase 27c, updated Phase 28):** When a logged-in user clicks an annotation card in ConceptAnnotationPanel, AppShell calls `handleSubscribeToCorpus` which subscribes to the corpus (or handles 409 if already subscribed), creates/finds a corpus tab in the sidebar, sets `pendingCorpusDocumentId` and `pendingAnnotationId`, and switches to the tab. CorpusTabContent watches for the pending annotation in its loaded annotations array, selects it, and triggers `navigateToOccurrence` on the quote text (with 300ms delay for DOM render). Guests see a login modal with "Log in to view documents and annotations" (updated Phase 28 — previously opened DecontextualizedDocView overlay).
164. **Pending Annotation Must Not Trigger Creation UI (Phase 27c bugfix):** When consuming `pendingAnnotationId` in CorpusTabContent, the effect must set `showAnnotationPanel(false)` — not `true`. Setting it to `true` opens the AnnotationPanel creation form (QUOTE/COMMENT/CONCEPT fields) instead of just selecting the annotation in the sidebar list. The pending flow should: open the document → scroll to quote → select the annotation in the sidebar → NOT open creation UI.
165. **Pending Document Must Override Currently-Open Document (Phase 27c bugfix):** When `pendingCorpusDocumentId` points to a document different from the one already open in the corpus tab, the pending document effect must trigger even if `subView !== 'list'`. The fix extends the effect condition to also fire when the current document ID differs from the pending one, navigating to the new document before applying `pendingAnnotationId`.
166. **Admin-Controlled Document Tags Replace User-Created Tags (Phase 27e):** `POST /api/documents/tags/create` now returns 410 Gone. `GET /api/documents/tags` filters by `ENABLED_DOCUMENT_TAGS` env var (case-insensitive comma-separated names). If the env var is empty or unset, all tags are returned (backwards compatible). Initial tags seeded in migrate.js: preprint, protocol, grant application, review article, dataset, thesis, textbook, lecture notes, commentary. "Create new tag" UI removed from CorpusTabContent tag pickers. Mirrors the `ENABLED_ATTRIBUTES` pattern from Phase 25e.
167. **Responsive Concept Layout (Phase 27d):** Below 900px viewport width, the two-column layout switches to vertical stacking (`flexDirection: 'column'`). The right panel loses its left border and gains a top border. The panel becomes collapsible via a clickable "Annotations & Links ▸/▾" header, defaulting to collapsed on narrow screens. Uses `window.matchMedia` with a change listener, cleaned up on unmount.
168. **Retired View Modes and Components (Phase 27a):** The `'links'` and `'fliplinks'` view modes are retired. `WebLinksView.jsx` (Phase 6b) and `FlipLinksView.jsx` (Phase 6c) are deleted. The 🔗 Links button in the concept header and the "🔗 All Links" button in FlipView.jsx are removed. A migration step in migrate.js updates any `graph_tabs` rows with `view_mode = 'links'` or `'fliplinks'` to `'children'`. Web links and cross-context annotations are now served by ConceptAnnotationPanel in the right column.
169. **DocumentPage.jsx — ❌ REMOVED (Phase 28):** The standalone document page at `/documents/:id` was deleted along with `DecontextualizedDocView.jsx`. The route was removed from App.jsx. Guest annotation card clicks now open the login modal (Phase 28f) with the notice "Log in to view documents and annotations" instead of showing a standalone document view. The callback chain is: `ConceptAnnotationPanel.onRequestLogin` → `Concept.onRequestLogin` → `AppShell.handleRequestLogin` → opens the login modal.
170. **Login Modal Replaces Login/Register Pages (Phase 28f, updated Phase 32c):** `LoginModal.jsx` is a centered overlay modal with semi-transparent backdrop, two tabs (Log In / Sign Up), dismissable via backdrop click or Escape. As of Phase 32c, uses phone OTP two-step flow (`sendCode` → `phoneRegister`/`phoneLogin` via AuthContext) instead of username/password. Accepts a `notice` prop for contextual messages (e.g., "You have a pending corpus invite..."). The `/login` and `/register` routes in App.jsx redirect to `/`. `AcceptInvite.jsx` and `DocInviteAccept.jsx` show the login modal for guests. `Login.jsx` and `Register.jsx` files are retained but unused. Old `login()`/`register()` functions removed from AuthContext in Phase 32d.
171. **Child Rankings Retired (Phase 28b):** The `child_rankings` table remains in the database (append-only philosophy) but the ranking UI is removed. The backend `getVoteSets` no longer returns ranking-related data for the frontend. Individual vote set filtering still works; only the per-child rank dropdown and aggregated rank badges are removed. Ranking cleanup queries in `removeVote`, `removeVoteFromTab`, and `addSwapVote` were also cleaned up.
172. **Super-Groups Retired (Phase 28b):** Vote set similarity grouping (Layer 3 — super-groups with agglomerative hierarchical clustering) is removed from the frontend. The underlying `getVoteSets` endpoint still returns vote set data, but super-group computation and the two-row swatch layout are removed. Individual vote set swatches and filtering remain.
173. **"Graph Votes" Replaces "Saved" Terminology (Phase 28c):** All user-facing "Saved" / "saves" / "saved" text is renamed: sidebar button → "Graph Votes", page heading → "Graph Votes", count labels → "graph votes", sort dropdown → "↓ Votes", SwapModal → "vote/votes", VoteSetBar tooltip → "users voted for the same", annotation panel → "▲ N votes", FlipView badge → "Voted". The internal code (variable names, API endpoints, database tables) retains the original "save"/"vote" naming — only UI-facing strings changed. Browser tab `<title>` changed from "Concept Hierarchy" to "orca".
174. **PostgreSQL COUNT() Returns String (Phase 28 bugfix):** The `pg` driver returns `COUNT()` as a string (e.g., `"1"` not `1`). Strict equality (`=== 1`) fails silently. Always wrap with `Number()` before numeric comparison. This caused the child count display to always show "children" instead of "child" for single-child concepts (ConceptGrid.jsx).
175. **Dormancy Banner Orphaned Activity Rows (Phase 28 bugfix):** The `getTabActivity` API returned ALL `saved_page_tab_activity` rows for a user, including orphaned rows for tabs where the user no longer has any actual saves. The `check-dormancy.js` script would mark these empty tabs dormant after 30 days, triggering the dormancy warning banner with nothing to act on. Fix: added `EXISTS` subquery filters so `getTabActivity` only returns activity rows backed by real saves — uncategorized tab requires at least one vote, corpus tabs require at least one vote on an edge with annotations in that corpus.
176. **Zen Aesthetic Rules (Phase 28a):** The UI uses a strict black-on-off-white theme with EB Garamond serif font. Rules: (1) No emoji icons in UI chrome — all emoji (📚📋📌🏷👥🔗🔄🚫🚩👁) replaced with text labels; only ▲ (save/vote) and ⇄ (swap) retained as geometric symbols; plain Unicode (←→▸▾✕↓) kept as simple shapes. (2) No colored buttons — green, red, blue buttons all converted to transparent/dark with neutral borders. (3) No italics — all `fontStyle: 'italic'` removed across 22 files (87 instances). (4) Font explicitly set on breadcrumbs, concept names, child counts, flip/share/sort buttons, login/register/logout buttons via inline `fontFamily`. (5) The only color in the UI comes from vote set swatches and dots.
177. **Document Search Excludes Superseded Versions (Phase 28d bugfix):** The `searchDocuments` query now adds `AND NOT EXISTS (SELECT 1 FROM documents d2 WHERE d2.source_document_id = d.id)` to exclude older document versions that have been superseded by newer versions. This prevents duplicate results when searching for documents.
178. **Annotation Lists Sorted by Vote Count (Phase 28d):** Both `CorpusTabContent.jsx` (contextualized view) and the now-removed `DecontextualizedDocView.jsx` sort annotation lists by `vote_count` descending. The `getAllDocumentAnnotations` backend endpoint now includes `vote_count` (via subquery on `annotation_votes`) in the response, with accumulation across merged duplicate annotations.
179. **Corpus Member Username Visibility (Phase 28e, updates #39):** Within a corpus, all corpus members (owner AND allowed users) can see each other's usernames in the members panel. The backend checks `corpus_allowed_users` membership (not just ownership) and returns the full username list plus `isOwner` and `isMember` flags. Invite link generation and member removal remain owner-only. Non-members still see count only. The Leave button is shown for allowed users who aren't the owner.
180. **Phone OTP Login Modal (Phase 32c):** `LoginModal.jsx` rewired from username/password forms to a two-step phone OTP flow. Each tab (Log In / Sign Up) has Step 1 (enter phone + send code) and Step 2 (enter 6-digit code + verify). Phone input shows static "+1" prefix with raw 10-digit input. Resend code link with 30-second countdown timer (`useEffect`/`setInterval`). Tab switching resets to Step 1. `logoutEverywhere` in AppShell header does API call then local cleanup unconditionally — ensures user is always logged out locally even if the server call fails.
181. **Graceful Shutdown in server.js:** `server.js` registers `SIGINT`/`SIGTERM` handlers that call `server.close()` before exiting. This ensures port 5000 is released cleanly when the process is stopped or when nodemon restarts after a crash. Without this, stale Node processes hold the port and cause `EADDRINUSE` errors on restart.
182. **Email Column Reactivated for Legal Notifications (Phase 36):** The `email` column on `users` was retired in Phase 32d but is reactivated in Phase 36 for legal notifications (copyright violations, ToS updates). Required for new registrations at application level; DB column stays nullable for backward compatibility. Not used for auth — phone OTP remains the only auth mechanism. No uniqueness constraint on email.

### Common Tasks

**Adding a new API endpoint:**
1. Create controller function in `backend/src/controllers/`
2. Add route in `backend/src/routes/`
3. Add API method in `frontend/src/services/api.js`

**Adding a new page:**
1. Create component in `frontend/src/pages/`
2. Add route in `frontend/src/App.jsx`
3. Link to it from other pages

**Database changes:**
1. Modify `backend/src/config/migrate.js`
2. Drop and recreate database (for now)
3. Later: use proper migrations

---

## Organizational Philosophy

**Commons Model**
As a platform that hosts user generated content, Orca's approach to content moderation and curation revolves around community norms over top down executive decisions and curious discovery over algorithmic curation. The placement and movement of saves is the primary signal to high quality concept paths. We want to enable users to use those signals wisely to assert a tasteful preference for high quality content in Orca. Part of that is discussing and asserting community norms. Orca users should strive for this active sense of civic engagement with the community. Find communities in which you can be an active citizen. Pursuit of Wikipedia-like governing and structuring activity to the graphs. 

**Using Language As a Tool**
'In most cases, the meaning of a word is its use.' Concepts are functional entities in Orca. They connect to both parent and child concepts and help direct human energy in productive ways. They add clarity and flexibility to the conceptual model of actions and other concepts. Every concept in Orca carries one of four attributes: **action**, **tool**, **value**, or **question**. Actions are the default concept type — steps, workflows, things you do. Tools differentiate the means by which actions are carried out. Values represent motivations, principles, and differentiators that guide why and how actions are pursued. Questions capture research questions — open inquiries that organize investigation and exploration within a domain. A user might apply a value as a root concept to contain actions that 'enact' it, or as a child of an action to specify substeps or tools that uniquely pursue that value. These attributes allow users to tag concepts within a shared graph, so that `Reading [action]` and `Book [tool]` can coexist as siblings in the same hierarchy. The hierarchical relationships come to represent the order in which these things are thought about during real decision making. This maintains the collective action ontology spirit: an action scaffolding that can be enriched with tools, values, and questions. The basic level is the most efficient to talk about for a given purpose; the idea is to expand upward into goals and downward into detailed descriptions.

## Permanence & Moderation Rules

### Nothing Is Ever Deleted
- **Concepts** are never deleted, only hidden (via spam/vandalism flagging)
- **Edges** are never deleted, only hidden (via spam/vandalism flagging)
- Hidden items have talk pages for accountability and community discussion
- Low-saved content stays visible — saving and hiding are completely separate systems

### Hiding System (Spam/Abuse Only)
- Hiding is for spam, vandalism, offensive content, or illegal activity — NOT for low-quality or unpopular content
- Low-saved concepts remain visible to encourage new ideas and organic discovery
- **Namespace blocking:** If a concept is hidden in a specific path + attribute context, that exact namespace is blocked. You cannot recreate an identically-named concept with the same attribute in that same path until it is unhidden.
- Hidden concepts/edges can be unhidden if the community decides the flag was wrong

### Graph Votes Page Stability (formerly "Saved Page")
- The Graph Votes page shows only the user's own votes, organized across corpus-based tabs — this list is stable unless the user explicitly votes or unvotes
- The dynamism is in the *child sets* of the user's voted leaf nodes — those evolve as other users add content — but the user's bookmarked list itself does not churn
- Unvoting cascades: removing a concept (via X button on Graph Votes page or unvoting in children view) also removes all descendants in that branch, with vote counts subtracted accordingly

---

## My Notes on Status

Phase 1: Complete.
Phase 2: Complete. All features implemented — Display totals, root concept voting, browser back button integration, Flip View (flat vote-sorted cards), and Combined Add/Search field with pg_trgm fuzzy matching.
Phase 3: Complete. Attribute system implemented — attributes table with action/tool/value, attribute_id on edges, two-step creation flow (name → attribute picker), attributes displayed in square brackets everywhere, 40-character name validation (later raised to 255 in Phase 28g), existing edges migrated to [action].
Phase 4: Complete. Full-path save model, cascading unsave, Sort by New, Link votes, Flip View similarity percentage, Move votes, Swap votes, Vote Set Visualization (Layer 1: swatches + dots + basic filtering), Vote Set Tiered Display (Layer 2: toggle for ranked sections), and Vote Set Similarity Grouping (Layer 3: super-groups with hierarchical clustering) all implemented.
Phase 5a: Complete. Basic Saved Page with tree display, unsave with cascading, collapse/expand, move/swap vote indicators, and navigation to concept-in-context. "Saved" button added to Root and Concept page headers.
Phase 5b: Complete. Saved Tabs with `saved_tabs` and `vote_tab_links` junction table, default tab auto-created on registration, migration backfill for existing users/votes, tab bar UI on Saved Page (switch/create/rename/delete), inline tab picker dropdown on ▲ save button, per-tab save filtering, tab-scoped unsave with orphan cleanup.
Phase 5c-1: Complete. Unified tab bar shell (AppShell) with persistent graph tabs. New `graph_tabs` database table. Backend CRUD for graph tabs (get/create/update/close). AppShell.jsx wraps entire app — one header, unified tab bar showing saved tabs (italic, left side) + graph tabs (right side) with `+` button. Saved tabs no longer have ✕ button — only removable via right-click context menu ("Remove tab and unsave concepts"). Graph tabs have ✕ to close. Right-click context menu supports Duplicate (graph tabs) and Open in New Window. Root.jsx and Concept.jsx refactored to accept props for tab mode (graphTabId, onNavigate, initialConceptId, etc.) — no more their own headers. New SavedTabContent.jsx extracted from Saved.jsx renders inside saved tabs. Clicking a concept in a saved tree opens a new graph tab. App.jsx simplified to login/register + AppShell for all authenticated routes. `/saved` route retired.
Phase 5c-2: Complete. Within-tab navigation with in-tab back button. `navHistory` stack in Concept.jsx tracks forward navigation; `←` back button appears in concept header bar when history is non-empty. All graph tabs rendered simultaneously with `display: none` on inactive ones (hide-not-unmount) so nav history survives tab switching. `handleGraphTabNavigate` in AppShell normalizes camelCase update keys (tabType, conceptId, viewMode) to snake_case (tab_type, concept_id, view_mode) before applying to local state, and applies state optimistically before the DB call. Tab label updates after concept loads via a `useEffect` on `concept` + `currentAttribute`.
Phase 5c-3: Complete. Search results navigate the current graph tab to the decontextualized flip view (rather than URL routing). SearchField accepts `graphTabId` + `onNavigate` props; when in tab mode, clicking a result calls `onNavigate` instead of `navigate()`. Root and Concept pass these props down to SearchField. Concept detects when it was opened directly into flip view from root (initialViewMode === 'flip' and no path) and pre-seeds `navHistory` with a root entry so the back button works immediately. `navigateBack` sends `label: 'Root'` when popping back to root so the tab label updates correctly.
Phase 5c-4: Complete. Polish and edge cases for graph tab management. Adjacent-tab switching on close (Chrome-style: prefer tab to the right, fall back to left). Auto-create a fresh Root graph tab when the last graph tab is closed (prevents user from being stuck with no graph tabs). Context menu overflow protection (clamped to viewport). Removed broken "Open in new window" for saved tabs (no standalone route exists); saved tab context menu now shows only "Remove tab and unsave concepts" (when 2+ tabs) or "No actions available" (last tab). Fixed stale-state bug where closing the last graph tab created two Root tabs instead of one (`setGraphTabs([newTab])` instead of appending to stale `prev`).
Phase 5d: Complete. Tab Grouping with named expandable groups. New `tab_groups` table + `group_id` nullable FK on `saved_tabs` and `graph_tabs`. 7 backend endpoints (get/create/rename/delete/toggle/add-tab/remove-tab). Groups render in tab bar between saved tabs and graph tabs — each group is a clickable expand/collapse header showing ▸/▾ arrow, name, and member count. Expanded groups show member tabs inline with left border. Context menus updated: right-click ungrouped tab → create/add to group; right-click grouped tab → remove from group; right-click group header → rename/delete. Double-click group header to rename inline. Expand/collapse state persisted to DB with optimistic update. Deleting a group ungroups tabs (sets group_id = NULL), does not delete them.
Phase 5e: Complete. Saved Tree Reordering with persistent order. New `saved_tree_order` table with `(user_id, saved_tab_id, root_concept_id)` unique constraint. 2 backend endpoints (`GET /tree-order`, `POST /tree-order/update`). SavedTabContent.jsx updated with ▲/▼ arrow buttons on each root tree card. Optimistic state updates with DB persistence. Trees with explicit order sort first by `display_order`; unordered trees fall to bottom by save count.
Phase 5f: Complete. Child Ordering Within Vote Sets. New `child_rankings` table with 3 backend endpoints (get/update/remove). Only the user's own vote set can be ranked (backend validates); other sets show aggregated rankings read-only. `getVoteSets` response now includes `userSetIndex`, `parentEdgeId`, and `voteSetKey` per set. Solo vote sets enabled (removed 2+ user threshold from `HAVING` clause). User's own swatch has bold dark border + "Your vote set" tooltip. Dropdown selector (1 to N) on each child card when viewing own set. Aggregated rank badges on all single-set views. Rank-based sorting (most popular rank wins, then user count, then saves). Ranking cleanup on unsave in both `removeVote` and `removeVoteFromTab`.
Phase 5 misc: Complete. Three sub-features implemented:
- **Read-Only Guest Access:** Non-logged-in users can browse graphs, search, navigate, and see save counts and vote sets — all read-only. New `optionalAuth` middleware in `auth.js` passes `req.user = null` for guests; concept GET routes switched from `authenticateToken` to `optionalAuth`; all `req.user.userId` references in `conceptsController.js` made null-safe (pass `-1` for guests so `user_voted`/`user_linked` = false, `userSetIndex` = null). Frontend: `App.jsx` removes `ProtectedRoute` wrapper; `AppShell.jsx` shows "Log in / Sign up" header for guests, creates ephemeral local-only graph tabs (no DB persistence), hides saved tabs and groups; `Root.jsx`, `Concept.jsx`, `ConceptGrid.jsx`, `FlipView.jsx`, `SearchField.jsx` all accept `isGuest` prop — vote/save/move/swap/link buttons hidden or read-only for guests, "Add as child" and "Create as root" hidden. `AuthContext.jsx` exports `isGuest` boolean.
- **Search Surfacing Saved Tabs:** When a logged-in user searches, the backend cross-references search results against the user's saved edges via `votes` → `vote_tab_links` → `saved_tabs` → `edges`. Results appearing in saved tabs get a `savedTabs` array (with `tabId` and `tabName`). These results are sorted to the top. `SearchField.jsx` displays an "In your saved tabs" section header and green italic tab-name badges on matching results. Backend also now returns `exactMatch` boolean (was previously missing).
- **Ctrl+F Verification:** Verified browser-native Ctrl+F works on Root page, Concept page (children view), Flip View, and Saved tabs. No issues found — all rendered text is findable.
- **FlipView Navigation Fix (pre-existing bug from Phase 5c):** Clicking an alt parent card in Flip View was using URL-based `navigate()` which stopped working when everything moved to AppShell tab mode in Phase 5c. Fix: `Concept.jsx` now passes `onParentClick` callback to `FlipView.jsx` which calls `navigateInTab()` for proper in-tab navigation with nav history support. Falls back to URL navigation in standalone mode.
- **SearchField childAttributes Display Fix (pre-existing bug):** The `childAttributes` array from the backend contains raw strings (e.g., `"action"`) but `SearchField.jsx` was treating them as objects with `.attribute_name`, producing `child:undefined` badges. Fixed to handle both string and object formats.
Note: Multiple browser tabs. Users can open Orca in multiple browser tabs while staying logged in. Each browser tab has its own independent React state, so navigating in one does not affect the other. No shared-state mechanisms (localStorage broadcasts, BroadcastChannel, etc.) exist between tabs. This should work naturally — verify during testing.
Phase 6: Complete. All four sub-phases implemented:
- **Phase 6a:** Web Links Backend — `concept_links` and `concept_link_votes` database tables, 5 backend endpoints (getWebLinks, addWebLink, removeWebLink, upvoteWebLink, removeWebLinkVote) with optionalAuth on GET for guest access, frontend API methods.
- **Phase 6b:** External Links Page UI — `WebLinksView.jsx` component with upvote buttons, sort toggle, add form with URL validation, guest read-only mode. Accessible via 🔗 Links button in concept header bar (next to Flip View toggle). View mode `'links'` with proper nav history.
- **Phase 6c:** Flip View Cross-Context Links Compilation — `FlipLinksView.jsx` component showing all web links across ALL parent contexts grouped by parent edge. New backend endpoint `getAllWebLinksForConcept`. Current context highlighted and interactive; other contexts read-only. Accessible via 🔗 All Links button in Flip View header. View mode `'fliplinks'` with proper nav history.
- **Phase 6d:** Shareable Concept Links — 📋 Share button in concept header bar copies URL to clipboard with brief "✓ Copied!" feedback. Uses `navigator.clipboard.writeText` with legacy fallback. Frontend-only change.

### Implementation Order (Phase 6)
1. ~~Web Links Backend (Phase 6a)~~ ✅
2. ~~External Links Page UI (Phase 6b)~~ ✅
3. ~~Flip View Cross-Context Links (Phase 6c)~~ ✅
4. ~~Shareable Concept Links (Phase 6d)~~ ✅

### Implementation Order (Phase 4)
1. ~~Full-Path Save Model~~ ✅
2. ~~Sort by New~~ ✅
3. ~~Link Votes~~ ✅
4. ~~Flip View Similarity Percentage~~ ✅
5. ~~Move Votes~~ ✅
6. ~~Swap Votes~~ ✅
7. Vote Set Visualization & Filtering
   - ~~Layer 1: Swatches + Dots + Basic Filtering~~ ✅
   - ~~Layer 2: Tiered Display (toggle for ranked sections when multi-filtering)~~ ✅
   - ~~Layer 3: Vote Set Similarity Grouping (super-groups)~~ ✅

### Roadmap Summary
- **Phase 4:** Complete ✅
- **Phase 5a:** Basic Saved Page ✅
- **Phase 5b:** Saved Tabs ✅
- **Phase 5c-1:** Unified Tab Bar Shell ✅
- **Phase 5c-2:** Within-tab navigation, in-tab back button, nav history preserved across tab switches ✅
- **Phase 5c-3:** Search navigates current tab; Saved tree clicks open new tab ✅
- **Phase 5c-4:** Close tab polish, adjacent-tab switching, auto-create on last close, context menu fixes ✅
- **Phase 5d:** Tab Grouping ✅
- **Phase 5e:** Saved Tree Reordering ✅
- **Phase 5f:** Child Ordering Within Vote Sets ✅
- **Phase 5 misc:** Read-Only Guest Access, Search Surfacing Saved Tabs, Ctrl+F Verification ✅
- **Phase 5: COMPLETE** ✅
- **Phase 6:** External Links ✅ (6a: Web Links Backend, 6b: External Links Page UI, 6c: Flip View Cross-Context Links, 6d: Shareable Concept Links)
- **Phase 7a:** Corpus & Document Infrastructure ✅ (database tables, CRUD endpoints, document upload, browsing UI)
- **Phase 7b:** Duplicate Detection on Upload ✅ (pg_trgm similarity matching, two-step upload flow, unique name validation for corpuses and documents)
- **Phase 7c:** Corpus Subscriptions, Corpus Tabs & Saved Page Overhaul ✅ (7c-1: subscriptions backend, 7c-2: corpus tabs in main tab bar, 7c-3: saved page standalone overlay, 7c-4: cleanup)
- **Phase 7d-1 + 7d-2:** Annotation Infrastructure & Creation UI ✅ (database table with CHECK constraint + 3 indexes, 4 backend CRUD endpoints with permission checks, AnnotationPanel with concept search + root edge support + full path resolution, CorpusTabContent updated with annotation highlights + detail sidebar + text selection flow using DOM Range API)
- **Phase 7d-3 + 7d-4:** Annotation Display Polish & Bidirectional Linking ✅ (navigate-to-concept button in annotation sidebar, Document Annotations section on External Links page with corpus-grouped collapsible display + sort modes, pending document navigation pattern, corpus overlay redirected to corpus tab for annotation support, annotation loading race condition fix)
- **Phase 7d: COMPLETE** ✅
- **Phase 7e–7i:** Remaining corpus phases (~~7e: Decontextualized Document View~~, ~~7f: Color Set Selection & Voting on Annotations~~, ~~7g: Combined Public/Private Model with Allowed Users~~, ~~7h: Document Versioning~~, ~~7i: Live Concept Linking in Documents~~)
- **Phase 7e: COMPLETE ✅**
- **Phase 7f-1:** Annotation Voting ✅ (annotation_votes table, vote/unvote endpoints, endorsement counts on highlights and sidebar)
- **Phase 7f-2:** Color Set Voting + Corpus Tab Grouping + Document Persistence ✅ (annotation_color_set_votes table, color set picker in sidebar, corpus tabs joinable in tab groups via group_id on corpus_subscriptions, auto-group on navigate-to-concept, all corpus tabs rendered simultaneously with display:none for state persistence)
- **Phase 7f: COMPLETE ✅**
- **Phase 7g-1:** Allowed Users Infrastructure ✅ (corpus_allowed_users table, corpus_invite_tokens table, annotation_removal_log table, layer column on document_annotations, 10 new backend endpoints, updated createAnnotation/getDocumentAnnotations/deleteAnnotation for layer support, allowed users can add documents)
- **Phase 7g-2:** Allowed Users Management UI ✅ (CorpusDetailView: invite link generation/copy/revoke, allowed users list with remove, removal log viewer, fixed isOwner check to use actual user ID comparison, AcceptInvite.jsx page with /invite/:token route)
- **Phase 7g-3:** Layer Toggle & Private Annotations ✅ (CorpusTabContent: All/Public/Private layer filter toggle, private-layer annotation creation, green-tinted private highlights, layer badges in detail sidebar, AnnotationPanel updated to accept layer prop, checkAllowedStatus on corpus load, replaced annotation_mode badge with owner/allowed user badge)
- **Phase 7g: COMPLETE ✅**
- **Phase 7h:** Document Versioning ✅ (version_number/source_document_id columns on documents, backend endpoints with recursive CTE version chain, version history panel, version badges on document list and viewer. Note: `is_draft` column and draft/finalize logic removed in Phase 21a)
- **Phase 7h: COMPLETE ✅**
- **Phase 7i-1 + 7i-2:** Concept Linking in Documents — Backend Matching & Underline Display ✅ (new `POST /concepts/find-in-text` endpoint with whole-word regex matching, concept link underlines woven into document segments alongside annotations, click-to-open decontextualized Flip View via `onOpenConceptTab` with new `viewMode` parameter, `handleOpenConceptTab` accepts optional 6th `viewMode` parameter, AppShell wrapper passes `viewMode` through to handler)
- **Phase 7i-3:** Disambiguation Picker — SKIPPED ✅ (unnecessary under current data model; concept names are globally unique, decontextualized Flip View already shows all attribute contexts)
- **Phase 7i-4:** Live Concept Linking During Draft Editing & Upload ✅ (debounced 500ms `findConceptsInText` calls, concept link preview panels below draft textarea and upload textarea, buildConceptLinkSegments helper, concept links load after finalization)
- **Phase 7i-5:** Concept Link Caching for Finalized Documents ✅ (new `document_concept_links_cache` table, `GET /concepts/document-links/:documentId` endpoint, stale-check via `computed_at` vs `MAX(concepts.created_at)`, atomic cache replacement, `loadConceptLinks` updated to call cached endpoint by document ID)
- **Phase 7i: COMPLETE ✅**
- **Phase 7: COMPLETE ✅** — All sub-phases (7a through 7i) finished.
- **Phase 7c Saved Page Overhaul: COMPLETE ✅** — Saves auto-grouped by corpus via annotations, tab picker removed, new `saved_tree_order_v2` table, `saved_tabs`/`vote_tab_links` functionally retired
- **Post-Phase 7 cleanup: COMPLETE ✅** — Dead `savedTabs` code removed from AppShell, per-corpus document favoriting, search results surface corpus annotations
- **Phase 7h bug fix:** Version creation now adds new version to ALL corpuses the source document belongs to (not just the current corpus); `createVersion` no longer requires source document to be in the requesting corpus (supports cross-corpus version history navigation)
- **Phase 8a:** Saved Page Tab Activity Infrastructure ✅ (saved_page_tab_activity table with partial unique index for NULL corpus_id, backfill migration seeding existing users, 3 new endpoints: recordTabActivity/getTabActivity/reviveTabActivity, check-dormancy.js background job script, npm run check-dormancy command)
- **Phase 8b:** Save Count Exclusion ✅ (DORMANT_USERS_SUBQUERY constant in both conceptsController.js and votesController.js, dormancy filter applied to 13 save count queries: root page, children, current edge count ×2, flip view ×2, vote sets, addVote/removeVote/removeVoteFromTab response counts, getUserSaves ×2, getUserSavesByCorpus)
- **Phase 8c:** Dormancy UI ✅ (3 new API methods in api.js, SavedPageOverlay.jsx rewritten with: parallel load of saves+activity, activity recording on tab switch, dormant tabs dimmed to 45% opacity with gray "dormant" badge, revival modal with "Revive my votes"/"View without reviving", dormant info bar with inline revive button, allTabsDormant flag for context-aware messaging, smart initial tab selection skipping dormant tabs)
- **Phase 8: COMPLETE ✅**
- **Phase 9:** Corpus Deletion & Orphan Rescue — ✅ COMPLETE (9a: Subscriptions — already done in 7c, 9b: Corpus Deletion with orphan rescue for allowed users' documents)
- **Phase 10a:** Rename "Private" Layer to "Editorial" ✅ (database migration, backend visibility change, frontend filter/badge/highlight rename, editorial-layer voting restricted to allowed users)
- **Phase 10b:** Remove Corpus Creation Toggle ✅ (annotation_mode selector removed from creation form, mode badge removed from corpus cards)
- **Phase 10c:** Dormancy Warning on Login ✅ (warm amber banner on AppShell mount, clickable to open Saved Page, dismissable)
- **Phase 10: COMPLETE ✅**
- **Phase 11:** Sort by Annotation Count ✅ (dropdown sort selector with Saves/New/Annotations; conditional annotation JOIN on backend)
- **Phase 11: COMPLETE ✅**
- **Phase 12:** Nested Corpuses & Sidebar Redesign
  - **Phase 12a:** Nested corpus infrastructure ✅ (single-parent `parent_corpus_id` column, cycle prevention, 4 backend endpoints, `corpus_subscriptions.group_id` retired)
  - **Phase 12b:** Sidebar redesign ✅ (vertical sidebar replaces horizontal tab bar, three sections: CORPUSES / GRAPH GROUPS / GRAPHS, collapsible, "Saved" and "Browse" moved to sidebar)
  - **Phase 12c:** Graph tab placement in corpus tree ✅ (`user_corpus_tab_placements` table, styled corpus picker dropdown, mutual exclusion with flat groups)
  - **Phase 12d:** Corpus browsing UI updates ✅ (sub-corpuses section in CorpusDetailView with search/add/create/remove, parent path in CorpusListView)
  - **Phase 12e:** Sub-corpus expansion in sidebar ✅ (lazy-load children on expand, recursive rendering, cache, loading indicator)
- **Phase 13:** Cross-Annotation Path Linking ✅ (13-1: clickable ancestor annotations with resolvedPathIds, 13-2: descendant path extension with intermediate/branching support)
- **Phase 14:** Concept Diffing
  - **Phase 14a:** Basic Diff Modal ✅ (right-click context menu on ConceptGrid, `POST /batch-children-for-diff` endpoint, DiffModal.jsx with Shared/Similar/Unique grouping, Jaccard similarity with configurable threshold, search-to-add panes with context picker)
  - **Phase 14b:** Drill-Down Navigation ✅ (clickable child cards, per-pane drill stack with cached back-nav, breadcrumb trail, cross-level comparison)
  - **Phase 14c:** Cross-Level Selection ✅ (covered by 14b breadcrumbs; uneven depth alignment skipped by design)
- **Phase 15:** Bug Fixes & Quick Wins ✅ (15a: sidebar labels fixed, 15b: sub-corpus subscription blocked at backend+frontend, 15c: N/A after 15b, 15d: path duplication fixed in 4 files, 15e: move destination shows full path, 15f: root concepts as normal context cards in move modal)
- **Phase 16:** Moderation / Spam Flagging ✅ (concept_flags + concept_flag_votes + moderation_comments tables, is_hidden column on edges, 7 moderation endpoints, 13 queries filtered for hidden edges, HiddenConceptsView.jsx, flag option in context menu)
- **Phase 17:** Document Types / Tags ✅ (document_tags + document_tag_links tables, 5 tag endpoints, tag picker on upload, tag pills on doc cards, filter by tag, tag display in WebLinksView + 6 bug fixes)
- **Phase 18:** Flip View Shared Path Highlighting ✅ (hover-based contiguous shared segment detection across cards, `getSharedSegments` algorithm, `renderAncestorPath` with per-concept hoverable spans, warm amber highlights, no interference with card clicks)
- **Phase 19:** Sidebar Redesign & Sub-Corpus Removal ✅
  - **Phase 19a:** Sub-Corpus Removal ✅ (dropped `parent_corpus_id` column + index, removed 4 sub-corpus endpoints, removed cycle-prevention helper, cleaned up frontend sub-corpus UI from CorpusDetailView/CorpusListView/AppShell)
  - **Phase 19b:** Unified Sidebar Layout ✅ (new `sidebar_items` table, merged 3 sections into single unlabeled list, 2 new sidebar-items endpoints, `subscribe`/`unsubscribe` auto-manage sidebar_items rows, Promise.all fault-tolerance fix)
  - **Phase 19c:** Drag-and-Drop with @dnd-kit ✅ (new `SidebarDndContext.jsx`, `PointerSensor` with 8px activation, `SortableGroupWrapper` with header-only drag handle, optimistic reorder with rollback, warm amber drop targets)
  - **Phase 19d:** Cleanup & Migration Safety ✅ (dropped `corpus_subscriptions.group_id`, blocked corpus tabs from groups, removed auto-grouping on concept open, removed dead sidebar section styles)
- **Phase 20:** Graph & Vote Simplification ✅
  - **Phase 20a:** Single-Attribute Graphs ✅ (migration normalizes all edges per graph to most common attribute, `createChildConcept` auto-assigns root edge's attribute via `graph_path[0]`, attribute picker removed from child-add flow, `[bracket]` tags removed from 15+ components, attribute badges added to concept header/root cards/flip view cards/annotation cards)
  - **Phase 20b:** Remove Move Votes ✅ (dropped `side_votes` table, removed 3 move vote endpoints + handlers, removed `move_count` from children/root/saved queries, deleted `MoveModal.jsx`, removed → N indicators from ConceptGrid/SavedTabContent/Saved)
  - **Phase 20c:** Save/Swap Mutual Exclusivity ✅ (`addVote` deletes existing `replace_votes` for same user+edge, `addSwapVote` deletes existing save with cascading unsave, frontend optimistic state updates for cross-clearing)
  - **Phase 20d:** Annotation Sentence Expansion ✅ (WebLinksView fetches document bodies in parallel, `getAnnotationSentence` scans backward/forward to sentence boundaries with 200-char cap and ellipsis, annotated text rendered in `<strong>`)
  - **Bug fix:** Duplicate concept names in annotation path in `DecontextualizedDocView.jsx` — `graph_path` already includes parent as last element, removed extra `push` of `parentName` that caused doubling
- **Phase 21:** Document Experience Overhaul ✅
  - **Phase 21a:** Always-Editable Documents with Diff-and-Rebase ✅ (`diff-match-patch` installed, `is_draft` column dropped, `updateDraft`/`finalizeDraft` removed, new `adjustAnnotationOffsets` helper, new `POST /corpuses/documents/:id/edit` endpoint, Edit button for original uploader, draft badges/dashed borders removed)
  - **Phase 21b:** My Documents Section ✅ (collapsible "My Documents" section at top of corpus document lists in both CorpusTabContent and CorpusDetailView, tag filter applied, "All Documents" header added, guest-hidden)
  - **Phase 21c:** Version Consolidation ✅ (new `GET /documents/:id/version-chain` endpoint, `groupDocsByLineage` frontend helper, single card per version chain with vN badge, inline version navigator `← v1 | [v2] | v3 →`, WebLinksView version badges via `document_version_number`)
  - **Bug fix:** Tag filter not applied to My Documents section in CorpusTabContent — fixed to filter after lineage grouping
- **Phase 22:** File Upload Workflow & Document-Level Annotations ✅
  - **Phase 22a:** File Upload Workflow ✅ (multer/pdf-parse v1.1.1/mammoth backend, drag-and-drop upload UI in CorpusTabContent + CorpusDetailView, 10MB file size limit, edit endpoint + diff-match-patch removed, version upload via file, loading spinner, error display)
  - **Phase 22b:** Document-Level Annotations ✅ (quote_text/comment/quote_occurrence columns replace start_position/end_position, buildAnnotatedBody removed, floating 📌 text-selection shortcut, TreeWalker-based quote navigation with fade-out highlights, concept detection panel with step-through ‹n/total› navigator + case-insensitive matching, persistent underlines removed, AnnotationPanel complete redesign)
  - **Bug fixes:** database.js process.exit(-1) removed from pg pool error handler; pdf-parse downgraded v2→v1.1.1; window.document shadowing fix in navigateToQuote
- **Phase 23 (formerly):** ~~User-Generated Attributes~~ ❌ CANCELLED — replaced by owner-controlled attribute enablement in Phase 25e
- **Phase 23:** Vote Set Drift Tracking ✅(23a append-only vote_set_changes event log with save/unsave logging in addVote, removeVote, and addSwapVote cascades; 23b drift reconstruction endpoint replaying events to detect departed users and grouping by current set; 23c hover popover on vote set swatches showing top departure destinations with +added/−removed diffs, popover only renders on the swatch matching the current user's set; renumbered from Phase 24 after Phase 23 user-generated attributes was cancelled)
- **Phase 25:** Document & Browse Experience Improvements ✅
  - **Phase 25a:** Single Tag Per Document ✅ (direct `tag_id` column on documents, `document_tag_links` junction table dropped, uploader-only permission, recursive CTE version chain propagation, `createVersion` inherits tag)
  - **Phase 25e:** Value-Only Launch Mode ✅ (all edges migrated to value, `ENABLED_ATTRIBUTES` env var, `getAttributes` filters by enabled, auto-assign single attribute on root creation, `.env.example` created)
  - **Phase 25b:** Root Page Attribute Filter ✅ (All/Action/Tool/Value toggle, default Value, `localStorage` persistence, hidden when single attribute enabled)
  - **Phase 25c:** Author Annotation View & Author-Only Versioning ✅ (fourth layer filter "Author" via subquery, visible to all users, version creation restricted to `uploaded_by`, public/editorial layer badges on collapsed headers)
  - **Phase 25d:** WebLinksView Annotation Cleanup & Surfaced Sections ✅ (`getAnnotationSentence` rewritten for quote_text/quoteOccurrence model, shared `renderAnnotations` helper, My Documents section, Documents in My Corpuses section with subscription filtering, guest-hidden)

- **Phase 26:** Annotation Model Overhaul ✅
  - **Phase 26a:** Co-Author Infrastructure ✅ (document_authors/document_invite_tokens tables, lineage-level co-authorship via root document, invite acceptance, co-author management UI, version creation permission update)
  - **Phase 26b:** Corpus Member UI Simplification ✅ (count-only public display, owner-only username visibility — *relaxed in Phase 28e: all members see usernames*, leave corpus, retire display name and removal log)
  - **Phase 26c:** Annotation Permanence + Auto-Vote + Cleanup ✅ (delete endpoint returns 410, remove deletion UI, remove editorial voting restriction, remove color set voting)
  - **Phase 26d:** New Filter Model (Backend) ✅ (identity-based filtering — All/Corpus Members/Author via query-time identity resolution, provenance badges, legacy layer mapping)
  - **Phase 26e:** New Filter Model (Frontend) ✅ (filter toggle, provenance badges, auto-jump on creation)
- **Phase 27:** Annotations Panel Overhaul + Admin-Controlled Document Tags ✅
  - **Phase 27a:** Two-Column Layout + View Mode Retirement ✅ (65/35 flex split on concept page, `ConceptAnnotationPanel.jsx` with Annotations|Web Links tab toggle, deleted `WebLinksView.jsx` and `FlipLinksView.jsx`, retired `'links'`/`'fliplinks'` view modes, removed 🔗 buttons from concept header and FlipView, migration updates stale graph_tabs view_mode rows)
  - **Phase 27b:** Cross-Context Annotation Endpoint + Panel Rendering ✅ (`GET /api/concepts/:id/annotations` aggregating across all edges via `child_id`, flat vote-sorted list with context provenance, document title + corpus name + path, Web Links tab via existing `getAllWebLinks` flattened, read-only vote counts, sort toggle Top|New, children view scoped to current edge via `?edgeId=N`, flip view shows all contexts)
  - **Phase 27c:** Tag Filter + My Corpuses Filter + Annotation Navigation ✅ (My Corpuses checkbox toggle with corpus name pills, tag filter pills, composable `?corpusIds=` + `?tagId=` params, annotation card click-through with auto-subscribe + pending annotation scroll-to, guest click-through originally via DecontextualizedDocView overlay — *updated Phase 28: guests now see login modal*, bug fixes: creation panel opening on click-through, wrong document shown for same-corpus navigation)
  - **Phase 27d:** Responsive Layout ✅ (vertical stacking below 900px via `matchMedia`, collapsible "Annotations & Links" header defaulting collapsed on narrow, top border replaces left border)
  - **Phase 27e:** Admin-Controlled Document Tags ✅ (`POST /tags/create` → 410 Gone, `ENABLED_DOCUMENT_TAGS` env var filtering on `GET /tags`, 9 initial tags seeded in migrate.js, "Create new tag" UI removed from CorpusTabContent)
- **Phase 28:** Visual Polish, UI Cleanup & Bug Fixes ✅ COMPLETE
  - **Phase 28a:** Visual Cleanup — Icons, Fonts, Colors ✅ (all emoji icons removed from UI chrome, EB Garamond applied everywhere via Google Fonts import + explicit fontFamily, all colored buttons converted to black-on-off-white Zen aesthetic, all italics removed, × close buttons kept)
  - **Phase 28b:** UI Removals — Ranking & Supergroups ✅ (child rankings UI removed, Layer 3 super-groups removed, ranking cleanup queries cleaned up in removeVote/removeVoteFromTab/addSwapVote)
  - **Phase 28c:** Rename & Title Changes ✅ ("Saved" → "Graph Votes" across all user-facing text in AppShell/SavedPageOverlay/Saved/SavedTabContent, sort dropdown "↓ Saves" → "↓ Votes", SwapModal/VoteSetBar/ConceptGrid/AnnotationPanel "saves" → "votes", FlipView badge "Saved" → "Voted", browser tab title "Concept Hierarchy" → "orca")
  - **Phase 28d:** Bug Fixes ✅ (decontextualized doc view buildAnnotatedBody rewritten for quote_text model with always-visible annotation sidebar, document search excludes superseded versions, root flip view toggle/share/search no longer hidden by isDecontextualized guard, duplicate PrePrint tag fixed with exact match + case-insensitive unique index + migration cleanup, annotation lists sorted by vote_count descending with vote_count subquery in getAllDocumentAnnotations)
  - **Phase 28e:** Corpus Member Visibility Update ✅ (all corpus members see usernames via isMember check including corpus_allowed_users, invite links and remove buttons remain owner-only, Leave button for non-owner members, non-members see count only)
  - **Phase 28f:** Login Panel Redesign ✅ (LoginModal.jsx with Log In/Sign Up tabs, /login and /register routes → redirect to /, AcceptInvite and DocInviteAccept show login modal for guests, Login.jsx and Register.jsx retained but unused)
  - **Phase 28g:** Expand Concept Name Character Limit ✅ (concepts.name and document_concept_links_cache.concept_name widened to VARCHAR(255) via idempotent ALTER TABLE, backend validation changed from >40 to >255, frontend SearchField and AnnotationPanel maxLength changed to 255)
  - **Phase 28 additional fixes:** DecontextualizedDocView and DocumentPage removed entirely (deleted files, removed /documents/:id route, removed getAllDocumentAnnotations from api.js); guest annotation clicks open login modal; child count singular/plural fix (pg COUNT string wrapping); swap button tooltip added; dormancy banner orphaned activity rows fix (EXISTS subquery filters); ConceptAnnotationPanel 14px horizontal padding added

### Git Commits (Phase 27)
1. `feat: 27a, two-column concept layout with annotation panel stub, retire links/fliplinks view modes and WebLinksView/FlipLinksView`
2. `feat: 27b, cross-context annotation endpoint and panel rendering with annotations + web links tabs`
3. `feat: 27c, tag filter + My Corpuses filter + auto-subscribe annotation navigation in concept annotation panel`
4. `feat: 27d, responsive layout — vertical stacking on narrow screens with collapsible annotation panel`
5. `feat: 27e, admin-controlled document tags — retire creation endpoint, add ENABLED_DOCUMENT_TAGS env var, seed initial tags, remove create UI`

### Git Commits (Phase 28)
1. `feat: 28a, visual cleanup — remove all emoji icons, apply EB Garamond everywhere, convert colored buttons to black-on-off-white Zen aesthetic, remove all italics`
2. `feat: 28b, retire child rankings and super-groups, clean up ranking queries`
3. `feat: 28c, rename Saved to Graph Votes, saves to votes, browser tab title to orca`
4. `fix: 28d, decontextualized doc view buildAnnotatedBody rewrite, document search version exclusion, root flip view toggle fix, duplicate PrePrint tag fix, annotation sort by vote count`
5. `feat: 28e, corpus member username visibility — all members see usernames, owner-only invite/remove`
6. `feat: 28f, login modal replaces login/register pages — LoginModal.jsx, route redirects, invite acceptance modal`
7. `feat: 28g, expand concept name limit 40→255 — VARCHAR(255) migration, backend/frontend validation update`
8. `feat: 28 cleanup, remove DecontextualizedDocView and DocumentPage, guest annotation login modal, child count fix, dormancy banner fix, annotation panel padding`

### Git Commits (Phase 2)
1. `feat: display total users on root page and edge vote count on concept page`
2. `feat: add root edges so root concepts support voting`
3. `feat: browser back button integration for flip view`
4. `feat: flip view path grouping with trie-based shared segment detection`
5. `refactor: simplify flip view to flat vote-sorted cards, remove trie grouping`
6. `feat: add combined search/add field with pg_trgm fuzzy matching`
7. `fix: hide breadcrumb and view toggle in decontextualized flip view`

### Git Commits (Phase 3)
1. `feat: add attribute system (action, tool, value) with required selection on concept creation`

### Git Commits (Phase 4)
1. `feat: full-path save model with cascading unsave`
2. `feat: sort by new option on root and concept pages`
3. `feat: add link votes (similarity votes) in contextual Flip View`
4. `feat: add Jaccard similarity percentage to contextual Flip View`
5. `feat: add move votes with destination modal, search, and mini graph browser`
6. `feat: add swap votes with sibling selection modal`
7. `feat: add vote set visualization with color swatches, dots, and basic filtering`
8. `feat: add tiered display toggle for multi-set vote filtering (Layer 2)`
9. `feat: add vote set similarity grouping with super-groups (Layer 3)`

### Implementation Order (Phase 5)
1. ~~Basic Saved Page (Phase 5a)~~ ✅
2. ~~Saved Tabs (Phase 5b)~~ ✅
3. In-App Navigation Tabs (Phase 5c)
   - ~~5c-1: Unified tab bar shell, graph_tabs DB, AppShell architecture~~ ✅
   - ~~5c-2: Within-tab navigation, in-tab back button, nav history preserved across tab switches~~ ✅
   - ~~5c-3: Search navigates current tab; Saved tree clicks open new tab~~ ✅
   - ~~5c-4: Polish — close graph tabs, adjacent-tab switching, auto-create, context menu fixes~~ ✅
4. ~~Tab Grouping (Phase 5d)~~ ✅
5. ~~Saved Tree Reordering (Phase 5e)~~ ✅
6. ~~Child Ordering Within Vote Sets (Phase 5f)~~ ✅
7. ~~Ctrl+F Verification~~ ✅
8. ~~Read-Only Guest Access~~ ✅
9. ~~Search Surfacing Saved Tabs~~ ✅ (corpus annotation surfacing deferred to Phase 7)

### Git Commits (Phase 5)
1. `feat: add Saved Page with tree display, unsave, and navigation (Phase 5a)`
2. `feat: add Saved Tabs with tab bar, create/rename/delete, per-tab saves (Phase 5b)`
3. `feat: add unified tab bar with persistent graph tabs (Phase 5c-1)`
4. `feat: within-tab navigation with back button and tab state persistence (Phase 5c-2)`
5. `feat: search results navigate within current graph tab (Phase 5c-3)`
6. `feat: polish graph tab close behavior, context menus, auto-create (Phase 5c-4)`
7. `feat: add tab grouping with named expandable groups (Phase 5d)`
8. `feat: add saved tree reordering with persistent order (Phase 5e)`
9. `feat: add child ordering within vote sets with ranking dropdown (Phase 5f)`
10. `feat: add read-only guest access, search surfacing saved tabs, Ctrl+F verification, FlipView nav fix (Phase 5 misc)`

### Git Commits (Phase 6)
1. `feat: add external web links with upvote system (Phase 6a + 6b)`
2. `feat: add cross-context links compilation in Flip View (Phase 6c)`
3. `feat: add shareable concept links with copy to clipboard (Phase 6d)`

### Git Commits (Phase 7)
1. `feat: add corpus and document infrastructure with CRUD endpoints and UI (Phase 7a)`
2. `feat: add duplicate document detection on upload (Phase 7b)`
3. `fix: stray brace in Concept.jsx; add unique name validation for corpuses and documents`
4. `feat: add corpus subscriptions with persistent corpus tabs in tab bar (Phase 7c-1 + 7c-2)`
5. `feat: move saved page to standalone overlay, remove saved tabs from main tab bar (Phase 7c-3 + 7c-4)`
6. `feat: add document annotations with text selection, concept search, and highlight display (Phase 7d-1 + 7d-2)`
7. `feat: add annotation navigation and bidirectional linking on External Links page (Phase 7d-3 + 7d-4)`
8. `feat: add decontextualized document view, add-existing-document UI, document search endpoint (Phase 7e)`
9. `feat: add annotation voting with endorsement counts (Phase 7f-1)`
10. `feat: add annotation color set voting, persist corpus tab state, auto-group concept tabs (Phase 7f-2)`
11. `feat: corpus tabs joinable in tab groups, auto-group on navigate-to-concept, persist document on tab switch`
12. `feat: add allowed users infrastructure with invite tokens, layer column, and removal log (Phase 7g-1)`
13. `feat: add allowed users management UI with invite links, member list, and removal log (Phase 7g-2)`
14. `feat: add invite acceptance page and route for allowed user onboarding (Phase 7g-2 complete)`
15. `feat: add layer toggle, private annotations, and visual layer indicators in corpus tabs (Phase 7g-3)`
16. `feat: add document versioning with draft editing and version history (Phase 7h)`
17. `feat: add concept linking in documents with underline display and flip view navigation (Phase 7i-1 + 7i-2); fix version creation across corpuses`
18. `feat: add live concept linking during draft editing and document upload (Phase 7i-4)`
19. `feat: add concept link caching for finalized documents (Phase 7i-5)`
20. `feat: saved page overhaul — auto-group saves by corpus via annotations (Phase 7c overhaul)`
21. `chore: remove dead savedTabs state and tab picker code from AppShell`
22. `feat: add per-corpus document favoriting with star button`
23. `feat: surface corpus annotations in search results alongside saved tabs`

### Git Commits (Phase 8)
1. `feat: add saved page tab activity table and dormancy endpoints (Phase 8a)`
2. `feat: exclude dormant users from all save count queries (Phase 8b)`
3. `feat: add dormancy UI with dimmed tabs, revival modal, and activity tracking (Phase 8c)`
4. `fix: context-aware dormancy messaging — only claim votes excluded when all tabs dormant`

### Git Commits (Phase 10)
1. `feat: rename private annotation layer to editorial, make visible to all users (Phase 10a)`
2. `feat: remove annotation mode toggle from corpus creation (Phase 10b)`
3. `feat: add dormancy warning banner on login (Phase 10c)`

### Git Commits (Phase 12)
1. `feat: add nested corpus infrastructure with single-parent tree model (Phase 12a)`
2. `feat: replace horizontal tab bar with vertical sidebar (Phase 12b)`
3. `feat: add graph tab placement inside corpus tree with styled picker (Phase 12c)`
4. `fix: rename sidebar section headers to CORPUSES / GRAPH GROUPS / GRAPHS`
5. `feat: add sub-corpus management UI in corpus detail view (Phase 12d)`
6. `feat: add sub-corpus expansion in sidebar with lazy loading (Phase 12e)`

### Git Commits (Phase 13)
1. `feat: add cross-annotation path linking with clickable ancestors and descendant extension (Phase 13)`

### Git Commits (Phase 14)
1. `feat: add concept diff modal with right click entry, batch children endpoint, and three-group comparison (phase 14a)`
2. `feat: add drill-down navigation in diff modal with per-pane breadcrumbs and cross-level comparison (phase 14b)`

### Git Commits (Phase 15)
1. `fix: Phase 15 bug fixes — sidebar labels, sub-corpus subscription, path duplication, move modal root cards`

### Git Commits (Phase 18)
1. `feat: add hover-based shared path highlighting in Flip View (Phase 18)`

### Git Commits (Phase 19)
1. `feat: remove sub-corpus infrastructure (Phase 19a)`
2. `feat: unified sidebar layout with sidebar_items table (Phase 19b)`
3. `feat: add drag-and-drop sidebar reordering with @dnd-kit (Phase 19c)`
4. `feat: cleanup — drop corpus_subscriptions.group_id, remove auto-grouping and dead sidebar code (Phase 19d)`

### Git Commits (Phase 20)
1. `feat: 20a, single-attribute graphs — auto-assign graph attribute to child edges from root; remove [bracket] attribute tags everywhere; add attribute badges in concept header, root cards, and flip view; skip attribute picker for child creation`
2. `feat: 20b, remove move votes — drop side_votes table, remove all move vote endpoints, handlers, and UI (MoveModal, move count indicators, ConceptGrid move button)`
3. `feat: 20c, save/swap mutual exclusivity — save removes swap vote; swap vote removes save (with cascade); frontend optimistically reflects cross-clearing`
4. `feat: 20d, annotation sentence expansion in external links — show full sentence context for annotations in WebLinksView, with annotated text bolded; 200-char scan cap with ellipsis`
5. `fix: duplicate concept names in annotation path display in DecontextualizedDocView — graph_path already includes parent, removed extra push`

### Git Commits (Phase 21)
1. `feat: 21a, always-editable documents with diff-and-rebase — remove draft/finalize, add annotation offset adjustment via diff-match-patch`
2. `feat: 21b, add My Documents section at top of corpus document lists`
3. `feat: 21c, version consolidation on document cards with inline version navigation`

### Git Commits (Phase 22)
1. `feat: 22a-1, backend file upload with multer/pdf-parse/mammoth, remove edit endpoint and diff-match-patch`
2. `feat: 22a-2, file upload UI with drag-and-drop, remove text editor and edit button`
3. `feat: 22a-3, PDF/DOCX extraction verified, upload loading indicator, 10MB file size limit, error display`
4. `fix: remove process.exit(-1) from database.js pg pool error handler`
5. `fix: downgrade pdf-parse from v2.4.5 to v1.1.1 for Node.js CJS compatibility`
6. `feat: 22b-1, migrate annotations from offset-based to document-level with quote_text and comment`
7. `feat: 22b-2, document-level annotation UI with quote/comment fields, text selection shortcut, basic quote navigation`
8. `fix: window.document shadowed by React state variable — use window.document.* for DOM API calls`
9. `feat: 22b-3, concept detection panel with step-through occurrence navigation, case-insensitive matching, persistent underlines removed`

### Git Commits (Phase 23)
1. `feat: 23a, vote set drift event log table and save/unsave logging`
2. `feat: 23b, vote set drift reconstruction endpoint with departure grouping`
3. `feat: 23c, vote set drift UI with hover popover on swatches showing departure destinations`

### Git Commits (Phase 25)
1. `feat: 25a, single tag per document — migrate to direct tag_id column, drop junction table, restrict tag changes to uploader`
2. `feat: 25e, value-only launch mode — migrate all edges to value attribute, add ENABLED_ATTRIBUTES env var, auto-assign when single attribute`
3. `feat: 25b, root page attribute filter with localStorage persistence, hidden when single attribute enabled`
4. `feat: 25c, author annotation view for all users, restrict version creation to document uploader`
5. `feat: 25d, fix annotation display in WebLinksView for document-level model, add My Documents and My Corpuses surfaced sections`

### Git Commits (Phase 26)
1. `feat: 26a, co-author infrastructure — document_authors and document_invite_tokens tables, root document lookup utility, co-author management endpoints, invite acceptance route, co-author UI in document viewer, version creation permission update`
2. `fix: use recursive CTE for root document lookup in createVersion — fixes duplicate version numbers in deep chains`
3. `feat: 26b, corpus member UI simplification — count-only public display, owner-only username visibility, leave corpus, retire display name and removal log`
4. `feat: 26b, add members panel and delete corpus button to CorpusTabContent`
5. `feat: 26c-1, annotation permanence and auto-vote on creation — delete endpoint returns 410, remove deletion UI, remove editorial voting restriction`
6. `feat: 26c-2, remove annotation color set voting — endpoints return 410, remove frontend UI and API methods`
7. `feat: 26d, identity-based annotation filtering — rewrite getDocumentAnnotations with ?filter=all|corpus_members|author, provenance badges, legacy ?layer= mapping, remove layer restrictions`
8. `feat: 26e-1, new annotation filter toggle (All/Corpus Members/Author) with provenance badges, remove all editorial/public layer references`
9. `fix: document lineage grouping with gaps — backend computes root_document_id via recursive CTE, frontend uses it for reliable grouping and My Documents filtering`
10. `feat: 26e-2, auto-jump annotation filter to matching view on creation, add isAuthor/isCorpusMember flags to annotations response`
11. `feat: 26e-3, co-author display polish and final cleanup audit — remove stale layer/color-set/delete references`

### Phase 31: Annotation Messaging (31a–d COMPLETE)

Private messaging system anchored to annotations. Every thread is a group chat between a document's **author group** (uploader + coauthors) and one **external user**. Two initiation modes, one unified thread model.

#### Design Spec

**Core concept:**
Messaging is always about a specific annotation on a specific document. There are two ways to start a thread:

1. **"Message author(s)"** — any user (who is not the sole author of the document) clicks this on an annotation to start a conversation with the document's author group. Coauthors can also use this on their own documents, creating an author group chat about an annotation.
2. **"Message annotator"** — any document author clicks this on an annotation to reach out to the annotation's creator. The thread includes the full author group + the annotator. Only visible when the annotation creator is NOT already a coauthor (because if they are, the participant group would be identical to "Message author(s)").

**Thread identity:**
A thread is uniquely identified by `(annotation_id, external_user_id, thread_type)`. The `external_user_id` is the one participant who isn't in the author group — either the person who messaged the authors, or the annotator being contacted. Thread types: `to_authors` and `to_annotator`.

**Participant rules:**
- Participants = author group (derived at query time from `documents.uploaded_by` + `document_authors` via root document lookup) + `external_user_id`
- No explicit participants table — participants computed at query time, consistent with how coauthor identity works elsewhere
- New coauthors automatically gain access to all existing threads on that document (query-time computation). The UI should warn when adding a coauthor that they will see all existing message threads.
- Any participant can send messages in a thread they belong to

**Button visibility rules per annotation:**
- **Already a participant in any thread for this annotation** → Show **"View threads"** button that deep-links to the Messages page filtered to that annotation. No initiation buttons shown.
- **Not a participant + not the sole author viewing their own doc** → Show **"Message author(s)"** button
- **Not a participant + is a document author + annotation creator is NOT a coauthor** → Also show **"Message annotator"** button
- **Sole author viewing their own document** → No "Message author(s)" button (no point messaging yourself). Only "Message annotator" for annotations by non-authors.

**Messages page (sidebar navigation):**
Accessed from the sidebar alongside Browse, Graph Votes, and Saved. Page-by-page drill-down with three levels:

1. **Documents level (top):** Two collapsible sections — "My Documents" and "Others' Documents" — both expanded by default. Documents listed inline within each section with unread count badges. Users can click a document directly without an extra navigation step.
2. **Annotations level:** Within a document, list of annotations that have threads. Each shows concept breadcrumb path (parent path with bold concept name), quote text, and comment, plus unread count.
3. **Threads level:** Within an annotation, individual threads with specific users. Click into one to open the chat view.

The "View threads" button on annotation cards deep-links directly to the annotation's threads level in the Messages page.

**Unread tracking:**
- Total unread count displayed on the Messages sidebar button
- Subtotals bubble up at each drill-down level: per-document, per-annotation, per-thread
- Tracked via `last_read_at` timestamp per user per thread — messages with `created_at > last_read_at` are unread
- Reading a thread updates `last_read_at` to current time

#### Database Tables (Phase 31)

**`message_threads`** — Links an annotation to a conversation thread.

```sql
CREATE TABLE message_threads (
  id SERIAL PRIMARY KEY,
  annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
  external_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  thread_type VARCHAR(20) NOT NULL CHECK (thread_type IN ('to_authors', 'to_annotator')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(annotation_id, external_user_id, thread_type)
);

CREATE INDEX idx_message_threads_annotation ON message_threads(annotation_id);
CREATE INDEX idx_message_threads_external_user ON message_threads(external_user_id);
```

Key points:
- `annotation_id` scopes the thread to a specific annotation (which itself is scoped to a corpus + document)
- `external_user_id` is the one participant outside the author group — either the person who clicked "Message author(s)" or the annotator being contacted via "Message annotator"
- `thread_type` distinguishes the two initiation modes: `'to_authors'` (outsider → author group) or `'to_annotator'` (author group → annotator)
- `UNIQUE(annotation_id, external_user_id, thread_type)` prevents duplicate threads
- `created_by` tracks who initiated the thread (may differ from `external_user_id` for `to_annotator` threads, where an author initiates but the annotator is the external user)
- `ON DELETE CASCADE` from `document_annotations` — if an annotation is somehow removed (currently annotations are permanent, but future-proofing), threads go with it
- Participants are NOT stored explicitly — derived at query time: author group (root doc's `uploaded_by` + `document_authors`) UNION `external_user_id`

**`messages`** — Individual messages within a thread.

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at);
```

Key points:
- `body` is the message text content (plain text, no markdown)
- `sender_id` must be a valid participant (author group member or external user) — enforced at application level
- `ON DELETE CASCADE` from `message_threads` ensures cleanup
- Compound index on `(thread_id, created_at)` for efficient chronological message loading
- Messages are append-only — no editing or deletion (consistent with Orca's append-only philosophy)

**`message_read_status`** — Tracks read state per user per thread.

```sql
CREATE TABLE message_read_status (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id, user_id)
);

CREATE INDEX idx_message_read_status_user ON message_read_status(user_id);
```

Key points:
- `last_read_at` timestamp — any message in the thread with `created_at > last_read_at` is unread for this user
- Row is upserted when a user opens a thread (set `last_read_at = NOW()`)
- If no row exists for a user+thread, all messages in that thread are unread for them
- Unread counts at each hierarchy level computed by aggregating across threads the user participates in
- `ON DELETE CASCADE` from both `message_threads` and `users` ensures cleanup

#### API Endpoints (Phase 31)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/messages/threads/create` | Required | Create a new thread — params: `annotation_id`, `thread_type`, `body` (first message). Backend derives `external_user_id` from context. Returns thread with first message. |
| GET | `/api/messages/threads` | Required | Get all threads for the current user, grouped by document → annotation. Returns unread counts at each level. Accepts `?section=my_docs|others_docs` filter. |
| GET | `/api/messages/threads/:threadId` | Required | Get a single thread with all messages (chronological). Automatically updates `last_read_at`. |
| POST | `/api/messages/threads/:threadId/reply` | Required | Send a message in an existing thread — params: `body`. Returns the new message. |
| GET | `/api/messages/threads/:threadId/messages` | Required | Get messages for a thread with pagination — `?before=timestamp&limit=50`. For loading older messages. |
| GET | `/api/messages/unread-count` | Required | Get total unread message count for the current user (for sidebar badge). |
| GET | `/api/messages/annotations/:annotationId/status` | Required | Check if the current user is a participant in any thread for this annotation — returns thread IDs or empty (for button display logic). |

Authorization middleware: every endpoint validates that the requesting user is a participant in the thread (author group member or external user). Thread creation validates initiation permissions (not sole author for `to_authors`; must be author for `to_annotator`).

#### Frontend Components (Phase 31)

New files:
- `MessagesPage.jsx` — Top-level Messages page with "My Documents" / "Others' Documents" sections and drill-down navigation (Phase 31b — DONE)
- `MessageThread.jsx` — Chat-style conversation view for a single thread (Phase 31c — DONE)
- `backend/src/controllers/messagesController.js` — All messaging endpoints (Phase 31a — DONE)
- `backend/src/routes/messages.js` — Route definitions (Phase 31a — DONE)

Modified files:
- `AppShell.jsx` — Add "Messages" sidebar item with unread badge, Messages page rendering, `refreshUnreadCount` callback, immediate badge refresh on thread back-navigation (Phase 31b/d — DONE)
- `CorpusTabContent.jsx` — Annotation messaging buttons, coauthor warning, version annotation map loading, version navigation buttons on annotation cards (Phase 31c/d — DONE)
- `frontend/src/services/api.js` — New `messagesAPI` and `documentsAPI.getVersionAnnotationMap` methods (Phase 31a/d — DONE)
- `backend/src/config/migrate.js` — Three new tables (Phase 31a — DONE)
- `backend/src/server.js` — Register messages routes (Phase 31a — DONE)
- `backend/src/controllers/corpusController.js` — Annotation copy in `createVersion`, deduplication in `getAnnotationsForEdge`, new `getVersionAnnotationMap` endpoint (Phase 31d — DONE)
- `backend/src/controllers/conceptsController.js` — Deduplication in `getAnnotationsForConcept` (Phase 31d — DONE)
- `backend/src/controllers/messagesController.js` — Version-aware `getAnnotationStatus` and `getThreads` with lineage CTEs (Phase 31d — DONE)
- `backend/src/routes/documents.js` — New `/:id/version-annotation-map` route (Phase 31d — DONE)

#### Implementation Plan

**Phase 31a — Database & Backend API (COMPLETE):**
- Migration for `message_threads`, `messages`, `message_read_status` tables
- `messagesController.js` with all 7 endpoints: create thread, get threads (hierarchical grouped by document → annotation with unread counts, `?section` filter), get single thread (auto-marks read), reply, paginated messages (`?before&limit`), unread count, annotation participation status
- Authorization on every endpoint validates participant status (query-time from author group + external_user_id via root document CTE)
- Root document lookup reuses existing `getRootDocumentId` / `isDocumentAuthor` from `utils/documentLineage.js`
- Route definitions in `routes/messages.js`, registered in `server.js`
- Frontend `messagesAPI` methods added to `api.js` for all 7 endpoints

**Phase 31b — Messages Page UI (COMPLETE):**
- `MessagesPage.jsx` with three-level drill-down: documents (with collapsible sections) → annotations → threads
- Top level shows two collapsible sections ("My Documents" / "Others' Documents"), both expanded by default, with documents listed inline for direct access
- Annotations level shows concept breadcrumb path (parent path with bold concept name), quote text, and comment
- Unread count badges at every drill-down level (section, document, annotation, thread)
- "Messages" sidebar button in `AppShell.jsx` with total unread badge (polled every 60s)
- Back navigation at each level, proper overlay toggling with all other sidebar items
- Zen aesthetic: EB Garamond throughout, neutral dark unread badges, no colored buttons/emoji/italics

**Phase 31c — Thread View & Annotation Buttons (COMPLETE):**
- `MessageThread.jsx` — chat-style UI with chronological messages, sender usernames, timestamps, reply bar with Enter-to-send (Shift+Enter for newlines), auto-scroll to bottom
- Auto-mark-as-read when opening a thread (backend upserts `last_read_at` on GET `/threads/:threadId`)
- Annotation messaging buttons in `CorpusTabContent.jsx` with four visibility conditions: already-participant shows "View threads" (deep-links to annotation's threads level in Messages page); non-sole-author shows "Message author(s)"; document author seeing non-coauthor annotation shows "Message annotator"; sole author sees neither initiation button
- Inline compose box with textarea, Send/Cancel buttons for thread creation
- `getThreads` backend query enhanced to join `edges`/`concepts` tables for annotation concept name and graph_path, with batch resolution of path IDs to concept names
- Deep-link navigation: "View threads" button passes `initialAnnotationId` through AppShell → MessagesPage, which auto-navigates to the matching annotation's threads level

**Phase 31d — Polish, Version-Aware Threads & Annotation Copy (COMPLETE):**
- Version-aware thread display: `getThreads` and `getAnnotationStatus` use lineage CTEs to group threads across document versions by annotation equivalence (same `edge_id` + same `quote_text`)
- **Annotation copy on version creation (gap fix):** `createVersion` now copies all `document_annotations` rows and their `annotation_votes` from source to new version via INSERT...SELECT within the existing transaction. Does NOT copy `message_threads` (threads remain anchored to original annotations). Without this, version-aware thread display and annotation navigation had nothing to match against on new versions.
- **Cross-version annotation deduplication:** `getAnnotationsForEdge` and `getAnnotationsForConcept` now deduplicate across version chains using `ROW_NUMBER() OVER (PARTITION BY root_document_id, corpus_id, created_by, quote_text ORDER BY version_number DESC)` — only the most recent version's annotation is returned. Per-document view (`CorpusTabContent`) is NOT deduplicated (shows all annotations for the specific version).
- **Version navigation buttons on annotation cards:** When viewing a document with multiple versions, annotation cards show "← v1" / "v3 →" buttons if equivalent annotations exist on adjacent versions. Clicking navigates to that version and scrolls to the quote. Powered by new `GET /api/documents/:id/version-annotation-map` endpoint.
- New endpoint: `GET /api/documents/:id/version-annotation-map` — returns lightweight annotation fingerprints `{document_id, version_number, edge_id, quote_text}` across all versions in a document's lineage via bidirectional recursive CTE
- Coauthor change warning ("New coauthors will see all existing message threads on this document")
- Empty states for Messages page ("No message threads yet") and thread view ("No messages yet")
- Relative timestamp formatting ("2m ago", "3h ago", "Yesterday", "Mar 15") with date separators in thread view
- Sidebar unread badge immediate refresh on thread back-navigation (no wait for 60s poll)
- End-to-end testing: 22/22 tests passed for 31d features

#### Architecture Decisions (Phase 31)

- **No explicit participants table:** Thread participants are derived at query time from the document's author group (`documents.uploaded_by` + `document_authors` via root document CTE) plus `message_threads.external_user_id`. This is consistent with how coauthor identity works for annotation filtering (Phase 26d) and ensures new coauthors automatically gain access to existing threads.
- **Append-only messages:** Messages cannot be edited or deleted, consistent with Orca's append-only philosophy. Quality control is social, not mechanical.
- **Thread scoping via annotations:** Threads are scoped to annotations (not documents directly). Since annotations are themselves scoped to corpus + document, this provides full context without redundant foreign keys on the thread table.
- **`external_user_id` unification:** Both thread types use the same field to identify the non-author participant. For `to_authors` threads, this is the person who reached out. For `to_annotator` threads, this is the annotator. The author group is always on the other side. This simplifies queries significantly.
- **Button state derived from participation:** Rather than complex conditional logic about thread types and roles, the UI simply checks "am I in any thread for this annotation?" — if yes, show "View threads"; if no, show the appropriate initiation button(s). This prevents duplicate-group threads naturally.
- **Annotation copy on version creation (Phase 31d):** `createVersion` copies all `document_annotations` and `annotation_votes` from source to new version. This was a critical gap — without copied annotations, version-aware thread grouping and version navigation buttons had no equivalent annotations to match against on new versions. Threads are NOT copied (they stay anchored to the original annotation, and the version-aware queries find them via lineage + equivalence). Vote copying maps old→new annotation IDs via ordered queries within the same transaction.
- **Aggregating-view deduplication (Phase 31d):** `getAnnotationsForEdge` and `getAnnotationsForConcept` deduplicate annotations that exist across multiple versions of the same document (a consequence of annotation copying). Uses SQL window function `ROW_NUMBER() OVER (PARTITION BY root_document_id, corpus_id, created_by, COALESCE(quote_text, '') ORDER BY version_number DESC)` to keep only the most recent version's annotation. Per-document view is intentionally NOT deduplicated — users viewing a specific version should see all annotations on that version.
- **Annotation equivalence:** Two annotations are considered "equivalent" across versions when they share the same `edge_id` and `quote_text` (or both NULL). This is the matching key used for version-aware thread grouping, cross-version deduplication, and version navigation buttons.

### Phase 32: Phone OTP Authentication (32a–e COMPLETE)

**Goal:** Replace email + password authentication with phone number + one-time-password (SMS code) authentication. Achieves two goals: (1) one human = one account (phone numbers are much harder to multiply than email addresses), and (2) less sensitive data stored (eliminates password hashes and email addresses; stores only bcrypt-hashed phone numbers, unrecoverable even in a full database breach).

**External dependency:** Twilio Verify API (handles sending and validating SMS codes)
**Cost:** ~$0.05 per verification (Twilio Verify pricing, includes SMS delivery)
**New npm packages:** `twilio`, `express-rate-limit`

**Auth flow:** phone number → SMS code → JWT (no passwords anywhere). Old username/email/password flow removed in Phase 32d.

#### Phase 32a: Twilio Setup + Database Migration (COMPLETE)

- Installed `twilio` and `express-rate-limit` npm packages on backend
- Database migration: `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(255);` (nullable — existing test users don't have phone numbers yet)
- New utility: `backend/src/utils/phoneAuth.js` — exports `normalizePhone` (E.164 normalization with US +1 default), `sendVerificationCode`, `checkVerificationCode` (Twilio Verify API wrappers)
- Updated `.env.example` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` placeholders
- **Remaining for later sub-phases:** Twilio account/Verify Service creation

#### Phase 32b: New Auth Endpoints (Backend) (COMPLETE)

- Database migration: `email` and `password_hash` made nullable (phone-based registrations don't provide these), added `token_issued_after TIMESTAMP` column
- Updated `.env.example`: `JWT_EXPIRES_IN` changed from `7d` to `90d`
- Auth middleware (`middleware/auth.js`): after JWT signature verification, queries `token_issued_after` from database and rejects tokens with `iat <= token_issued_after`. Applied to both `authenticateToken` (returns 401) and `optionalAuth` (clears `req.user`, treats as guest). Uses `<=` comparison to handle same-second edge case.
- Rate limiter: `express-rate-limit` on `/send-code` — 5 requests per IP per 15 minutes. Prevents SMS bombing. Defined in `routes/auth.js`.
- New controller functions in `authController.js`: `sendCode`, `verifyRegister`, `verifyLogin`, `logoutEverywhere`
- `verifyRegister` validates username format and uniqueness BEFORE calling Twilio (avoids burning OTP on invalid input)
- Phone uniqueness check: originally O(n) bcrypt scan (Phase 32b). Replaced in Phase 33e with O(1) HMAC lookup via `phone_lookup` column with UNIQUE constraint.
- New routes: `/send-code` (rate-limited), `/verify-register`, `/verify-login`, `/logout-everywhere` (auth required)
- Legacy `/register` and `/login` endpoints preserved (removed in Phase 32d, now complete)

**Files changed:**
- `backend/src/config/migrate.js` — Phase 32b migration block
- `backend/.env.example` — JWT_EXPIRES_IN 7d → 90d
- `backend/src/middleware/auth.js` — `checkTokenIssuedAfter` helper, async verify callbacks, DB pool import
- `backend/src/controllers/authController.js` — Four new controller functions, `phoneAuth` import
- `backend/src/routes/auth.js` — Four new routes, `express-rate-limit` import and limiter config

#### Phase 32c: Frontend — New Login/Register UI (COMPLETE)

Rewrote `LoginModal.jsx` with two-step phone-based OTP flow, replacing the old username/email/password forms:

**Sign Up:** (1) Username + phone number with +1 prefix + "Send Code" button → (2) 6-digit code input + "Verify & Create Account" button
**Log In:** (1) Phone number with +1 prefix + "Send Code" button → (2) 6-digit code input + "Verify & Log In" button

- US +1 country code shown as static prefix next to phone input; input accepts raw 10 digits only
- "Resend code" link appears after 30-second cooldown (countdown timer via `useEffect`/`setInterval`)
- "Back" link on Step 2 returns to Step 1, pre-fills previous entries
- Tab switching resets step to 1 and clears all form state
- `AuthContext.jsx` — added `sendCode`, `phoneRegister`, `phoneLogin`, `logoutEverywhere` functions (old `login`/`register` removed in Phase 32d)
- `api.js` — added `authAPI.sendCode()`, `authAPI.verifyRegister()`, `authAPI.verifyLogin()`, `authAPI.logoutEverywhere()` methods (old methods removed in Phase 32d)
- `AppShell.jsx` — added "Logout everywhere" button next to existing "Logout" button in header user section. Regular logout clears local token only; "Logout everywhere" calls `/auth/logout-everywhere` (invalidates all JWTs via `token_issued_after`), then clears local state. Even if the API call fails, local cleanup still runs.
- Design: EB Garamond on all elements, black-on-off-white Zen aesthetic, no colored buttons, no italics, no emoji. Error messages in dark red (#c00).

**Files changed:**
- `frontend/src/components/LoginModal.jsx` — Full rewrite: phone OTP two-step flow
- `frontend/src/contexts/AuthContext.jsx` — Four new functions: `sendCode`, `phoneRegister`, `phoneLogin`, `logoutEverywhere`
- `frontend/src/services/api.js` — Four new authAPI methods
- `frontend/src/components/AppShell.jsx` — "Logout everywhere" button in header

#### Phase 32d: Migration — Existing Users + Cleanup (COMPLETE)

- Migration script in `migrate.js` assigns bcrypt-hashed fake phone numbers (Twilio test range +15005550001–006) to test users alice–frank. Each user checked for `phone_hash IS NULL` before hashing; idempotent on re-run. Wrapped in try/catch per user so one failure doesn't block others.
- Removed old `/register` and `/login` endpoints from `authController.js` and `routes/auth.js`. These routes now return 404.
- Removed old `authAPI.login()` and `authAPI.register()` from `frontend/src/services/api.js`
- Removed old `login()` and `register()` functions from `AuthContext.jsx`. Provider value now exports only: `user`, `loading`, `error`, `logout`, `sendCode`, `phoneRegister`, `phoneLogin`, `logoutEverywhere`, `isAuthenticated`, `isGuest`
- `password_hash` and `email` columns retained (append-only philosophy) but functionally retired — no auth code reads or writes them
- `Login.jsx` and `Register.jsx` page files are already gone (not present in `frontend/src/pages/`)

**Files changed:**
- `backend/src/config/migrate.js` — Phase 32d migration block (test user phone hashes)
- `backend/src/controllers/authController.js` — Removed `register` and `login` functions
- `backend/src/routes/auth.js` — Removed `/register` and `/login` routes
- `frontend/src/services/api.js` — Removed `authAPI.login()` and `authAPI.register()`
- `frontend/src/contexts/AuthContext.jsx` — Removed old `login()` and `register()` functions

#### Phase 32e: Security Hardening + Documentation (COMPLETE)

Security verification: rate limiting (429 on 6th request), phone uniqueness (all test users have bcrypt hashes), token invalidation (401 on invalid/expired tokens), old endpoints removed (404), new endpoints respond correctly (400/401 as expected). Frontend builds with zero errors. No password or email references remain in active auth code paths.

Documentation: ORCA_STATUS.md updated with final Phase 32 state — users table schema, auth endpoints, architecture decisions, file structure, environment configuration.

**Risks:** Twilio outage blocks auth (low likelihood, 99.95% SLA); some users uncomfortable sharing phone number (mitigated by transparency about hashing; future phase could add Google OAuth as alternative); O(n) phone uniqueness check (optimization available if needed at scale).

### Phase 33: Plumbing Audit Remediation (33a–e)

**Goal:** Fix bugs, security holes, and infrastructure gaps identified by a comprehensive codebase audit. Organized by urgency — critical bugs first, then security hardening, then data integrity, then infrastructure polish, then scalability.

**Context:** Full audit performed March 2026 covering secrets, database management, error handling, auth/authorization, input validation, rate limiting, data integrity, file uploads, API patterns, startup/shutdown, logging, and dependencies. 23 findings total across all severity levels.

#### Phase 33a: Critical Bug Fixes — ✅ COMPLETE

**Goal:** Fix active bugs that affect normal use right now.

1. **Wrap Twilio calls in try/catch** — ✅ Done. All three Twilio call sites in authController.js (`sendCode`, `verifyRegister`, `verifyLogin`) now wrapped in try/catch returning 500 JSON error. Previously, if Twilio threw an exception the request would hang forever.

2. **Add permission check to `uploadDocument`** — ✅ Done. corpusController.js `uploadDocument` now checks that the requesting user is either the corpus owner (`corpuses.created_by`) or an allowed member (`corpus_allowed_users`) before processing the upload. Returns 403 if neither. Matches the pattern used by `addDocumentToCorpus`.

3. **Add `.catch()` fallbacks to all `Promise.all` members** — ✅ Done. Three locations fixed:
   - `AppShell.jsx` `loadAllTabs` — added `.catch()` to `getGraphTabs`, `getTabGroups`, `getMySubscriptions` (4th member `getSidebarItems` already had one)
   - `CorpusTabContent.jsx` `openDocument` — added `.catch()` to `getDocument` (returns null, with early-return guard) and `getVersionChain`
   - `OrphanRescueModal.jsx` `loadAvailableCorpuses` — added `.catch()` to `listMine` and `getMySubscriptions`

4. **Run `npm audit fix`** — ✅ Done. Backend: 2 packages updated, 0 vulnerabilities remaining. Frontend: 3 packages updated, 2 moderate vulnerabilities remaining (esbuild ≤0.24.2 / vite 0.11.0–6.1.6) — fix requires `--force` which would upgrade vite to v8 (breaking change), so deferred.

5. **EADDRINUSE auto-recovery** — ✅ Bonus fix. Added `server.on('error')` handler in server.js that detects `EADDRINUSE`, finds the stale process via `netstat`, kills it with `taskkill`, and retries the listen after 1 second. Previously the server would crash on restart if the port was still held by a zombie process.

#### Phase 33b: Security Hardening — ✅ COMPLETE

**Goal:** Close security gaps before real users are on the platform.

1. **Replace JWT secret** — ✅ Done. Replaced weak dictionary-word passphrase (`orcabeluganarwhal`) with a random 64-character hex string generated via `crypto.randomBytes(32)`. All existing JWTs invalidated (test users only). `.env.example` unchanged (keeps placeholder).

2. **Lock down CORS** — ✅ Done. Replaced `app.use(cors())` with origin-whitelist CORS in server.js. Allowed origins read from `CORS_ORIGINS` env var (comma-separated), falling back to `http://localhost:5173`. Requests from unlisted origins are rejected (no `Access-Control-Allow-Origin` header). `CORS_ORIGINS` added to both `.env` and `.env.example`.

3. **Add rate limiting to OTP verification endpoints** — ✅ Done. Added `verifyCodeLimiter` (10 attempts per IP per 15 minutes) to `POST /verify-login` and `POST /verify-register` in routes/auth.js. Existing `sendCodeLimiter` (5 per 15 min) on `/send-code` unchanged.

#### Phase 33c: Data Integrity — Transaction Wrapping — ✅ COMPLETE

**Goal:** Wrap multi-step database operations in transactions so partial failures don't leave data in broken states.

1. **Voting operations** — ✅ Done. `addVote` in votesController.js now wraps all write operations (delete replace_votes, insert votes loop, insert vote_tab_links loop) in a single `BEGIN`/`COMMIT` transaction. Read-only lookups (edge existence, path resolution) remain outside the transaction on the pool.

2. **Annotation creation** — ✅ Done. `createAnnotation` in corpusController.js now wraps the annotation INSERT and the auto-vote INSERT in a single transaction. If the auto-vote fails, the annotation is rolled back too — no more orphaned annotations with vote_count=0.

3. **User registration** — ✅ Done. `verifyRegister` in authController.js now wraps user INSERT and default "Saved" tab INSERT in a single transaction. Twilio verification and bcrypt operations remain outside the transaction (no network calls held open during the transaction). JWT signing also outside.

4. **Race condition in `createRootConcept`** — ✅ Done. Moved the duplicate name check (`SELECT ... WHERE LOWER(name) = LOWER($1)`) inside the transaction so it is serialized with the INSERT. No unique index exists on `concepts.name`, so `ON CONFLICT` was not usable — the in-transaction check prevents the race condition.

#### Phase 33d: Input Validation + Infrastructure Polish — ✅ COMPLETE

**Goal:** Add missing input validation and improve server infrastructure.

1. **Add max-length validation on unbounded text fields** — ✅ Done.
   - Message thread body: 10,000 char limit in `createThread` and `replyToThread` (messagesController.js)
   - Annotation `quote_text`: 2,000 char limit in `createAnnotation` (corpusController.js)
   - Annotation `comment`: 5,000 char limit in `createAnnotation` (corpusController.js)
   - All checks happen before any database work, return 400 with clear error messages.

2. **Configure explicit database pool limits** — ✅ Done. database.js now sets `max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`.

3. **Close database pool on shutdown** — ✅ Done. Shutdown handler in server.js now calls `pool.end()` after `server.close()` completes, cleanly releasing all database connections.

4. **Add database health check at startup** — ✅ Done. server.js runs `SELECT 1` before `app.listen()`. If PostgreSQL is unreachable, logs "ERROR: Cannot connect to PostgreSQL. Is the database running?" and exits with code 1. Server never starts if the database is down.

5. **Add missing FK constraint** — ✅ Done. Added idempotent migration in migrate.js: `ALTER TABLE document_concept_links_cache ADD CONSTRAINT fk_doc_concept_links_cache_concept FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE` (guarded by `IF NOT EXISTS` check).

6. **Tighten error message forwarding** — ✅ Done. Replaced four `error.message` forwards in corpusController.js with explicit hardcoded strings: "Document not found or has no version history" (invite token), "Document not found" (get authors), "Document not found for co-author removal" (remove author), "Document not found for leaving authorship" (leave authorship).

#### Phase 33e: O(n) Login Redesign — ✅ COMPLETE

**Goal:** Fix the most significant scalability risk in the codebase. Login and registration previously fetched ALL user phone hashes and ran `bcrypt.compare()` against each one sequentially — O(n) that would time out at ~10,000 users.

**Solution:** Added a deterministic `phone_lookup` column (HMAC-SHA256 of the normalized phone number, keyed by `PHONE_LOOKUP_KEY` env var). HMAC is deterministic, so it can be indexed and queried in O(1) via a UNIQUE constraint.

1. **New env var `PHONE_LOOKUP_KEY`** — ✅ Done. Random 32-byte hex key added to `.env` and `.env.example`. Used by `computePhoneLookup()` in phoneAuth.js.

2. **New utility `computePhoneLookup()`** — ✅ Done. Added to `phoneAuth.js`: `crypto.createHmac('sha256', PHONE_LOOKUP_KEY).update(normalizedPhone).digest('hex')`. Returns a 64-character hex string.

3. **Database migration** — ✅ Done. Added `phone_lookup VARCHAR(64)` column with `UNIQUE` constraint (`users_phone_lookup_key`). Backfilled all 6 test users (alice–frank) using their known phone numbers (+15005550001 through +15005550006). Guarded by `IF NOT EXISTS` checks for idempotency.

4. **`verifyRegister` rewritten** — ✅ Done. Phone uniqueness check replaced: was `SELECT all phone_hashes → bcrypt.compare() loop`, now `SELECT id FROM users WHERE phone_lookup = $1`. INSERT now includes `phone_lookup` alongside `phone_hash`.

5. **`verifyLogin` rewritten** — ✅ Done. User lookup replaced: was `SELECT all phone_hashes → bcrypt.compare() loop`, now `SELECT id, username FROM users WHERE phone_lookup = $1`. Single-row result, no bcrypt needed.

6. **No remaining O(n) patterns** — ✅ Verified. Grep for `phone_hash IS NOT NULL` returns zero matches in the codebase.

**Files changed:**
- `backend/.env` — added `PHONE_LOOKUP_KEY`
- `backend/.env.example` — added `PHONE_LOOKUP_KEY` placeholder
- `backend/src/utils/phoneAuth.js` — added `crypto` import, `computePhoneLookup()` export
- `backend/src/controllers/authController.js` — imported `computePhoneLookup`, rewrote `verifyRegister` and `verifyLogin` to use O(1) HMAC lookup
- `backend/src/config/migrate.js` — Phase 33e migration block (column, constraint, test user backfill)

---

**Audit findings NOT included in Phase 33 (deferred):**
- Pagination on list endpoints — fine for small userbase, add when data grows
- Rate limiting on content creation endpoints — low abuse risk with small userbase
- Structured logging / request IDs — adequate for current scale
- Vite/esbuild dev-server vulnerabilities — dev-only, not a production risk

### Phase 34: Corpus & Document Search Fields — ✅ COMPLETE

**Goal:** Add client-side search/filter fields to the Browse Corpuses view and to corpus document lists, so users can quickly find corpuses and documents without scrolling. All filtering is client-side (data already loaded in state). No new backend endpoints needed.

#### Phase 34a: Corpus Search in CorpusListView — ✅ COMPLETE

**Goal:** Add two independent search fields to `CorpusListView.jsx` — one on the "My Corpuses" section and one on the "All Corpuses" section.

- Replaced toggle-based view (viewMode 'all'/'mine') with two always-visible sections: "My Corpuses" and "All Corpuses"
- Two new state variables: `myCorpusSearch`, `allCorpusSearch` — each filters its respective list by `corpus.name` (case-insensitive substring match)
- The two fields are completely independent — typing in one does NOT affect the other
- Guest handling: entire "My Corpuses" section (including search field) gated behind `!isGuest`; "All Corpuses" always renders
- Small inline search inputs on each section header line with ✕ clear button (appears when field has text)
- Styling: EB Garamond font, 1px solid #ccc border, off-white background (#faf9f6), 13px font size
- Files changed: `CorpusListView.jsx` only

#### Phase 34b: Document Search in CorpusDetailView — ✅ COMPLETE

**Goal:** Add "My Documents" and "All Documents" sections with independent search fields to `CorpusDetailView.jsx` (the Browse overlay corpus view).

- Existing "My Documents" / "All Documents" sections already present from Phase 21b — added search inputs to each section header
- Two new state variables: `myDocSearch`, `allDocSearch` — each filters its respective list by `doc.title` (case-insensitive substring match)
- My Documents: filters `groupDocsByLineage(documents)` by `_chainUploaders.has(currentUserId)`, then by search term
- My Documents section hidden entirely when user has no docs and no active search
- All Documents section always visible; shows all corpus documents with independent search
- Guest handling: entire My Documents section (including search) gated behind `!isGuest`
- No backend changes needed — `uploaded_by` already returned in `getCorpus` document query
- Search inputs placed inline on section headers with ✕ clear buttons, EB Garamond font, off-white background
- Files changed: `CorpusDetailView.jsx` only

#### Phase 34c: Document Search in CorpusTabContent — ✅ COMPLETE

**Goal:** Add the same "My Documents" / "All Documents" sections with search fields to `CorpusTabContent.jsx` (the sidebar tab corpus view).

- Two new state variables: `myDocSearch`, `allDocSearch` — each filters its respective list by `doc.title` (case-insensitive substring match)
- My Documents: filters `groupDocsByLineage(documents)` by `_chainUploaders.has(user?.id)`, then by search term; hidden when user has no docs and no active search
- Existing tag filter and favorite sorting preserved alongside new search filtering
- Search fields only visible on document list view — component early-returns document viewer when `subView !== 'list'`
- Both search states reset to '' in `handleBackToList` when returning from document view
- Guest handling: entire My Documents section (including search) gated behind `!isGuest`
- Search inputs inline on section headers with ✕ clear buttons, EB Garamond font, off-white background
- Behavior matches CorpusDetailView (Phase 34b) — same filtering logic, same user gating, same section structure
- Files changed: `CorpusTabContent.jsx` only

#### Phase 34 Verification Checklist
1. CorpusListView: "My Corpuses" and "All Corpuses" searches are independent
2. CorpusDetailView (Browse overlay): "My Documents" and "All Documents" searches are independent
3. CorpusTabContent (sidebar tab): "My Documents" and "All Documents" searches are independent
4. **Cross-check:** same corpus via Browse overlay vs sidebar tab — both have working document search
5. Guest mode: only "All" sections and search fields appear
6. Clean build: `cd frontend && npm run build` succeeds

### Phase 35: Document Deletion & Account Deletion — 🟡 IN PROGRESS

**Goal:** Allow users to delete documents they uploaded (removing from all corpuses and deleting all associated annotations, messages, and votes). Allow users to delete their account, with a guided flow for transferring corpus ownership and managing documents before deletion.

#### Phase 35a: Document Deletion + Shared Component Extraction — ✅ DONE

**Goal:** Users can permanently delete a specific document version they uploaded. Deletion removes that single version from all corpuses and destroys all associated annotations, messages, and votes on that version. Additionally, extract shared UI components from `CorpusTabContent.jsx` and `CorpusDetailView.jsx` to eliminate persistent feature divergence between the two corpus views.

**Behavior:**
- Only the original uploader (`documents.uploaded_by`) can delete a document version
- Deletion targets a single document row — the specific version identified by `:id` in the URL. Other versions in the chain (whether uploaded by the same user or by co-authors) are NOT affected.
- If the deleted version was referenced by another version's `source_document_id`, that FK becomes NULL automatically via the existing `ON DELETE SET NULL` constraint — the referencing version becomes a standalone document (or a new chain root).
- Co-author records (`document_authors`) referencing a deleted root document CASCADE away. Surviving versions that were downstream lose their co-author associations (accepted edge case for launch).

**Cascade chain for the deleted document:**
1. `document_annotations` CASCADE → `annotation_votes` CASCADE, `message_threads` CASCADE → `messages` CASCADE → `message_read_status` CASCADE
2. `corpus_documents` CASCADE (removed from all corpuses)
3. `document_concept_links_cache` CASCADE
4. `document_favorites` CASCADE
5. `document_authors` CASCADE (if this was the root doc)
6. `document_invite_tokens` CASCADE (if this was the root doc)
7. The `documents` row itself is deleted

**API endpoint:**
- `POST /api/documents/:id/delete` — Auth required, uploader only (`uploaded_by = req.user.userId`)
- Deletes the single document row in a transaction with `AND uploaded_by = $2` safety belt
- Returns `{ deletedDocumentId }`
- Returns 403 if requesting user is not the uploader of the specified document
- Returns 404 if document not found

**Frontend UI:**
- "Delete" button on document cards in the document list, visible only to the uploader of that version
- Confirmation modal warning that all annotations and messages on this version will be permanently lost
- If document is part of a version chain, modal shows a note: "Other versions of this document will not be affected."
- After deletion, corpus document list refreshes automatically
- Button styling: transparent background, dark text, neutral border (consistent with Orca's design language — no red/danger colors)

**Shared component extraction:**
Three areas of document/corpus UI code were duplicated between `CorpusTabContent.jsx` and `CorpusDetailView.jsx`, causing persistent feature divergence (every feature added to one view was missed in the other). Fix: extract three shared presentational components that receive data and callbacks via props. Both parent components render the shared components instead of maintaining separate copies.

1. **`CorpusDocumentList.jsx`** (802 lines) — My/All Documents sections with collapse toggle, search fields, tag filter bar, document cards (title, meta row, version badge, tag pills with remove, favorite star, tag assignment dropdown, delete button for uploaders, remove button for owners), delete confirmation modal. Internal state: search terms, tag filter, collapse, tag menu, delete modal. All API calls via callbacks from parent.

2. **`CorpusUploadForm.jsx`** (602 lines) — Upload toggle button, drag-and-drop zone, file picker, title input, tag picker (single-select with search suggestions), add-existing-document search/picker. Only renders for corpus owners or allowed members (`isOwner || isAllowedUser`). Internal state: form fields, upload progress, search results. API calls via callbacks.

3. **`CorpusMembersPanel.jsx`** (~420 lines) — Member list with remove button (owner only), invite link generation/copy/revoke, leave corpus button (non-owner members), member count for non-members. Inline transfer ownership UI for owners (select member, confirm, transfer — Phase 35b). Internal state: generating/copying/leaving/transfer loading states. API calls via callbacks.

**Parity gaps fixed by extraction:**
- Favorites (star toggle) — was missing from CorpusDetailView
- Tag assignment (add/change/remove tags on doc cards) — was missing from CorpusDetailView
- Tag filter bar (filter docs by tag) — was missing from CorpusDetailView
- Tag picker during upload — was missing from CorpusDetailView
- Upload visibility — restricted to corpus owners and allowed members (was previously visible to all logged-in users)

**Files changed:**
- `backend/src/controllers/corpusController.js` — new `deleteDocument` function (transaction-wrapped, single-row delete with `uploaded_by` safety belt)
- `backend/src/routes/documents.js` — new route `POST /:id/delete` with `authenticateToken`
- `frontend/src/services/api.js` — new `documentsAPI.deleteDocument(documentId)` method
- `frontend/src/components/CorpusTabContent.jsx` — refactored to use shared components (reduced from ~4950 to 3269 lines). Retains document viewer, annotations, messaging, version navigation, co-author management.
- `frontend/src/components/CorpusDetailView.jsx` — refactored to use shared components (reduced from ~1930 to 640 lines). Retains corpus header, edit/delete corpus, subscribe/unsubscribe.
- **NEW** `frontend/src/components/CorpusDocumentList.jsx` — shared document list component
- **NEW** `frontend/src/components/CorpusUploadForm.jsx` — shared upload form component
- **NEW** `frontend/src/components/CorpusMembersPanel.jsx` — shared members panel component

See Architecture Decision #211.

#### Phase 35b: Corpus Ownership Transfer — ✅ DONE

**Goal:** Allow a corpus owner to transfer ownership to an existing corpus member (allowed user). Required as a prerequisite for account deletion, but also useful as a standalone feature.

**API endpoint:**
- `POST /api/corpuses/:id/transfer-ownership` — Owner only
- Body: `{ newOwnerId }` — must be an existing allowed user of the corpus (`corpus_allowed_users`)
- Validates: corpus exists (404), requester is owner (403), newOwnerId is a number (400), not self-transfer (400), target is existing member (400)
- Transaction performs three atomic operations:
  1. Updates `corpuses.created_by` to the new owner
  2. Removes the new owner from `corpus_allowed_users` (now implicitly a member as owner)
  3. Adds the old owner to `corpus_allowed_users` with `ON CONFLICT DO NOTHING` (becomes a regular member)
- Returns `{ message, newOwnerId, corpusId }`

**Frontend UI:**
- Inline transfer flow in `CorpusMembersPanel.jsx`, visible only to owners when there are non-owner members
- Small "Transfer ownership" text button below member list (not prominent — rarely used)
- Clicking shows member pick list with "Transfer to [username]" buttons
- Confirmation step: "Transfer ownership of this corpus to [username]? You will become a regular member." with Confirm/Cancel
- Both `CorpusTabContent.jsx` and `CorpusDetailView.jsx` wire the callback, refreshing corpus data + member list after successful transfer

**Files changed:**
- `backend/src/controllers/corpusController.js` — new `transferOwnership` function with transaction
- `backend/src/routes/corpuses.js` — new route `/:id/transfer-ownership`
- `frontend/src/services/api.js` — new `corpusAPI.transferOwnership(corpusId, newOwnerId)` method
- `frontend/src/components/CorpusMembersPanel.jsx` — inline transfer UI with 4 state variables (showTransferUI, selectedTransferTarget, confirmingTransfer, transferring)
- `frontend/src/components/CorpusTabContent.jsx` — `handleTransferOwnership` callback wired to panel
- `frontend/src/components/CorpusDetailView.jsx` — `handleTransferOwnership` callback wired to panel

#### Phase 35c: Account Deletion Backend — ✅ DONE

**Goal:** Backend infrastructure for account deletion. Migration to fix foreign key constraints that block user deletion, plus the delete-account endpoint.

**Migration — Changed 12 provenance FKs to `ON DELETE SET NULL`:**
These foreign keys referenced `users(id)` with no `ON DELETE` clause (PostgreSQL defaults to `RESTRICT`, blocking deletion). Each was dropped and re-added with `ON DELETE SET NULL` using idempotent `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` pattern, wrapped in try/catch:
- `concepts.created_by` (`concepts_created_by_fkey`)
- `attributes.created_by` (`attributes_created_by_fkey`)
- `edges.created_by` (`edges_created_by_fkey`)
- `concept_links.added_by` (`concept_links_added_by_fkey`)
- `corpuses.created_by` (`corpuses_created_by_fkey`)
- `documents.uploaded_by` (`documents_uploaded_by_fkey`)
- `corpus_documents.added_by` (`corpus_documents_added_by_fkey`)
- `document_annotations.created_by` (`document_annotations_created_by_fkey`)
- `corpus_invite_tokens.created_by` (`corpus_invite_tokens_created_by_fkey`)
- `document_invite_tokens.created_by` (`document_invite_tokens_created_by_fkey`)
- `document_tags.created_by` (`document_tags_created_by_fkey`)
- `message_threads.created_by` (`message_threads_created_by_fkey`)

**Note:** 26+ other FKs already had `ON DELETE CASCADE` (votes, subscriptions, tabs, messages, flags, etc.). 2 FKs in `annotation_removal_log` already had `ON DELETE SET NULL`. After this migration, zero `RESTRICT` FKs remain on `users(id)`.

**New API endpoint:** `POST /api/auth/delete-account` (auth required)
- Pre-check: queries `corpuses WHERE created_by = $1`. Returns 400 with `{ error, corpuses: [{id, name}] }` if any exist.
- Wrapped in a transaction (pre-check + delete are atomic to prevent race conditions).
- Single `DELETE FROM users WHERE id = $1` — CASCADE and SET NULL handle all child tables automatically. No manual child table deletes.
- Returns `{ message: 'Account deleted successfully' }`.

**Files changed:**
- `backend/src/config/migrate.js` — Phase 35c migration block (12 FK alterations via loop)
- `backend/src/controllers/authController.js` — new `deleteAccount` function with transaction
- `backend/src/routes/auth.js` — `router.post('/delete-account', authenticateToken, authController.deleteAccount)`

#### Phase 35d: Account Deletion Frontend + Header Account Menu — ✅ DONE

**Goal:** Frontend deletion flow with guided corpus transfer/deletion, and header consolidation of logout actions into a dropdown menu.

**Part 1 — Header account menu consolidation:**
Replaced the separate "Logout" and "Logout everywhere" buttons with a single "Log out ▾" dropdown button. Dropdown has three options:
1. "Log out" — current session logout
2. "Log out everywhere" — invalidate all sessions
3. "Delete account" — opens the deletion flow

Dropdown uses `useRef` + `mousedown` listener for click-outside-to-close. Styled with off-white background (#faf9f6), 1px solid #ccc border, EB Garamond font, subtle hover effect. Only shown for authenticated users (not guests).

**Part 2 — `DeleteAccountFlow.jsx` (modal overlay):**
Three-step flow rendered as a fixed-position overlay (z-index 10000, semi-transparent backdrop):

1. **Step 1 — Corpus ownership:** Fetches `corpusAPI.listMine()` on mount. For each corpus, fetches members via `corpusAPI.listAllowedUsers()`. Corpuses with members show a transfer dropdown + "Transfer" button (calls `corpusAPI.transferOwnership`). Corpuses without members show "Delete Corpus" button (calls `corpusAPI.deleteCorpus`). "Continue" disabled until all resolved. Skipped entirely if user owns zero corpuses.
2. **Step 2 — Document notice:** Informational text about documents remaining anonymously. No blocking action.
3. **Step 3 — Final confirmation:** Text input requiring exact case-sensitive username match. "Permanently Delete My Account" button disabled until match. On success: closes modal, defers `logout()` via `setTimeout` to avoid unmount-during-render. On 400 error (still owns corpuses): returns to Step 1 with refreshed corpus list.

**Bug fix (document search):** `CorpusUploadForm.jsx` "Add existing document" search was broken — `res.data || []` should have been `res.data?.documents || []` since the API returns `{ documents: [...] }`. Search results never rendered because the object was truthy but had no `.length`.

**Bug fix (document search with deleted users):** `corpusController.js` `searchDocuments` used `JOIN users` (inner join), which excluded documents where `uploaded_by IS NULL` (from deleted users). Changed to `LEFT JOIN`.

**New API method:** `authAPI.deleteAccount()` — `POST /api/auth/delete-account`

**Files changed:**
- `frontend/src/components/DeleteAccountFlow.jsx` — new component (3-step deletion flow)
- `frontend/src/components/AppShell.jsx` — header dropdown menu, DeleteAccountFlow rendering, account menu state + click-outside handler, dropdown styles
- `frontend/src/services/api.js` — `authAPI.deleteAccount()` method
- `frontend/src/components/CorpusUploadForm.jsx` — bug fix: `res.data?.documents` for search results
- `backend/src/controllers/corpusController.js` — bug fix: `LEFT JOIN` in document search query

#### Phase 35 Architecture Decisions

- **Architecture Decision #208 — Document Deletion Is Version-Specific:** When a user deletes a document, only the single specified version is deleted — not the entire version chain. Other versions (whether uploaded by the same user or co-authors) are unaffected. If a downstream version referenced the deleted one via `source_document_id`, that FK becomes NULL via the existing `ON DELETE SET NULL` constraint, making the downstream version a standalone document. This gives users granular control — they can delete a flawed V1 while keeping a corrected V3 they also uploaded. Co-author records (`document_authors`) on deleted root documents are lost via CASCADE — surviving downstream versions lose co-author associations. Accepted tradeoff: co-authorship loss is an edge case unlikely at launch scale.

- **Architecture Decision #209 — Account Deletion Requires Pre-Transfer of Corpus Ownership:** Users cannot delete their account while they still own corpuses. The deletion flow guides them through transferring each corpus to an existing member. If a corpus has no members, the user must delete it or recruit a member first. This ensures no corpus is left ownerless and preserves community data. The transfer endpoint (`POST /corpuses/:id/transfer-ownership`) is also useful as a standalone feature independent of account deletion.

- **Architecture Decision #210 — Provenance FKs Changed to ON DELETE SET NULL:** Foreign keys for `created_by`, `added_by`, and `uploaded_by` columns that reference `users(id)` are changed from the default `RESTRICT` to `ON DELETE SET NULL`. This allows user deletion while preserving community contributions (concepts, edges, annotations, web links, documents) with NULL attribution. This is consistent with Orca's append-only philosophy — content is never deleted, only its authorship becomes anonymous.

- **Architecture Decision #211 — Corpus View Shared Components Extracted:** Three areas of UI code were duplicated between `CorpusTabContent.jsx` (persistent sidebar tab) and `CorpusDetailView.jsx` (Browse overlay), causing persistent feature divergence. Extracted into three shared presentational components: (1) `CorpusDocumentList.jsx` — document cards, My/All sections, search, tags, favorites, remove/delete; (2) `CorpusUploadForm.jsx` — drag-and-drop upload, file picker, add-existing-document; (3) `CorpusMembersPanel.jsx` — member list, invite links, leave/remove. All three receive data and callbacks via props (no direct API calls). Search and modal state is internal. The parent components retain their distinct responsibilities: `CorpusTabContent` handles the persistent tab with document viewer/annotations/messaging, `CorpusDetailView` handles the Browse overlay with corpus management and subscribe flow.

#### Phase 35 Verification Checklist
1. Document deletion: uploader can delete their own version, non-uploaders cannot (403)
2. Document deletion: only the specified version is deleted; other versions in the chain survive
3. Document deletion: annotations, messages, favorites, cache all cleaned up for the deleted version
4. Document deletion: downstream versions referencing the deleted one get `source_document_id = NULL`
5. Corpus transfer: owner can transfer to an allowed user; new owner becomes owner, old owner becomes member
6. Corpus transfer: non-owners get 403; non-members as target get 400
7. Account deletion: blocked if user still owns corpuses (400 with list)
8. Account deletion: after transferring all corpuses, deletion succeeds
9. Account deletion: concepts/edges/annotations persist with `created_by = NULL`
10. Account deletion: votes, subscriptions, tabs, messages all CASCADE deleted
11. Account deletion: JWT cleared client-side, user redirected to root
12. Account deletion: header dropdown consolidates Log out, Log out everywhere, Delete account
13. Account deletion: dropdown closes on click outside
14. Account deletion: deletion modal closes cleanly before logout (no stuck modal)
15. Document search: "Add existing document" returns results (res.data.documents fix)
16. Document search: documents from deleted users (uploaded_by NULL) still appear (LEFT JOIN fix)
17. Clean build: `cd frontend && npm run build` succeeds

### Phase 36: Legal Compliance — Age Verification, Email Collection, Copyright Confirmation — ✅ IMPLEMENTED

**Goal:** Add three legal compliance features required before public launch: (1) age verification at sign-up (18+ checkbox with stored consent timestamp), (2) email collection at sign-up (required, for copyright violation notices and ToS/privacy updates), (3) copyright confirmation at document upload (checkbox with stored consent timestamp, applies to both original uploads and version uploads).

#### Phase 36a: Database Migration

**Users table — new column:**
- `age_verified_at TIMESTAMP` — nullable, set to `NOW()` when user checks the age verification checkbox during registration

**Documents table — new column:**
- `copyright_confirmed_at TIMESTAMP` — nullable, set to `NOW()` when uploader checks the copyright confirmation checkbox during upload

**Test user backfill:**
- Update alice–frank with fake emails: `alice@test.com`, `bob@test.com`, `carol@test.com`, `dave@test.com`, `eve@test.com`, `frank@test.com`
- Set `age_verified_at = NOW()` for all six test users (grandfathered)

#### Phase 36b: Backend Changes

**`verifyRegister` in `authController.js`:**
- Now accepts `{ phoneNumber, code, username, email, ageVerified }`
- Validates `email` is present and has valid format (basic regex: contains `@` and `.`)
- Validates `ageVerified === true` — returns 400 if false/missing
- Stores `email` in the `email` column (reactivated from Phase 32d retirement)
- Sets `age_verified_at = NOW()` in the INSERT statement
- Email uniqueness is NOT enforced — multiple accounts can share an email (one phone per account is the identity constraint)

**Document upload endpoint (`/:id/documents/upload` in `corpusController.js`):**
- Requires `copyrightConfirmed: true` in the request body (multipart form field or JSON field)
- Returns 400 if `copyrightConfirmed` is missing or not `true`
- Sets `copyright_confirmed_at = NOW()` in the document INSERT

**Version create endpoint (`/versions/create` in `corpusController.js`):**
- Same copyright confirmation requirement as upload
- Requires `copyrightConfirmed: true`, returns 400 if missing
- Sets `copyright_confirmed_at = NOW()` on the new version row

#### Phase 36c: Frontend Changes

**`LoginModal.jsx` — Sign Up tab, Step 2 (after OTP verification step):**
- New email input field (required, type="email", validated for format before submit)
- New checkbox: "I confirm I am at least 18 years old" (must be checked to enable submit button)
- Submit button disabled until: username filled, email filled and valid, age checkbox checked
- Sends `email` and `ageVerified: true` to `verifyRegister` endpoint

**`CorpusUploadForm.jsx` — upload form:**
- New checkbox: "I confirm I have the right to upload this content (I own it or it is in the public domain)" (must be checked to enable Upload button)
- Sends `copyrightConfirmed: true` with the upload request
- Checkbox resets when upload completes (ready for next upload)

**Version upload (wherever the "Create New Version" flow lives):**
- Same copyright confirmation checkbox as original upload
- Sends `copyrightConfirmed: true` with the version create request

#### Phase 36 Architecture Decisions

- **Architecture Decision #212 — Email Reactivated for Legal Notifications (Phase 36):** The `email` column on the `users` table, retired in Phase 32d when phone OTP replaced email+password auth, is reactivated for a new purpose: legal notifications (copyright violation notices, ToS/privacy policy updates). Email is required for new registrations (application-level enforcement) but the DB column remains nullable for backward compatibility. Email uniqueness is NOT enforced — multiple accounts may share an email, since phone number (one per account) remains the identity constraint. Email is NOT used for authentication.

- **Architecture Decision #213 — Consent Timestamps for Legal Defensibility (Phase 36):** Age verification and copyright confirmation are stored as timestamps (`age_verified_at` on `users`, `copyright_confirmed_at` on `documents`) rather than simple booleans. Timestamps provide a verifiable record of when consent was given, which is stronger evidence in dispute resolution. Age verification is per-user (set once at registration). Copyright confirmation is per-document (set at each upload, including version uploads), because each document upload is a separate legal assertion.

#### Phase 36 Bug Fix: LEFT JOIN on `uploaded_by` (prevents document disappearance after account deletion)

**Problem:** Five queries in `corpusController.js` used `JOIN users u ON u.id = d.uploaded_by` (inner join). When a user deletes their account, Phase 35c sets `documents.uploaded_by = NULL` (ON DELETE SET NULL). The inner JOIN then fails to match (NULL never equals anything), silently dropping the document from query results. Documents appeared to vanish from corpuses even though the rows still existed in the database.

**Affected queries (all changed to LEFT JOIN):**
1. `getCorpus` — corpus document list (line ~185) — documents by deleted users disappeared from corpus views
2. `checkDuplicates` — duplicate detection (line ~403) — could not detect duplicates of documents uploaded by deleted users
3. `getDocument` — single document fetch (line ~821) — returned 404 for documents whose uploader deleted their account
4. `getVersionHistory` — version history (line ~1071) — dropped versions uploaded by deleted users from the version chain display
5. `getDocumentAuthors` — author list (line ~2876) — omitted the original uploader if their account was deleted

**Not changed:** `getOrphanedDocuments` (line ~2449) — this query filters `WHERE d.uploaded_by = $1` for the current logged-in user, so `uploaded_by` is never NULL in that context. Inner JOIN is safe.

**Rule:** Any query that JOINs `users` via `documents.uploaded_by` (or any other SET NULL FK) **must** use `LEFT JOIN`, because the FK value becomes NULL when the referenced user is deleted. This applies to all provenance columns changed by Phase 35c (see the FK constraint list: `concepts.created_by`, `edges.created_by`, `corpuses.created_by`, `documents.uploaded_by`, `corpus_documents.added_by`, `document_annotations.created_by`, etc.). The frontend already handles NULL usernames gracefully (conditional rendering).

#### Phase 36 Verification Checklist
1. Sign Up: cannot complete registration without entering an email
2. Sign Up: cannot complete registration without checking age verification box
3. Sign Up: email stored in `users.email` column, `age_verified_at` set to a timestamp
4. Sign Up: invalid email format (no @, no .) rejected with error message
5. Document upload: cannot upload without checking copyright confirmation box
6. Document upload: `copyright_confirmed_at` set to a timestamp on the document row
7. Version upload: same copyright confirmation required, same timestamp stored
8. Test users: alice–frank have emails and `age_verified_at` after migration
9. Clean build: `cd frontend && npm run build` succeeds
10. Account deletion: documents uploaded by a now-deleted user still appear in corpus views (with null uploader username)

### Info Pages (Phase 30g + ongoing) — ✅ IMPLEMENTED

**Goal:** Static informational pages with community comment sections. Three pages accessible via header navigation buttons: Using Orca (`/using-orca`), Constitution (`/constitution`), Donate (`/donate`).

**Component:** `InfoPage.jsx` — single component handles all three slugs. Detected via `INFO_SLUGS` array in `AppShell.jsx`.

**Layout:**
- Using Orca and Constitution use a **two-column layout**: left column = page content, right column = sticky comments section (heading: "Report Bugs / Request Enhancements" for Using Orca, "Community Comments" for others)
- Donate uses a single-column layout (placeholder content)
- `maxWidth: 1400px`, side padding `12px`, column gap `32px`

**Using Orca page content (`UsingOrcaContent` component):**
1. **Intro paragraph** — describes what Orca is (building shared value hierarchies, annotations, messaging)
2. **Three use case paragraphs** — Research, Product Development, Education. Each has a bold "Use Case: [Name]." label followed by description text
3. **Open source note** — "Orca is open source (link to github.com/orca-concepts/orca). Educators and organizations can run their own instance for a controlled environment."
4. **2×2 screenshot grid** — four cells arranged via CSS Grid (`gridTemplateColumns: '1fr 1fr'`), falls back to single-column stack on narrow screens (<768px via useState/useEffect resize listener):
   - **Value Hierarchy** — single screenshot (`step3.png`) with caption about Effect Size Reporting hierarchy
   - **Flip View** — single screenshot (`flip-view.png`) with caption about alternative parent contexts
   - **Messages** — carousel of 4 slides (`message1-4.png`) with caption about annotation messaging
   - **Example Workflow** — carousel of 3 slides (`step1-3.png`), each titled "Example Workflow: Step N — Description":
     - Step 1 — Browse a Corpus
     - Step 2 — Add an Annotation
     - Step 3 — Explore the Value Graph

**Lightbox modal:**
- Clicking any screenshot opens a lightbox overlay with the expanded image
- Lightbox displays the caption text below the image
- For carousel images (Messages, Example Workflow), the lightbox includes prev/next navigation arrows and a "N of M" indicator
- Close via × button or clicking the dark overlay background

**Constitution page content (`ConstitutionContent` component):**
- "(Tentative*)" subtitle with footnote explaining LLC status
- Bulleted list of constitutional principles (not-for-profit, privacy, human verification, transparent moderation)
- Footnote about current moderation approach (10-flag threshold, admin decisions, future Wikipedia-style deliberation)

**Comment system (shared across all info pages):**
- Comments with ▲ vote button and vote count
- 1-level nested replies (cannot reply to a reply)
- Auto-vote on comment creation (starts at 1)
- Sorted by vote count desc, then chronologically
- Guest users see comments but cannot add or vote (login prompt shown)
- 2000 character max per comment
- Optimistic vote toggling with revert on error

**Screenshot assets** (in `frontend/public/images/using-orca/`):
- `step1.png` — Corpus page with document list
- `step2.png` — Document view with annotations panel
- `step3.png` — Value hierarchy graph with child concepts and annotations
- `flip-view.png` — Flip View showing alternative parents
- `message1.png` through `message4.png` — Messaging feature screenshots

**Backend:** `pagesController.js` + `routes/pages.js`. Valid slugs hardcoded: `['using-orca', 'constitution', 'donate']`. Database tables: `page_comments`, `page_comment_votes` (see Database Schema section).

---

### Phase 37: Pre-Launch Bug Fixes — ⏳ PLANNED

**Goal:** Fix all bugs identified in the March 2026 QA pass that affect core functionality, user experience, or data integrity before public launch. Organized into six batches (37a–37f) grouped by file-touch area for efficient Claude Code sessions.

**Approach:** Work through batches sequentially. Git commit after each batch. Run ORCA_TESTS.md Level 1 after each batch. Full Level 2 regression after all batches complete.

---

#### Phase 37a: Backend Controller Fixes — ⏳ PLANNED

Five backend bugs across `conceptsController.js`, `votesController.js`, and `corpusController.js`.

**Bug 1 — Logged-out users can't see swap votes:**
- **Symptom:** Guest users see no swap vote counts on concept children.
- **Root cause hypothesis:** The swap count subquery in `getConceptWithChildren` may be missing from the `optionalAuth` code path, or the query may filter by authenticated user ID in a way that returns 0 for guests.
- **Fix:** Ensure the `swap_count` subquery (via `replace_votes`) runs identically for authenticated and guest users. The swap count is a public aggregate — no user-specific filtering needed.
- **Files:** `conceptsController.js`

**Bug 2 — Can't add root concept if name exists anywhere in database:**
- **Symptom:** Creating a root concept is rejected if the concept name already exists as a non-root concept anywhere, instead of only checking for existing root edges with that name.
- **Root cause hypothesis:** The backend's duplicate check in `createRootConcept` looks at the `concepts` table globally (checking if the name exists at all) instead of checking specifically for existing root edges with that concept ID and selected attribute.
- **Fix:** The check should allow reuse of existing concept names as roots. The constraint should be: "does a root edge already exist for this concept ID with this attribute?" — not "does this concept name exist anywhere." This matches how child concept creation works (reuses existing concept rows).
- **Files:** `conceptsController.js`

**Bug 3 — Corpus members can add document versions (should be authors only):**
- **Symptom:** Users who are corpus allowed members (but not document authors/coauthors) can upload new versions of a document. Only the original uploader and coauthors should be able to.
- **Root cause hypothesis:** The `createVersion` endpoint checks corpus membership (`corpus_allowed_users`) instead of (or in addition to) author status (`documents.uploaded_by` + `document_authors`).
- **Fix:** Change the permission check in `createVersion` to verify the requesting user is a document author (uploader or coauthor via root document lookup), not just a corpus member.
- **Files:** `corpusController.js`

**Bug 4 — Web links show across all contexts instead of being edge-specific:**
- **Symptom:** A web link added to one parent context for a concept appears in all contexts for that concept. Web links should be edge-specific (tied to a specific parent context), only compiling across contexts in the Web Links tab's cross-context view.
- **Root cause hypothesis:** The query fetching web links for the current context may be using `child_id` (concept-level) instead of the specific `edge_id` for the current context.
- **Fix:** Ensure the Annotations tab's web links query filters by the current `edge_id`, not by `child_id`. The Web Links tab (cross-context compilation) can continue using `child_id` — that's its purpose.
- **Files:** `votesController.js`, `ConceptAnnotationPanel.jsx`
- **Related architecture decision:** #58 ("Web Links Are Context-Specific (Edge-Tied)")

**Bug 5 — Web link creator cannot remove their own link:**
- **Symptom:** The delete/remove button for a web link doesn't work or doesn't appear for the user who added it.
- **Root cause hypothesis:** Frontend permission check may be comparing user IDs incorrectly (e.g., `user.userId` vs `user.id` — the known frontend auth context pattern from Architecture Decision #100), or the backend `removeWebLink` endpoint may have a validation issue.
- **Fix:** Verify the frontend `added_by` comparison uses `user.id` (not `user.userId`), and verify the backend `removeWebLink` endpoint correctly checks `added_by = req.user.userId`.
- **Files:** `votesController.js`, `ConceptAnnotationPanel.jsx`

**Suggested git commit:** `fix: 37a — swap votes guest view, root concept creation, version permissions, web links context, web link deletion`

---

#### Phase 37b: Auth & Registration — ⏳ PLANNED

One bug in the phone number registration flow.

**Bug — Phone "already exists" error shows too late:**
- **Symptom:** During registration, the user can send the OTP code before being told the phone number is already registered. The check should happen as soon as the phone number is entered, before the code is sent.
- **Root cause hypothesis:** The phone uniqueness check currently lives in `verifyRegister` (after code verification), not in `sendCode` (before sending the OTP).
- **Fix:** Add a phone uniqueness check to the `sendCode` endpoint. When `intent=register` (or a new parameter indicating registration), look up the phone number via `phone_lookup` (HMAC-SHA256). If a user already exists with that `phone_lookup`, return an error immediately — before calling Twilio. The frontend should display this error on the phone number input step. For `intent=login`, the existing flow is fine (user must exist).
- **Implementation detail:** The `sendCode` endpoint currently doesn't distinguish between login and register intents. Add an optional `intent` query parameter or body field (`'login'` or `'register'`). For `register` intent, check uniqueness first. For `login` intent, optionally check that the user exists (nice-to-have: "no account with this phone number" error before sending code).
- **Files:** `authController.js`, `routes/auth.js`, `LoginModal.jsx`, `AuthContext.jsx`, `api.js`

**Suggested git commit:** `fix: 37b — check phone uniqueness before sending OTP code during registration`

---

#### Phase 37c: Corpus & Document Frontend UX — ⏳ PLANNED

Five bugs in the corpus/document upload and annotation area.

**Bug 1 — Guest error opening documents from graphs:**
- **Symptom:** Logged-out users clicking a document link from `ConceptAnnotationPanel` get a JavaScript error or failed API call instead of the login modal.
- **Fix:** Catch 401 errors from document-related API calls in the annotation panel and trigger the login modal (via `AppShell`'s `showLoginModal` state or the existing login modal pattern). The login modal should appear with a message like "Log in to view documents."
- **Files:** `ConceptAnnotationPanel.jsx`, `AppShell.jsx`

**Bug 2 — Silent failure for docs over 10MB:**
- **Symptom:** When a file exceeds 10MB, the upload fails silently — no error message shown to the user.
- **Root cause hypothesis:** The multer `LIMIT_FILE_SIZE` error middleware may not be surfacing the error response to the frontend, or the frontend's error handler doesn't display the 413 response.
- **Fix:** Verify the backend error middleware catches `MulterError` with code `LIMIT_FILE_SIZE` and returns a clear 413 JSON response. Verify the frontend upload handlers (`doFileUpload`, `doVersionUpload`) display `err.response?.data?.error` for 413 responses. Consider also adding a client-side file size check before upload for instant feedback.
- **Files:** `corpusController.js` (error middleware), `CorpusUploadForm.jsx` or `CorpusTabContent.jsx`

**Bug 3 — Tag search opens in both My Docs and All Docs:**
- **Symptom:** After clicking "Add tag," the search bar opens in both the My Documents and All Documents sections simultaneously, and typing appears in both. Only one search bar should be active.
- **Root cause hypothesis:** The tag search state is shared or duplicated between the two document list sections, likely because both sections reference the same state variable or the tag UI is rendered in both places.
- **Fix:** Ensure the tag search UI is scoped to the specific document being tagged. The search bar should only appear in the section where the user clicked "Add tag," not in both sections.
- **Files:** `CorpusTabContent.jsx` or `CorpusDocumentList.jsx`

**Bug 4 — Can't remove cancelled upload from tray:**
- **Symptom:** If the user cancels a document upload mid-process, the file remains in the upload UI tray. The only way to clear it is to refresh the page.
- **Fix:** Reset all upload-related state (`uploadFile`, `uploadDragOver`, `uploadFileError`, etc.) when the user cancels an upload. The cancel action should return the upload UI to its initial empty state.
- **Files:** `CorpusUploadForm.jsx` or `CorpusTabContent.jsx`

**Bug 5 — Duplicate document similarity percentage missing:**
- **Symptom:** The similarity percentage that used to appear during upload (warning about potential duplicate documents) is no longer showing. This feature existed before Phase 22a (file upload rewrite) and was likely lost during the rewrite.
- **Root cause hypothesis:** The `checkDuplicates` endpoint still exists in `corpusController.js`, but the frontend upload flow no longer calls it after the Phase 22a rewrite removed the old `handleCheckAndUpload` function.
- **Fix:** Reconnect the duplicate check to the file upload flow. After file selection (but before upload), call the `checkDuplicates` endpoint with the extracted text. If matches are found, display the similarity percentage and document title(s) as a warning, with an option to proceed or cancel. The backend `checkDuplicates` uses `pg_trgm similarity()` on the first 5,000 characters with a 0.3 threshold (Architecture Decision #69).
- **Files:** `corpusController.js` (verify endpoint still works), `CorpusUploadForm.jsx` or `CorpusTabContent.jsx`

**Suggested git commit:** `fix: 37c — guest document access, upload size error, tag search scope, cancelled upload reset, duplicate check reconnect`

---

#### Phase 37d: Quick Text & Style Fixes — ⏳ PLANNED

Five small fixes across several files. All are cosmetic/text changes.

**Fix 1 — Long concept names squish sorting toggles:**
- **Symptom:** In the concept view, very long concept names push the sort toggles (Graph Votes | Newest | Annotations | Top Annotation) off-screen or make them invisible.
- **Fix:** Add `overflow: hidden`, `textOverflow: 'ellipsis'`, `whiteSpace: 'nowrap'` to the concept name container, or use `flexShrink: 0` on the sort toggle row to prevent it from being compressed. The sort toggles should always be visible.
- **Files:** `Concept.jsx`

**Fix 2 — Swap vote shading doesn't match save vote shading:**
- **Symptom:** When a user votes for a swap, the visual indicator on the swap button or card is not shaded/styled the same way that save votes are (dark filled background).
- **Fix:** Apply the same active/voted styling pattern used for save votes (▲ dark filled background) to swap vote indicators. Check both `ConceptGrid.jsx` (⇄ button on child cards) and `SwapModal.jsx` (vote buttons in the modal).
- **Files:** `SwapModal.jsx`, `ConceptGrid.jsx`

**Fix 3 — Unicode escape 'u/2026' in diff modal search bar:**
- **Symptom:** The compare children diff view shows `u/2026` (a Unicode escape for the ellipsis character `…`) after the placeholder text in the search bar.
- **Fix:** Replace the escaped Unicode with a literal ellipsis character `…` in the placeholder string, or remove it entirely.
- **Files:** `DiffModal.jsx`

**Fix 4 — Search results show redundant "child: value" label:**
- **Symptom:** In search results, concepts that are already children of the current concept show "child: value" as a badge. Since all graphs are single-attribute (Phase 20a), the attribute name is redundant. Should just say "child."
- **Fix:** Change the badge text from `child: ${attributeName}` to just `child` in the search result rendering.
- **Files:** `SearchField.jsx`

**Fix 5 — Unsubscribe warning says "removes the corpus tab" (too vague):**
- **Symptom:** The unsubscribe confirmation dialog says "removes the corpus tab" which sounds like it might delete the corpus or its data. Should clarify it only removes the tab from the user's sidebar.
- **Fix:** Change the warning text to "removes the corpus tab from your sidebar" or similar clarification.
- **Files:** `CorpusTabContent.jsx` or `CorpusDetailView.jsx` (wherever the unsubscribe confirmation lives)

**Suggested git commit:** `fix: 37d — long name layout, swap vote shading, diff modal unicode, search label, unsubscribe text`

---

#### Phase 37e: Root Page & Tab Groups — ⏳ PLANNED

Two bugs related to root-level concept operations and tab group management.

**Bug 1 — Hiding a concept on the root page doesn't work:**
- **Symptom:** Flagging a root-level concept to trigger hiding (10+ flags → `is_hidden = true`) does not work. The concept remains visible on the root page after exceeding the flag threshold.
- **Root cause hypothesis:** Root edges have `parent_id = NULL` and `graph_path = '{}'`. The flagging system in `moderationController.js` may not correctly identify or process root edges. The `getRootConcepts` query's `is_hidden` filter may also not apply to root edges correctly.
- **Fix:** Trace the flag → hide pipeline for root edges specifically. Ensure: (1) the `flagEdge` endpoint can accept root edge IDs, (2) the `is_hidden` update works on root edges, (3) the `getRootConcepts` query filters `WHERE e.is_hidden = false` on the root edge join. If root edges are excluded from flagging entirely, that's the core issue.
- **Files:** `moderationController.js`, `conceptsController.js` (`getRootConcepts`), `Root.jsx`

**Bug 2 — Deleting a tab group gives internal server error:**
- **Symptom:** Server returns 500 when trying to delete a tab group.
- **Root cause hypothesis:** The delete endpoint may have a missing column reference, an FK constraint issue, or a bug in the SQL (e.g., trying to update `group_id` on both `graph_tabs` and `saved_tabs` but one of the table references is stale or the query fails).
- **Fix:** Check the `deleteTabGroup` endpoint's SQL. Per the schema, deleting a group should set `group_id = NULL` on member tabs (via `ON DELETE SET NULL` on the FK). The backend endpoint may be trying to do this manually and failing, or it may be trying to delete the `tab_groups` row before properly handling `sidebar_items` references.
- **Files:** Backend controller handling tab groups (likely in the sidebar/tab management routes), `AppShell.jsx`

**Suggested git commit:** `fix: 37e — root concept hiding, tab group deletion`

---

#### Phase 37f: Flip View & Annotation Creation — ⏳ PLANNED

Two bugs related to Flip View display and the annotation creation flow.

**Bug 1 — No sorting options visible in Flip View:**
- **Symptom:** The sort-by-similarity toggle (which should cycle through Sort by Links → Sort by Similarity ↓ → Sort by Similarity ↑) is not visible in Flip View. Per the status doc (Phase 4), this feature exists and should be displayed as flat view options (not a dropdown).
- **Root cause hypothesis:** The sort controls may have been accidentally removed or hidden during a visual cleanup phase (Phase 28a or 30d). The backend similarity computation still exists in `getConceptParents`.
- **Fix:** Verify the sort toggle UI exists in `FlipView.jsx`. If missing, re-add it as a flat horizontal toggle row (matching the Phase 29c sort selector style: `Graph Votes | Similarity ↓ | Similarity ↑`). If present but hidden, fix the rendering condition. Only show in contextual Flip View (similarity requires an origin context).
- **Files:** `FlipView.jsx`

**Bug 2 — Annotation auto-creates when concept is selected:**
- **Symptom:** During annotation creation, selecting a concept immediately creates the annotation before the user has had a chance to add quote text or a comment. The annotation should not be created until the user explicitly confirms.
- **Root cause hypothesis:** The annotation creation flow treats concept selection as the final step and immediately calls `createAnnotation`. There is no intermediate "review and confirm" step.
- **Fix:** Restructure the annotation creation flow to be multi-step with explicit confirmation:
  1. User opens annotation panel (via "Annotate" button or text selection shortcut)
  2. User fills in fields: quote text (optional, pre-filled if text was selected), comment (optional), concept search + selection, context/edge selection
  3. All fields are editable and visible before creation
  4. User clicks a "Create Annotation" confirm button to finalize
  5. Only then does the frontend call the `createAnnotation` API
- **Files:** Annotation creation component (likely in `CorpusTabContent.jsx` or `AnnotationPanel.jsx`)

**Suggested git commit:** `fix: 37f — flip view sorting controls, annotation creation confirm step`

---

#### Phase 37 Architecture Decisions

- **Architecture Decision #214 — Phone Uniqueness Check Moved to Send-Code Step (Phase 37b):** The phone number uniqueness check for registration is moved from `verifyRegister` (after OTP verification) to `sendCode` (before sending the OTP). A new `intent` parameter (`'login'` or `'register'`) on the `sendCode` endpoint controls the behavior: for `register` intent, the endpoint checks `phone_lookup` and rejects if the phone already exists; for `login` intent, no uniqueness check (user must exist). This prevents wasting Twilio API calls and gives users immediate feedback.

- **Architecture Decision #215 — Annotation Creation Requires Explicit Confirmation (Phase 37f):** Annotation creation is changed from "auto-create on concept selection" to a multi-step flow with an explicit "Create Annotation" button. All fields (quote text, comment, concept, context) are visible and editable before creation. This prevents accidental annotations and allows users to add quote text and comments before committing. The text selection shortcut still pre-fills the quote field but does not auto-create.

#### Phase 37 Verification Checklist
1. Guest users see swap vote counts on concept children (37a)
2. Root concept creation succeeds when concept name exists as non-root elsewhere (37a)
3. Non-author corpus members get 403 when trying to create a document version (37a)
4. Web links added in one context do NOT appear in other contexts (37a)
5. Web link creator can remove their own link (37a)
6. Registration shows "phone already exists" error before sending OTP code (37b)
7. Guest users clicking documents from graph see login modal, not error (37c)
8. Files over 10MB show a clear error message on upload (37c)
9. Tag search bar opens in only one document section at a time (37c)
10. Cancelling an upload clears the file from the upload UI (37c)
11. Duplicate document warning with similarity percentage appears during upload (37c)
12. Long concept names don't push sort toggles off-screen (37d)
13. Swap vote indicators use same shading style as save votes (37d)
14. Diff modal search bar has no Unicode escape characters (37d)
15. Search results for existing children say "child" not "child: value" (37d)
16. Unsubscribe warning says "removes the corpus tab from your sidebar" (37d)
17. Root concepts can be flagged and hidden when flag threshold is reached (37e)
18. Deleting a tab group succeeds without server error (37e)
19. Flip View shows sort-by-similarity toggle in contextual mode (37f)
20. Annotation creation requires explicit "Create Annotation" button click (37f)
21. Clean build: `cd frontend && npm run build` succeeds after all batches

---

### Phase 38: Post-Launch Enhancements — ⏳ PLANNED

**Goal:** New features and improvements planned for after public launch. Each sub-phase is independent and can be implemented in any order based on user feedback and priorities. Complexity estimates included for planning.

---

#### Phase 38a: Flip View Navigation Stays on Current Concept — ⏳ PLANNED

**Complexity:** Medium

**Current behavior:** Clicking an alt parent card in Flip View navigates to that parent concept's children view (you leave the current concept).

**New behavior:** Clicking an alt parent card switches context — the current concept stays the same, but the graph path updates to show the concept's children as they appear under the clicked parent. The user stays on the same concept but sees it in a different parent context.

**Implementation:**
- `FlipView.jsx`: Change the `onParentClick` handler to navigate within the current concept by updating the path (replacing the current parent context with the clicked parent context) instead of navigating to the parent concept itself.
- `Concept.jsx`: The `navigateInTab` call should keep `conceptId` the same but update the `path` to the clicked parent's context path.
- `AppShell.jsx`: The graph tab update should reflect the new path without changing the concept ID.
- After navigation, the view should switch from Flip View to children view (since you're now viewing the concept in the new context).

**Files:** `FlipView.jsx`, `Concept.jsx`, `AppShell.jsx`

---

#### Phase 38b: Swap Votes on Root-Level Concepts — ⏳ PLANNED

**Complexity:** Medium

**Current behavior:** Swap votes (⇄) only work for children of a concept (sibling relationships). Root-level concepts on the root page have no swap vote capability.

**New behavior:** Root concepts can be swap-voted against other root concepts. The ⇄ button appears on root concept cards. The swap modal shows other root concepts as swap targets.

**Implementation:**
- Root edges have `parent_id = NULL` and `graph_path = '{}'`. "Siblings" at the root level are all other root edges (same attribute).
- Backend: Extend swap vote validation to handle root edges. Two root edges are "siblings" if they share the same attribute (since all root edges have `parent_id = NULL` and `graph_path = '{}'`).
- Frontend: Add ⇄ button to root concept cards in `Root.jsx`. Open the `SwapModal` with root context.
- `SwapModal.jsx`: Handle the root case — fetch root siblings via a query for root edges with the same attribute as the target.

**Note:** This should be implemented before or alongside Phase 38c (expanded swap votes) since 38c removes the sibling restriction entirely.

**Files:** `Root.jsx`, `votesController.js`, `SwapModal.jsx`, `conceptsController.js`

---

#### Phase 38c: Expanded Swap Votes — Any Concept via Search — ⏳ PLANNED

**Complexity:** High

**Current behavior:** Swap votes are restricted to siblings (children of the same parent in the same graph context). The backend validates the sibling relationship before accepting a swap vote.

**New behavior:** Any concept in any context can be a swap target. The swap modal includes a search function to find concepts across the entire database. The sibling validation is removed entirely from the backend.

**Implementation:**

**Backend changes (`votesController.js`):**
- Remove the sibling validation check from `addSwapVote`. The `replacement_edge_id` can be any valid edge, not just a sibling.
- Update the `getSwapSuggestions` query to return all existing swap suggestions for the target edge, sorted by vote count descending (no longer filtered to siblings only).
- The `replace_votes` table schema does not need to change — `edge_id` and `replacement_edge_id` are already generic FK references to `edges(id)`.

**Frontend changes (`SwapModal.jsx`):**
- **Existing suggestions section:** Show all concepts that have received swap votes for this edge, sorted by vote count (highest first). Each card shows: concept name, attribute badge, parent context path, vote count, and a "Vote" / "Voted" toggle button.
- **Search section:** New search input field (reusing the `SearchField` pattern with debounced `pg_trgm` search). Results show concept name, attribute badge, and all parent contexts. User selects a specific context (edge) to vote for.
- **Navigation:** Each suggestion card and search result card has a navigation icon/button that opens the concept in a new graph tab (so the user can inspect it without losing their place). This is separate from the vote button.
- **No sibling/non-sibling distinction:** The suggestions list doesn't differentiate between siblings and non-siblings. All swap suggestions are treated equally.

**Architecture Decision #216 — Swap Votes Expanded Beyond Siblings (Phase 38c):** The sibling-only restriction on swap votes is removed. Any concept-in-context (edge) can be proposed as a replacement for any other. This reflects the reality that better alternatives may exist outside the immediate sibling set — a concept might better belong in a completely different branch of the hierarchy. The `replace_votes` schema is unchanged; only the backend validation and frontend UI expand scope.

**Files:** `SwapModal.jsx`, `votesController.js`, `api.js`, `ConceptGrid.jsx` (if swap button behavior changes)

---

#### Phase 38d: Graph Votes Page Revamp — Flat with Corpus Badges — ⏳ PLANNED

**Complexity:** Medium-High

**Current behavior:** The Graph Votes page (`SavedPageOverlay.jsx`) organizes saved concept trees into corpus-based tabs (one tab per subscribed corpus, plus "Uncategorized"). Trees are assigned to corpus tabs based on whether any concept in the tree appears as an annotation in that corpus.

**Problem:** Some voted-for concepts are children of annotation concepts but don't appear as annotations themselves. These fall through the corpus tab assignment and are invisible — not shown in any tab.

**New behavior:** Remove corpus tabs entirely. Show ALL graph trees the user has votes in on a single flat page. Trees that contain any concept appearing as an annotation in a subscribed corpus get a corpus badge (or multiple badges if the concept appears in multiple subscribed corpuses). Trees with no corpus associations appear without badges.

**Implementation:**

**Backend changes (`votesController.js`):**
- Simplify the `getUserSaves` endpoint (or create a new one) to return ALL saved edges without corpus tab grouping.
- Add a separate query that maps concept IDs to subscribed corpus names via `document_annotations` → `corpus_subscriptions`. Return this as a `conceptCorpusBadges` lookup alongside the saved edges.

**Frontend changes (`SavedPageOverlay.jsx`):**
- Remove the internal tab bar and corpus tab logic.
- Render all trees in a single scrollable list.
- Each tree card shows corpus badges (small colored pills with corpus name) if any concept in that tree has annotations in subscribed corpuses.
- Trees can still be reordered (the `saved_tree_order_v2` table may need to work without `corpus_id`, or use `corpus_id = NULL` for all entries in the new flat model).
- Sorting: default order by total vote count across the tree, with manual reordering preserved.

**Architecture Decision #217 — Graph Votes Page Flattened (Phase 38d):** The corpus-based tab system on the Graph Votes page is replaced with a single flat list showing all trees. Corpus badges on tree cards indicate annotation membership. This fixes the problem of "missing" trees that fell through corpus assignment (e.g., children of annotation concepts that aren't annotations themselves). The flat view is also simpler to understand — users see everything in one place.

**Files:** `SavedPageOverlay.jsx`, `votesController.js`, `api.js`

---

#### Phase 38e: Color Set Threshold & Count-Based Sorting — ⏳ PLANNED

**Complexity:** Medium

**Current behavior:** All vote sets get a color swatch regardless of size (even solo vote sets with 1 user). Swatches are ordered by Jaccard similarity (nearest-neighbor algorithm).

**New behavior:**
- **Threshold:** Only vote sets with 10+ users get a color swatch. Users whose vote pattern matches fewer than 10 people see no swatch for their pattern.
- **Sorting:** Swatches ordered left-to-right by user count (largest set first). Jaccard similarity sorting removed.
- **Scaling (future consideration):** Threshold may scale with total active users to keep color sets representing meaningful consensus. Suggested formula: `threshold = max(10, floor(total_active_users * 0.01))` — at 1,000 users it's 10, at 5,000 it's 50. This can be implemented when there's real user data to calibrate against.

**Implementation:**

**Backend changes (`conceptsController.js`):**
- In `getVoteSets`: After computing vote sets, filter out sets with `userCount < 10` before returning.
- Remove the Jaccard similarity nearest-neighbor sorting logic. Replace with simple `ORDER BY user_count DESC`.
- The `userSetIndex` (which set the current user belongs to) should return `null` if the user's set was filtered out by the threshold.
- `edgeToSets` mapping should only include sets that pass the threshold.

**Frontend changes (`VoteSetBar.jsx`, `Concept.jsx`):**
- Handle the case where the user has no visible swatch (their set was below threshold). No "Your vote set" border highlight in this case.
- Swatches render left-to-right by user count (the backend already returns them sorted).
- Remove any Jaccard-related display logic.

**Architecture Decision #218 — Color Set Visibility Threshold (Phase 38e):** Vote sets with fewer than 10 users are hidden from the color swatch display. This prevents the swatch bar from being cluttered with many small, meaningless patterns when the user base is small. Users below the threshold can still see their own votes (via the ▲ indicators on child cards) but won't see a dedicated color swatch. The threshold may be scaled with total user count in the future. Swatches are ordered by user count (largest first) instead of Jaccard similarity, since the similarity ordering was confusing and the primary signal is "how many people share this pattern."

**Files:** `conceptsController.js`, `VoteSetBar.jsx`, `Concept.jsx`

---

#### Phase 38f: Filter Annotations by Attribute — ⏳ PLANNED

**Complexity:** Low-Medium

**Current behavior:** The annotation panel for a document shows all annotations regardless of attribute. The only filters are identity-based (All | Corpus Members | Author).

**New behavior:** Add attribute filter toggles below the identity filter: `All | Value | Action | Tool | Question`. These are flat horizontal toggles (matching the identity filter style). The attribute filter composes with the identity filter — you can view "Author annotations that are [value]" by selecting both.

**Implementation:**
- Frontend-only filter on existing annotation data (annotations already include `attribute_name` via the edge join).
- New state variable `attributeFilter` in `CorpusTabContent.jsx` (default: `'all'`).
- Filter annotations client-side before rendering: if `attributeFilter !== 'all'`, only show annotations where `annotation.attribute_name === attributeFilter`.
- Toggle row renders below the identity filter row, same styling (flat buttons with active/inactive states).
- Only show enabled attributes (from `ENABLED_ATTRIBUTES` env var, already available via `getAttributes` API).

**Files:** `CorpusTabContent.jsx`

---

#### Phase 38g: Sort Annotations by Quote Position — ⏳ PLANNED

**Complexity:** Medium

**Current behavior:** Annotations are sorted by vote count descending.

**New behavior:** Add a "Sort by Position" option that orders annotations by where their `quote_text` appears in the document body. Annotations with no `quote_text` appear at the top (they're document-level annotations with no specific location). This sort option can be combined with the attribute filter (Phase 38f) — e.g., view only [value] annotations sorted by position.

**Implementation:**
- At render time, for each annotation with `quote_text`, compute the position by searching for `quote_text` in the document body (using `indexOf` or the same `TreeWalker` logic used for quote navigation). Use `quote_occurrence` to disambiguate multiple matches.
- Cache computed positions to avoid re-searching on every render.
- New sort toggle: `Votes | Position` (flat horizontal, composable with attribute filter).
- Annotations with no `quote_text` get position `-1` (sort to top).
- Secondary sort within same position: vote count descending.

**Files:** `CorpusTabContent.jsx`

---

#### Phase 38h: Add as Annotation from Graph View — ⏳ PLANNED

**Complexity:** High

**Current behavior:** Annotations can only be created from the document viewer (inside a corpus tab). To annotate a document with a concept, you must first navigate to the document, then create the annotation.

**New behavior:** A new "Add as Annotation" button in the concept view (graph context) lets users annotate documents with the current concept without leaving the graph. Opens a modal listing subscribed corpuses with their documents. Clicking a document card opens the annotation creation panel with the concept pre-filled. Existing annotations for that concept on that document are shown to prevent duplicates.

**Implementation:**

**New modal component (`AnnotateFromGraphModal.jsx`):**
- Lists user's subscribed corpuses as expandable sections.
- Each corpus section shows its documents as clickable cards.
- Clicking a document card:
  1. Fetches existing annotations for this concept on this document (new backend endpoint).
  2. Shows the existing annotations (if any) so the user can see what's already there.
  3. Opens the annotation creation form with: concept pre-filled (current concept + edge), document selected, fields for quote text (optional) and comment (optional), "Create Annotation" confirm button.
- The corpus + document determines the `corpus_id` and `document_id` for the annotation. The `edge_id` comes from the current concept's context.

**New backend endpoint:**
- `GET /api/documents/:documentId/annotations-for-concept/:conceptId?corpusId=N` — returns all annotations on this document in this corpus that reference any edge for this concept. Used to show existing annotations and prevent duplicates.

**Frontend integration:**
- "Add as Annotation" button appears in the concept view header (or action row), next to the existing action buttons.
- Button only visible to logged-in users with at least one corpus subscription.

**Files:** New `AnnotateFromGraphModal.jsx`, `Concept.jsx`, `corpusController.js` or `conceptsController.js`, `api.js`

---

#### Phase 38i: Delete Any Document Version — ⏳ PLANNED

**Complexity:** Unknown (requires investigation)

**Current behavior:** Per bug report, only the latest version can be deleted. It's unclear whether this is a frontend limitation (UI only shows delete button on latest version) or a backend restriction.

**Investigation needed:**
1. Check `corpusController.js` `deleteDocument` endpoint — does it restrict deletion to the latest version, or can it accept any version ID?
2. Check `CorpusTabContent.jsx` — does the delete button only render for the latest version in the version navigator?
3. Check the version chain integrity logic — deleting a mid-chain version sets `source_document_id = NULL` on downstream versions (via `ON DELETE SET NULL`). Is this handled gracefully in the UI?

**After investigation:** If it's frontend-only, add delete buttons to all versions in the version navigator (with appropriate confirmation dialogs noting that the version chain will be broken). If it's backend, update the endpoint to accept any version ID and handle chain integrity.

**Files:** `CorpusTabContent.jsx`, possibly `corpusController.js`

---

#### Phase 38j: Annotation Citation Links — ⏳ PLANNED

**Complexity:** High

**Goal:** Enable users to cite Orca annotations in external research documents. When those documents are later uploaded to Orca, cited annotations are automatically detected and displayed.

**User flow:**
1. User views Document A in Orca, sees a useful annotation
2. Clicks "Cite" button on the annotation → plain URL copied to clipboard (e.g., `https://orca.app/cite/a/456`)
3. User pastes URL into their research doc (Google Docs, Word, etc.)
4. User uploads their document to Orca as Document B
5. During text extraction, backend scans for `orca.app/cite/a/` URLs via regex
6. For each detected citation URL, backend resolves the annotation ID, stores a row in `document_citation_links` with snapshot metadata (concept name, quote snippet, document title, corpus name) for dead-link resilience
7. Document B's annotation panel shows a "Cited Annotations" section listing all detected citations as cards
8. Citation URLs in Document B's body render as clickable links in the document viewer
9. Clicking a citation card (or body link) navigates to the annotation in Document A's corpus context

**New database table:**

```sql
CREATE TABLE document_citation_links (
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

CREATE INDEX idx_citation_links_citing_doc ON document_citation_links(citing_document_id);
CREATE INDEX idx_citation_links_cited_annotation ON document_citation_links(cited_annotation_id);
```

**Key design decisions:**
- `cited_annotation_id` uses `ON DELETE SET NULL` — when the original annotation's document is deleted (cascading to the annotation), the citation row survives with `cited_annotation_id = NULL` but snapshot fields still show useful info.
- Detection happens at upload time and version upload time only (no re-scanning).
- Citation URLs are plain format: `https://{domain}/cite/a/{annotation_id}`.
- Non-Orca users visiting the URL see a login prompt.
- Snapshot metadata stored at detection time: `snapshot_concept_name`, `snapshot_quote_text`, `snapshot_document_title`, `snapshot_corpus_name`. These survive even if the original annotation or document is later deleted.

**Backend work:**
- **Citation URL generation:** No backend change needed — the URL format is deterministic from the annotation ID. Frontend generates it.
- **Citation detection in upload pipeline:** After text extraction in `uploadDocument` and `createVersion`, run a regex scan for `cite/a/(\d+)` URLs. For each match, resolve the annotation ID, fetch snapshot data (concept name via edge → concept join, quote text, document title, corpus name), and batch-insert into `document_citation_links`.
- **New endpoint:** `GET /api/documents/:id/citations` — returns all citation links for a document. For each citation: if `cited_annotation_id` is not null, fetch live annotation data (current concept name, quote text, document title, corpus name, annotation ID for navigation). If null, return snapshot data with an "unavailable" flag.
- **Citation URL route:** `/cite/a/:annotationId` — resolves to the correct corpus + document view with the annotation highlighted. If the user is not logged in, show the login modal. If the annotation no longer exists, show a "this annotation is no longer available" message.

**Frontend work:**
- **"Cite" button** on each annotation card in the document viewer. Copies the citation URL to clipboard. Shows brief "Copied!" confirmation tooltip.
- **"Cited Annotations" section** in the annotation panel for documents that have citations. Renders below the main annotations list. Each citation card shows: concept name, quote snippet (truncated), source document title, corpus name. Uses live data when annotation exists; snapshot data with "(no longer available)" indicator when it doesn't.
- **Citation card click:** Navigates to the source document in the correct corpus tab, scrolling to and highlighting the cited annotation. If the annotation is unavailable, shows a message.
- **Body link rendering:** In the document body, citation URLs (`cite/a/...`) are detected and rendered as styled clickable links (underlined, distinguished from regular text). Clicking a body link has the same navigation behavior as clicking the citation card.

**Architecture Decision #219 — Citation Links with Dead-Link Resilience (Phase 38j):** Annotation citations store snapshot metadata at detection time (concept name, quote text, document title, corpus name) in addition to the annotation FK. When the cited annotation's document is deleted (cascading to the annotation row), the `cited_annotation_id` becomes NULL via `ON DELETE SET NULL`, but the snapshot fields preserve enough information to display a meaningful "this annotation is no longer available" card. This is consistent with Orca's philosophy of preserving provenance information even when source entities are removed.

**Files:** `migrate.js`, `corpusController.js` (upload pipeline), new `citationController.js` or additions to `corpusController.js`, `routes/documents.js` or new `routes/citations.js`, `api.js`, `CorpusTabContent.jsx` (annotation panel + body renderer), `App.jsx` or `AppShell.jsx` (citation URL route)

---

#### Phase 38 Implementation Priority (suggested)

Based on impact and dependencies:
1. **38a** (Flip View navigation) — quick win, improves core navigation
2. **38f** (attribute filter) — low complexity, useful for researchers
3. **38g** (position sort) — medium complexity, natural companion to 38f
4. **38d** (Graph Votes revamp) — fixes a real data visibility bug
5. **38e** (color set threshold) — should wait until there are real users to calibrate
6. **38b** (root swap votes) — implement before 38c
7. **38c** (expanded swap votes) — depends on 38b
8. **38h** (annotate from graph) — high complexity, high value for power users
9. **38i** (delete any version) — needs investigation first
10. **38j** (citation links) — highest complexity, biggest differentiator for academic use case

---

## Design Philosophy

The visual interface pursues minimalism and Zen aesthetics. The background is a soft off-white and text is black in EB Garamond serif font (loaded via Google Fonts, with explicit `fontFamily` set on all interactive elements). The only color comes from the identical vote set swatches and dots; all other buttons use the black-on-off-white theme with neutral borders. No emoji icons in UI chrome — replaced with text labels (only ▲ vote and ⇄ swap retained as geometric symbols; plain Unicode ←→▸▾✕↓ kept as simple shapes). No italics anywhere in the UI. No colored buttons (green, red, blue all converted to transparent/dark with neutral borders in Phase 28a).

## My Claude Preferences
I want to move safely and use git versioning to avoid big mistakes with code editing. I want you to prompt me when I should consider a commit to git. I also want you to prompt me to make updates to this markdown file when it makes sense. If you think a bug is worth documenting to avoid similar things in the future, for example.

---

## External Resources

- **Node.js Docs:** https://nodejs.org/docs
- **Express.js Docs:** https://expressjs.com
- **React Docs:** https://react.dev
- **PostgreSQL Docs:** https://www.postgresql.org/docs
- **Vite Docs:** https://vitejs.dev

---

## Questions to Ask When Stuck

1. "What does the backend error log say?"
2. "What does the frontend console show?"
3. "What's the PostgreSQL query returning?" (use pgAdmin to test)
4. "Is the .env file loaded?" (add console.log to check)
5. "Are both servers running?"

---

**END OF TECHNICAL REFERENCE**
