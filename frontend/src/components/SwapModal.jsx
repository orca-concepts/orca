import React, { useState, useEffect, useRef } from 'react';
import { votesAPI, conceptsAPI } from '../services/api';

const SwapModal = ({ edgeId, conceptName, onClose, onSwapVoteChanged }) => {
  // Suggestions from backend (enriched with parent context)
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Context picker (after selecting a search result)
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [conceptContexts, setConceptContexts] = useState([]);
  const [contextsLoading, setContextsLoading] = useState(false);

  const [actionMessage, setActionMessage] = useState('');

  const modalRef = useRef(null);

  // Load suggestions on mount
  useEffect(() => {
    if (edgeId) loadSuggestions();
  }, [edgeId]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await conceptsAPI.searchConcepts(searchQuery);
        setSearchResults(response.data.results || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadSuggestions = async () => {
    try {
      setLoadingSuggestions(true);
      const response = await votesAPI.getSwapVotes(edgeId);
      setSuggestions(response.data.swapVotes || []);
    } catch (err) {
      console.error('Failed to load swap suggestions:', err);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleToggleSuggestionVote = async (suggestion) => {
    try {
      if (suggestion.userVoted) {
        setActionMessage('Removing swap vote...');
        await votesAPI.removeSwapVote(edgeId, suggestion.replacementEdgeId);
        setActionMessage('Swap vote removed');
      } else {
        setActionMessage('Placing swap vote...');
        await votesAPI.addSwapVote(edgeId, suggestion.replacementEdgeId);
        setActionMessage('Swap vote placed!');
      }
      await loadSuggestions();
      if (onSwapVoteChanged) onSwapVoteChanged();
      setTimeout(() => setActionMessage(''), 1500);
    } catch (err) {
      console.error('Failed to toggle swap vote:', err);
      const errorMsg = err.response?.data?.error || 'Failed to update swap vote';
      setActionMessage(errorMsg);
      setTimeout(() => setActionMessage(''), 2500);
    }
  };

  const handleSelectConcept = async (concept) => {
    if (selectedConcept && selectedConcept.id === concept.id) {
      // Toggle off
      setSelectedConcept(null);
      setConceptContexts([]);
      return;
    }
    setSelectedConcept({ id: concept.id, name: concept.name, attributeName: concept.attribute_name });
    setContextsLoading(true);
    try {
      const response = await conceptsAPI.getConceptParents(concept.id);
      const parents = response.data.parents || [];
      // Filter out the current edge (self-swap prevention)
      const filtered = parents.filter(p => p.edge_id !== edgeId);
      setConceptContexts(filtered);
    } catch (err) {
      console.error('Failed to load contexts:', err);
      setConceptContexts([]);
    } finally {
      setContextsLoading(false);
    }
  };

  const handleVoteForReplacement = async (replacementEdgeId) => {
    try {
      setActionMessage('Placing swap vote...');
      await votesAPI.addSwapVote(edgeId, replacementEdgeId);
      setActionMessage('Swap vote placed!');
      await loadSuggestions();
      if (onSwapVoteChanged) onSwapVoteChanged();
      // Reset search state
      setSelectedConcept(null);
      setConceptContexts([]);
      setSearchQuery('');
      setSearchResults([]);
      setTimeout(() => setActionMessage(''), 1500);
    } catch (err) {
      console.error('Failed to add swap vote:', err);
      const errorMsg = err.response?.data?.error || 'Failed to add swap vote';
      setActionMessage(errorMsg);
      setTimeout(() => setActionMessage(''), 2500);
    }
  };

  const getConceptUrl = (conceptId, graphPath) => {
    const pathParam = graphPath && graphPath.length > 0 ? `?path=${graphPath.join(',')}` : '';
    return `/concept/${conceptId}${pathParam}`;
  };

  // Existing suggestion edge IDs for dedup in search
  const suggestionEdgeIds = new Set(suggestions.map(s => s.replacementEdgeId));

  return (
    <div style={styles.overlay}>
      <div ref={modalRef} style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h3 style={styles.title}>Suggest Replacement for "{conceptName}"</h3>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* Action message */}
        {actionMessage && (
          <div style={styles.actionMessage}>{actionMessage}</div>
        )}

        {/* Content */}
        <div style={styles.content}>
          {/* Section 1: Existing suggestions */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Existing suggestions</div>
            {loadingSuggestions ? (
              <div style={styles.loading}>Loading...</div>
            ) : suggestions.length === 0 ? (
              <div style={styles.emptyHint}>No suggestions yet. Search below to suggest a replacement.</div>
            ) : (
              suggestions.map(s => (
                <div key={s.replacementEdgeId} style={{
                  ...styles.card,
                  ...(s.userVoted ? styles.cardActive : {}),
                }}>
                  <div style={styles.cardMain}>
                    <div style={styles.cardContext}>
                      {s.parentName ? `${s.parentName} →` : 'Root →'}
                    </div>
                    <div style={styles.cardNameRow}>
                      <span style={styles.cardName}>{s.replacementName}</span>
                      {s.replacementAttributeName && (
                        <span style={styles.attrBadge}>{s.replacementAttributeName}</span>
                      )}
                    </div>
                    <div style={styles.cardMeta}>
                      {s.voteCount} {s.voteCount === 1 ? 'vote' : 'votes'}
                      <a
                        href={getConceptUrl(s.replacementChildId, s.graphPath)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.openLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open
                      </a>
                    </div>
                  </div>
                  <button
                    style={{
                      ...styles.voteButton,
                      ...(s.userVoted ? styles.voteButtonActive : {}),
                    }}
                    onClick={() => handleToggleSuggestionVote(s)}
                  >
                    {s.userVoted ? 'Voted' : 'Vote'}
                  </button>
                </div>
              ))
            )}
          </div>

          <div style={styles.divider} />

          {/* Section 2: Search */}
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Search for a replacement</div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedConcept(null);
                setConceptContexts([]);
              }}
              placeholder="Search for a replacement concept..."
              style={styles.searchInput}
            />

            {searchLoading && (
              <div style={styles.loading}>Searching...</div>
            )}

            {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div style={styles.emptyHint}>No concepts found</div>
            )}

            {/* Search results */}
            {searchResults.length > 0 && (
              <div style={styles.searchResultList}>
                {searchResults.map(r => (
                  <div key={r.id}>
                    <div
                      style={{
                        ...styles.searchResultCard,
                        ...(selectedConcept && selectedConcept.id === r.id ? styles.searchResultCardSelected : {}),
                      }}
                      onClick={() => handleSelectConcept(r)}
                    >
                      <span style={styles.cardName}>{r.name}</span>
                      {r.attribute_name && (
                        <span style={styles.attrBadge}>{r.attribute_name}</span>
                      )}
                      <span style={styles.expandArrow}>
                        {selectedConcept && selectedConcept.id === r.id ? '▾' : '▸'}
                      </span>
                    </div>

                    {/* Context picker for selected result */}
                    {selectedConcept && selectedConcept.id === r.id && (
                      <div style={styles.contextPicker}>
                        {contextsLoading ? (
                          <div style={styles.loading}>Loading contexts...</div>
                        ) : conceptContexts.length === 0 ? (
                          <div style={styles.emptyHint}>No available contexts for this concept</div>
                        ) : (
                          conceptContexts.map(ctx => {
                            const alreadySuggested = suggestionEdgeIds.has(ctx.edge_id);
                            return (
                              <div key={ctx.edge_id} style={styles.contextCard}>
                                <div style={styles.contextInfo}>
                                  <div style={styles.cardContext}>
                                    {ctx.name ? `${ctx.name} →` : 'Root →'}
                                  </div>
                                  <div style={styles.contextName}>{r.name}</div>
                                  <a
                                    href={getConceptUrl(r.id, ctx.graph_path)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={styles.openLink}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Open
                                  </a>
                                </div>
                                {alreadySuggested ? (
                                  <span style={styles.alreadyVotedHint}>Already suggested</span>
                                ) : (
                                  <button
                                    style={styles.voteButton}
                                    onClick={() => handleVoteForReplacement(ctx.edge_id)}
                                  >
                                    Vote to replace
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#faf9f7',
    borderRadius: '12px',
    width: '500px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
    border: '1px solid #e0e0e0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '20px 24px 16px',
    borderBottom: '1px solid #e8e8e8',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '600',
    wordBreak: 'break-word',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: '#999',
    cursor: 'pointer',
    padding: '4px 8px',
    marginLeft: '12px',
    flexShrink: 0,
  },
  actionMessage: {
    padding: '8px 24px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    backgroundColor: '#f0f0e8',
    borderBottom: '1px solid #e8e8e8',
  },
  content: {
    padding: '16px 24px 24px',
    overflowY: 'auto',
    flex: 1,
  },
  section: {
    marginBottom: '8px',
  },
  sectionLabel: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  divider: {
    height: '1px',
    backgroundColor: '#e8e8e8',
    margin: '16px 0',
  },
  loading: {
    textAlign: 'center',
    padding: '12px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  emptyHint: {
    padding: '12px 0',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  // Suggestion cards
  card: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid #e0e0e0',
    marginBottom: '6px',
    backgroundColor: 'white',
  },
  cardActive: {
    borderColor: '#333',
    backgroundColor: '#fafafa',
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  cardContext: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginBottom: '2px',
  },
  cardNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  cardName: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  attrBadge: {
    display: 'inline-block',
    padding: '1px 6px',
    background: '#f0ede8',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#555',
    flexShrink: 0,
  },
  cardMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
    marginTop: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  openLink: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  voteButton: {
    padding: '5px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#faf9f7',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#333',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    marginLeft: '12px',
  },
  voteButtonActive: {
    backgroundColor: '#333',
    color: 'white',
    borderColor: '#333',
  },
  // Search
  searchInput: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#faf9f7',
    outline: 'none',
    boxSizing: 'border-box',
  },
  searchResultList: {
    marginTop: '8px',
    maxHeight: '250px',
    overflowY: 'auto',
  },
  searchResultCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid #e8e8e8',
    marginBottom: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  searchResultCardSelected: {
    borderColor: '#333',
    backgroundColor: '#fafafa',
  },
  expandArrow: {
    marginLeft: 'auto',
    fontSize: '12px',
    color: '#999',
    flexShrink: 0,
  },
  // Context picker
  contextPicker: {
    marginLeft: '16px',
    marginBottom: '8px',
    borderLeft: '2px solid #e8e8e8',
    paddingLeft: '12px',
  },
  contextCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderRadius: '4px',
    border: '1px solid #eee',
    marginBottom: '4px',
    backgroundColor: 'white',
  },
  contextInfo: {
    flex: 1,
    minWidth: 0,
  },
  contextName: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  alreadyVotedHint: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
    flexShrink: 0,
    marginLeft: '12px',
  },
};

export default SwapModal;
