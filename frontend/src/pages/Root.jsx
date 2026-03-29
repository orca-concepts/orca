import React, { useState, useEffect } from 'react';
import { conceptsAPI, votesAPI, moderationAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConceptGrid from '../components/ConceptGrid';
import SearchField from '../components/SearchField';
import DiffModal from '../components/DiffModal';
import HiddenConceptsView from '../components/HiddenConceptsView';
import SwapModal from '../components/SwapModal';

const ATTR_FILTER_KEY = 'orca_root_attribute_filter';

const Root = ({ graphTabId, onNavigate, isGuest = false }) => {
  const [concepts, setConcepts] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState('saves'); // 'saves' | 'new' | 'annotations' | 'top_annotation'

  const { user } = useAuth();

  // Phase 14a: Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffInitialConcept, setDiffInitialConcept] = useState(null);

  // Phase 16c: Hidden root concepts state
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

  // Phase 38b: Swap modal state for root concepts
  const [swapModalEdge, setSwapModalEdge] = useState(null);

  // Phase 25b: Attribute filter state
  const [availableAttributes, setAvailableAttributes] = useState([]);
  const [attributeFilter, setAttributeFilter] = useState(() => {
    return localStorage.getItem(ATTR_FILTER_KEY) || 'value';
  });

  // Load available attributes on mount
  useEffect(() => {
    conceptsAPI.getAttributes()
      .then(response => {
        const attrs = response.data.attributes;
        setAvailableAttributes(attrs);
        // Validate stored filter against available attributes
        const stored = localStorage.getItem(ATTR_FILTER_KEY);
        const validNames = ['all', ...attrs.map(a => a.name)];
        if (!stored || !validNames.includes(stored)) {
          setAttributeFilter('value');
          localStorage.setItem(ATTR_FILTER_KEY, 'value');
        }
      })
      .catch(err => console.error('Failed to load attributes:', err));
  }, []);

  const handleAttributeFilterChange = (value) => {
    setAttributeFilter(value);
    localStorage.setItem(ATTR_FILTER_KEY, value);
  };

  useEffect(() => {
    loadRootConcepts();
    loadHiddenCount();
  }, [sortMode, user]);

  const loadHiddenCount = async () => {
    if (!user) { setHiddenCount(0); return; }
    try {
      // Root-level hidden: parentId is 'null' (string for the URL param), path is empty
      const response = await moderationAPI.getHiddenChildren('null', []);
      setHiddenCount((response.data.hiddenChildren || []).length);
    } catch (err) {
      setHiddenCount(0);
    }
  };

  const loadRootConcepts = async () => {
    try {
      setLoading(true);
      const sortParam = sortMode === 'saves' ? undefined : sortMode;
      const response = await conceptsAPI.getRootConcepts(sortParam);
      setConcepts(response.data.concepts);
      setTotalUsers(response.data.totalUsers);
      setError(null);
    } catch (err) {
      setError('Failed to load root concepts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConceptClick = (conceptId) => {
    // Look up the concept name for the tab label
    const concept = concepts.find(c => c.id === conceptId);
    const label = concept ? concept.name : 'Concept';

    // Update the graph tab's navigation state
    if (onNavigate && graphTabId) {
      onNavigate(graphTabId, {
        tabType: 'concept',
        conceptId: conceptId,
        path: [],
        viewMode: 'children',
        label,
      });
    }
  };

  const handleVote = async (edgeId, hasVoted, childPath) => {
    try {
      if (hasVoted) {
        await votesAPI.removeVote(edgeId);
      } else {
        await votesAPI.addVote(edgeId, []);
      }
      await loadRootConcepts();
    } catch (err) {
      console.error('Vote failed:', err);
      alert(err.response?.data?.error || 'Failed to vote');
    }
  };

  // Phase 14a: Open diff modal from right-click on a root concept card
  const handleCompareChildren = (child) => {
    setDiffInitialConcept({
      conceptId: child.id,
      name: child.name,
      attribute: child.attribute_name || '',
      path: [],
      pathNames: []
    });
    setDiffModalOpen(true);
  };

  // Phase 16c: Flag a root concept as spam
  const handleFlag = async (child) => {
    if (!user) return;
    const confirmMsg = `Flag "${child.name}" as spam?\n\nOnce 10 users have flagged it, it will be hidden from all users. It can be reviewed and restored from the Hidden panel.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await moderationAPI.flagEdge(child.edge_id, 'spam');
      await loadRootConcepts();
      await loadHiddenCount();
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.error?.includes('already flagged')) {
        alert('You have already flagged this concept.');
      } else {
        alert(err.response?.data?.error || 'Failed to flag concept');
      }
    }
  };

  const handleUnflag = async (child) => {
    if (!user) return;
    try {
      await moderationAPI.unflagEdge(child.edge_id);
      await loadRootConcepts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove flag');
    }
  };

  // Phase 38b: Swap vote on root concepts
  const handleSwapClick = (concept) => {
    setSwapModalEdge({
      edgeId: concept.edge_id,
      conceptName: concept.name,
      conceptId: concept.id,
    });
  };

  const handleSwapModalClose = () => setSwapModalEdge(null);

  const handleSwapVoteChanged = () => {
    // Optimistically clear any save for this edge in local state (mutual exclusivity)
    if (swapModalEdge) {
      const eid = swapModalEdge.edgeId;
      setConcepts(prev => prev.map(c =>
        c.edge_id === eid
          ? {
              ...c,
              user_voted: false,
              vote_count: c.user_voted ? Math.max(0, (parseInt(c.vote_count) || 1) - 1) : (parseInt(c.vote_count) || 0),
              user_swapped: true,
            }
          : c
      ));
    }
    loadRootConcepts();
  };

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        {!loading && !error && (
          <div style={styles.topBar}>
            <div style={styles.totalUsers}>
              {totalUsers} {totalUsers === 1 ? 'user' : 'users'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {hiddenCount > 0 && user && (
                <button
                  onClick={() => setShowHiddenPanel(true)}
                  style={styles.hiddenBadge}
                  title={`${hiddenCount} hidden root concept${hiddenCount !== 1 ? 's' : ''} — click to review`}
                >
                  {hiddenCount} hidden
                </button>
              )}
              <div style={styles.sortRow}>
                {[
                  { value: 'saves', label: 'Graph Votes' },
                  { value: 'new', label: 'Newest' },
                  { value: 'annotations', label: 'Annotations' },
                  { value: 'top_annotation', label: 'Top Annotation' },
                ].map((opt, i) => (
                  <button
                    key={opt.value}
                    onClick={() => setSortMode(opt.value)}
                    style={{
                      ...styles.sortBtn,
                      ...(sortMode === opt.value ? styles.sortBtnActive : {}),
                      ...(i < 3 ? { borderRight: '1px solid #eee' } : {}),
                    }}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Phase 25b: Attribute filter bar — only when multiple attributes enabled */}
        {!loading && !error && availableAttributes.length > 1 && (
          <div style={styles.attributeFilterBar}>
            <button
              style={attributeFilter === 'all' ? styles.attributeFilterBtnActive : styles.attributeFilterBtn}
              onClick={() => handleAttributeFilterChange('all')}
            >
              All
            </button>
            {availableAttributes.map(attr => (
              <button
                key={attr.id}
                style={attributeFilter === attr.name ? styles.attributeFilterBtnActive : styles.attributeFilterBtn}
                onClick={() => handleAttributeFilterChange(attr.name)}
              >
                {attr.name.charAt(0).toUpperCase() + attr.name.slice(1)}
              </button>
            ))}
          </div>
        )}

        {loading && <div style={styles.loading}>Loading...</div>}

        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && (() => {
          const filtered = attributeFilter === 'all' || availableAttributes.length <= 1
            ? concepts
            : concepts.filter(c => c.attribute_name === attributeFilter);
          return filtered.length === 0 ? (
            <div style={styles.emptyState}>
              <p>{isGuest ? 'No root concepts yet.' : 'No root concepts yet. Type in the search field to create one!'}</p>
            </div>
          ) : (
            <ConceptGrid
              concepts={filtered}
              onConceptClick={handleConceptClick}
              onVote={isGuest ? undefined : handleVote}
              onSwapClick={isGuest ? undefined : handleSwapClick}
              onCompareChildren={handleCompareChildren}
              onFlag={isGuest ? undefined : handleFlag}
              onUnflag={isGuest ? undefined : handleUnflag}
              showVotes={true}
              showAttributeBadge={true}
              path={[]}
            />
          );
        })()}
      </main>

      {/* Search field with root concept creation */}
      <SearchField
        parentId={null}
        path={null}
        viewMode="children"
        onConceptAdded={loadRootConcepts}
        isRootPage={!isGuest}
        graphTabId={graphTabId}
        onNavigate={onNavigate}
        isGuest={isGuest}
      />

      {/* Phase 14a: Diff Modal */}
      <DiffModal
        isOpen={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        initialConcept={diffInitialConcept}
        isGuest={isGuest}
      />

      {/* Phase 38b: Swap Modal for root concepts */}
      {swapModalEdge && (
        <SwapModal
          edgeId={swapModalEdge.edgeId}
          conceptName={swapModalEdge.conceptName}
          siblings={concepts.filter(c => c.edge_id !== swapModalEdge.edgeId)}
          onClose={handleSwapModalClose}
          onSwapVoteChanged={handleSwapVoteChanged}
        />
      )}

      {/* Phase 16c: Hidden Concepts Panel */}
      {showHiddenPanel && (
        <HiddenConceptsView
          parentId="null"
          path={[]}
          onClose={() => { setShowHiddenPanel(false); loadHiddenCount(); loadRootConcepts(); }}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#f5f5f5',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '40px 20px',
    position: 'relative',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#666',
  },
  error: {
    padding: '15px',
    backgroundColor: '#fee',
    color: '#c33',
    borderRadius: '4px',
    marginBottom: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
  totalUsers: {
    fontSize: '14px',
    color: '#888',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  sortRow: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  sortBtn: {
    padding: '3px 10px',
    border: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  sortBtnActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  hiddenBadge: {
    padding: '4px 10px',
    fontSize: '12px',
    backgroundColor: '#f5f0ea',
    color: '#555',
    border: '1px solid #d4d0c8',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  attributeFilterBar: {
    display: 'flex',
    gap: '6px',
    marginBottom: '16px',
  },
  attributeFilterBtn: {
    padding: '5px 14px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#555',
    transition: 'all 0.2s',
  },
  attributeFilterBtnActive: {
    padding: '5px 14px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'white',
    transition: 'all 0.2s',
  },
};

export default Root;
