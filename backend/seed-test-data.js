/**
 * ORCA Test Data Seed Script
 * 
 * This script wipes all existing data and creates a rich test dataset
 * covering edge cases for comprehensive testing.
 * 
 * HOW TO RUN:
 *   1. Make sure your backend server is NOT running (Ctrl+C if it is)
 *   2. Open a terminal and navigate to your backend folder:
 *        cd backend
 *   3. Run this script:
 *        node seed-test-data.js
 *   4. Start your servers again after it finishes
 * 
 * TEST USERS (all have password: test123):
 *   - alice, bob, carol, dave, eve, frank
 */

const bcrypt = require('bcryptjs');
const pool = require('./src/config/database');

const PASSWORD = 'test123';

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // =============================================
    // STEP 1: WIPE ALL DATA (order matters for foreign keys)
    // =============================================
    console.log('Wiping existing data...');
    await client.query('DELETE FROM replace_votes');
    await client.query('DELETE FROM side_votes');
    await client.query('DELETE FROM similarity_votes');
    await client.query('DELETE FROM votes');
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM concepts');
    await client.query('DELETE FROM users');

    // Reset sequences so IDs start from 1
    await client.query("ALTER SEQUENCE users_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE concepts_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE edges_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE votes_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE similarity_votes_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE side_votes_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE replace_votes_id_seq RESTART WITH 1");

    // Make sure attributes exist (action=1, tool=2, value=3)
    await client.query(`
      INSERT INTO attributes (name) VALUES ('action'), ('tool'), ('value')
      ON CONFLICT (name) DO NOTHING
    `);
    const attrResult = await client.query('SELECT id, name FROM attributes ORDER BY id');
    const attrs = {};
    attrResult.rows.forEach(r => { attrs[r.name] = r.id; });
    console.log('Attributes:', attrs);

    // =============================================
    // STEP 2: CREATE USERS
    // =============================================
    console.log('Creating users...');
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const userNames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
    const users = {};

    for (const name of userNames) {
      const result = await client.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name, `${name}@test.com`, passwordHash]
      );
      users[name] = result.rows[0].id;
    }
    console.log('Users created:', users);

    // =============================================
    // STEP 3: CREATE CONCEPTS
    // =============================================
    console.log('Creating concepts...');
    const concepts = {};
    const conceptNames = [
      // Root-level concepts
      'Health', 'Cooking', 'Sports', 'Learning', 'Music',
      // Health tree
      'Fitness', 'Nutrition', 'Mental Health',
      'Cardio', 'Strength Training', 'Yoga',
      'Running', 'Cycling', 'Swimming',
      'Protein', 'Vegetables', 'Meal Prep',
      'Meditation', 'Journaling', 'Therapy',
      // Cooking tree
      'Breakfast', 'Dinner', 'Baking',
      'Pancakes', 'Eggs', 'Smoothies',
      'Pasta', 'Stir Fry', 'Soup',
      'Bread', 'Cookies', 'Cakes',
      // Sports tree (shares "Running", "Cycling", "Swimming" concepts)
      'Team Sports', 'Solo Sports',
      'Basketball', 'Soccer', 'Baseball',
      // Learning tree
      'Reading', 'Writing', 'Practice',
      'Books', 'Articles', 'Podcasts',
      // Music tree
      'Guitar', 'Piano', 'Drums',
      'Scales', 'Chords', 'Songs',
      // Shared/cross-context concepts
      'Discipline', 'Consistency', 'Patience',
      'Timer', 'Journal',

    ];

    for (const name of conceptNames) {
      const result = await client.query(
        'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING id',
        [name, users.alice]
      );
      concepts[name] = result.rows[0].id;
    }
    console.log(`Created ${Object.keys(concepts).length} concepts`);

    // =============================================
    // STEP 4: CREATE EDGES (graph structure)
    // =============================================
    console.log('Creating edges...');

    // Helper: create edge and return edge ID
    async function createEdge(parentId, childId, graphPath, attrId, createdBy) {
      const result = await client.query(
        'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [parentId, childId, graphPath, attrId, createdBy]
      );
      return result.rows[0].id;
    }

    const edges = {};

    // --- ROOT EDGES (parent_id = NULL, graph_path = '{}') ---
    edges['root:Health'] = await createEdge(null, concepts['Health'], '{}', attrs.action, users.alice);
    edges['root:Cooking'] = await createEdge(null, concepts['Cooking'], '{}', attrs.action, users.alice);
    edges['root:Sports'] = await createEdge(null, concepts['Sports'], '{}', attrs.action, users.bob);
    edges['root:Learning'] = await createEdge(null, concepts['Learning'], '{}', attrs.action, users.carol);
    edges['root:Music'] = await createEdge(null, concepts['Music'], '{}', attrs.action, users.dave);

    // --- HEALTH TREE ---
    // Health(1) -> Fitness [action], Nutrition [action], Mental Health [action]
    const healthPath = [concepts['Health']];
    edges['Health>Fitness'] = await createEdge(concepts['Health'], concepts['Fitness'], healthPath, attrs.action, users.alice);
    edges['Health>Nutrition'] = await createEdge(concepts['Health'], concepts['Nutrition'], healthPath, attrs.action, users.alice);
    edges['Health>MentalHealth'] = await createEdge(concepts['Health'], concepts['Mental Health'], healthPath, attrs.action, users.bob);
    // Also add "Discipline" as a value under Health
    edges['Health>Discipline'] = await createEdge(concepts['Health'], concepts['Discipline'], healthPath, attrs.value, users.alice);

    // Health -> Fitness -> Cardio [action], Strength Training [action], Yoga [action]
    const fitnessPath = [concepts['Health'], concepts['Fitness']];
    edges['Fitness>Cardio'] = await createEdge(concepts['Fitness'], concepts['Cardio'], fitnessPath, attrs.action, users.alice);
    edges['Fitness>StrengthTraining'] = await createEdge(concepts['Fitness'], concepts['Strength Training'], fitnessPath, attrs.action, users.bob);
    edges['Fitness>Yoga'] = await createEdge(concepts['Fitness'], concepts['Yoga'], fitnessPath, attrs.action, users.carol);

    // Health -> Fitness -> Cardio -> Running [action], Cycling [action], Swimming [action]
    const cardioPath = [concepts['Health'], concepts['Fitness'], concepts['Cardio']];
    edges['Cardio>Running'] = await createEdge(concepts['Cardio'], concepts['Running'], cardioPath, attrs.action, users.alice);
    edges['Cardio>Cycling'] = await createEdge(concepts['Cardio'], concepts['Cycling'], cardioPath, attrs.action, users.bob);
    edges['Cardio>Swimming'] = await createEdge(concepts['Cardio'], concepts['Swimming'], cardioPath, attrs.action, users.carol);
    // Add "Timer" as a tool under Cardio
    edges['Cardio>Timer'] = await createEdge(concepts['Cardio'], concepts['Timer'], cardioPath, attrs.tool, users.alice);
    // Add "Consistency" as a value under Cardio
    edges['Cardio>Consistency'] = await createEdge(concepts['Cardio'], concepts['Consistency'], cardioPath, attrs.value, users.alice);

    // Health -> Nutrition -> Protein, Vegetables, Meal Prep
    const nutritionPath = [concepts['Health'], concepts['Nutrition']];
    edges['Nutrition>Protein'] = await createEdge(concepts['Nutrition'], concepts['Protein'], nutritionPath, attrs.action, users.alice);
    edges['Nutrition>Vegetables'] = await createEdge(concepts['Nutrition'], concepts['Vegetables'], nutritionPath, attrs.action, users.bob);
    edges['Nutrition>MealPrep'] = await createEdge(concepts['Nutrition'], concepts['Meal Prep'], nutritionPath, attrs.action, users.carol);

    // Health -> Mental Health -> Meditation, Journaling, Therapy
    const mentalHealthPath = [concepts['Health'], concepts['Mental Health']];
    edges['MentalHealth>Meditation'] = await createEdge(concepts['Mental Health'], concepts['Meditation'], mentalHealthPath, attrs.action, users.alice);
    edges['MentalHealth>Journaling'] = await createEdge(concepts['Mental Health'], concepts['Journaling'], mentalHealthPath, attrs.action, users.bob);
    edges['MentalHealth>Therapy'] = await createEdge(concepts['Mental Health'], concepts['Therapy'], mentalHealthPath, attrs.action, users.carol);
    // Add "Journal" as a tool under Mental Health
    edges['MentalHealth>Journal'] = await createEdge(concepts['Mental Health'], concepts['Journal'], mentalHealthPath, attrs.tool, users.alice);
    // Add "Patience" as a value under Mental Health
    edges['MentalHealth>Patience'] = await createEdge(concepts['Mental Health'], concepts['Patience'], mentalHealthPath, attrs.value, users.dave);

    // --- COOKING TREE ---
    const cookingPath = [concepts['Cooking']];
    edges['Cooking>Breakfast'] = await createEdge(concepts['Cooking'], concepts['Breakfast'], cookingPath, attrs.action, users.alice);
    edges['Cooking>Dinner'] = await createEdge(concepts['Cooking'], concepts['Dinner'], cookingPath, attrs.action, users.bob);
    edges['Cooking>Baking'] = await createEdge(concepts['Cooking'], concepts['Baking'], cookingPath, attrs.action, users.carol);

    // Cooking -> Breakfast -> Pancakes, Eggs, Smoothies
    const breakfastPath = [concepts['Cooking'], concepts['Breakfast']];
    edges['Breakfast>Pancakes'] = await createEdge(concepts['Breakfast'], concepts['Pancakes'], breakfastPath, attrs.action, users.alice);
    edges['Breakfast>Eggs'] = await createEdge(concepts['Breakfast'], concepts['Eggs'], breakfastPath, attrs.action, users.bob);
    edges['Breakfast>Smoothies'] = await createEdge(concepts['Breakfast'], concepts['Smoothies'], breakfastPath, attrs.action, users.carol);

    // Cooking -> Dinner -> Pasta, Stir Fry, Soup
    const dinnerPath = [concepts['Cooking'], concepts['Dinner']];
    edges['Dinner>Pasta'] = await createEdge(concepts['Dinner'], concepts['Pasta'], dinnerPath, attrs.action, users.alice);
    edges['Dinner>StirFry'] = await createEdge(concepts['Dinner'], concepts['Stir Fry'], dinnerPath, attrs.action, users.bob);
    edges['Dinner>Soup'] = await createEdge(concepts['Dinner'], concepts['Soup'], dinnerPath, attrs.action, users.carol);

    // Cooking -> Baking -> Bread, Cookies, Cakes
    const bakingPath = [concepts['Cooking'], concepts['Baking']];
    edges['Baking>Bread'] = await createEdge(concepts['Baking'], concepts['Bread'], bakingPath, attrs.action, users.alice);
    edges['Baking>Cookies'] = await createEdge(concepts['Baking'], concepts['Cookies'], bakingPath, attrs.action, users.bob);
    edges['Baking>Cakes'] = await createEdge(concepts['Baking'], concepts['Cakes'], bakingPath, attrs.action, users.carol);

    // --- SPORTS TREE ---
    // This is important: "Running", "Cycling", "Swimming" also appear here
    // to test same-named concepts in different contexts (Flip View)
    const sportsPath = [concepts['Sports']];
    edges['Sports>TeamSports'] = await createEdge(concepts['Sports'], concepts['Team Sports'], sportsPath, attrs.action, users.bob);
    edges['Sports>SoloSports'] = await createEdge(concepts['Sports'], concepts['Solo Sports'], sportsPath, attrs.action, users.bob);

    // Sports -> Solo Sports -> Running [action], Cycling [action], Swimming [action]
    // SAME concept IDs as under Health>Fitness>Cardio — different context!
    const soloSportsPath = [concepts['Sports'], concepts['Solo Sports']];
    edges['SoloSports>Running'] = await createEdge(concepts['Solo Sports'], concepts['Running'], soloSportsPath, attrs.action, users.bob);
    edges['SoloSports>Cycling'] = await createEdge(concepts['Solo Sports'], concepts['Cycling'], soloSportsPath, attrs.action, users.bob);
    edges['SoloSports>Swimming'] = await createEdge(concepts['Solo Sports'], concepts['Swimming'], soloSportsPath, attrs.action, users.eve);

    // Sports -> Team Sports -> Basketball, Soccer, Baseball
    const teamSportsPath = [concepts['Sports'], concepts['Team Sports']];
    edges['TeamSports>Basketball'] = await createEdge(concepts['Team Sports'], concepts['Basketball'], teamSportsPath, attrs.action, users.bob);
    edges['TeamSports>Soccer'] = await createEdge(concepts['Team Sports'], concepts['Soccer'], teamSportsPath, attrs.action, users.dave);
    edges['TeamSports>Baseball'] = await createEdge(concepts['Team Sports'], concepts['Baseball'], teamSportsPath, attrs.action, users.eve);

    // --- LEARNING TREE ---
    const learningPath = [concepts['Learning']];
    edges['Learning>Reading'] = await createEdge(concepts['Learning'], concepts['Reading'], learningPath, attrs.action, users.carol);
    edges['Learning>Writing'] = await createEdge(concepts['Learning'], concepts['Writing'], learningPath, attrs.action, users.carol);
    edges['Learning>Practice'] = await createEdge(concepts['Learning'], concepts['Practice'], learningPath, attrs.action, users.dave);

    // Learning -> Reading -> Books [tool], Articles [tool], Podcasts [tool]
    const readingPath = [concepts['Learning'], concepts['Reading']];
    edges['Reading>Books'] = await createEdge(concepts['Reading'], concepts['Books'], readingPath, attrs.tool, users.carol);
    edges['Reading>Articles'] = await createEdge(concepts['Reading'], concepts['Articles'], readingPath, attrs.tool, users.carol);
    edges['Reading>Podcasts'] = await createEdge(concepts['Reading'], concepts['Podcasts'], readingPath, attrs.tool, users.dave);

    // --- MUSIC TREE ---
    const musicPath = [concepts['Music']];
    edges['Music>Guitar'] = await createEdge(concepts['Music'], concepts['Guitar'], musicPath, attrs.tool, users.dave);
    edges['Music>Piano'] = await createEdge(concepts['Music'], concepts['Piano'], musicPath, attrs.tool, users.eve);
    edges['Music>Drums'] = await createEdge(concepts['Music'], concepts['Drums'], musicPath, attrs.tool, users.frank);
    // Add "Practice" under Music too — same concept, different context (for Flip View)
    edges['Music>Practice'] = await createEdge(concepts['Music'], concepts['Practice'], musicPath, attrs.action, users.dave);

    // Music -> Guitar -> Scales, Chords, Songs
    const guitarPath = [concepts['Music'], concepts['Guitar']];
    edges['Guitar>Scales'] = await createEdge(concepts['Guitar'], concepts['Scales'], guitarPath, attrs.action, users.dave);
    edges['Guitar>Chords'] = await createEdge(concepts['Guitar'], concepts['Chords'], guitarPath, attrs.action, users.dave);
    edges['Guitar>Songs'] = await createEdge(concepts['Guitar'], concepts['Songs'], guitarPath, attrs.action, users.eve);

    console.log(`Created ${Object.keys(edges).length} edges`);

    // =============================================
    // STEP 5: CREATE SAVE VOTES (with overlapping patterns for vote sets)
    // =============================================
    console.log('Creating save votes...');

    async function saveEdge(userId, edgeId) {
      await client.query(
        'INSERT INTO votes (user_id, edge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, edgeId]
      );
    }

    // --- Root saves ---
    // Everyone saves Health
    for (const u of [users.alice, users.bob, users.carol, users.dave, users.eve, users.frank]) {
      await saveEdge(u, edges['root:Health']);
    }
    // Most save Cooking
    for (const u of [users.alice, users.bob, users.carol, users.dave]) {
      await saveEdge(u, edges['root:Cooking']);
    }
    // Some save Sports, Learning, Music
    for (const u of [users.bob, users.dave, users.eve]) {
      await saveEdge(u, edges['root:Sports']);
    }
    for (const u of [users.carol, users.dave]) {
      await saveEdge(u, edges['root:Learning']);
    }
    await saveEdge(users.dave, edges['root:Music']);
    await saveEdge(users.eve, edges['root:Music']);

    // --- Health tree saves (with overlapping patterns for vote sets) ---
    // Full path saves: save parent edges too

    // GROUP A pattern: alice, bob, carol all save Fitness, Cardio, Running, Cycling
    // (identical vote set = 3 users saving same children of Fitness)
    for (const u of [users.alice, users.bob, users.carol]) {
      await saveEdge(u, edges['Health>Fitness']);
      await saveEdge(u, edges['Fitness>Cardio']);
      await saveEdge(u, edges['Fitness>StrengthTraining']);
    }

    // GROUP B pattern: alice, bob also save Yoga (overlaps with Group A but adds one)
    // This should NOT form a separate identical set since they share with carol on the first two
    // Actually: alice and bob save {Cardio, StrengthTraining, Yoga}, carol saves {Cardio, StrengthTraining}
    for (const u of [users.alice, users.bob]) {
      await saveEdge(u, edges['Fitness>Yoga']);
    }

    // GROUP C pattern: dave, eve save Cardio + Yoga (different combo from above)
    for (const u of [users.dave, users.eve]) {
      await saveEdge(u, edges['Health>Fitness']);
      await saveEdge(u, edges['Fitness>Cardio']);
      await saveEdge(u, edges['Fitness>Yoga']);
    }

    // frank saves only Strength Training
    await saveEdge(users.frank, edges['Health>Fitness']);
    await saveEdge(users.frank, edges['Fitness>StrengthTraining']);

    // Cardio children saves (for deeper vote sets)
    for (const u of [users.alice, users.bob]) {
      await saveEdge(u, edges['Cardio>Running']);
      await saveEdge(u, edges['Cardio>Cycling']);
      await saveEdge(u, edges['Cardio>Timer']);
    }
    for (const u of [users.carol, users.dave]) {
      await saveEdge(u, edges['Cardio>Running']);
      await saveEdge(u, edges['Cardio>Swimming']);
      await saveEdge(u, edges['Cardio>Consistency']);
    }
    await saveEdge(users.eve, edges['Cardio>Swimming']);
    await saveEdge(users.eve, edges['Cardio>Cycling']);

    // Nutrition saves
    for (const u of [users.alice, users.bob, users.carol]) {
      await saveEdge(u, edges['Health>Nutrition']);
      await saveEdge(u, edges['Nutrition>Protein']);
      await saveEdge(u, edges['Nutrition>Vegetables']);
    }
    await saveEdge(users.dave, edges['Health>Nutrition']);
    await saveEdge(users.dave, edges['Nutrition>MealPrep']);

    // Mental Health saves
    for (const u of [users.alice, users.bob]) {
      await saveEdge(u, edges['Health>MentalHealth']);
      await saveEdge(u, edges['MentalHealth>Meditation']);
      await saveEdge(u, edges['MentalHealth>Journaling']);
    }
    await saveEdge(users.carol, edges['Health>MentalHealth']);
    await saveEdge(users.carol, edges['MentalHealth>Therapy']);
    await saveEdge(users.carol, edges['MentalHealth>Journal']);

    // --- Cooking tree saves ---
    for (const u of [users.alice, users.bob, users.carol]) {
      await saveEdge(u, edges['Cooking>Breakfast']);
      await saveEdge(u, edges['Breakfast>Pancakes']);
      await saveEdge(u, edges['Breakfast>Eggs']);
    }
    for (const u of [users.alice, users.bob]) {
      await saveEdge(u, edges['Cooking>Dinner']);
      await saveEdge(u, edges['Dinner>Pasta']);
    }
    await saveEdge(users.dave, edges['Cooking>Baking']);
    await saveEdge(users.dave, edges['Baking>Bread']);
    await saveEdge(users.dave, edges['Baking>Cookies']);

    // --- Sports tree saves ---
    for (const u of [users.bob, users.dave]) {
      await saveEdge(u, edges['Sports>SoloSports']);
      await saveEdge(u, edges['SoloSports>Running']);
      await saveEdge(u, edges['SoloSports>Cycling']);
    }
    await saveEdge(users.eve, edges['Sports>TeamSports']);
    await saveEdge(users.eve, edges['TeamSports>Basketball']);
    await saveEdge(users.eve, edges['TeamSports>Soccer']);

    // --- Music tree saves ---
    await saveEdge(users.dave, edges['Music>Guitar']);
    await saveEdge(users.dave, edges['Guitar>Chords']);
    await saveEdge(users.dave, edges['Guitar>Songs']);
    await saveEdge(users.eve, edges['Music>Piano']);
    await saveEdge(users.eve, edges['Music>Guitar']);
    await saveEdge(users.eve, edges['Guitar>Scales']);
    await saveEdge(users.eve, edges['Guitar>Songs']);

    console.log('Save votes created');

    // =============================================
    // STEP 6: CREATE LINK VOTES (similarity votes in Flip View)
    // =============================================
    console.log('Creating link votes...');

    // "Running" appears under both Cardio and Solo Sports
    // Users who came from Cardio context link to Solo Sports context as helpful
    // origin = edge connecting Running to Cardio, similar = edge connecting Running to Solo Sports
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.alice, edges['Cardio>Running'], edges['SoloSports>Running']]
    );
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.bob, edges['Cardio>Running'], edges['SoloSports>Running']]
    );
    // And from the other direction
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.dave, edges['SoloSports>Running'], edges['Cardio>Running']]
    );

    // "Practice" appears under Learning and Music
    await client.query(
      'INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.carol, edges['Learning>Practice'], edges['Music>Practice']]
    );

    console.log('Link votes created');

    // =============================================
    // STEP 7: CREATE MOVE VOTES
    // =============================================
    console.log('Creating move votes...');

    // Someone thinks "Yoga" under Fitness should actually be under Mental Health
    // First we need the edge for Yoga under Mental Health to exist as a destination
    // Let's create that edge
    edges['MentalHealth>Yoga'] = await createEdge(concepts['Mental Health'], concepts['Yoga'], mentalHealthPath, attrs.action, users.eve);

    // Now eve and frank vote to move Yoga from Fitness to Mental Health
    await client.query(
      'INSERT INTO side_votes (user_id, edge_id, destination_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.eve, edges['Fitness>Yoga'], edges['MentalHealth>Yoga']]
    );
    await client.query(
      'INSERT INTO side_votes (user_id, edge_id, destination_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.frank, edges['Fitness>Yoga'], edges['MentalHealth>Yoga']]
    );

    // Someone thinks "Meal Prep" under Nutrition should be under Cooking
    edges['Cooking>MealPrep'] = await createEdge(concepts['Cooking'], concepts['Meal Prep'], cookingPath, attrs.action, users.dave);
    await client.query(
      'INSERT INTO side_votes (user_id, edge_id, destination_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.dave, edges['Nutrition>MealPrep'], edges['Cooking>MealPrep']]
    );

    console.log('Move votes created');

    // =============================================
    // STEP 8: CREATE SWAP VOTES
    // =============================================
    console.log('Creating swap votes...');

    // Someone thinks "Strength Training" under Fitness should be replaced by "Yoga"
    // (they're siblings — both children of Fitness in the same context)
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.eve, edges['Fitness>StrengthTraining'], edges['Fitness>Yoga']]
    );
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.carol, edges['Fitness>StrengthTraining'], edges['Fitness>Yoga']]
    );

    // Someone thinks "Eggs" under Breakfast should be replaced by "Smoothies"
    await client.query(
      'INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [users.dave, edges['Breakfast>Eggs'], edges['Breakfast>Smoothies']]
    );

    console.log('Swap votes created');

    // =============================================
    // COMMIT
    // =============================================
    await client.query('COMMIT');

    // Print summary
    const userCount = (await pool.query('SELECT COUNT(*) FROM users')).rows[0].count;
    const conceptCount = (await pool.query('SELECT COUNT(*) FROM concepts')).rows[0].count;
    const edgeCount = (await pool.query('SELECT COUNT(*) FROM edges')).rows[0].count;
    const voteCount = (await pool.query('SELECT COUNT(*) FROM votes')).rows[0].count;
    const linkCount = (await pool.query('SELECT COUNT(*) FROM similarity_votes')).rows[0].count;
    const moveCount = (await pool.query('SELECT COUNT(*) FROM side_votes')).rows[0].count;
    const swapCount = (await pool.query('SELECT COUNT(*) FROM replace_votes')).rows[0].count;

    console.log('\n========================================');
    console.log('SEED COMPLETE!');
    console.log('========================================');
    console.log(`Users:           ${userCount}`);
    console.log(`Concepts:        ${conceptCount}`);
    console.log(`Edges:           ${edgeCount}`);
    console.log(`Save votes:      ${voteCount}`);
    console.log(`Link votes:      ${linkCount}`);
    console.log(`Move votes:      ${moveCount}`);
    console.log(`Swap votes:      ${swapCount}`);
    console.log('========================================');
    console.log('\nAll test users have password: test123');
    console.log('Users: alice, bob, carol, dave, eve, frank');
    console.log('\nKey test scenarios:');
    console.log('- "Running" exists under Health>Fitness>Cardio AND Sports>Solo Sports (Flip View)');
    console.log('- "Practice" exists under Learning AND Music (Flip View)');
    console.log('- Cardio has 5 children with 3 attributes (action, tool, value)');
    console.log('- Fitness children have overlapping vote patterns (vote set swatches)');
    console.log('- Cardio children have overlapping vote patterns (vote set swatches)');
    console.log('- Yoga under Fitness has 2 move votes pointing to Mental Health');
    console.log('- Strength Training under Fitness has 2 swap votes pointing to Yoga');
    console.log('- Eggs under Breakfast has 1 swap vote pointing to Smoothies');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('SEED FAILED:', error);
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .then(() => {
    console.log('\nDone! You can now start your servers.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
