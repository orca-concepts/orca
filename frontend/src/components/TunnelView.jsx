import React, { useState, useEffect, useRef, useCallback } from 'react';
import { conceptsAPI, tunnelsAPI } from '../services/api';

const TunnelView = ({
  conceptId,
  edgeId,
  path,
  isGuest = false,
  onNavigate,
  onOpenNewTab,
}) => {
  const [tunnelData, setTunnelData] = useState({});
  const [loading, setLoading] = useState(true);
  const [attributes, setAttributes] = useState([]);
  const [columnSorts, setColumnSorts] = useState({});

  // Per-column search state
  const [columnSearchTerms, setColumnSearchTerms] = useState({});
  const [columnSearchResults, setColumnSearchResults] = useState({});
  const [columnSearchLoading, setColumnSearchLoading] = useState({});
  const [contextPickerData, setContextPickerData] = useState(null); // { attributeId, conceptId, conceptName, parents }
  const [columnFeedback, setColumnFeedback] = useState({}); // attributeId -> message
  const searchTimers = useRef({});

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, card }

  const loadData = useCallback(async () => {
    if (!edgeId) return;
    setLoading(true);
    try {
      const [attrRes, tunnelRes] = await Promise.all([
        conceptsAPI.getAttributes().catch(() => ({ data: { attributes: [] } })),
        tunnelsAPI.getTunnelLinks(edgeId).catch(() => ({ data: { tunnelLinks: {} } })),
      ]);
      setAttributes(attrRes.data.attributes || attrRes.data || []);
      setTunnelData(tunnelRes.data.tunnelLinks || {});
    } catch (err) {
      console.error('Error loading tunnel data:', err);
    } finally {
      setLoading(false);
    }
  }, [edgeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    window.document.addEventListener('mousedown', handleClick);
    window.document.addEventListener('keydown', handleKey);
    return () => {
      window.document.removeEventListener('mousedown', handleClick);
      window.document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Close context picker on outside click or Escape
  useEffect(() => {
    if (!contextPickerData) return;
    const handleKey = (e) => { if (e.key === 'Escape') setContextPickerData(null); };
    window.document.addEventListener('keydown', handleKey);
    return () => window.document.removeEventListener('keydown', handleKey);
  }, [contextPickerData]);

  const handleColumnSortChange = (attrId, newSort) => {
    setColumnSorts(prev => ({ ...prev, [attrId]: newSort }));
  };

  const getSortedLinks = (attrId) => {
    const group = tunnelData[attrId];
    if (!group) return [];
    const links = [...group.links];
    const sort = columnSorts[attrId] || 'votes';
    if (sort === 'new') {
      links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      links.sort((a, b) => b.tunnelVoteCount - a.tunnelVoteCount || b.saveVoteCount - a.saveVoteCount);
    }
    return links;
  };

  // Debounced search per column
  const handleSearchInput = (attrId, value) => {
    setColumnSearchTerms(prev => ({ ...prev, [attrId]: value }));
    setContextPickerData(null);

    if (searchTimers.current[attrId]) clearTimeout(searchTimers.current[attrId]);

    if (!value || value.trim().length === 0) {
      setColumnSearchResults(prev => ({ ...prev, [attrId]: [] }));
      return;
    }

    searchTimers.current[attrId] = setTimeout(async () => {
      setColumnSearchLoading(prev => ({ ...prev, [attrId]: true }));
      try {
        const res = await conceptsAPI.searchConcepts(value.trim(), undefined, undefined, attrId);
        setColumnSearchResults(prev => ({ ...prev, [attrId]: res.data.results || [] }));
      } catch (err) {
        console.error('Search error:', err);
        setColumnSearchResults(prev => ({ ...prev, [attrId]: [] }));
      } finally {
        setColumnSearchLoading(prev => ({ ...prev, [attrId]: false }));
      }
    }, 300);
  };

  // When a search result is clicked, show context picker (parent edges for that concept)
  const handleSearchResultClick = async (attrId, result) => {
    try {
      const [parentsRes, rootRes] = await Promise.all([
        conceptsAPI.getConceptParents(result.id, '').catch(() => ({ data: { parents: [] } })),
        conceptsAPI.getRootConcepts().catch(() => ({ data: { concepts: [] } })),
      ]);
      // Filter non-root parents to edges with matching attribute
      const matchingParents = (parentsRes.data.parents || []).filter(p => p.attribute_id === attrId);

      // Also check for root edges — getConceptParents excludes them (inner JOIN on parent_id)
      const rootConcepts = rootRes.data.concepts || rootRes.data || [];
      const rootEdges = (Array.isArray(rootConcepts) ? rootConcepts : [])
        .filter(r => r.id === result.id && r.attribute_id === attrId)
        .map(r => ({
          edge_id: r.edge_id,
          id: r.id,
          name: r.name,
          graph_path: [],
          attribute_id: r.attribute_id,
          attribute_name: r.attribute_name,
          vote_count: r.vote_count,
        }));

      const allContexts = [...matchingParents, ...rootEdges];

      if (allContexts.length === 0) {
        setColumnFeedback(prev => ({ ...prev, [attrId]: 'No contexts with this attribute' }));
        setTimeout(() => setColumnFeedback(prev => ({ ...prev, [attrId]: null })), 2000);
        return;
      }

      if (allContexts.length === 1) {
        // Single context — create tunnel directly
        await createTunnel(attrId, allContexts[0].edge_id);
        return;
      }

      // Resolve path names for display
      const allIds = new Set();
      allContexts.forEach(p => (p.graph_path || []).forEach(id => allIds.add(id)));
      allContexts.forEach(p => { if (p.id) allIds.add(p.id); });

      let nameMap = {};
      if (allIds.size > 0) {
        try {
          const nameRes = await conceptsAPI.getConceptNames(Array.from(allIds).join(','));
          for (const c of (nameRes.data.concepts || [])) {
            nameMap[c.id] = c.name;
          }
        } catch (e) { /* ignore */ }
      }

      setContextPickerData({
        attributeId: attrId,
        conceptId: result.id,
        conceptName: result.name,
        parents: allContexts,
        nameMap,
      });
    } catch (err) {
      console.error('Error loading concept parents:', err);
    }
  };

  const createTunnel = async (attrId, linkedEdgeId) => {
    try {
      await tunnelsAPI.createTunnelLink(edgeId, linkedEdgeId);
      setColumnSearchTerms(prev => ({ ...prev, [attrId]: '' }));
      setColumnSearchResults(prev => ({ ...prev, [attrId]: [] }));
      setContextPickerData(null);
      await loadData();
    } catch (err) {
      if (err.response?.status === 409) {
        setColumnFeedback(prev => ({ ...prev, [attrId]: 'Already linked' }));
      } else {
        setColumnFeedback(prev => ({ ...prev, [attrId]: err.response?.data?.error || 'Failed' }));
      }
      setTimeout(() => setColumnFeedback(prev => ({ ...prev, [attrId]: null })), 2000);
    }
  };

  const handleTunnelVote = async (tunnelLinkId, attrId, currentVoted) => {
    if (isGuest) return;
    // Optimistic update
    setTunnelData(prev => {
      const updated = { ...prev };
      if (updated[attrId]) {
        updated[attrId] = {
          ...updated[attrId],
          links: updated[attrId].links.map(l =>
            l.tunnelLinkId === tunnelLinkId
              ? {
                  ...l,
                  userVoted: !currentVoted,
                  tunnelVoteCount: currentVoted ? l.tunnelVoteCount - 1 : l.tunnelVoteCount + 1,
                }
              : l
          ),
        };
      }
      return updated;
    });
    try {
      await tunnelsAPI.toggleTunnelVote(tunnelLinkId);
    } catch (err) {
      console.error('Vote error:', err);
      await loadData(); // revert on error
    }
  };

  const handleCardClick = (card) => {
    if (!onNavigate) return;
    // Navigate current tab to the linked concept
    // The card's pathNames correspond to graph_path (root to parent)
    // For navigation, we need the path excluding the concept itself
    // graph_path already is root-to-parent, which is the navigation path
    const navPath = card.pathNames ? (tunnelData[card.attributeId]?.links || []).find(l => l.tunnelLinkId === card.tunnelLinkId) : card;
    // Use the linked edge's graph_path for navigation
    // We need the raw IDs, not names. Reconstruct from the API data.
    // The API returns pathNames but not pathIds directly; however we can use the linkedEdgeId
    // to navigate. The simplest approach: navigate to the concept with the path from the tunnel data.
    // We stored graph_path in the backend response implicitly via pathNames.
    // Actually, let's pass through the parent's graph_path directly.
    onNavigate(card.conceptId, card.graphPath || [], 'children');
  };

  const handleCardRightClick = (e, card) => {
    if (!onOpenNewTab) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, card });
  };

  if (loading) {
    return <div style={styles.loading}>Loading tunnel links...</div>;
  }

  // Parse attributes array (may come as { attributes: [...] } or directly as array)
  const attrList = Array.isArray(attributes) ? attributes : (attributes.attributes || []);

  return (
    <div style={styles.container}>
      <div style={styles.columnsContainer}>
        {attrList.map(attr => {
          const attrId = attr.id;
          const links = getSortedLinks(attrId);
          const currentSort = columnSorts[attrId] || 'votes';
          const searchTerm = columnSearchTerms[attrId] || '';
          const searchResults = columnSearchResults[attrId] || [];
          const isSearching = columnSearchLoading[attrId] || false;
          const feedback = columnFeedback[attrId] || null;

          return (
            <div key={attrId} style={styles.column}>
              {/* Column header */}
              <div style={styles.columnHeader}>[{attr.name}]</div>

              {/* Search/add field (logged-in only) */}
              {!isGuest && (
                <div style={styles.searchSection}>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => handleSearchInput(attrId, e.target.value)}
                    placeholder={`Search ${attr.name}...`}
                    style={styles.searchInput}
                  />
                  {feedback && (
                    <div style={styles.feedback}>{feedback}</div>
                  )}
                  {searchTerm && searchResults.length > 0 && !contextPickerData && (
                    <div style={styles.searchDropdown}>
                      {searchResults.map(result => (
                        <div
                          key={result.id}
                          style={styles.searchResultItem}
                          onClick={() => handleSearchResultClick(attrId, result)}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f4f0'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'white'; }}
                        >
                          <span style={styles.searchResultName}>{result.name}</span>
                          {result.savedTabs && result.savedTabs.length > 0 && (
                            <span style={styles.searchBadge}>Voted</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {searchTerm && searchResults.length === 0 && !isSearching && searchTerm.trim().length > 0 && (
                    <div style={styles.searchDropdown}>
                      <div style={styles.searchNoResults}>No results</div>
                    </div>
                  )}
                  {/* Context picker */}
                  {contextPickerData && contextPickerData.attributeId === attrId && (
                    <div style={styles.searchDropdown}>
                      <div style={styles.contextPickerHeader}>
                        Select context for "{contextPickerData.conceptName}":
                      </div>
                      {contextPickerData.parents.map(parent => {
                        const pathDisplay = (parent.graph_path || [])
                          .map(id => contextPickerData.nameMap[id] || `[${id}]`)
                          .join(' \u2192 ');
                        return (
                          <div
                            key={parent.edge_id}
                            style={styles.contextPickerItem}
                            onClick={() => createTunnel(attrId, parent.edge_id)}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f4f0'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'white'; }}
                          >
                            {pathDisplay ? `${pathDisplay} \u2192 ${parent.name}` : parent.name}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Sort toggle */}
              {links.length > 0 && (
                <div style={styles.sortRow}>
                  {[
                    { key: 'votes', label: 'Votes' },
                    { key: 'new', label: 'New' },
                  ].map(({ key, label }, i) => (
                    <button
                      key={key}
                      onClick={() => handleColumnSortChange(attrId, key)}
                      style={{
                        ...styles.sortBtn,
                        ...(currentSort === key ? styles.sortBtnActive : {}),
                        ...(i === 0 ? { borderRight: '1px solid #ddd' } : {}),
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Card list */}
              {links.length === 0 ? (
                <div style={styles.emptyColumn}>No tunnels yet</div>
              ) : (
                <div style={styles.cardList}>
                  {links.map(card => (
                    <TunnelCard
                      key={card.tunnelLinkId}
                      card={card}
                      attrId={attrId}
                      isGuest={isGuest}
                      onVote={handleTunnelVote}
                      onClick={handleCardClick}
                      onRightClick={handleCardRightClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={styles.contextMenuOverlay}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            zIndex: 1000,
            minWidth: '180px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}>
            <div
              style={styles.contextMenuItem}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f4f0'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'white'; }}
              onClick={() => {
                const c = contextMenu.card;
                if (onOpenNewTab) onOpenNewTab(c.conceptId, c.graphPath || []);
                setContextMenu(null);
              }}
            >
              Open in new graph tab
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Separate card component to keep things clean
const TunnelCard = ({ card, attrId, isGuest, onVote, onClick, onRightClick }) => {
  const pathDisplay = (card.pathNames || []).join(' \u2192 ');

  return (
    <div
      style={styles.card}
      onContextMenu={(e) => onRightClick(e, card)}
    >
      {/* Path above */}
      {pathDisplay && (
        <div style={styles.cardPath}>{pathDisplay}</div>
      )}
      {/* Concept name — clickable */}
      <div
        style={styles.cardName}
        onClick={() => onClick(card)}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#000'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#222'; }}
      >
        {card.conceptName}
      </div>
      {/* Vote row */}
      <div style={styles.cardVoteRow}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onVote(card.tunnelLinkId, attrId, card.userVoted);
          }}
          style={{
            ...styles.voteButton,
            ...(card.userVoted ? styles.voteButtonActive : {}),
            ...(isGuest ? styles.voteButtonReadOnly : {}),
          }}
          title={isGuest ? 'Log in to vote' : (card.userVoted ? 'Remove vote' : 'Vote')}
        >
          ▲ {card.tunnelVoteCount}
        </button>
        <span style={styles.saveVoteCount} title="Save votes on this concept">
          ▲ {card.saveVoteCount}
        </span>
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    width: '100%',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  columnsContainer: {
    display: 'flex',
    gap: '24px',
    overflowX: 'auto',
    alignItems: 'flex-start',
  },
  column: {
    minWidth: '220px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  columnHeader: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    paddingBottom: '8px',
    borderBottom: '2px solid #ddd',
    marginBottom: '12px',
  },
  searchSection: {
    position: 'relative',
    marginBottom: '12px',
  },
  searchInput: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    boxSizing: 'border-box',
    outline: 'none',
  },
  feedback: {
    fontSize: '12px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginTop: '4px',
  },
  searchDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '4px',
    zIndex: 100,
    maxHeight: '240px',
    overflowY: 'auto',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  searchResultItem: {
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
  },
  searchResultName: {
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  searchBadge: {
    fontSize: '11px',
    padding: '1px 6px',
    border: '1px solid #333',
    borderRadius: '2px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    flexShrink: 0,
  },
  searchNoResults: {
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  contextPickerHeader: {
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    borderBottom: '1px solid #eee',
  },
  contextPickerItem: {
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    backgroundColor: 'white',
  },
  sortRow: {
    display: 'flex',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '12px',
    alignSelf: 'flex-start',
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
  emptyColumn: {
    textAlign: 'center',
    padding: '30px 10px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
  },
  card: {
    padding: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  cardPath: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginBottom: '4px',
    lineHeight: '1.3',
    wordBreak: 'break-word',
  },
  cardName: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
    color: '#222',
    cursor: 'pointer',
    marginBottom: '6px',
  },
  cardVoteRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  voteButton: {
    padding: '3px 8px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    transition: 'all 0.15s',
  },
  voteButtonActive: {
    backgroundColor: '#333',
    color: '#faf9f6',
    borderColor: '#333',
  },
  voteButtonReadOnly: {
    cursor: 'default',
    opacity: 0.7,
  },
  saveVoteCount: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  contextMenuOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  contextMenuItem: {
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    backgroundColor: 'white',
  },
};

export default TunnelView;
