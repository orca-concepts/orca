# ORCA — Testing Checklist

**Purpose:** This file is the authoritative testing checklist for the Orca app. Claude Code must read this file after implementing any code change and run tests according to the Run Levels below. Do not consider a task complete until the required tests pass.

**Writing style:** Tests are written in natural language. Claude Code should interpret each test and determine the appropriate verification method (curl, psql, `npm run build`, file inspection, subagent checks, etc.).

**Test users:** alice, bob, carol, dave, eve, frank (all have bcrypt-hashed fake phone numbers and fake emails)

---

## CRITICAL: Test Result Persistence Rules

**These rules are mandatory. Violating them wastes real money on token usage.**

1. **Every agent that runs tests MUST write its results to a file** in the project root, named `test-results-section-{range}.md` (e.g., `test-results-section-1-4.md`). Results returned only in conversation context WILL be lost to context window compression before they can be compiled. This has already happened once — do not repeat it.

2. **Never defer report compilation.** Do not wait for all agents to finish before compiling. Process each agent's file as soon as it completes, or have the final compilation step read from the files on disk.

3. **The final compiled report MUST also be written to a file** — `test-results-full.md` in the project root — before presenting it to the user. If context compresses mid-summary, the file survives.

4. **After the report is delivered**, delete the intermediate `test-results-section-*.md` files and `test-results-full.md` (they are ephemeral, not part of the codebase). Do NOT commit them to git.

5. **If an agent finishes with "Done" and no file was written, that agent's work is lost.** Re-run it. "Done" does not mean "passed" — it means the agent completed execution. Results only exist if they are on disk.

---

## Run Levels

There are three run levels. The prompt you receive will tell you which level to use. If it doesn't specify, default to Level 1.

### Level 1 — Standard (default after every change)
Run these:
- **Section 0 (Build & Startup)** — always, no exceptions
- **Every section directly touched by your changes** — use your judgment
- **Core regression sweep (Sections 2, 5, 6, 7, 12, 25)** — Concepts, Corpuses, Documents, Annotations, Sidebar, and Combos. These are the areas where cross-cutting bugs most often hide. Run them even if you don't think your changes affect them.

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

## 1. Authentication (Password Login + Phone OTP Registration)

### Password Login (Phase 40b)
- [ ] Login with username + correct password returns JWT token and user object (POST `/api/auth/login`)
- [ ] Login with email + correct password returns JWT token and user object
- [ ] Login with wrong password returns 401 "Invalid credentials"
- [ ] Login with non-existent username returns 401 "Invalid credentials" (no account enumeration)
- [ ] Login without identifier or password returns 400
- [ ] The old OTP login endpoint (`POST /api/auth/verify-login`) returns 404 (removed)

### Registration (Phone OTP + Password)
- [ ] Sending a verification code with `intent=register` to a new phone number returns success (POST `/api/auth/send-code`)
- [ ] Sending a verification code with `intent=register` to an existing phone number returns 400 error before sending OTP
- [ ] Cannot register without providing a password — returns "Password is required"
- [ ] Cannot register with a password shorter than 8 characters — returns error
- [ ] Cannot register with a weak password (e.g., "password") — returns zxcvbn feedback message
- [ ] Cannot register without providing an email address — returns an error
- [ ] Cannot register without checking the age verification box (`ageVerified: true`) — returns an error
- [ ] Cannot register with an invalid email format (no @, no dot) — returns an error
- [ ] Successful registration stores `password_hash`, `email`, and sets `age_verified_at` to a timestamp
- [ ] Successful registration returns a JWT token

### Forgot Password (Phase 40b)
- [ ] Forgot password send-code endpoint exists and returns generic success message (POST `/api/auth/forgot-password/send-code`)
- [ ] Forgot password reset endpoint exists and validates password strength (POST `/api/auth/forgot-password/reset`)
- [ ] Forgot password reset with weak password returns zxcvbn feedback
- [ ] Successful password reset returns JWT token (auto-login)

### General Auth
- [ ] The `/api/auth/me` endpoint returns the current user's info when given a valid JWT
- [ ] The `/api/auth/me` endpoint returns 401 when given no token or an invalid token
- [ ] "Log out everywhere" (`POST /api/auth/logout-everywhere`) sets `token_issued_after` and subsequent requests with the old token return 401
- [ ] Rate limiting: more than 10 login attempts from the same IP within 15 minutes are rejected
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
- [ ] Adding a swap vote between sibling edges succeeds (Phase 44: sibling-only restriction restored)
- [ ] Adding a swap vote between non-sibling edges returns 400 "Replacement must be a sibling"
- [ ] Adding a swap vote where edge_id === replacement_edge_id returns an error (can't swap with self)
- [ ] Save and swap are mutually exclusive: saving removes any existing swap on that edge; swapping removes any existing save (with cascading unsave to descendants)
- [ ] Auto-save on swap (Phase 44): casting swap A→B auto-saves B if user hasn't already saved it; response includes `autoSaved: true`
- [ ] Auto-save does not duplicate: casting swap A→B where user already saved B returns `autoSaved: false`
- [ ] Auto-save cascade: casting swap A→B auto-saves B, which clears any existing swap the user had on B (Phase 20c)
- [ ] Auto-save persists after swap removal: removing swap A→B does NOT remove the auto-saved vote on B
- [ ] `user_swapped` field is returned in children response (true when current user has a swap vote on that edge, false otherwise)
- [ ] `user_swapped` is false for guest users
- [ ] Root concepts include `swap_count` and `user_swapped` in the root concepts response
- [ ] Root concept swap votes work between root edges with the same attribute
- [ ] ⇄ button appears on root concept cards with swap count
- [ ] GET /swap/:edgeId returns `{ existingSwaps, otherSiblings, totalSwapVotes }` — two separate lists
- [ ] `existingSwaps` sorted by voteCount DESC; `otherSiblings` sorted by saveCount DESC
- [ ] No edge appears in both `existingSwaps` and `otherSiblings`
- [ ] Source edge does not appear in `otherSiblings` (self-swap prevention)
- [ ] SwapModal shows two sections: "Existing swap votes" and "Other siblings"
- [ ] SwapModal "Other siblings" has client-side search field that filters in real time
- [ ] SwapModal cards show concept name and save count only (no path, attribute badge, or open link)
- [ ] SwapModal vote buttons use ▲ N format matching ConceptGrid save vote button styling
- [ ] Auto-save inline note "Also added a vote for [name]" appears for ~3 seconds when applicable

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
- [ ] Only the corpus owner can update or delete the corpus itself
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

- [ ] Sidebar items (corpuses, combos, groups, graph tabs) appear in the correct `display_order`
- [ ] Drag-and-drop reordering updates `sidebar_items` display_order
- [ ] Creating a new graph tab adds a sidebar item at the bottom
- [ ] Closing a graph tab removes the sidebar item
- [ ] Graph tabs can be placed inside a corpus (removes from flat group)
- [ ] Tab groups: create, rename, delete, toggle expand/collapse all work
- [ ] Browser back/forward buttons navigate correctly through concept navigation history
- [ ] Combo tabs appear in the sidebar when subscribed and disappear when unsubscribed
- [ ] Combo tabs can be dragged to new positions in the sidebar — order persists after refresh
- [ ] Combo tabs can be dragged onto a group to join it, and dragged out to leave it
- [ ] Right-click on a combo tab shows "Add to group" / "Remove from group" and "Unsubscribe"
- [ ] Sidebar action buttons (Graph Votes, Browse Corpuses, Browse Combos, Messages) display in a 2x2 grid without overflow

---

## 13. Corpus Membership & Invites

- [ ] Generating an invite token works for corpus owners
- [ ] Clicking "+ New Invite Link" shows a form with optional "Max uses" and "Expires in days" fields
- [ ] Generating a link with no limits creates an unlimited, non-expiring token
- [ ] Generating a link with max uses set to 3 shows "0 / 3 uses" on the token card
- [ ] Generating a link with expiry set to 7 days shows "expires {date}" on the token card
- [ ] An expired invite token cannot be accepted — returns an error
- [ ] A token that has reached its max uses cannot be accepted — returns an error
- [ ] Accepting a valid invite token adds the user to `corpus_allowed_users`
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
- [ ] Cannot delete account if user owns any superconcepts — returns 400 with error message listing the superconcepts
- [ ] After transferring all corpus and superconcept ownership, deletion succeeds
- [ ] CASCADE deletes: votes, subscriptions, tabs, messages, flags are removed
- [ ] SET NULL: concepts, edges, annotations, web links, documents `created_by`/`uploaded_by` become NULL
- [ ] Documents uploaded by the deleted user still appear in corpus views (LEFT JOIN with null username)
- [ ] The deleted user's JWT no longer works for any endpoint
- [ ] Combos owned by the deleted user become ownerless (`created_by = NULL`) via ON DELETE SET NULL
- [ ] Ownerless combos still appear in Browse Combos and are viewable by subscribers
- [ ] Ownerless combos show "Created by [deleted user]" in the header
- [ ] No one can add or remove edges from an ownerless combo

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
- [ ] Guest users can browse combos in the Browse Combos overlay (see names, descriptions, metadata)
- [ ] Guest users do NOT see Subscribe/Unsubscribe buttons on combo cards
- [ ] Guest users clicking a combo name in Browse Combos see the login modal
- [ ] Guest users CANNOT: create concepts, vote, annotate, message, upload, flag, or subscribe to combos
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

### 37b: Auth & Registration (updated Phase 40b)
- [ ] During registration, entering a phone number that already exists shows an error BEFORE sending the OTP code
- [ ] The `sendCode` endpoint accepts an `intent` parameter (`register` — `login` intent removed in Phase 40b)
- [ ] Registration flow works end-to-end: phone OTP → username/email/password → account created
- [ ] Password login works with username and with email
- [ ] Forgot password flow works end-to-end: phone → OTP → new password → auto-login

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

## 25. Combos (Phase 39)

### Browse Combos
- [ ] "Browse Combos" button appears in the sidebar alongside "Browse Corpuses"
- [ ] Clicking "Browse Combos" opens the overlay; clicking "Browse Corpuses" closes it (and vice versa)
- [ ] The combo list loads with combo name, description, creator username, concept count, and subscriber count
- [ ] Search bar filters combos by name with 300ms debounce
- [ ] Sort toggle switches between "Subscribers" (default) and "New"
- [ ] "Create Combo" button is visible for logged-in users, hidden for guests
- [ ] Creating a combo with a unique name succeeds and the combo appears in the list
- [ ] Creating a combo with a duplicate name (case-insensitive) shows a "name already exists" error
- [ ] Creator is auto-subscribed — the new combo appears as a sidebar tab immediately
- [ ] Subscribe button on a combo card adds the combo to the sidebar
- [ ] Unsubscribe button removes the combo from the sidebar

### Combo Tab Content
- [ ] Clicking a combo tab in the sidebar shows the combo page with header, subconcepts, and annotations
- [ ] Header shows combo name, description, "Created by {username}", concept count, subscriber count
- [ ] Unsubscribe button in the combo header removes the tab and switches to another tab

### Owner — Subconcept Management
- [ ] Only the combo owner sees the "Subconcepts" section with the "+ Add Concept" button
- [ ] Non-owners do not see add/remove controls
- [ ] Clicking "+ Add Concept" opens an inline search form
- [ ] Searching finds concepts by name using trigram matching
- [ ] Clicking a search result shows available contexts (edges) for that concept, including root edges
- [ ] Clicking a context adds the edge to the combo — it appears in the subconcept list and filter bar
- [ ] Adding an edge that is already in the combo shows "already in combo" error
- [ ] Clicking the remove button on a subconcept removes it from the combo

### Subconcept Filter Bar
- [ ] Filter bar shows one badge per member edge with concept name and attribute
- [ ] All badges are active by default — all annotations shown
- [ ] Clicking a badge toggles it off — annotations from that edge disappear
- [ ] Clicking again toggles it back on
- [ ] "Show All" link appears when any badge is toggled off and reactivates all badges

### Annotation Sorting
- [ ] Default sort is "Combo Votes" — annotations ordered by combo vote count
- [ ] Switching to "New" reorders annotations by creation date
- [ ] Switching to "Annotation Votes" reorders by corpus-level vote count

### Combo Voting
- [ ] Clicking the vote button on an annotation card increments the combo vote count and shows active state
- [ ] Clicking again removes the vote and decrements the count
- [ ] Combo votes are separate from corpus votes — changing one does not affect the other
- [ ] Both combo vote count and corpus vote count are displayed on each annotation card

### Click-Through Navigation
- [ ] Clicking a document title on an annotation card navigates to that document in the correct corpus tab
- [ ] If not subscribed to the corpus, auto-subscribes before navigating
- [ ] The annotation is scrolled to and highlighted in the corpus tab document viewer

### Combo Data Freshness
- [ ] After adding a concept to a combo via "Add to Combo" in the graph view, switching to the combo tab shows the new concept immediately (no manual refresh needed)

### Empty States
- [ ] A new combo with no edges shows "This combo has no concepts yet" (owner also sees "Add concepts using the controls above")
- [ ] A combo with edges but no annotations shows "The concepts in this combo don't have any annotations yet"
- [ ] Filtering out all annotations shows "No annotations match the selected filters"

---

## 26. Add to Combo from Graph View (Phase 39d)

- [ ] The "Add to Combo" button appears in the concept header when the user is logged in and owns at least one combo
- [ ] The button does NOT appear for guest users
- [ ] The button does NOT appear when the user owns zero combos
- [ ] The button does NOT appear on the root page (no parent edge)
- [ ] With exactly one owned combo: clicking the button adds the current edge directly and shows "Added" feedback
- [ ] With multiple owned combos: clicking the button opens a dropdown picker listing all owned combos
- [ ] Each combo in the picker shows name and concept count
- [ ] Clicking a combo in the picker adds the edge and shows "Added" feedback
- [ ] Adding the same edge again shows "Already in combo" feedback
- [ ] The picker closes when clicking outside it
- [ ] The picker closes when pressing Escape
- [ ] The feedback text reverts to "Add to Combo" after a short delay
- [ ] The picker resets when navigating to a different concept
- [ ] Existing header buttons (Share, Flip View, Add as Annotation, save, swap) still work correctly

---

## 27. ORCID Display (Phase 41b)

- [ ] OrcidBadge component renders a small green "iD" badge when `orcidId` is provided
- [ ] OrcidBadge renders nothing when `orcidId` is null or undefined
- [ ] Clicking the badge opens `https://orcid.org/{orcidId}` in a new tab
- [ ] Badge appears next to corpus owner names in Browse Corpuses list
- [ ] Badge appears next to corpus owner name in corpus detail header
- [ ] Badge appears next to member usernames in the corpus members panel
- [ ] Badge appears next to document uploader name in the document viewer
- [ ] Badge appears next to annotation creator names in the document annotation sidebar
- [ ] Badge appears next to annotation creator names in the concept annotation panel
- [ ] Badge appears next to combo creator names in Browse Combos and combo tab header
- [ ] Badge appears next to annotation creator names on combo annotation cards
- [ ] Badge appears next to version uploader names in version history
- [ ] Users without an ORCID do NOT show a badge anywhere
- [ ] Backend endpoints return `orcid_id` / `orcidId` fields: corpus list, corpus detail, allowed users, document detail, document annotations, concept annotations, combo list, combo detail, combo annotations, version history

---

## 28. Corpus Invite by Username/ORCID (Phase 41d)

### User Search Endpoint
- [ ] `GET /api/users/search?q=bo` returns matching users with username and orcidId
- [ ] Requesting user is excluded from results (searching your own name returns nothing)
- [ ] ORCID search: `?q=0000-0001-2345-6789` returns exact match
- [ ] ORCID prefix: `?q=0000-0001` returns users whose ORCID starts with that prefix
- [ ] Query shorter than 2 characters returns 400 error
- [ ] Non-matching query returns empty `{ users: [] }`
- [ ] Endpoint requires authentication — 401 without token
- [ ] Max 10 results returned

### Direct Invite Endpoint
- [ ] Corpus owner can add a user: `POST /api/corpuses/:id/invite-user` with `{ userId }` succeeds
- [ ] Adding the same user again returns 409 "User is already a member"
- [ ] Adding the corpus owner returns 400 "Cannot add the corpus owner as a member"
- [ ] Non-owner calling the endpoint returns 403
- [ ] Adding a non-existent user ID returns 404 "User not found"
- [ ] Successful add returns `{ success: true, user: { id, username, orcidId } }`

### Frontend — Add Member UI
- [ ] "Add member" section appears in corpus members panel for corpus owners only
- [ ] Non-owners do not see the "Add member" section
- [ ] Typing in the search input triggers a search after 300ms debounce
- [ ] Search results show username with OrcidBadge (if user has ORCID)
- [ ] Clicking "Add" on a result adds the user and shows "Added ✓" feedback
- [ ] After "Added" feedback, input clears and results dropdown closes automatically
- [ ] Member list refreshes after adding a user
- [ ] Clicking "Add" on an already-added user shows "Already a member"
- [ ] Search dropdown closes when input loses focus
- [ ] Searching with fewer than 2 characters shows no results

---

## 29. Phase 42 — Superconcepts Rename, Coauthor Lookup, Ownership Transfer, Member Document Removal

### 42a: Superconcepts UI Rename
- [ ] All user-facing text says "superconcept(s)" instead of "combo(s)" — sidebar button, browse overlay, tab headers, create form, empty states
- [ ] API routes still use `/api/combos/*` — no backend route changes
- [ ] Internal code (variable names, component file names) still uses "combo" terminology

### 42b: Document Coauthor Invite by Username/ORCID
- [ ] Document authors see an "Add coauthor" search input in the coauthor management section
- [ ] Non-authors do not see the "Add coauthor" search input
- [ ] Searching by username prefix returns matching users with OrcidBadge (if applicable)
- [ ] Searching by ORCID (full or prefix) returns matching users
- [ ] Clicking "Add" on a search result adds the user as a coauthor and shows "Added" feedback
- [ ] Adding a user who is already a coauthor shows "Already a coauthor"
- [ ] Adding the document uploader returns an error (they are already an author implicitly)
- [ ] Non-author calling the endpoint returns 403
- [ ] The coauthor list refreshes after adding a user

### 42c: Superconcept Ownership Transfer
- [ ] Superconcept owner sees a "Transfer ownership" section with a username/ORCID search input
- [ ] Non-owners do not see transfer controls
- [ ] Searching finds users by username or ORCID
- [ ] Clicking "Transfer" on a search result shows a confirmation dialog
- [ ] Confirming the transfer updates `combos.created_by` to the new owner
- [ ] If the new owner was not already a subscriber, they are auto-subscribed (combo tab appears in their sidebar)
- [ ] After transfer, the original owner loses owner controls (no add/remove subconcepts, no transfer)
- [ ] Transferring to the current owner returns an error
- [ ] Account deletion is blocked when the user owns superconcepts — error message lists them
- [ ] After transferring all superconcepts, account deletion proceeds normally

### 42d: Corpus Member Document Removal
- [ ] Corpus owner can remove any document from the corpus (unchanged behavior)
- [ ] Corpus member can remove a document they personally added (`corpus_documents.added_by` matches their user ID)
- [ ] Corpus member cannot remove a document added by another member — returns 403 "You can only remove documents you added"
- [ ] Corpus member cannot remove a document added by the corpus owner — returns 403
- [ ] Non-member cannot remove any document — returns 403
- [ ] The remove (✕) button appears on all documents for the corpus owner
- [ ] The remove (✕) button appears only on the member's own documents for corpus members
- [ ] The remove (✕) button does not appear for non-members or guests
- [ ] Confirmation dialog appears before removal (same as owner removal flow)
- [ ] Same orphan cleanup applies: if the removed document is in zero corpuses, it is auto-deleted unless the uploader is an allowed user (Phase 9b rescue)
- [ ] Removing a document also deletes its annotations within that corpus

---

## 30. Tunnel Links (Phase 43)

### Backend — Tunnel CRUD & Voting
- [ ] Creating a tunnel link inserts two rows (bidirectional): `POST /api/tunnels/create` with `{ originEdgeId, linkedEdgeId }` returns both `tunnelLinkId` and `reverseTunnelLinkId`
- [ ] Both directions are auto-voted for the creator on creation
- [ ] Getting tunnel links for edge A (`GET /api/tunnels/:edgeId`) returns the link to edge B, grouped by attribute
- [ ] Getting tunnel links for edge B returns the reverse link to edge A
- [ ] Duplicate tunnel link creation returns 409 "Tunnel link already exists"
- [ ] Cannot create a tunnel link to the same edge (self-tunnel) — returns 400
- [ ] Cannot create a tunnel link to a hidden edge — returns 400
- [ ] Cannot create a tunnel link from a hidden edge — returns 400
- [ ] Vote toggle (`POST /api/tunnels/vote`) toggles on/off correctly with updated count
- [ ] Voting on direction A→B does not affect B→A vote count (directional)
- [ ] Tunnel links TO hidden edges still appear in GET results (not filtered)
- [ ] Guest users (no JWT) can GET tunnel links with `userVoted: false`
- [ ] Guest users cannot create tunnel links or vote — returns 401

### Backend — Search Attribute Filter
- [ ] `GET /api/concepts/search?q=term&attributeId=3` returns only concepts with edges having `attribute_id = 3`
- [ ] `GET /api/concepts/search?q=term` without `attributeId` returns all matching concepts (backwards compatible)
- [ ] `GET /api/concepts/search?q=term&attributeId=999` returns empty results for non-existent attribute

### Frontend — Tunnel Button
- [ ] "Tunnel" button appears in concept header when in children view with a path context (`parentEdgeId` exists)
- [ ] "Tunnel" button is NOT visible in flip view
- [ ] "Tunnel" button is NOT visible in tunnel view itself
- [ ] "Tunnel" button is NOT visible on root-level concepts without a path
- [ ] "Tunnel" button IS visible for guest users (guests can browse tunnels read-only)
- [ ] Clicking "Tunnel" switches to tunnel view — four attribute columns appear

### Frontend — Tunnel View Layout
- [ ] Tunnel view takes full width — annotation panel (right column) is NOT visible
- [ ] One column per enabled attribute (action, tool, value, question with default config)
- [ ] Each column has a header showing the attribute name in brackets (e.g., "[value]")
- [ ] Empty columns show "No tunnels yet" text
- [ ] Columns scroll horizontally on narrow viewports (< 900px)

### Frontend — Tunnel View Search & Create
- [ ] Search field at top of each column is visible for logged-in users
- [ ] Search field is NOT visible for guest users
- [ ] Typing in a column's search field returns results filtered to that attribute only
- [ ] Clicking a search result with one matching context creates the tunnel directly (no picker)
- [ ] Clicking a search result with multiple matching contexts shows a context picker
- [ ] Clicking a root-level concept from search correctly finds and uses the root edge
- [ ] After creating a tunnel, the new card appears in the column immediately
- [ ] Duplicate tunnel attempt shows "Already linked" feedback
- [ ] Search input clears after successful tunnel creation

### Frontend — Tunnel View Cards
- [ ] Each card shows concept name, path (if non-root), tunnel vote count, and save vote count
- [ ] Root edge tunnel cards show just the concept name (no path crash)
- [ ] Clicking a concept name navigates the current tab to that concept in children view
- [ ] ▲ vote button toggles tunnel vote with optimistic count update (logged-in users)
- [ ] ▲ vote button is visible but non-interactive for guests (opacity reduced, no click effect)
- [ ] Per-column "Votes | New" sort toggle works independently per column
- [ ] Right-click on a card shows "Open in new graph tab" context menu
- [ ] Clicking "Open in new graph tab" creates a new graph tab at the linked concept
- [ ] Right-click context menu dismisses on clicking away from it
- [ ] Right-click context menu dismisses on pressing Escape

### Frontend — Tunnel View Persistence
- [ ] Tunnel view mode persists in graph tab across page refresh (`view_mode = 'tunnel'` in database)
- [ ] Standalone URL `?view=tunnel` loads tunnel view correctly
- [ ] "Children View" button in header returns from tunnel view to children view

### Frontend — Flip View Changes (Phase 43b)
- [ ] Flip view sort toggle reads "Votes | Similarity ↓ | Similarity ↑" (first label changed from "Links")
- [ ] Right-click on a flip view card shows "Open in new graph tab" context menu
- [ ] Clicking "Open in new graph tab" in flip view creates a new graph tab at that concept in the clicked parent's context
- [ ] Left click on flip view cards still navigates the current tab (Phase 38a behavior unchanged)
- [ ] Right-click context menu in flip view dismisses correctly on outside click

---

## 31. Annotation Creation Warning Modal (Phase 45)

### Database & Backend
- [ ] `hide_annotation_warning` column exists on `users` table (BOOLEAN, NOT NULL, default false)
- [ ] `GET /api/auth/me` returns `hideAnnotationWarning` field (false for users who haven't dismissed)
- [ ] `POST /api/auth/hide-annotation-warning` with valid JWT returns `{ success: true }` and sets column to true
- [ ] `POST /api/auth/hide-annotation-warning` without JWT returns 401
- [ ] After calling the endpoint, `GET /api/auth/me` returns `hideAnnotationWarning: true`

### Frontend — Warning Modal
- [ ] When a user with `hideAnnotationWarning: false` clicks "Create Annotation", the warning modal appears before the annotation is created
- [ ] Warning modal shows title "Annotations are permanent" and explains append-only model
- [ ] Warning modal has a "Don't show this again" checkbox (unchecked by default)
- [ ] Clicking "Cancel" closes the modal without creating the annotation
- [ ] Clicking "Create annotation" creates the annotation and closes the modal
- [ ] If "Don't show again" was checked on confirm, the backend endpoint is called and subsequent annotation creations in the same session skip the modal
- [ ] A user with `hideAnnotationWarning: true` (already dismissed) skips the modal entirely — annotation creates directly on button click
- [ ] Guest users never see the modal (they cannot create annotations — existing guards prevent this)
- [ ] The modal uses inline styles only (no CSS classes), EB Garamond font, black-on-off-white aesthetic

### All annotation creation paths covered
- [ ] Text selection → "Annotate" button → AnnotationPanel → Create Annotation — goes through modal
- [ ] "Add as Annotation" from graph view → AnnotationPanel (prefilled) → Create Annotation — goes through modal
- [ ] No orphaned `createAnnotation` calls exist outside the modal-gated `handleConfirmCreate` path

---

## 32. Responsive Concept Header (Phase 46)

- [ ] At full desktop width (~1440px), the concept header renders normally (breadcrumb + buttons on one row, concept name + sort toggles on one row)
- [ ] At half-screen width (~720px), action buttons (Flip View, Share, Tunnel, Add as Annotation, Add to Superconcept) wrap to a second row below the breadcrumb instead of squishing
- [ ] At half-screen width, sort toggles (Graph Votes, Newest, Annotations, Top Annotation) wrap below the concept name instead of squishing
- [ ] At narrow width (~500px), all elements remain readable — no overlapping or invisible buttons
- [ ] No buttons were removed or renamed compared to the pre-Phase 46 layout
- [ ] No CSS files were added (inline styles only)
- [ ] The combo picker dropdown (Add to Superconcept) still positions correctly when buttons are wrapped

---

**END OF TESTING CHECKLIST**
