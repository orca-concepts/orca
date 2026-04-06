import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { votesAPI } from '../services/api';

// Phase 44b: Simplified swap card — no path, no attribute badge, no open link
function SwapCard({ name, saveCount, swapVoteCount, userVoted, onVote }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardLeft}>
        <span style={styles.cardName}>{name}</span>
        <span style={styles.cardSaveCount}>
          ▲ {saveCount} {saveCount === 1 ? 'vote' : 'votes'}
        </span>
      </div>
      <button
        onClick={onVote}
        style={{
          ...styles.swapVoteButton,
          ...(userVoted ? styles.swapVoteButtonActive : {}),
        }}
      >
        ▲ {swapVoteCount}
      </button>
    </div>
  );
}

const SwapModal = ({ edgeId, conceptName, onClose, onSwapVoteChanged }) => {
  const [existingSwaps, setExistingSwaps] = useState([]);
  const [otherSiblings, setOtherSiblings] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoSaveNote, setAutoSaveNote] = useState(null);
  const [loading, setLoading] = useState(true);

  const modalRef = useRef(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const response = await votesAPI.getSwapVotes(edgeId);
      setExistingSwaps(response.data.existingSwaps || []);
      setOtherSiblings(response.data.otherSiblings || []);
    } catch (err) {
      console.error('Failed to load swap data:', err);
    } finally {
      setLoading(false);
    }
  }, [edgeId]);

  useEffect(() => {
    if (edgeId) refetch();
  }, [edgeId, refetch]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.document.addEventListener('keydown', handleKey);
    return () => window.document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    window.document.addEventListener('mousedown', handleClickOutside);
    return () => window.document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleVote = async (replacementEdgeId, replacementName) => {
    try {
      const response = await votesAPI.addSwapVote(edgeId, replacementEdgeId);
      if (response.data.autoSaved) {
        setAutoSaveNote({ name: replacementName });
        setTimeout(() => setAutoSaveNote(null), 3000);
      }
      await refetch();
      if (onSwapVoteChanged) onSwapVoteChanged();
    } catch (err) {
      console.error('Swap vote failed:', err);
    }
  };

  const handleUnvote = async (replacementEdgeId) => {
    try {
      await votesAPI.removeSwapVote(edgeId, replacementEdgeId);
      await refetch();
      if (onSwapVoteChanged) onSwapVoteChanged();
    } catch (err) {
      console.error('Swap vote removal failed:', err);
    }
  };

  const filteredOtherSiblings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return otherSiblings;
    return otherSiblings.filter(s => s.childName.toLowerCase().includes(q));
  }, [otherSiblings, searchQuery]);

  const noSiblingsAtAll = existingSwaps.length === 0 && otherSiblings.length === 0;

  return (
    <div style={styles.overlay}>
      <div ref={modalRef} style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h3 style={styles.title}>Swap votes for "{conceptName}"</h3>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* Content */}
        <div style={styles.content}>
          {loading && <div style={styles.loading}>Loading...</div>}

          {!loading && noSiblingsAtAll && (
            <div style={styles.emptyHint}>No siblings to swap with</div>
          )}

          {/* Section 1: Existing swap votes */}
          {!loading && existingSwaps.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionLabel}>Existing swap votes</div>
              {existingSwaps.map(item => (
                <SwapCard
                  key={`existing-${item.replacementEdgeId}`}
                  name={item.replacementName}
                  saveCount={item.saveCount}
                  swapVoteCount={item.voteCount}
                  userVoted={item.userVoted}
                  onVote={() => item.userVoted
                    ? handleUnvote(item.replacementEdgeId)
                    : handleVote(item.replacementEdgeId, item.replacementName)}
                />
              ))}
            </div>
          )}

          {/* Section 2: Other siblings */}
          {!loading && !noSiblingsAtAll && (
            <div style={styles.section}>
              {existingSwaps.length > 0 && <div style={styles.divider} />}
              <div style={styles.sectionLabel}>Other siblings</div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search siblings..."
                style={styles.searchInput}
              />
              {filteredOtherSiblings.length === 0 && (
                <div style={styles.emptyHint}>
                  {otherSiblings.length === 0 ? 'No other siblings' : 'No matches'}
                </div>
              )}
              {filteredOtherSiblings.map(item => (
                <SwapCard
                  key={`sibling-${item.edgeId}`}
                  name={item.childName}
                  saveCount={item.saveCount}
                  swapVoteCount={0}
                  userVoted={false}
                  onVote={() => handleVote(item.edgeId, item.childName)}
                />
              ))}
            </div>
          )}

          {/* Auto-save inline note */}
          {autoSaveNote && (
            <div style={styles.autoSaveNote}>
              Also added a vote for {autoSaveNote.name}
            </div>
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
  // Card layout
  card: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #e8e8e8',
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardSaveCount: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    flexShrink: 0,
  },
  // Swap vote button — matches ConceptGrid.jsx save vote button pattern exactly
  swapVoteButton: {
    padding: '8px 16px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#555',
    transition: 'all 0.2s',
    fontFamily: '"EB Garamond", Georgia, serif',
    flexShrink: 0,
    marginLeft: '12px',
  },
  swapVoteButtonActive: {
    backgroundColor: '#333',
    color: '#faf9f6',
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
    marginBottom: '8px',
  },
  // Auto-save note
  autoSaveNote: {
    marginTop: '10px',
    padding: '8px 12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#555',
    backgroundColor: '#f0f0e8',
    borderRadius: '4px',
  },
};

export default SwapModal;
