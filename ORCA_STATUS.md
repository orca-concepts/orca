
# ORCA - Project Status & Technical Reference

**Last Updated:** March 31, 2026 (Phase 37 complete; Phase 38 complete; Phase 39 Combos planned; codebase published under AGPL v3)

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
- **No sibling restriction (Phase 38c):** Any edge can be proposed as a replacement for any other — the original sibling-only restriction was removed. The `replacement_edge_id` can reference any valid edge in any context.
- Backend validates that both edges exist and are different (can't swap with self)
- Multiple users can point to different replacements
- Visible to all users; purely informational — no automatic removal (append-only model)
- `edge_id` = the edge being flagged as replaceable
- `replacement_edge_id` = the edge that should replace it
- Indexes on both `edge_id` and `replacement_edge_id` for fast lookups
- Swap count (distinct users) returned as `swap_count` in children queries; `user_swapped` boolean returned for the current user (Phase 38b)
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

#### `document_citation_links` — ✅ IMPLEMENTED (Phase 38j)
Stores detected annotation citation URLs found in uploaded documents. When a document body contains an Orca citation URL (`cite/a/{annotationId}`), a row is created linking the citing document to the cited annotation with snapshot metadata for dead-link resilience.

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

**Key Points:**
- `cited_annotation_id` uses `ON DELETE SET NULL` — when the cited annotation is deleted (e.g., via document deletion cascade), the citation row survives with snapshot fields intact
- Detection happens at upload time (`uploadDocument`) and version upload time (`createVersion`) only — no re-scanning
- Citation URLs are plain format: `{origin}/cite/a/{annotationId}`
- Snapshot metadata (`snapshot_concept_name`, `snapshot_quote_text`, `snapshot_document_title`, `snapshot_corpus_name`) stored at detection time for dead-link resilience
- `ON DELETE CASCADE` from `citing_document_id` ensures cleanup when the citing document is deleted

#### `combos` — Phase 39a (planned)
User-created collections of edges (concepts-in-context) from across the graph system. Combos group related concepts from different graphs and attributes, presenting a unified view of all annotations attached to those edges.

```sql
CREATE TABLE combos (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_combos_name_lower ON combos (LOWER(name));
CREATE INDEX idx_combos_created_by ON combos(created_by);
```

**Key Points:**
- Combo names are unique (case-insensitive), enforced by the unique index on `LOWER(name)` — same pattern as corpuses
- `description` is optional free-text explaining the combo's purpose
- Only the owner (`created_by`) can add/remove edges from the combo
- **Combos cannot be deleted** — consistent with Orca's append-only philosophy
- `created_by` uses default FK behavior (not `ON DELETE SET NULL`) — if the owner deletes their account, the combo persists but becomes ownerless. Future consideration: ownership transfer similar to corpus transfer (Phase 35b).

#### `combo_edges` — Phase 39a (planned)
Junction table linking combos to edges (concepts-in-context). A combo contains one or more edges; the same edge can appear in multiple combos.

```sql
CREATE TABLE combo_edges (
  id SERIAL PRIMARY KEY,
  combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(combo_id, edge_id)
);

CREATE INDEX idx_combo_edges_combo ON combo_edges(combo_id);
CREATE INDEX idx_combo_edges_edge ON combo_edges(edge_id);
```

**Key Points:**
- `UNIQUE(combo_id, edge_id)` prevents duplicate edge entries in the same combo
- `ON DELETE CASCADE` from both FKs ensures cleanup
- Only the combo owner can INSERT/DELETE rows — enforced at the application level
- **Hidden edges stay:** If an edge's `is_hidden` becomes true via moderation, its annotations still appear on the combo page. The owner adding it implies trust.
- No `added_by` column needed since only the owner can add edges

#### `combo_subscriptions` — Phase 39a (planned)
Tracks which users are subscribed to which combos. Subscribing creates a persistent combo tab in the sidebar.

```sql
CREATE TABLE combo_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, combo_id)
);

CREATE INDEX idx_combo_subscriptions_user ON combo_subscriptions(user_id);
CREATE INDEX idx_combo_subscriptions_combo ON combo_subscriptions(combo_id);
```

**Key Points:**
- `UNIQUE(user_id, combo_id)` prevents duplicate subscriptions
- `ON DELETE CASCADE` from both `users` and `combos` ensures cleanup
- Subscribing creates a row in `sidebar_items` (item_type: `'combo'`); unsubscribing removes both
- Subscriber count displayed on combo listings and combo detail views
- Same pattern as `corpus_subscriptions`

#### `combo_annotation_votes` — Phase 39a (planned)
Votes on annotations within the context of a specific combo. These are separate from the corpus-level `annotation_votes` — a user can vote for an annotation in a combo without affecting its corpus vote count, and vice versa.

```sql
CREATE TABLE combo_annotation_votes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
  annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, combo_id, annotation_id)
);

CREATE INDEX idx_combo_annotation_votes_combo_annotation ON combo_annotation_votes(combo_id, annotation_id);
```

**Key Points:**
- `UNIQUE(user_id, combo_id, annotation_id)` — one vote per user per annotation per combo
- Combo votes are independent from corpus-level `annotation_votes` — both counts displayed on combo page annotation cards
- `ON DELETE CASCADE` from all three FKs ensures cleanup
- No auto-vote on annotation creation (unlike corpus annotations) — combo votes are always deliberate

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
| GET | `/:corpusId/documents/:documentId/annotations-for-concept/:conceptId` | Guest OK | Get annotations for a specific concept on a specific document within a corpus. Returns annotations where `edge.child_id = conceptId`, with parent context, creator username, vote counts. Sorted by vote_count DESC. (Phase 38h) |
| ~~GET~~ | ~~`/:id/children`~~ | ~~Guest OK~~ | ~~Get direct sub-corpuses of a corpus (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~GET~~ | ~~`/:id/tree`~~ | ~~Guest OK~~ | ~~Get full recursive tree of sub-corpuses (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~POST~~ | ~~`/:parentId/add-subcorpus`~~ | ~~Owner/Allowed~~ | ~~Set an existing corpus as a sub-corpus of a parent (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |
| ~~POST~~ | ~~`/:parentId/remove-subcorpus`~~ | ~~Owner/Allowed~~ | ~~Remove a sub-corpus link — corpus becomes top-level (Phase 12a)~~ — ❌ REMOVED (Phase 19a) |

### Documents (`/api/documents`) — ✅ IMPLEMENTED (Phase 7a, extended Phase 17a, 21c, 31d, 38j)

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
| GET | `/:id/citations` | Guest OK | Get all citation links for a document. Returns live annotation data when `cited_annotation_id` is not null, snapshot data with `unavailable: true` when it is. (Phase 38j) |

### Citations (`/api/citations`) — ✅ IMPLEMENTED (Phase 38j)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/resolve/:annotationId` | Required | Resolve a citation annotation ID to its corpus and document context for navigation. Returns `corpusId`, `documentId`, `annotationId`. (Phase 38j) |

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
│   │   │   ├── citations.js     # Citation resolution routes (Phase 38j)
│   │   │   ├── documents.js     # Document routes — standalone doc + tags + citations (Phase 7a, 17a, 38j)
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
    │   │   ├── AnnotateFromGraphPicker.jsx # Corpus/document picker for "Add as Annotation" from graph view (Phase 38h)
    │   │   ├── AnnotationPanel.jsx  # Text selection → concept search → annotation creation (Phase 7d, updated 26c, 38h — prefilledConcept/prefilledEdge props)
    │   │   ├── AppShell.jsx         # Unified tab bar shell (header + saved tabs + graph tabs + content area)
    │   │   ├── Breadcrumb.jsx      # Navigation breadcrumb (with names)
    │   │   ├── CitationRedirect.jsx # Citation URL redirect — /cite/a/:annotationId route (Phase 38j)
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


## Current Feature Status & Architecture Notes

**Note:** Detailed phase implementation narratives (Phases 1–36) and git commit logs have been moved to `ORCA_HISTORY.md` to keep this file focused on active reference material. The numbered architecture notes below and the phase summary list encode the rules and patterns that Claude Code needs for implementation work.

---

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
183. **Add as Annotation from Graph View (Phase 38h):** Users can annotate documents with the current concept directly from the graph view without navigating to the document first. The "Add as Annotation" button (children view only, logged-in users with a context) opens `AnnotateFromGraphPicker.jsx`, a lightweight corpus/document picker that shows subscribed corpuses with their documents and existing annotations for duplicate prevention. Selecting a document triggers the pending-document navigation pattern: `AppShell.handleAnnotateFromGraph` auto-subscribes if needed, sets `pendingCorpusDocumentId` + `pendingAnnotationFromGraph`, switches to the corpus tab. `CorpusTabContent` opens the document and the annotation creation panel with concept/edge pre-filled via `prefilledConcept`/`prefilledEdge` props on `AnnotationPanel.jsx`. The user can then see the document body, add quote text and comments, and confirm.
184. **Annotation Citation Links (Phase 38j):** Users can copy a citation URL for any annotation via a "Cite" button on annotation cards. Citation URLs use the format `/cite/a/{annotationId}`. When a document containing citation URLs is uploaded, the backend scans the body text via regex, resolves each annotation ID, and stores rows in `document_citation_links` with snapshot metadata (concept name, quote text, document title, corpus name). The "Cited Annotations" section in `CorpusTabContent` shows detected citations with live data when available or snapshot data with "(no longer available)" when the cited annotation has been deleted. Clicking a citation card navigates to the source document in the correct corpus. The `/cite/a/:annotationId` route is handled by `CitationRedirect.jsx` which resolves the annotation to its corpus/document context.
185. **Search Corpus Badge Tooltips Include Document Titles (Phase 38k):** The corpus annotation badges on search results now include hover tooltips showing the specific document title(s) where the concept is annotated. The tooltip is rendered via `ReactDOM.createPortal` into `document.body` with `position: fixed` to avoid affecting the search dropdown layout. The backend `searchConcepts` endpoint's corpus annotation surfacing query JOINs `documents` to collect titles per corpus.

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
- **Phase 37:** Pre-Launch Bug Fixes ✅ COMPLETE (37a–37f: backend controller fixes, auth registration, corpus/document UX, text/style fixes, root page/tab groups, flip view/annotation creation)
- **Phase 38:** Post-Launch Enhancements ✅ COMPLETE (38a–38k: flip view nav, root swap votes, expanded swap votes, graph votes revamp, color set threshold, attribute filter, position sort, annotate from graph, delete any version, citation links, search badge tooltip)
- **Phase 39:** Combos (39a: backend infrastructure, 39b: Browse Combos overlay, 39c: combo persistent tab, 39d: add to combo from graph, 39e: polish)
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


---

### Phase 37: Pre-Launch Bug Fixes — ✅ COMPLETE

**Goal:** Fix all bugs identified in the March 2026 QA pass that affect core functionality, user experience, or data integrity before public launch. Organized into six batches (37a–37f) grouped by file-touch area for efficient Claude Code sessions.

**Completed:** All six batches implemented, tested (Level 1 after each batch), and committed.

---

#### Phase 37a: Backend Controller Fixes — ✅ COMPLETE

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

#### Phase 37b: Auth & Registration — ✅ COMPLETE

One bug in the phone number registration flow.

**Bug — Phone "already exists" error shows too late:**
- **Symptom:** During registration, the user can send the OTP code before being told the phone number is already registered. The check should happen as soon as the phone number is entered, before the code is sent.
- **Root cause hypothesis:** The phone uniqueness check currently lives in `verifyRegister` (after code verification), not in `sendCode` (before sending the OTP).
- **Fix:** Add a phone uniqueness check to the `sendCode` endpoint. When `intent=register` (or a new parameter indicating registration), look up the phone number via `phone_lookup` (HMAC-SHA256). If a user already exists with that `phone_lookup`, return an error immediately — before calling Twilio. The frontend should display this error on the phone number input step. For `intent=login`, the existing flow is fine (user must exist).
- **Implementation detail:** The `sendCode` endpoint currently doesn't distinguish between login and register intents. Add an optional `intent` query parameter or body field (`'login'` or `'register'`). For `register` intent, check uniqueness first. For `login` intent, optionally check that the user exists (nice-to-have: "no account with this phone number" error before sending code).
- **Files:** `authController.js`, `routes/auth.js`, `LoginModal.jsx`, `AuthContext.jsx`, `api.js`

**Suggested git commit:** `fix: 37b — check phone uniqueness before sending OTP code during registration`

---

#### Phase 37c: Corpus & Document Frontend UX — ✅ COMPLETE

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

#### Phase 37d: Quick Text & Style Fixes — ✅ COMPLETE

Five small fixes across several files. All are cosmetic/text changes.

**Fix 1 — Long concept names squish sorting toggles:**
- **Symptom:** In the concept view, very long concept names push the sort toggles (Graph Votes | Newest | Annotations | Top Annotation) off-screen or make them invisible.
- **Fix:** Add `overflow: hidden`, `textOverflow: 'ellipsis'`, `whiteSpace: 'nowrap'` to the concept name container, or use `flexShrink: 0` on the sort toggle row to prevent it from being compressed. The sort toggles should always be visible.
- **Files:** `Concept.jsx`

**Fix 2 — Swap vote shading doesn't match save vote shading:**
- **Symptom:** When a user votes for a swap, the visual indicator on the swap button or card is not shaded/styled the same way that save votes are (dark filled background).
- **Fix:** Apply the same active/voted styling pattern used for save votes (▲ dark filled background) to swap vote indicators. Check both `ConceptGrid.jsx` (⇄ button on child cards) and `SwapModal.jsx` (vote buttons in the modal).
- **Files:** `SwapModal.jsx`, `ConceptGrid.jsx`
- **Status:** Partially complete in Phase 37d. `SwapModal.jsx` vote buttons fixed. `ConceptGrid.jsx` ⇄ per-user active styling completed in Phase 38b/38c — backend now returns `user_swapped` field and `swapButtonActive` style is applied.

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

#### Phase 37e: Root Page & Tab Groups — ✅ COMPLETE

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

#### Phase 37f: Flip View & Annotation Creation — ✅ COMPLETE

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

### Phase 38: Post-Launch Enhancements — ✅ COMPLETE

**Goal:** New features and improvements planned for after public launch. Each sub-phase is independent and can be implemented in any order based on user feedback and priorities. Complexity estimates included for planning.

**Completed:** 38a, 38b, 38c, 38d, 38e, 38f, 38g, 38h, 38i, 38j, 38k (all 11)

---

#### Phase 38a: Flip View Navigation Stays on Current Concept — ✅ COMPLETE

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

#### Phase 38b: Swap Votes on Root-Level Concepts — ✅ COMPLETE

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

#### Phase 38c: Expanded Swap Votes — Any Concept via Search — ✅ COMPLETE

**Complexity:** High

**Current behavior:** Swap votes are restricted to siblings (children of the same parent in the same graph context). The backend validates the sibling relationship before accepting a swap vote.

**New behavior:** Any concept in any context can be a swap target. The swap modal includes a search function to find concepts across the entire database. The sibling validation is removed entirely from the backend.

**Implementation:**

**Backend changes (`votesController.js`):**
- Remove the sibling validation check from `addSwapVote`. The `replacement_edge_id` can be any valid edge, not just a sibling.
- Update the `getSwapSuggestions` query to return all existing swap suggestions for the target edge, sorted by vote count descending (no longer filtered to siblings only).
- The `replace_votes` table schema does not need to change — `edge_id` and `replacement_edge_id` are already generic FK references to `edges(id)`.

**Backend changes (`conceptsController.js`) — deferred from Phase 37d:**
- Add `user_swapped` field to the children response in `getConceptWithChildren`. Use a `BOOL_OR(rv.user_id = $userId)` subquery on `replace_votes`, matching the existing `user_voted` pattern for save votes. For guests, pass `-1` as user ID (same as save votes). This enables the frontend `ConceptGrid.jsx` ⇄ button to show per-user active styling (the `swapButtonActive` style is already defined and ready from Phase 37d).

**Frontend changes (`SwapModal.jsx`):**
- **Existing suggestions section:** Show all concepts that have received swap votes for this edge, sorted by vote count (highest first). Each card shows: concept name, attribute badge, parent context path, vote count, and a "Vote" / "Voted" toggle button.
- **Search section:** New search input field (reusing the `SearchField` pattern with debounced `pg_trgm` search). Results show concept name, attribute badge, and all parent contexts. User selects a specific context (edge) to vote for.
- **Navigation:** Each suggestion card and search result card has a navigation icon/button that opens the concept in a new graph tab (so the user can inspect it without losing their place). This is separate from the vote button.
- **No sibling/non-sibling distinction:** The suggestions list doesn't differentiate between siblings and non-siblings. All swap suggestions are treated equally.

**Architecture Decision #216 — Swap Votes Expanded Beyond Siblings (Phase 38c):** The sibling-only restriction on swap votes is removed. Any concept-in-context (edge) can be proposed as a replacement for any other. This reflects the reality that better alternatives may exist outside the immediate sibling set — a concept might better belong in a completely different branch of the hierarchy. The `replace_votes` schema is unchanged; only the backend validation and frontend UI expand scope.

**Files:** `SwapModal.jsx`, `votesController.js`, `api.js`, `ConceptGrid.jsx` (if swap button behavior changes)

---

#### Phase 38d: Graph Votes Page Revamp — Flat with Corpus Badges — ✅ COMPLETE

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

#### Phase 38e: Color Set Threshold & Count-Based Sorting — ✅ COMPLETE

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

#### Phase 38f: Filter Annotations by Attribute — ✅ COMPLETE

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

#### Phase 38g: Sort Annotations by Quote Position — ✅ COMPLETE

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

#### Phase 38h: Add as Annotation from Graph View — ✅ COMPLETE

**Complexity:** High

**Current behavior:** Annotations can only be created from the document viewer (inside a corpus tab). To annotate a document with a concept, you must first navigate to the document, then create the annotation.

**New behavior:** A new "Add as Annotation" button in the concept view (graph context) lets users annotate documents with the current concept without leaving the graph. Opens a picker modal listing subscribed corpuses with their documents. Clicking a document navigates to the corpus tab doc viewer with the annotation creation panel pre-filled with the current concept and edge. Existing annotations for that concept on each document are shown inline in the picker to prevent duplicates.

**Implementation:**

**New backend endpoint:**
- `GET /api/corpuses/:corpusId/documents/:documentId/annotations-for-concept/:conceptId` — guest-accessible via `optionalAuth`. Returns all annotations on a document within a corpus that reference any edge where `child_id = conceptId`. Includes parent context info (parent_name, graph_path, attribute_name), creator username, vote_count, user_voted. Uses LEFT JOIN on users and concepts (SET NULL FK safety). Sorted by vote_count DESC, created_at DESC.

**New picker component (`AnnotateFromGraphPicker.jsx`):**
- Lightweight corpus/document picker modal — no annotation creation form inside.
- Lists subscribed corpuses as expandable sections with document counts.
- Expanded corpus shows documents; for each document, fetches existing annotations via the Part 1 endpoint and filters to the current edge for duplicate detection.
- Existing annotations shown inline below document cards (quote text + comment, truncated).
- Clicking a document triggers navigation to the corpus tab doc viewer.

**Navigation flow (via existing pending-document pattern):**
- `Concept.jsx` → `onAnnotateFromGraph` callback → `AppShell.handleAnnotateFromGraph` auto-subscribes to corpus if needed, sets `pendingCorpusDocumentId` + `pendingAnnotationFromGraph`, switches to corpus tab → `CorpusTabContent` opens the document and the annotation creation panel with concept/edge pre-filled via new `prefilledConcept`/`prefilledEdge` props on `AnnotationPanel.jsx`.

**Frontend integration:**
- "Add as Annotation" button appears in concept view header, only in children view (not flip view), only for logged-in users with a parent edge context.
- `AnnotationPanel.jsx` accepts optional `prefilledConcept` and `prefilledEdge` props that skip concept search and context picker steps.

**Files:** New `AnnotateFromGraphPicker.jsx`, modified `AnnotationPanel.jsx`, `Concept.jsx`, `AppShell.jsx`, `CorpusTabContent.jsx`, `corpusController.js`, `corpuses.js` (route), `api.js`

---

#### Phase 38i: Delete Any Document Version — ✅ COMPLETE

**Complexity:** Low (frontend-only fix)

**Problem:** Only the latest version could be deleted — the delete button was restricted to the most recent version in the version navigator.

**Investigation result:** The backend `deleteDocument` endpoint already accepted any version ID. The restriction was frontend-only — `CorpusTabContent.jsx` only rendered the delete button for the latest version in the version chain.

**Fix:** Extended the delete button to appear on all versions in the version history panel, with confirmation dialogs. Deleting a mid-chain version sets `source_document_id = NULL` on downstream versions (via `ON DELETE SET NULL`), which the UI handles gracefully.

**Files:** `CorpusTabContent.jsx`

---

#### Phase 38j: Annotation Citation Links — ✅ COMPLETE

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

**Files:** `migrate.js`, `corpusController.js` (upload pipeline + citation resolution), `routes/citations.js`, `routes/documents.js`, `api.js`, `CorpusTabContent.jsx` (annotation panel + body renderer + cite button + cited annotations section), `CitationRedirect.jsx`, `App.jsx` (citation URL route)

---

#### Phase 38k: Search Result Corpus Badge Tooltip + "Saved" → "Voted" Rename — ✅ COMPLETE

**Complexity:** Low

**Changes:**
1. **Corpus badge tooltip:** When search results show corpus annotation badges, hovering shows the specific document title(s) where the concept is annotated in that corpus. Tooltip rendered via `ReactDOM.createPortal` into `document.body` with fixed positioning above the badge — avoids affecting dropdown layout.
2. **"Saved" → "Voted" rename:** The green badge on search results for concepts the user has voted on now says "Voted" instead of showing the saved tab name (which was "Saved").

**Backend:** Extended the corpus annotation surfacing query in `searchConcepts` to JOIN `documents` and return `documentTitles` array per corpus (via `array_agg`-style grouping in JS).

**Frontend:** Portal-based tooltip on corpus badges showing "Annotated in: Doc1, Doc2, ..." on hover (truncated at 4 titles with "and N more"). Badge text changed from `result.savedTabs.map(t => t.tabName)` to static "Voted".

**Files:** `conceptsController.js`, `SearchField.jsx`

---

#### Phase 38 Implementation Priority (completed)

1. ~~**38a** (Flip View navigation)~~ ✅
2. ~~**38f** (attribute filter)~~ ✅
3. ~~**38g** (position sort)~~ ✅
4. ~~**38d** (Graph Votes revamp)~~ ✅
5. ~~**38e** (color set threshold)~~ ✅
6. ~~**38b** (root swap votes)~~ ✅
7. ~~**38c** (expanded swap votes)~~ ✅
8. ~~**38h** (annotate from graph)~~ ✅
9. ~~**38i** (delete any version)~~ ✅
10. ~~**38j** (citation links)~~ ✅
11. ~~**38k** (search corpus badge tooltip + "Saved" → "Voted" rename)~~ ✅

---

### Phase 39: Combos — PLANNED

**Goal:** Let users group concepts-in-context (edges) from across different graphs and attributes into named collections called "combos." A combo page shows all annotations attached to its member edges, with filtering, sorting, and combo-specific voting. Users subscribe to combos for persistent sidebar tabs.

**UI terminology:** "Combo" everywhere (database tables, API, frontend). The Browse page is "Browse Combos." Sidebar tabs show the combo name.

---

#### Phase 39a: Backend Infrastructure — Tables, CRUD, Subscriptions

**Complexity:** High

**New database tables:** `combos`, `combo_edges`, `combo_subscriptions`, `combo_annotation_votes` (see Database Schema section for full schemas).

**New API endpoints (`/api/combos`):**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/` | Guest OK | List all combos (with creator username, edge count, annotation count, subscriber count). Supports `?search=` for name search and `?sort=new|subscribers` (default: subscribers). |
| GET | `/:id` | Guest OK | Get combo details + list of member edges with concept names, paths, attributes |
| GET | `/:id/annotations` | Required | Get all annotations across all edges in the combo. Supports `?sort=combo_votes|new|annotation_votes` (default: combo_votes), `?edgeIds=1,2,3` for subconcept filtering. Returns annotation data with concept badges, both combo vote count and corpus-level vote count, user vote status for both. |
| POST | `/create` | Required | Create a new combo (name, description). Creator auto-subscribes. |
| GET | `/mine` | Required | List combos owned by the current user (for the "Add to Combo" picker) |
| GET | `/subscriptions` | Required | Get current user's combo subscriptions with details |
| POST | `/subscribe` | Required | Subscribe to a combo (creates sidebar item) |
| POST | `/unsubscribe` | Required | Unsubscribe from a combo (removes sidebar item) |
| POST | `/:id/edges/add` | Owner only | Add an edge to the combo. Body: `{ edgeId }`. Returns 409 if already in combo. |
| POST | `/:id/edges/remove` | Owner only | Remove an edge from the combo. Body: `{ edgeId }`. |
| POST | `/:id/annotations/vote` | Required | Vote on an annotation within this combo context |
| POST | `/:id/annotations/unvote` | Required | Remove combo vote on an annotation |

**Sidebar integration:**
- New `item_type: 'combo'` in `sidebar_items` table
- Subscribe/unsubscribe auto-manage `sidebar_items` rows (same pattern as corpuses)

**Files:** `migrate.js`, new `comboController.js`, new `routes/combos.js`, `server.js`, `api.js`, `votesController.js` (sidebar items update)

**Suggested git commit:** `feat: 39a — combo backend infrastructure, CRUD, subscriptions, combo annotation votes`

---

#### Phase 39b: Browse Combos Overlay

**Complexity:** Medium

**New sidebar button:** "Browse Combos" alongside existing "Browse Corpuses" button (rename current "Browse" to "Browse Corpuses").

**Browse Combos overlay** (same pattern as corpus browse — full-page overlay via AppShell state):
- Lists all combos in the system as cards
- Each card shows: combo name, description (truncated), creator username, subconcept count, annotation count, subscriber count
- Search bar for filtering by name (frontend filter on loaded data, or backend `?search=` param for scalability)
- Sort toggle: New (created_at desc) | Subscribers (count desc)
- Subscribe/Unsubscribe button on each card
- Clicking a combo name subscribes (if not already) and switches to the combo's persistent tab

**Files:** New `ComboListView.jsx`, `AppShell.jsx` (sidebar button + overlay state), `api.js`

**Suggested git commit:** `feat: 39b — Browse Combos overlay with search, sort, subscribe`

---

#### Phase 39c: Combo Page (Persistent Tab)

**Complexity:** High

**New component:** `ComboTabContent.jsx` — rendered in main content area when a combo tab is active (same pattern as `CorpusTabContent.jsx`).

**Layout:**
- Header: combo name, description, creator username, subscriber count, unsubscribe button
- Owner controls (visible to owner only): "Add Subconcept" button opening a search/picker, list of current subconcepts with remove buttons
- Subconcept filter bar: clickable concept badges (multi-select toggle) to filter annotations to specific subconcepts
- Sort toggle: Combo Votes | New | Annotation Votes
- Annotation card list: flat list of annotation cards, each showing:
  - Document title (clickable — navigates to document in corpus context)
  - Quote text (if present)
  - Comment (if present)
  - Concept badge(s) indicating which subconcept edge this annotation belongs to
  - Combo vote count + vote button (combo-specific)
  - Corpus-level vote count (read-only display)
  - Creator username
- Empty states: no subconcepts yet (owner prompt to add), subconcepts but no annotations

**Add subconcept picker (owner only):**
- Search field using existing concept search (`/api/concepts/search`)
- Results show concept name + attribute + parent context path
- Selecting a result shows available edges (contexts) for that concept
- Owner picks a specific edge to add to the combo
- Confirmation feedback + badge appears in filter bar

**Click-through navigation:**
- Clicking a document title on an annotation card navigates to the document in its corpus context (same pending-document pattern as ConceptAnnotationPanel click-through: auto-subscribe to corpus if needed, set pendingCorpusDocumentId + pendingAnnotationId, switch to corpus tab)

**Files:** New `ComboTabContent.jsx`, `AppShell.jsx` (combo tab rendering, pending navigation), `api.js`

**Suggested git commit:** `feat: 39c — combo persistent tab with annotation list, filtering, sorting, combo votes, owner subconcept management`

---

#### Phase 39d: Add to Combo from Graph View

**Complexity:** Medium

**New UI:** "Add to Combo" button on concept cards in children view. Only visible to logged-in users who own at least one combo.

**Flow:**
1. User clicks "Add to Combo" on a concept card in children view
2. Picker modal shows the user's owned combos (fetched via `GET /api/combos/mine`)
3. User selects a combo
4. Backend adds the edge to the combo (or shows "already in combo" if duplicate)
5. Brief confirmation feedback

**Implementation:**
- Button appears in `ConceptGrid.jsx` alongside ▲ vote and ⇄ swap buttons
- Picker component similar to the saved tab picker pattern — lightweight modal/dropdown
- Uses existing `POST /api/combos/:id/edges/add` endpoint

**Files:** `ConceptGrid.jsx`, new picker component (or inline in ConceptGrid), `api.js`

**Suggested git commit:** `feat: 39d — add to combo from graph view with combo picker`

---

#### Phase 39e: Polish & Edge Cases

**Complexity:** Low-Medium

**Tasks:**
- Sidebar drag-and-drop integration for combo tabs (update `SidebarDndContext.jsx` to handle `item_type: 'combo'`)
- Combo tabs rendered with `display: none` when inactive (same hide-not-unmount pattern as corpus/graph tabs)
- Tab groups: combo tabs can be placed in tab groups alongside corpus and graph tabs
- Graph tab placement: graph tabs can be placed inside combo sidebar items (update `user_corpus_tab_placements` or create parallel table)
- Frontend build verification (`npm run build`)
- Test Level 1 regression sweep

**Files:** `SidebarDndContext.jsx`, `AppShell.jsx`, `votesController.js` (tab group handling)

**Suggested git commit:** `feat: 39e — combo sidebar polish, drag-and-drop, tab groups, build verification`

---

#### Phase 39 Architecture Decisions

- **Architecture Decision #220 — Combos Are Permanent (Phase 39):** Combos cannot be deleted, matching Orca's append-only philosophy. There is no archive or retire mechanism. A combo with zero subscribers still appears in Browse Combos. If the owner deletes their account, the combo persists but becomes ownerless (no one can add/remove edges). Future: ownership transfer could be added following the corpus transfer pattern (Phase 35b).

- **Architecture Decision #221 — Combo Votes Are Independent from Corpus Votes (Phase 39):** The `combo_annotation_votes` table is separate from `annotation_votes`. An annotation's combo vote count and corpus vote count are completely independent numbers. Both are displayed on combo page annotation cards. This reflects that an annotation's value in a combo context may differ from its value in its original corpus context — different communities may weight the same annotation differently.

- **Architecture Decision #222 — Hidden Edges Remain Visible in Combos (Phase 39):** When an edge is hidden via moderation (`is_hidden = true`), its annotations still appear on combo pages that include that edge. The combo owner's deliberate act of adding the edge implies a level of trust. This differs from graph views where hidden edges are filtered out.

- **Architecture Decision #223 — Browse Combos Renamed from Browse Button (Phase 39):** The existing "Browse" sidebar button is renamed to "Browse Corpuses" and a new "Browse Combos" button is added alongside it. Both open full-page overlays with the same interaction pattern.

#### Phase 39 Implementation Priority

1. **39a** (backend infrastructure) — must be first
2. **39b** (Browse Combos overlay) — enables discovery
3. **39c** (combo persistent tab) — the core experience
4. **39d** (add to combo from graph) — convenience feature
5. **39e** (polish) — final cleanup

#### Phase 39 Verification Checklist
1. Create a combo with name and description — succeeds
2. Duplicate combo name (case-insensitive) — returns 409
3. Subscribe/unsubscribe — sidebar item appears/disappears
4. Owner adds edge to combo — edge appears in subconcept list
5. Owner removes edge from combo — edge removed
6. Non-owner cannot add/remove edges — returns 403
7. Combo page shows annotations from all member edges
8. Subconcept filter toggles work (multi-select)
9. Sort by combo votes / new / annotation votes all work correctly
10. Combo vote button works — independent from corpus vote count
11. Both vote counts displayed on annotation cards
12. Click annotation card → navigates to document in corpus context
13. Browse Combos shows all combos with search and sort
14. Add to Combo from graph view works for combo owners
15. Non-owners don't see "Add to Combo" button (unless they own other combos)
16. Sidebar drag-and-drop works with combo tabs
17. Combo tabs persist across refresh/logout
18. Clean build: `cd frontend && npm run build` succeeds
19. Hidden edge annotations still appear on combo page
20. Combo with no edges shows appropriate empty state

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
