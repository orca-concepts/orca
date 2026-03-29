import React, { useState, useEffect } from 'react';
import { getSetColor } from './VoteSetBar';

const ConceptGrid = ({
  concepts,
  onConceptClick,
  onVote,
  onSwapClick,
  onCompareChildren,
  onFlag,
  onUnflag,
  showVotes = false,
  showAttributeBadge = false,
  path = [],
  edgeToSets = {},
  tierLabel = null,
}) => {
  // Phase 14a: Right-click context menu for concept diffing
  const [contextMenu, setContextMenu] = useState(null);

  const handleCardContextMenu = (e, child) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onCompareChildren && !onFlag) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      child
    });
  };

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  return (
    <>
      {tierLabel && (
        <div style={styles.tierHeader}>
          {tierLabel}
        </div>
      )}
      <div style={styles.grid}>
        {concepts.map((concept) => {
          // Get vote set dots for this edge
          const setIndices = edgeToSets[concept.edge_id] || [];
          
          // Is the tab picker open for this concept?
          const showingTabPicker = false; // Tab picker removed in Phase 7c overhaul

          return (
            <div key={concept.edge_id || concept.id} style={styles.card}>
              <div 
                style={styles.cardContent}
                onClick={() => onConceptClick(concept.id)}
                onContextMenu={(e) => handleCardContextMenu(e, concept)}
              >
                <div style={styles.nameRow}>
                  <h3 style={styles.conceptName}>
                    {concept.name}
                  </h3>
                  {showAttributeBadge && concept.attribute_name && (
                    <span style={styles.attributeBadge}>{concept.attribute_name}</span>
                  )}
                  {setIndices.length > 0 && (
                    <div style={styles.dotsContainer}>
                      {setIndices.map((setIndex) => {
                        const color = getSetColor(setIndex);
                        return (
                          <span
                            key={setIndex}
                            style={{
                              ...styles.dot,
                              backgroundColor: color.hex,
                            }}
                            title={`${color.name} vote set`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                {concept.child_count !== undefined && (
                  <div style={styles.childCount}>
                    {concept.child_count} {Number(concept.child_count) === 1 ? 'child' : 'children'}
                  </div>
                )}
                {concept.flag_count != null && Number(concept.flag_count) > 0 && Number(concept.flag_count) < 10 && (
                  <div style={styles.flagCount}>
                    {concept.flag_count} {Number(concept.flag_count) === 1 ? 'user has' : 'users have'} flagged this as spam
                  </div>
                )}
                {concept.top_annotation_votes != null && Number(concept.top_annotation_votes) > 0 && (
                  <div style={styles.topAnnotationIndicator}>
                    Top annotation: {concept.top_annotation_votes} {Number(concept.top_annotation_votes) === 1 ? 'vote' : 'votes'}
                  </div>
                )}
              </div>
              
              {showVotes && (
                <div style={styles.voteSection}>
                  <button
                    style={{
                      ...styles.voteButton,
                      ...(concept.user_voted ? styles.voteButtonActive : {}),
                      ...(!onVote ? styles.voteButtonReadOnly : {}),
                    }}
                    onClick={onVote ? (e) => {
                      e.stopPropagation();
                      onVote(concept.edge_id, concept.user_voted, path);
                    } : undefined}
                    title={!onVote ? 'Log in to vote on concepts' : undefined}
                  >
                    ▲ {concept.vote_count}
                  </button>
                  {onSwapClick ? (
                    <button
                      style={styles.swapButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwapClick(concept);
                      }}
                      title="Pick another child concept in this context you prefer to this one"
                    >
                      ⇄ {concept.swap_count || 0}
                    </button>
                  ) : (Number(concept.swap_count) > 0 && (
                    <span
                      style={styles.swapButton}
                      title="Log in to vote on swaps"
                    >
                      ⇄ {concept.swap_count}
                    </span>
                  ))}
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* Phase 14a: Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: '#faf9f6',
            border: '1px solid #d4d0c8',
            borderRadius: '3px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10001,
            fontFamily: '"EB Garamond", Georgia, serif',
            fontSize: '14px',
            minWidth: '180px',
          }}
          onClick={e => e.stopPropagation()}
        >
          {onCompareChildren && (
            <div
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                color: '#333',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0ece4'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => {
                onCompareChildren(contextMenu.child);
                setContextMenu(null);
              }}
            >
              Compare children…
            </div>
          )}
          {onFlag && (
            <div
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                color: '#555',
                borderTop: onCompareChildren ? '1px solid #e8e4dc' : 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0ece4'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              onClick={() => {
                if (contextMenu.child.user_flagged && onUnflag) {
                  onUnflag(contextMenu.child);
                } else {
                  onFlag(contextMenu.child);
                }
                setContextMenu(null);
              }}
            >
              {contextMenu.child.user_flagged ? 'Unflag as spam' : 'Flag as spam'}
            </div>
          )}
        </div>
      )}
    </>
  );
};

const styles = {
  tierHeader: {
    fontSize: '14px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    paddingBottom: '8px',
    marginBottom: '4px',
    borderBottom: '1px solid #e0e0e0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '80px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'hidden',
    transition: 'transform 0.2s, box-shadow 0.2s',
    cursor: 'pointer',
  },
  cardContent: {
    padding: '20px',
  },
  nameRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
  },
  conceptName: {
    margin: '0 0 10px 0',
    fontSize: '18px',
    color: '#333',
    wordBreak: 'break-word',
    flex: 1,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  attributeTag: {
    color: '#888',
    fontWeight: '400',
    fontSize: '15px',
  },
  attributeBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f0ede8',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#555',
    marginLeft: '6px',
    verticalAlign: 'middle',
    flexShrink: 0,
  },
  dotsContainer: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
    paddingTop: '4px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  childCount: {
    fontSize: '14px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  flagCount: {
    fontSize: '12px',
    color: '#c33',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginTop: '4px',
  },
  topAnnotationIndicator: {
    fontSize: '12px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginTop: '4px',
  },
  voteSection: {
    borderTop: '1px solid #eee',
    padding: '12px 20px',
    backgroundColor: '#fafafa',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  voteButton: {
    padding: '8px 16px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#555',
    transition: 'all 0.2s',
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
  swapButton: {
    padding: '8px 12px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#555',
    transition: 'all 0.2s',
  },
};

export default ConceptGrid;
