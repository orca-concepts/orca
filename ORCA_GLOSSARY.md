# Orca Glossary

A shared vocabulary for discussing Orca's UI, data model, and system behaviors.

---

## Data Model

**Concept**
A named node in the graph. Concept names are globally unique strings (case-insensitive). A concept row is just a name + ID — it has no inherent meaning until placed in context via an edge. The same concept can appear in many different graph paths with different children in each.

**Edge**
A parent-child relationship between two concepts within a specific graph path. Edges are the fundamental unit of context in Orca — votes attach to edges, attributes attach to edges, and a concept's contextual identity is defined by the edge that places it. Root concepts also have edges (with `parent_id = NULL` and `graph_path = '{}'`).

**Graph Path**
An ordered array of concept IDs representing the ancestry from root to parent for a given edge. Stored as a PostgreSQL integer array on the edge. Example: for the edge placing "Cardio" under "Exercise" in `Health → Fitness → Exercise`, the graph path is `[Health_ID, Fitness_ID, Exercise_ID]`. The path *does not* include the child concept itself.

**Contextual Identity**
The principle that a concept's real identity is determined by its **path + attribute**, not just its name. "Cardio" under `Health → Fitness → Exercise` and "Cardio" under `Sports → Team Sports` are completely separate contextual entities — they have independent vote counts, independent children, and (in Phase 3) potentially different attributes. This is the single most important architectural concept in Orca.

**Attribute** *(Phase 3)*
A discrete, reusable category label (e.g., "action", "tool") assigned to an edge at creation time. Attributes are **not** key-value metadata (not `difficulty=hard`). They are immutable after assignment and become part of contextual identity. A concept with no attribute is an action concept by default. Same concept name + different attribute = completely separate contextual entity.

**Root Concept**
A concept with no parent. Root concepts have special edges (`parent_id = NULL`, `graph_path = '{}'`) so they participate in the unified voting model. Displayed on the Root Page.

**Root Edge**
The edge record that connects a root concept to the graph system. Has `parent_id = NULL` and `graph_path = '{}'`. Exists so that voting on root concepts uses the same mechanism as voting on any other edge.

---

## UI Elements & Views

**Root Page**
The landing page after login. Displays all root concepts as a grid, sorted by vote count descending. Shows total active users at the top.

**Concept Page** *(also: Concept View)*
The page displayed when navigating into a concept. Shows the concept name with its vote total (from the edge connecting it to its parent in the current path), a breadcrumb trail, the children view or flip view, and the add/search field.

**Children View** *(default view)*
The default display on a Concept Page. Shows the current concept's child concepts as a grid of cards, sorted by vote count descending. Each card shows the child name, vote count, vote button, and child count.

**Concept Card**
A card in the grid representing a single child concept (or root concept on the Root Page). Displays name, vote count, vote button, and child count badge.

**Breadcrumb**
The navigation trail at the top of a Concept Page showing the full path from root to the current concept, with each segment as a clickable link. Concept names are resolved via batch lookup. The breadcrumb excludes the current concept (which is shown as the page title).

**Flip View**
An alternate view on the Concept Page, toggled via the Flip View button. Instead of showing the current concept's children, it shows all the **parent contexts** where the current concept appears in the graph — effectively inverting the navigation direction. Parent contexts are displayed as a flat grid of cards sorted by vote count descending.

**Flip View Button**
The toggle in the Concept Page header (currently "🔄 Flip View") that switches between Children View and Flip View. Pushing this button adds `&view=flip` to the URL, making view mode part of browser history.

**Flip View Card**
A card in the Flip View grid representing one parent context. Shows the ancestor path above the immediate parent (italic, smaller text), the immediate parent name (black, larger text), the vote count (inline), and a "Voted" badge if the user has voted on that edge. Root-level parents show only the parent name with no ancestor path text. Full path available on hover tooltip.

**Contextual Flip View**
Flip View entered from a specific graph path (i.e., you were viewing a concept in context and flipped). Supports similarity votes. Has a back button to return to Children View.

**Decontextualized Flip View** *(future: via search)*
Flip View entered from search, without a specific origin path. Shows parent contexts sorted by vote popularity. Does **not** support similarity votes.

**Add/Search Field** *(Phase 2, in progress)*
A persistent input field at the bottom-right of the Concept Page. Serves dual purpose: searching across all concepts (with results opening in decontextualized Flip View) and adding new child concepts to the current context. Placeholder text: "Add/Search..."

**Voted Page** *(Phase 5)*
A per-user page showing all concepts the user has voted for, displayed as a collapsible tree/DAG. The page itself is **stable** — it only changes when the user explicitly votes or unvotes. The dynamism lives in the child sets of voted leaf nodes, which evolve as other users add content.

**Vote Button**
The interactive element on a Concept Card that toggles the user's vote on that edge. Shows visual indication when the user has already voted.

**Vote Count**
The number displayed on an edge showing how many users have voted for that parent-child relationship in that specific context. On a Concept Card, this is the child's edge vote count. On the Concept Page title area, this is the current concept's edge vote count (relative to its parent in the current path).

**Total Active Users**
The count displayed at the top of the Root Page showing how many users are currently active. (Phase 7 will filter to only users active in the last 14 days; currently shows all users.)

**Child Count**
The badge on a Concept Card showing how many children that concept has in the current context.

**Attribute Map** *(Phase 3)*
A user-created visual reference diagram showing intentional relationships between attributes. Globally accessible via a button on every page. Uses discrete connector types (e.g., directional, associated). Purely organizational — does not drive system functionality.

---

## Vote Types

**Regular Vote**
A vote on an edge endorsing that parent-child relationship in context. In Phase 4, regular votes will propagate up the full path (branch-aware). Currently, votes apply only to the specific edge.

**Side Vote** *(Phase 4)*
A vote asserting that a concept belongs in a different context. The user specifies the destination context via a modal. Visible to all users as an informational signal — does not move anything automatically.

**Replace-With Vote** *(Phase 4)*
A vote asserting that a concept should be replaced by one of its siblings in the same context. The user specifies which sibling. Visible to all users as an informational signal — does not remove anything automatically.

**Similarity Vote** *(Phase 4)*
A Flip View-only vote asserting that a parent context is similar or helpful relative to the user's origin context. Only available in Contextual Flip View (not Decontextualized). Different origin contexts maintain independent similarity vote sets.

---

## System Behaviors

**Concept Reuse**
When creating a child concept, the system checks (case-insensitive) if a concept with that name already exists. If so, it reuses the existing concept row and creates a new edge. This is how the same concept appears in multiple graph paths.

**Cycle Prevention**
When adding a child, the system checks that the concept does not already appear in its own ancestor path. A concept cannot be its own grandparent.

**Permanence / Append-Only**
Nothing is ever deleted from Orca. Concepts and edges can only be **hidden** (for spam, vandalism, offensive content, or illegal activity), never removed. Low-voted content stays visible. Hiding and voting are completely separate systems.

**Hiding** *(future)*
The moderation mechanism for removing content from view. Hidden items retain talk pages for accountability. Hidden items block their namespace — you cannot recreate an identically-named concept with the same attribute in that same path until the hidden item is unhidden. Hiding is reversible.

**Namespace Blocking**
When a concept is hidden in a specific path + attribute context, that exact combination is reserved. No one can create a new concept with the same name and attribute in that path until the original is unhidden.

**Branch-Aware Vote Propagation** *(Phase 4)*
The rule governing how regular votes flow upstream. Extending an existing branch deeper does **not** add upstream votes. Voting in a new branch that shares upstream edges **does** add votes to those shared edges. This rewards breadth (distinct branches of activity) over depth.

**Identical Vote Sets** *(Phase 4)*
Groups of users who have voted for the exact same combination of children in a given context. Visualized as color swatches at the top of a Concept Page, with matching color dots on each child card. Enables collaborative filtering — seeing which "taste profiles" exist in a community.

**Active/Inactive Users** *(Phase 7)*
Users are considered active if they have viewed their Voted Page within the last 14 days. Inactive users' votes are hidden from all totals and vote set calculations but are immediately restored when the user returns.

---

## Navigation & Routing

**Path Parameter**
The `?path=` query parameter in the URL that encodes the current graph path as a comma-separated list of concept IDs. This is how the system knows which context you're viewing a concept in.

**View Parameter**
The `&view=flip` query parameter that stores Flip View state in the URL. This allows browser back/forward buttons to work naturally with view mode changes and preserves flip view state on page refresh.

**Breadcrumb Navigation**
Clicking a breadcrumb segment navigates to that ancestor concept in the appropriate path context. The path is truncated to end at the clicked concept.

---

## Philosophy & Governance

**Productive Contestation**
The principle that ongoing debate around concepts is valuable data about unsettled community mental models, not a problem to solve. The system is designed to surface disagreement patterns (via vote set visualization) rather than force consensus.

**Commons Model**
Orca's governance philosophy modeled after Wikipedia: community norms over top-down decisions, curious discovery over algorithmic curation. Quality emerges from active civic engagement with the platform.

**Basic Level**
The most efficient level of abstraction to talk about for a given purpose. Orca's hierarchies are designed to expand upward into goals and downward into detailed descriptions, with the basic level as the natural middle.
