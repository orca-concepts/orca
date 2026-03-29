import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { conceptsAPI, votesAPI } from '../services/api';

/**
 * Collect all unique concept IDs from parent graph_paths that need name resolution.
 */
function collectPathIds(parents) {
  const ids = new Set();
  for (const parent of parents) {
    for (const id of parent.graph_path) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Find all maximal contiguous runs of concept IDs that appear identically
 * (same values, same order, adjacent) in both pathA and pathB.
 * Returns an array of arrays (each a contiguous shared run).
 */
function getSharedSegments(pathA, pathB) {
  const result = [];
  for (let i = 0; i < pathA.length; i++) {
    for (let j = 0; j < pathB.length; j++) {
      if (pathA[i] === pathB[j]) {
        // Skip if this is a continuation of a previous match (avoid duplicates)
        if (i > 0 && j > 0 && pathA[i - 1] === pathB[j - 1]) continue;
        // Extend the match as far as possible
        let len = 1;
        while (
          i + len < pathA.length &&
          j + len < pathB.length &&
          pathA[i + len] === pathB[j + len]
        ) {
          len++;
        }
        result.push(pathA.slice(i, i + len));
      }
    }
  }
  return result;
}

const FlipView = ({
  concept,
  parents: initialParents,
  originPath,
  originEdgeId,
  mode = 'exploratory',
  isGuest = false,
  onParentClick: externalParentClick,
}) => {
  const navigate = useNavigate();
  const [nameMap, setNameMap] = useState({});
  // Local state for parents so we can update link counts without re-fetching
  const [parents, setParents] = useState(initialParents);
  // Sort mode: 'links' (default in contextual), 'similarity_asc', 'similarity_desc'
  const [sortMode, setSortMode] = useState('links');
  // Hover state for path highlighting: { edgeId, conceptId } | null
  const [hoveredInfo, setHoveredInfo] = useState(null);

  // Sync with prop changes (e.g. when parent component re-fetches)
  useEffect(() => {
    setParents(initialParents);
  }, [initialParents]);

  const isContextual = mode === 'contextual' && !!originEdgeId;

  // Fetch concept names for all IDs in graph_paths (for path display on cards)
  useEffect(() => {
    const idsToFetch = collectPathIds(parents);

    if (idsToFetch.length === 0) return;

    // Seed with names we already have from parent objects
    const knownNames = {};
    for (const parent of parents) {
      knownNames[parent.id] = parent.name;
    }

    const unknownIds = idsToFetch.filter(id => !knownNames[id]);

    if (unknownIds.length === 0) {
      setNameMap(knownNames);
      return;
    }

    conceptsAPI.getConceptNames(unknownIds.join(','))
      .then(response => {
        const fetched = {};
        for (const c of response.data.concepts) {
          fetched[c.id] = c.name;
        }
        setNameMap({ ...knownNames, ...fetched });
      })
      .catch(err => {
        console.error('Error fetching concept names for flip view:', err);
        setNameMap(knownNames);
      });
  }, [parents]);

  const handleParentClick = (parent) => {
    if (externalParentClick) {
      // Tab mode: use the callback provided by Concept.jsx
      externalParentClick(parent);
    } else {
      // Standalone mode: stay on the current concept but switch to the new parent's context (Phase 38a)
      const newPath = parent.graph_path.join(',');
      navigate(`/concept/${concept.id}?path=${newPath}`);
    }
  };

  const handleLinkVote = async (e, parent) => {
    // Stop the card click from firing
    e.stopPropagation();

    if (!originEdgeId) return;

    try {
      if (parent.user_linked) {
        // Remove link vote
        const response = await votesAPI.removeLinkVote(originEdgeId, parent.edge_id);
        setParents(prev => prev.map(p =>
          p.edge_id === parent.edge_id
            ? { ...p, user_linked: false, link_count: response.data.linkCount }
            : p
        ));
      } else {
        // Add link vote
        const response = await votesAPI.addLinkVote(originEdgeId, parent.edge_id);
        setParents(prev => prev.map(p =>
          p.edge_id === parent.edge_id
            ? { ...p, user_linked: true, link_count: response.data.linkCount }
            : p
        ));
      }
    } catch (err) {
      console.error('Error toggling link vote:', err);
    }
  };

  const getName = (id) => nameMap[id] || '...';

  /**
   * Full path tooltip: entire chain including concept name at the end.
   */
  const getFullPathTooltip = (parent) => {
    return parent.graph_path.map(id => getName(id)).join(' → ') + ' → ' + (concept?.name || '');
  };

  // Don't show the origin edge's own card in contextual mode
  // (the user is already there — no point linking to yourself)
  const filteredParents = isContextual
    ? parents.filter(p => p.edge_id !== originEdgeId)
    : parents;

  // Apply sort based on sortMode
  const sortedParents = [...filteredParents].sort((a, b) => {
    if (sortMode === 'similarity_desc') {
      // Highest similarity first; nulls at end
      const aVal = a.similarity_percentage ?? -1;
      const bVal = b.similarity_percentage ?? -1;
      if (bVal !== aVal) return bVal - aVal;
      return (parseInt(b.link_count) || 0) - (parseInt(a.link_count) || 0);
    }
    if (sortMode === 'similarity_asc') {
      // Lowest similarity first; nulls at end
      const aVal = a.similarity_percentage ?? 101;
      const bVal = b.similarity_percentage ?? 101;
      if (aVal !== bVal) return aVal - bVal;
      return (parseInt(b.link_count) || 0) - (parseInt(a.link_count) || 0);
    }
    // Default: 'links' — link_count DESC, vote_count DESC (already sorted by backend)
    return 0;
  });

  /**
   * Compute a map of edgeId -> Set<conceptId> indicating which concept IDs
   * should be highlighted on each card, based on the current hover state.
   *
   * For the hovered card: highlight the hovered concept plus any IDs in
   * contiguous shared segments (with any other card) that include it.
   * For other cards: highlight IDs in contiguous shared segments with the
   * hovered card that include the hovered concept.
   */
  const computeHighlightMap = () => {
    if (!hoveredInfo) return {};
    const { edgeId: hovEdgeId, conceptId: hovConceptId } = hoveredInfo;
    const hovCard = sortedParents.find(p => p.edge_id === hovEdgeId);
    if (!hovCard) return {};

    const map = {};

    for (const card of sortedParents) {
      const highlighted = new Set();

      if (card.edge_id === hovEdgeId) {
        // Source card: always highlight the hovered concept itself
        highlighted.add(hovConceptId);
        // Extend to any shared segment with any other card that includes it
        for (const other of sortedParents) {
          if (other.edge_id === hovEdgeId) continue;
          const segs = getSharedSegments(hovCard.graph_path, other.graph_path);
          for (const seg of segs) {
            if (seg.includes(hovConceptId)) {
              seg.forEach(id => highlighted.add(id));
            }
          }
        }
      } else {
        // Other card: find shared segments with the hovered card
        const segs = getSharedSegments(hovCard.graph_path, card.graph_path);
        for (const seg of segs) {
          if (seg.includes(hovConceptId)) {
            seg.forEach(id => highlighted.add(id));
          }
        }
      }

      if (highlighted.size > 0) {
        map[card.edge_id] = highlighted;
      }
    }

    return map;
  };

  const highlightMap = computeHighlightMap();

  /**
   * Render the path above the immediate parent as individual hoverable spans.
   * ancestorIds: graph_path.slice(0, -1)
   */
  const renderAncestorPath = (card, ancestorIds) => {
    if (ancestorIds.length === 0) return null;
    const cardHighlights = highlightMap[card.edge_id];
    return (
      <div style={styles.pathAbove}>
        {ancestorIds.map((id, idx) => {
          const isHighlighted = cardHighlights?.has(id) ?? false;
          return (
            <React.Fragment key={id}>
              {idx > 0 && <span style={styles.pathSeparator}> → </span>}
              <span
                style={{
                  ...styles.pathConceptSpan,
                  backgroundColor: isHighlighted ? 'rgba(232, 217, 160, 0.5)' : 'transparent',
                }}
                onMouseEnter={() => setHoveredInfo({ edgeId: card.edge_id, conceptId: id })}
                onMouseLeave={() => setHoveredInfo(null)}
              >
                {getName(id)}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.conceptName}>
          Flip View: {concept?.name}
        </h2>
      </div>

      {/* Description + sort toggle */}
      <div style={styles.description}>
        {filteredParents.length === 0 ? (
          <p style={{ margin: 0 }}>This concept has no other parent contexts yet.</p>
        ) : (
          <div style={styles.descriptionRow}>
            <p style={{ margin: 0 }}>
              {filteredParents.length} parent context{filteredParents.length !== 1 ? 's' : ''}
            </p>
            {isContextual && filteredParents.length > 0 && (
              <div style={styles.sortToggleRow}>
                {[
                  { key: 'links', label: 'Links' },
                  { key: 'similarity_desc', label: 'Similarity \u2193' },
                  { key: 'similarity_asc', label: 'Similarity \u2191' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSortMode(key)}
                    style={{
                      ...styles.sortToggleButton,
                      ...(sortMode === key ? styles.sortToggleButtonActive : {}),
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Flat grid of parent cards */}
      <div style={styles.parentsGrid}>
        {sortedParents.map((parent) => {
          const ancestorIds = parent.graph_path.slice(0, -1);
          const fullTooltip = getFullPathTooltip(parent);
          const linkCount = parseInt(parent.link_count) || 0;
          const userLinked = parent.user_linked;
          const similarity = parent.similarity_percentage;
          const cardHighlights = highlightMap[parent.edge_id];
          const parentHighlighted = cardHighlights?.has(parent.id) ?? false;

          return (
            <div
              key={parent.edge_id}
              style={styles.parentCard}
              title={fullTooltip}
              onClick={() => handleParentClick(parent)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#333';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#ddd';
              }}
            >
              {/* Ancestor path (excludes parent itself) — hoverable spans */}
              {renderAncestorPath(parent, ancestorIds)}

              {/* Immediate parent name + attribute badge */}
              <div style={styles.parentRow}>
                <span
                  style={{
                    ...styles.parentName,
                    backgroundColor: parentHighlighted ? 'rgba(232, 217, 160, 0.5)' : 'transparent',
                    borderRadius: '2px',
                    padding: '0 2px',
                  }}
                  onMouseEnter={() => setHoveredInfo({ edgeId: parent.edge_id, conceptId: parent.id })}
                  onMouseLeave={() => setHoveredInfo(null)}
                >
                  {parent.name}
                </span>
                {parent.attribute_name && (
                  <span style={styles.attributeBadge}>{parent.attribute_name}</span>
                )}
                <span style={styles.voteCount}>
                  ▲ {parent.vote_count}
                </span>
                {parent.user_voted && (
                  <span style={styles.userVotedBadge}>Voted</span>
                )}
              </div>

              {/* Bottom row: link votes + similarity (contextual mode only) */}
              {isContextual && (
                <div style={styles.bottomRow}>
                  <button
                    onClick={isGuest ? undefined : (e) => handleLinkVote(e, parent)}
                    style={{
                      ...styles.linkVoteButton,
                      ...(userLinked ? styles.linkVoteButtonActive : {}),
                      ...(isGuest ? styles.linkVoteButtonReadOnly : {}),
                    }}
                    title={isGuest ? 'Log in to vote on links' : (userLinked ? undefined : 'Vote this context as helpful')}
                  >
                    ▲ {linkCount}
                  </button>

                  {/* Similarity percentage */}
                  {similarity !== null && similarity !== undefined && (
                    <span
                      style={styles.similarityBadge}
                      title="Jaccard similarity: shared children / total unique children across both contexts"
                    >
                      {similarity}% similar
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: '20px',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  conceptName: {
    margin: 0,
    fontSize: '28px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#111',
    fontWeight: '400',
    flex: 1,
  },
  description: {
    marginBottom: '24px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#888',
  },
  descriptionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  sortToggleRow: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #bbb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  sortToggleButton: {
    padding: '4px 12px',
    backgroundColor: 'white',
    border: 'none',
    borderRight: '1px solid #bbb',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#888',
    whiteSpace: 'nowrap',
  },
  sortToggleButtonActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  parentsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  parentCard: {
    backgroundColor: '#faf9f7',
    border: '1px solid #ddd',
    borderRadius: '3px',
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  pathAbove: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#999',
    fontStyle: 'normal',
    marginBottom: '6px',
    lineHeight: '1.3',
    wordBreak: 'break-word',
  },
  pathSeparator: {
    color: '#bbb',
  },
  pathConceptSpan: {
    borderRadius: '2px',
    padding: '0 2px',
    cursor: 'default',
    transition: 'background-color 0.1s',
  },
  parentRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap',
  },
  parentName: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#111',
    fontWeight: '400',
    wordBreak: 'break-word',
    cursor: 'default',
    transition: 'background-color 0.1s',
  },
  attributeBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f0ede8',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#555',
    flexShrink: 0,
  },
  voteCount: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#555',
  },
  userVotedBadge: {
    fontSize: '11px',
    padding: '1px 6px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    border: '1px solid #333',
    color: '#333',
    borderRadius: '2px',
  },
  bottomRow: {
    marginTop: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    borderTop: '1px solid #eee',
    paddingTop: '8px',
  },
  linkVoteButton: {
    padding: '4px 10px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#555',
    transition: 'all 0.2s',
  },
  linkVoteButtonActive: {
    backgroundColor: '#333',
    color: '#faf9f6',
    borderColor: '#333',
  },
  linkVoteButtonReadOnly: {
    cursor: 'default',
    opacity: 0.7,
  },
  similarityBadge: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", "Garamond", "Georgia", serif',
    color: '#777',
    fontStyle: 'normal',
    cursor: 'default',
  },
};

export default FlipView;
