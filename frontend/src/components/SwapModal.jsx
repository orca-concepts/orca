import React, { useState, useEffect, useRef } from 'react';
import { votesAPI } from '../services/api';

const SwapModal = ({ edgeId, conceptName, siblings, onClose, onSwapVoteChanged }) => {
  // siblings = array of sibling concepts from the parent page (excluding the concept itself)
  // Each sibling has: { id, name, edge_id, attribute_name, vote_count }

  const [existingSwaps, setExistingSwaps] = useState([]);
  const [loadingSwaps, setLoadingSwaps] = useState(true);
  const [actionMessage, setActionMessage] = useState('');

  const modalRef = useRef(null);

  // Load existing swap votes on mount
  useEffect(() => {
    loadExistingSwaps();
  }, [edgeId]);

  // Close modal on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const loadExistingSwaps = async () => {
    try {
      setLoadingSwaps(true);
      const response = await votesAPI.getSwapVotes(edgeId);
      setExistingSwaps(response.data.swapVotes);
    } catch (err) {
      console.error('Failed to load swap votes:', err);
    } finally {
      setLoadingSwaps(false);
    }
  };

  const handleSwapVote = async (replacementEdgeId, userAlreadyVoted) => {
    try {
      if (userAlreadyVoted) {
        setActionMessage('Removing swap vote...');
        await votesAPI.removeSwapVote(edgeId, replacementEdgeId);
        setActionMessage('Swap vote removed');
      } else {
        setActionMessage('Placing swap vote...');
        await votesAPI.addSwapVote(edgeId, replacementEdgeId);
        setActionMessage('Swap vote placed!');
      }
      await loadExistingSwaps();
      if (onSwapVoteChanged) onSwapVoteChanged();
      setTimeout(() => setActionMessage(''), 1500);
    } catch (err) {
      console.error('Failed to update swap vote:', err);
      const errorMsg = err.response?.data?.error || 'Failed to update swap vote';
      setActionMessage(errorMsg);
      setTimeout(() => setActionMessage(''), 2500);
    }
  };

  // Build a lookup of existing swap votes by replacement edge ID
  const swapVoteMap = {};
  existingSwaps.forEach(sv => {
    swapVoteMap[sv.replacementEdgeId] = sv;
  });

  // Build the sibling list: show existing swap vote suggestions at top (sorted by vote count),
  // then remaining siblings that don't have any swap votes yet
  const siblingEdgeIds = new Set(siblings.map(s => s.edge_id));
  
  // Existing swap suggestions (may include siblings and their vote data)
  const existingSwapSiblings = existingSwaps.filter(sv => siblingEdgeIds.has(sv.replacementEdgeId));
  const existingSwapEdgeIds = new Set(existingSwapSiblings.map(sv => sv.replacementEdgeId));
  
  // Siblings without any existing swap votes
  const unvotedSiblings = siblings.filter(s => !existingSwapEdgeIds.has(s.edge_id));

  return (
    <div style={styles.overlay}>
      <div ref={modalRef} style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h3 style={styles.title}>Swap "{conceptName}"</h3>
            <p style={styles.subtitle}>Select a sibling that should replace this concept</p>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* Action message */}
        {actionMessage && (
          <div style={styles.actionMessage}>{actionMessage}</div>
        )}

        {/* Content */}
        <div style={styles.content}>
          {loadingSwaps ? (
            <div style={styles.loading}>Loading swap votes...</div>
          ) : (
            <>
              {/* Existing swap suggestions (with vote counts) */}
              {existingSwapSiblings.length > 0 && (
                <div style={styles.section}>
                  <div style={styles.sectionLabel}>Existing suggestions</div>
                  {existingSwapSiblings.map(sv => {
                    const sibling = siblings.find(s => s.edge_id === sv.replacementEdgeId);
                    return (
                      <div key={sv.replacementEdgeId} style={{
                        ...styles.siblingCard,
                        ...(sv.userVoted ? styles.siblingCardActive : {})
                      }}>
                        <div style={styles.siblingInfo}>
                          <span style={styles.siblingName}>
                            {sv.replacementName}
                            {sv.replacementAttributeName && (
                              <span style={styles.siblingAttr}> ({sv.replacementAttributeName})</span>
                            )}
                          </span>
                          {sibling && (
                            <span style={styles.siblingMeta}>
                              {sibling.vote_count} {parseInt(sibling.vote_count) === 1 ? 'vote' : 'votes'}
                            </span>
                          )}
                        </div>
                        <div style={styles.siblingActions}>
                          <span style={styles.swapCount}>
                            {sv.voteCount} {sv.voteCount === 1 ? 'swap vote' : 'swap votes'}
                          </span>
                          <button
                            style={{
                              ...styles.voteButton,
                              ...(sv.userVoted ? styles.voteButtonActive : {})
                            }}
                            onClick={() => handleSwapVote(sv.replacementEdgeId, sv.userVoted)}
                          >
                            {sv.userVoted ? 'Un-second' : 'Second'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Divider if both sections exist */}
              {existingSwapSiblings.length > 0 && unvotedSiblings.length > 0 && (
                <div style={styles.divider} />
              )}

              {/* All other siblings (no existing swap votes) */}
              {unvotedSiblings.length > 0 && (
                <div style={styles.section}>
                  <div style={styles.sectionLabel}>
                    {existingSwapSiblings.length > 0 ? 'Other siblings' : 'Siblings'}
                  </div>
                  <div style={styles.siblingList}>
                    {unvotedSiblings.map(sibling => (
                      <div key={sibling.edge_id} style={styles.siblingCard}>
                        <div style={styles.siblingInfo}>
                          <span style={styles.siblingName}>
                            {sibling.name}
                            {sibling.attribute_name && (
                              <span style={styles.siblingAttr}> ({sibling.attribute_name})</span>
                            )}
                          </span>
                          <span style={styles.siblingMeta}>
                            {sibling.vote_count} {parseInt(sibling.vote_count) === 1 ? 'vote' : 'votes'}
                          </span>
                        </div>
                        <button
                          style={styles.voteButton}
                          onClick={() => handleSwapVote(sibling.edge_id, false)}
                        >
                          Swap
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state: no siblings at all */}
              {siblings.length === 0 && (
                <div style={styles.emptyState}>
                  No siblings in this context. Swap votes require at least one other concept under the same parent.
                </div>
              )}
            </>
          )}
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
    width: '480px',
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
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '600',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: '#999',
    cursor: 'pointer',
    padding: '4px 8px',
    marginLeft: '12px',
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
  loading: {
    textAlign: 'center',
    padding: '20px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
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
  siblingList: {
    maxHeight: '300px',
    overflowY: 'auto',
  },
  siblingCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid #e0e0e0',
    marginBottom: '6px',
    backgroundColor: 'white',
    transition: 'border-color 0.15s',
  },
  siblingCardActive: {
    borderColor: '#333',
    backgroundColor: '#fafafa',
  },
  siblingInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  siblingName: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  siblingAttr: {
    color: '#888',
    fontWeight: '400',
    fontSize: '13px',
  },
  siblingMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
  },
  siblingActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
    marginLeft: '12px',
  },
  swapCount: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
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
  },
  voteButtonActive: {
    backgroundColor: '#333',
    color: 'white',
    borderColor: '#333',
  },
  emptyState: {
    textAlign: 'center',
    padding: '24px 16px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    fontStyle: 'normal',
  },
};

export default SwapModal;
