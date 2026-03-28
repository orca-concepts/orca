-- ============================================================
-- FLIP VIEW PATH GROUPING — TEST DATA SEED
-- ============================================================
--
-- INSTRUCTIONS:
-- 1. Make sure your backend is stopped (Ctrl+C in the backend terminal)
-- 2. Open pgAdmin or psql connected to your concept_hierarchy database
-- 3. Run this entire script
-- 4. Restart your backend: cd backend && npm run dev
-- 5. Log in as testuser / testpass123
-- 6. Follow the testing steps at the bottom of this file
--
-- WHAT THIS CREATES:
-- A test user and a web of concepts where "Cardio" (the target concept)
-- appears as a child in 6 different parent contexts across varied graph
-- structures, designed to exercise every grouping scenario.
--
-- CLEANUP: To remove test data afterward, see the cleanup section at the bottom.
--
-- ============================================================

-- 0. Create a test user (password: testpass123, hashed with bcryptjs 10 rounds)
INSERT INTO users (username, email, password_hash)
VALUES ('testuser', 'testuser@test.com', '$2a$10$8KzaN2kIGE5PVNQ1LQKBr.xLJlkg0/67KRsORbGEeXOKOqpD2YVKK')
ON CONFLICT (username) DO NOTHING;

-- Store the test user ID
DO $$
DECLARE
  test_uid INTEGER;
BEGIN
  SELECT id INTO test_uid FROM users WHERE username = 'testuser';

  -- ============================================================
  -- 1. CREATE CONCEPTS
  -- ============================================================
  -- Target concept (the one we'll flip-view on):
  INSERT INTO concepts (id, name, created_by) VALUES (900, 'Cardio', test_uid) ON CONFLICT (id) DO NOTHING;

  -- Scenario A: Long shared path, diverging at root
  -- Path 1: Wellness(901) → Fitness(902) → Exercise(903) → Routines(904) → Cardio(900)
  -- Path 2: Lifestyle(905) → Fitness(902) → Exercise(903) → Routines(904) → Cardio(900)
  INSERT INTO concepts (id, name, created_by) VALUES (901, 'Wellness', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (902, 'Fitness', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (903, 'Exercise', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (904, 'Routines', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (905, 'Lifestyle', test_uid) ON CONFLICT (id) DO NOTHING;

  -- Scenario B: Same immediate parent, diverging at grandparent
  -- Path 3: Health(906) → Training(908) → Workouts(907) → Cardio(900)
  -- Path 4: Sports(909) → Training(908) → Workouts(907) → Cardio(900)
  -- (wait — Training can't appear under two different parents with the same graph_path
  --  unless the graph_paths are different. They will be: [906,908] vs [909,908])
  -- Actually: Workouts(907) is the parent of Cardio in both.
  -- Path 3: Health(906) → Training(908) → Workouts(907) → Cardio(900)
  --   edge for Cardio: parent=907, graph_path=[906, 908, 907]
  -- Path 4: Sports(909) → Training(908) → Workouts(907) → Cardio(900)
  --   edge for Cardio: parent=907, graph_path=[909, 908, 907]
  -- Wait — Training(908) appears under Health(906) AND Sports(909), that's fine (concept reuse).
  -- But Workouts(907) under Training(908) in path [906,908] vs [909,908] — those are different contexts.
  -- Shared segment above Cardio: Workouts(907). Diverge at Training(908)'s parent: Health(906) vs Sports(909).
  INSERT INTO concepts (id, name, created_by) VALUES (906, 'Health', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (907, 'Workouts', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (908, 'Training', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (909, 'Sports', test_uid) ON CONFLICT (id) DO NOTHING;

  -- Scenario C: Completely different parent — no shared path with any other
  -- Path 5: Music(910) → Rhythm(911) → Cardio(900)
  INSERT INTO concepts (id, name, created_by) VALUES (910, 'Music', test_uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO concepts (id, name, created_by) VALUES (911, 'Rhythm', test_uid) ON CONFLICT (id) DO NOTHING;

  -- Scenario D: Short unique path (root → parent → Cardio)
  -- Path 6: Movement(912) → Cardio(900)
  INSERT INTO concepts (id, name, created_by) VALUES (912, 'Movement', test_uid) ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 2. CREATE ROOT EDGES (for root concepts)
  -- ============================================================
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 901, '{}', test_uid) ON CONFLICT DO NOTHING; -- Wellness root
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 905, '{}', test_uid) ON CONFLICT DO NOTHING; -- Lifestyle root
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 906, '{}', test_uid) ON CONFLICT DO NOTHING; -- Health root
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 909, '{}', test_uid) ON CONFLICT DO NOTHING; -- Sports root
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 910, '{}', test_uid) ON CONFLICT DO NOTHING; -- Music root
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (NULL, 912, '{}', test_uid) ON CONFLICT DO NOTHING; -- Movement root

  -- ============================================================
  -- 3. CREATE INTERIOR EDGES (building the paths)
  -- ============================================================

  -- === Scenario A: Long shared path, two roots ===
  -- Wellness(901) → Fitness(902)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (901, 902, ARRAY[901], test_uid) ON CONFLICT DO NOTHING;
  -- Lifestyle(905) → Fitness(902)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (905, 902, ARRAY[905], test_uid) ON CONFLICT DO NOTHING;
  -- Fitness(902) → Exercise(903) under Wellness path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (902, 903, ARRAY[901, 902], test_uid) ON CONFLICT DO NOTHING;
  -- Fitness(902) → Exercise(903) under Lifestyle path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (902, 903, ARRAY[905, 902], test_uid) ON CONFLICT DO NOTHING;
  -- Exercise(903) → Routines(904) under Wellness path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (903, 904, ARRAY[901, 902, 903], test_uid) ON CONFLICT DO NOTHING;
  -- Exercise(903) → Routines(904) under Lifestyle path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (903, 904, ARRAY[905, 902, 903], test_uid) ON CONFLICT DO NOTHING;
  -- Routines(904) → Cardio(900) under Wellness path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (904, 900, ARRAY[901, 902, 903, 904], test_uid) ON CONFLICT DO NOTHING;
  -- Routines(904) → Cardio(900) under Lifestyle path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (904, 900, ARRAY[905, 902, 903, 904], test_uid) ON CONFLICT DO NOTHING;

  -- === Scenario B: Same immediate parent (Workouts), different grandparent ===
  -- Health(906) → Training(908)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (906, 908, ARRAY[906], test_uid) ON CONFLICT DO NOTHING;
  -- Sports(909) → Training(908)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (909, 908, ARRAY[909], test_uid) ON CONFLICT DO NOTHING;
  -- Training(908) → Workouts(907) under Health path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (908, 907, ARRAY[906, 908], test_uid) ON CONFLICT DO NOTHING;
  -- Training(908) → Workouts(907) under Sports path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (908, 907, ARRAY[909, 908], test_uid) ON CONFLICT DO NOTHING;
  -- Workouts(907) → Cardio(900) under Health path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (907, 900, ARRAY[906, 908, 907], test_uid) ON CONFLICT DO NOTHING;
  -- Workouts(907) → Cardio(900) under Sports path
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (907, 900, ARRAY[909, 908, 907], test_uid) ON CONFLICT DO NOTHING;

  -- === Scenario C: Completely different path ===
  -- Music(910) → Rhythm(911)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (910, 911, ARRAY[910], test_uid) ON CONFLICT DO NOTHING;
  -- Rhythm(911) → Cardio(900)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (911, 900, ARRAY[910, 911], test_uid) ON CONFLICT DO NOTHING;

  -- === Scenario D: Short unique path ===
  -- Movement(912) → Cardio(900)
  INSERT INTO edges (parent_id, child_id, graph_path, created_by)
  VALUES (912, 900, ARRAY[912], test_uid) ON CONFLICT DO NOTHING;

  -- ============================================================
  -- 4. ADD SOME VOTES (to verify sorting within groups)
  -- ============================================================
  -- Vote on the Wellness→...→Cardio edge (Scenario A, path 1)
  INSERT INTO votes (user_id, edge_id)
  SELECT test_uid, id FROM edges
  WHERE parent_id = 904 AND child_id = 900 AND graph_path = ARRAY[901, 902, 903, 904]
  ON CONFLICT DO NOTHING;

  -- Vote on the Health→Training→Workouts→Cardio edge (Scenario B, path 3)
  INSERT INTO votes (user_id, edge_id)
  SELECT test_uid, id FROM edges
  WHERE parent_id = 907 AND child_id = 900 AND graph_path = ARRAY[906, 908, 907]
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Test data seeded successfully!';
END $$;

-- ============================================================
-- VERIFICATION QUERY
-- Run this to confirm the 6 parent edges for Cardio(900) exist:
-- ============================================================
SELECT
  e.id as edge_id,
  c.name as parent_name,
  e.graph_path,
  COUNT(v.id) as vote_count
FROM edges e
JOIN concepts c ON e.parent_id = c.id
LEFT JOIN votes v ON e.id = v.edge_id
WHERE e.child_id = 900
GROUP BY e.id, c.name, e.graph_path
ORDER BY e.graph_path;


-- ============================================================
-- TESTING STEPS
-- ============================================================
--
-- 1. Start backend and frontend (npm run dev in both)
--
-- 2. Log in as:  testuser / testpass123
--
-- 3. Navigate to any path that leads to Cardio. For example:
--    - From the root page, click "Wellness"
--    - Click "Fitness" → "Exercise" → "Routines" → "Cardio"
--
-- 4. Click the Flip View toggle button.
--
-- 5. VERIFY GROUPING — You should see these groups:
--
--    GROUP 1: "Routines → Exercise → Fitness"  (2 contexts)
--    ┌──────────────────────────────────────────────────────┐
--    │  Wellness →  Routines     ▲ 1 vote   [You voted]    │
--    │  Lifestyle → Routines     ▲ 0 votes                 │
--    └──────────────────────────────────────────────────────┘
--    Explanation: Cardio's parent is Routines(904) in both paths.
--    The shared segment above Cardio is Routines → Exercise → Fitness.
--    They diverge at Wellness(901) vs Lifestyle(905).
--
--    GROUP 2: "Workouts → Training"  (2 contexts)
--    ┌──────────────────────────────────────────────────────┐
--    │  Health →  Workouts       ▲ 1 vote   [You voted]    │
--    │  Sports → Workouts        ▲ 0 votes                 │
--    └──────────────────────────────────────────────────────┘
--    Explanation: Cardio's parent is Workouts(907) in both paths.
--    Shared segment: Workouts → Training. Diverge at Health vs Sports.
--
--    GROUP 3: "Root level"  (2 contexts)
--    ┌──────────────────────────────────────────────────────┐
--    │  Music → Rhythm           ▲ 0 votes                 │
--    │  Movement                 ▲ 0 votes                 │
--    └──────────────────────────────────────────────────────┘
--    Explanation: Rhythm(911) and Movement(912) are completely
--    different parents with no shared ancestors. They group under
--    "Root level" (empty shared path). Movement has no diverging
--    chain displayed since it IS the root.
--
-- 6. VERIFY HOVER TOOLTIPS — Hover over any entry card.
--    The tooltip should show the full path, e.g.:
--    "Wellness → Fitness → Exercise → Routines → Cardio"
--
-- 7. VERIFY CLICK NAVIGATION — Click any entry card.
--    It should navigate to that parent concept in the correct
--    graph context (check the URL path parameter).
--
-- 8. VERIFY VOTE BADGE — The Wellness path and Health path entries
--    should show "You voted" badges (we inserted votes above).
--
-- 9. VERIFY SORTING — Within each group, higher-voted entries
--    should appear first.
--
-- ============================================================


-- ============================================================
-- CLEANUP (run when done testing)
-- ============================================================
-- DELETE FROM votes WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');
-- DELETE FROM edges WHERE created_by = (SELECT id FROM users WHERE username = 'testuser') AND child_id BETWEEN 900 AND 912;
-- DELETE FROM edges WHERE created_by = (SELECT id FROM users WHERE username = 'testuser') AND parent_id BETWEEN 900 AND 912;
-- DELETE FROM edges WHERE created_by = (SELECT id FROM users WHERE username = 'testuser') AND child_id BETWEEN 900 AND 912 AND parent_id IS NULL;
-- DELETE FROM concepts WHERE id BETWEEN 900 AND 912;
-- DELETE FROM users WHERE username = 'testuser';