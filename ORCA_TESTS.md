# ORCA — Testing Checklist

**Purpose:** This file is the authoritative testing checklist for the Orca app. Claude Code must read this file after implementing any code change and run tests according to the Run Levels below. Do not consider a task complete until the required tests pass.

**Writing style:** Tests are written in natural language. Claude Code should interpret each test and determine the appropriate verification method (curl, psql, `npm run build`, file inspection, subagent checks, etc.).

**Test users:** alice, bob, carol, dave, eve, frank (all have bcrypt-hashed fake phone numbers and fake emails)

---

## Run Levels

There are three run levels. The prompt you receive will tell you which level to use. If it doesn't specify, default to Level 1.

### Level 1 — Standard (default after every change)
Run these:
- **Section 0 (Build & Startup)** — always, no exceptions
- **Every section directly touched by your changes** — use your judgment
- **Core regression sweep (Sections 2, 5, 6, 7, 12)** — Concepts, Corpuses, Documents, Annotations, and Account Deletion. These are the areas where cross-cutting bugs most often hide. Run them even if you don't think your changes affect them.

### Level 2 — Full Regression (run when prompted, or before major commits)
Run **every section, every test, no skipping.** Report all results organized by section number. This is the comprehensive sweep. Miles will prompt this with: "Run the full ORCA_TESTS.md checklist."

### Level 3 — Targeted (run when prompted for a specific section)
Run only the specific section(s) Miles names. Example: "Run Section 8 (Messaging) tests only."

---

## 0. Build & Startup (ALWAYS RUN — every level)

- [ ] Frontend builds cleanly: `cd frontend && npm run build` produces zero errors
- [ ] Backend starts without crashing: `cd backend && node src/server.js` starts and connects to the database
- [ ] No console errors on the backend startup log (watch for "Cannot find module" or similar)

---

## 1. Authentication (Phone OTP)

- [ ] Sending a verification code to a phone number returns success (POST `/api/auth/send-code`)
- [ ] Cannot register without providing an email address — returns an error
- [ ] Cannot register without checking the age verification box (`ageVerified: true`) — returns an error
- [ ] Cannot register with an invalid email format (no @, no dot) — returns an error
- [ ] Successful registration stores the email in `users.email` and sets `age_verified_at` to a timestamp
- [ ] Successful registration returns a JWT token
- [ ] Successful login returns a JWT token
- [ ] The `/api/auth/me` endpoint returns the current user's info when given a valid JWT
- [ ] The `/api/auth/me` endpoint returns 401 when given no token or an invalid token
- [ ] "Log out everywhere" (`POST /api/auth/logout-everywhere`) sets `token_issued_after` and subsequent requests with the old token return 401
- [ ] Rate limiting: more than 5 send-code requests from the same IP within 15 minutes are rejected

---

## 2. Concepts & Graph Navigation

- [ ] Root concepts page (`GET /api/concepts/root`) returns all root concepts
- [ ] Creating a root concept requires an `attributeId` — returns error without one
- [ ] Creating a root concept with an attribute creates both the concept and a root edge (`parent_id = NULL`, `graph_path = '{}'`)
- [ ] Creating a child concept in a context creates the edge with the correct `graph_path` (root-to-parent, not including child)
- [ ] Concept names are capped at 255 characters — longer names are rejected
- [ ] Creating a concept with a name that already exists reuses the existing concept ID (case-insensitive match)
- [ ] Cycle detection: cannot create a child that would be its own ancestor — returns an error
- [ ] Getting a concept with children (`GET /api/concepts/:id?path=...`) returns children sorted by save count descending (default)
- [ ] Sort by new (`?sort=new`) returns children sorted by edge `created_at` descending
- [ ] Each child in the response includes: `edge_id`, `vote_count`, `user_voted`, `child_count`, `attribute_id`, `attribute_name`, `swap_count`
- [ ] Hidden concepts (`is_hidden = true`) do not appear in children lists
- [ ] Concept search (`GET /api/concepts/search?q=...`) returns results using trigram similarity
- [ ] Guest users (no JWT) can view concepts and children but cannot create concepts

---

## 3. Voting (Save / Swap / Link)

### Save votes
- [ ] Saving an edge (`POST /api/votes/add`) creates a vote and saves the full path
- [ ] Saving the same edge twice returns an appropriate response (not a crash)
- [ ] Unsaving an edge (`POST /api/votes/remove`) cascades to all descendant edges in that branch
- [ ] Save count on children updates correctly after adding/removing saves

### Swap votes
- [ ] Adding a swap vote validates that the replacement is a sibling (same `parent_id` and `graph_path`)
- [ ] Adding a swap vote on a non-sibling returns an error
- [ ] Save and swap are mutually exclusive: saving removes any existing swap on that edge; swapping removes any existing save (with cascading unsave to descendants)

### Link votes (Flip View)
- [ ] Link votes can only be added in contextual Flip View (with an `originEdgeId`)
- [ ] Adding and removing link votes updates the link count correctly

---

## 4. Flip View

- [ ] Getting parents for a concept (`GET /api/concepts/:id/parents?originPath=...`) returns all parent contexts
- [ ] Contextual Flip View (with `originPath`) returns `originEdgeId` and link vote counts
- [ ] Decontextualized Flip View (from search, no `originPath`) returns parents without link vote UI
- [ ] Jaccard similarity scores appear correctly (shared children / total unique children)

---

## 5. Saved Page

- [ ] The Saved Page shows corpus-based tabs (one per subscribed corpus, plus "Uncategorized")
- [ ] Saves appear under the correct corpus tab based on annotation membership
- [ ] Tree ordering (up/down arrows) persists between sessions — check `saved_tree_order_v2` table
- [ ] Save removal from the Saved Page works and cascading unsave removes descendants

---

## 6. Corpuses

- [ ] Creating a corpus with a unique name succeeds
- [ ] Creating a corpus with a duplicate name (case-insensitive) returns 409 Conflict
- [ ] Renaming a corpus to an existing name returns 409 Conflict
- [ ] Only the corpus owner can update, delete, or manage documents
- [ ] Corpus listing (`GET /api/corpuses/`) is guest-accessible and shows document counts and owner usernames
- [ ] Subscribing to a corpus creates a `corpus_subscriptions` row and a `sidebar_items` row
- [ ] Unsubscribing removes both the subscription and the sidebar item
- [ ] Deleting a corpus cascades to `corpus_documents`, subscriptions, and sidebar items
- [ ] Browse Corpuses page has a working client-side search/filter field

---

## 7. Documents

### Upload
- [ ] Uploading a .txt file stores the text in `documents.body` with format `'plain'`
- [ ] Uploading a .md file stores the text with format `'markdown'`
- [ ] Uploading a .pdf file extracts text via pdf-parse with format `'pdf'`
- [ ] Uploading a .docx file extracts text via mammoth with format `'docx'`
- [ ] Cannot upload without checking the copyright confirmation checkbox — returns an error
- [ ] Successful upload sets `copyright_confirmed_at` to a timestamp on the document row
- [ ] Document titles must be unique (case-insensitive) — duplicate returns 409 Conflict
- [ ] Only corpus owner or allowed users can upload documents

### Versions
- [ ] Creating a version increments `version_number` and sets `source_document_id` to the predecessor
- [ ] Version creation requires copyright confirmation — same as original upload
- [ ] Version creation copies all `document_annotations` and `annotation_votes` from source to new version
- [ ] Version creation does NOT copy `message_threads`
- [ ] New versions inherit the source document's `tag_id`
- [ ] Version history endpoint returns all versions in the lineage ordered by version number

### Deletion (Phase 35a)
- [ ] Only the uploader can delete a document version
- [ ] Deleting a version cascades to its annotations, messages, favorites, cache, and corpus_documents links
- [ ] Downstream versions referencing the deleted version get `source_document_id = NULL` (chain doesn't break entirely)

### Tags
- [ ] Assigning a tag to a document propagates across the full version chain (all versions get the same tag)
- [ ] Removing a tag propagates across the full version chain
- [ ] Only the document uploader can assign or change tags
- [ ] The tag list endpoint (`GET /api/documents/tags`) is filtered by `ENABLED_DOCUMENT_TAGS` env var

### Favorites
- [ ] Favoriting a document in a corpus is per-corpus — doesn't affect other corpuses
- [ ] Favorited documents sort to the top of the document list
- [ ] Toggle endpoint works: first call favorites, second call unfavorites

### Corpus document list
- [ ] Corpus document list has a working client-side search/filter field
- [ ] Documents uploaded by a deleted user still appear (LEFT JOIN on `uploaded_by`) with null username displayed gracefully

---

## 8. Annotations

- [ ] Creating an annotation auto-votes for the creator
- [ ] Annotations are permanent — the delete endpoint returns 410 Gone
- [ ] Annotations are scoped to corpus + document — same document in different corpuses has separate annotations
- [ ] Annotation deduplication across version chains: when the same annotation exists on multiple versions, only the most recent version's annotation is returned
- [ ] Guest users can view annotations but cannot create or vote on them
- [ ] Annotation vote (endorse) toggle works correctly
- [ ] Concept annotation panel (`GET /api/concepts/:id/annotations`) returns cross-context annotations with correct provenance info
- [ ] Annotation filters work: `?filter=all|corpus_members|author`
- [ ] Provenance badges (`addedByAuthor`, `votedByAuthor`) appear correctly

---

## 9. Web Links

- [ ] Adding a web link validates URL format (must start with `http://` or `https://`, max 2048 chars)
- [ ] Duplicate URL on the same edge returns 409 Conflict
- [ ] Only the user who added a link can remove it
- [ ] Web link is auto-upvoted by the adding user
- [ ] Vote toggle on web links works (click count to toggle)
- [ ] Creator comments: only the creator can edit their comment
- [ ] "(edited)" indicator only appears after a genuine edit, not on first comment addition
- [ ] Cross-context web links tab shows links from all parent contexts for a concept

---

## 10. Messaging (Phase 31)

- [ ] "Message author(s)" button appears for non-sole-author users viewing an annotation
- [ ] "Message annotator" button appears for authors when annotation creator is not a coauthor
- [ ] Sole author viewing their own doc does NOT see "Message author(s)"
- [ ] "View threads" button appears instead of initiation buttons when user is already a participant
- [ ] Creating a thread creates the first message and returns the thread
- [ ] Replying to a thread appends a message and the thread's messages load chronologically
- [ ] Unread count badge on the Messages sidebar item updates correctly
- [ ] Opening a thread updates `last_read_at` and reduces the unread count
- [ ] Messages page drill-down works: Documents → Annotations → Threads → Chat view
- [ ] New coauthors automatically gain access to existing threads (query-time participant computation)

---

## 11. Moderation & Flagging

- [ ] Flagging an edge: one flag per user per edge
- [ ] An edge becomes hidden (`is_hidden = true`) only after 10 distinct flags
- [ ] Unflagging works: removes the user's flag from the edge
- [ ] If unflagging brings the count below 10, the edge is restored (not hidden)
- [ ] Hide/show community voting works on hidden edges
- [ ] Moderation comments can be added to hidden edges (multiple per user allowed, max 2000 chars)
- [ ] Admin unhide (`POST /api/moderation/unhide`) restores a hidden edge — requires `ADMIN_USER_ID` match

---

## 12. Sidebar & Navigation

- [ ] Sidebar items (corpuses, groups, graph tabs) appear in the correct `display_order`
- [ ] Drag-and-drop reordering updates `sidebar_items` display_order
- [ ] Creating a new graph tab adds a sidebar item at the bottom
- [ ] Closing a graph tab removes the sidebar item
- [ ] Graph tabs can be placed inside a corpus (removes from flat group)
- [ ] Tab groups: create, rename, delete, toggle expand/collapse all work
- [ ] Browser back/forward buttons navigate correctly through concept navigation history

---

## 13. Corpus Membership & Invites

- [ ] Generating an invite token works for corpus owners
- [ ] Accepting an invite token adds the user to `corpus_allowed_users`
- [ ] Allowed users can upload documents and create annotations
- [ ] Removing an allowed user works (owner only)
- [ ] Self-leave from a corpus works and also removes subscription
- [ ] Ownership transfer: new owner removed from allowed users (implicit member as owner), old owner added to allowed users

---

## 14. Document Co-Authorship (Phase 26)

- [ ] Generating a document invite token works for any author (uploader or coauthor)
- [ ] Accepting a document invite adds the user to `document_authors` for the root document
- [ ] Any author can create new versions
- [ ] Any author can generate invite tokens and remove other coauthors
- [ ] Coauthors can self-remove (leave)
- [ ] The uploader cannot leave (they're the permanent root author)
- [ ] Promotion: when a user becomes a coauthor, their existing annotations appear in the Author filter without data migration

---

## 15. Account Deletion (Phase 35c)

- [ ] Cannot delete account if user owns any corpuses — returns 400 with error message
- [ ] After transferring all corpus ownership, deletion succeeds
- [ ] CASCADE deletes: votes, subscriptions, tabs, messages, flags are removed
- [ ] SET NULL: concepts, edges, annotations, web links, documents `created_by`/`uploaded_by` become NULL
- [ ] Documents uploaded by the deleted user still appear in corpus views (LEFT JOIN with null username)
- [ ] The deleted user's JWT no longer works for any endpoint

---

## 16. Info Pages (Using Orca, Constitution, Donate)

- [ ] All three pages load at their routes (`/using-orca`, `/constitution`, `/donate`)
- [ ] Comments load for guest users (without vote buttons)
- [ ] Authenticated users can add comments (max 2000 chars)
- [ ] Reply nesting is exactly 1 level — cannot reply to a reply
- [ ] Vote toggle on comments works
- [ ] Auto-vote on comment creation (starts at 1)
- [ ] Comments sorted by vote count descending, then chronologically

---

## 17. Diff Modal (Phase 14)

- [ ] Right-click context menu on a concept in the grid shows "Compare" option
- [ ] Diff modal shows side-by-side child comparison with Shared/Similar/Unique grouping
- [ ] Drill-down navigation within the diff modal works with breadcrumbs
- [ ] Batch children endpoint respects max 10 panes limit

---

## 18. Vote Sets

- [ ] Vote set bar shows colored swatches for groups of users who saved the same children
- [ ] Filtering by a single vote set shows only children saved by that exact group
- [ ] Multi-select across vote sets works
- [ ] Vote set colors are consistent and distinguishable

---

## 19. Search

- [ ] Concept search uses trigram similarity (`pg_trgm`) and returns relevant results
- [ ] Document search (`GET /api/corpuses/documents/search`) uses ILIKE matching
- [ ] Search from concept page properly scopes results (child-check query filters hidden)
- [ ] Browse Corpuses client-side filter works on corpus names
- [ ] Corpus document list client-side filter works on document titles

---

## 20. Guest Access

- [ ] Guest users (no JWT) can browse root concepts and navigate the graph
- [ ] Guest users can view corpus listings and corpus details
- [ ] Guest users can view documents and annotations
- [ ] Guest users can view Flip View and web links
- [ ] Guest users CANNOT: create concepts, vote, annotate, message, upload, or flag
- [ ] Login prompt appears when guest attempts a restricted action

---

## 21. Orphan Rescue (Phase 9b)

- [ ] When a document is removed from its last corpus, it's auto-deleted UNLESS the uploader is an allowed user
- [ ] Allowed user's orphaned documents appear in the orphan rescue modal
- [ ] "Rescue" moves the document to a chosen corpus
- [ ] "Dismiss" permanently deletes the orphaned document

---

## 22. Legal Compliance (Phase 36)

- [ ] Registration: email field required, age verification checkbox required
- [ ] Registration: invalid email rejected, missing age verification rejected
- [ ] Document upload: copyright confirmation checkbox required
- [ ] Version upload: copyright confirmation checkbox required
- [ ] `age_verified_at` set once at registration, never cleared
- [ ] `copyright_confirmed_at` set per document at each upload
- [ ] Test users (alice–frank) have emails and `age_verified_at` after migration

---

## 23. Design & UI Conventions

- [ ] All styling uses inline styles (no external CSS files created)
- [ ] Font is EB Garamond on all interactive elements
- [ ] Background is soft off-white, text is black
- [ ] No emoji icons in UI chrome (only triangle-vote and swap-arrows as geometric symbols; plain Unicode arrows and shapes only)
- [ ] No italics anywhere in the UI
- [ ] No colored buttons (all transparent/dark with neutral borders)
- [ ] Attribute badges appear only in designated locations (concept page header, root page cards, Flip View cards, annotation cards)
- [ ] Attributes are NOT shown in square brackets in child lists, search results, breadcrumbs, Saved page, or diff modal

---

## 24. Phase 37 — Pre-Launch Bug Fixes

### 37a: Backend Controller Fixes
- [ ] Guest users (no JWT) see `swap_count` values on concept children (not all zeros)
- [ ] Creating a root concept succeeds when the concept name already exists as a non-root concept elsewhere
- [ ] Creating a root concept is rejected when a root edge already exists for that concept+attribute
- [ ] Corpus allowed users (non-authors) get 403 when trying to create a document version
- [ ] Document authors and coauthors CAN create document versions
- [ ] Web links added in one parent context do NOT appear in other contexts for the same concept
- [ ] Web links DO appear in the cross-context Web Links tab compilation
- [ ] Web link creator can see and use the remove/delete button on their own link
- [ ] Web link removal actually deletes the link from the database

### 37b: Auth & Registration
- [ ] During registration, entering a phone number that already exists shows an error BEFORE sending the OTP code
- [ ] During login, entering a phone number that doesn't exist shows an error BEFORE sending the OTP code (nice-to-have)
- [ ] The `sendCode` endpoint accepts an `intent` parameter (`login` or `register`)
- [ ] Registration flow still works end-to-end after the change

### 37c: Corpus & Document Frontend UX
- [ ] Guest users clicking a document link from the concept annotation panel see the login modal (not an error)
- [ ] Uploading a file over 10MB shows a clear error message (not silent failure)
- [ ] Client-side file size check provides instant feedback before upload attempt (nice-to-have)
- [ ] Clicking "Add tag" opens the tag search in only one document section (not both My Docs and All Docs)
- [ ] Cancelling a document upload clears the file from the upload UI tray
- [ ] Duplicate document similarity percentage appears during upload when matches are found
- [ ] Upload proceeds normally when no duplicates are found

### 37d: Quick Text & Style Fixes
- [ ] Long concept names (100+ characters) do not push sort toggles off-screen
- [ ] Sort toggles remain visible and clickable with any concept name length
- [ ] Swap vote indicators use the same dark filled shading as save vote indicators
- [ ] Diff modal search bar placeholder has no Unicode escape sequences (no `u/2026`)
- [ ] Search results for existing children show "child" badge (not "child: value")
- [ ] Unsubscribe confirmation says "removes the corpus tab from your sidebar" (or similar)

### 37e: Root Page & Tab Groups
- [ ] Root concepts can be flagged (flag count increments)
- [ ] Root concepts become hidden when flag count reaches 10
- [ ] Hidden root concepts do not appear on the root page
- [ ] Deleting a tab group succeeds (200 response, no 500 error)
- [ ] Member tabs of deleted group have `group_id = NULL` (ungrouped)

### 37f: Flip View & Annotation Creation
- [ ] Flip View shows sort toggle controls in contextual mode (Sort by Links | Similarity ↓ | Similarity ↑)
- [ ] Sort by Similarity actually reorders the alt parent cards
- [ ] Sort controls do NOT appear in decontextualized Flip View
- [ ] Annotation creation does NOT auto-create when a concept is selected
- [ ] Annotation creation shows all fields (quote text, comment, concept, context) before confirming
- [ ] "Create Annotation" button must be clicked to finalize the annotation
- [ ] Text selection shortcut pre-fills quote text but does not auto-create

---

**END OF TESTING CHECKLIST**
