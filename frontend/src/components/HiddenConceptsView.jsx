import React, { useState, useEffect } from 'react';
import { moderationAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const HiddenConceptsView = ({ parentId, path = [], onClose }) => {
  const { user } = useAuth();
  const [hiddenChildren, setHiddenChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Track which edge's comments are expanded
  const [expandedComments, setExpandedComments] = useState({});
  // Comments loaded per edge
  const [commentsData, setCommentsData] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  // New comment text per edge
  const [newComment, setNewComment] = useState({});

  // Admin user ID from env (passed via a meta tag or just check response)
  // We'll let the backend enforce admin — frontend just shows the button to all logged-in users
  // and the backend returns 403 if not admin. Simpler than syncing the env var to frontend.

  useEffect(() => {
    loadHiddenChildren();
  }, [parentId, path.join(',')]);

  const loadHiddenChildren = async () => {
    try {
      setLoading(true);
      const response = await moderationAPI.getHiddenChildren(parentId, path);
      setHiddenChildren(response.data.hiddenChildren || []);
      setIsAdmin(response.data.isAdmin || false);
      setError(null);
    } catch (err) {
      console.error('Failed to load hidden children:', err);
      setError('Failed to load hidden concepts');
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (edgeId, voteType, currentVoteType) => {
    try {
      if (currentVoteType === voteType) {
        // Toggle off — remove vote
        await moderationAPI.removeModerationVote(edgeId);
      } else {
        // Set or change vote
        await moderationAPI.voteModerationHide(edgeId, voteType);
      }
      await loadHiddenChildren();
    } catch (err) {
      console.error('Vote failed:', err);
      alert(err.response?.data?.error || 'Failed to vote');
    }
  };

  const handleUnhide = async (edgeId) => {
    if (!window.confirm('Are you sure you want to unhide this concept? It will become visible to all users again.')) {
      return;
    }
    try {
      await moderationAPI.unhideEdge(edgeId);
      await loadHiddenChildren();
    } catch (err) {
      if (err.response?.status === 403) {
        alert('Only administrators can unhide concepts.');
      } else {
        alert(err.response?.data?.error || 'Failed to unhide');
      }
    }
  };

  const toggleComments = async (edgeId) => {
    if (expandedComments[edgeId]) {
      setExpandedComments(prev => ({ ...prev, [edgeId]: false }));
      return;
    }

    // Load comments if not already loaded
    if (!commentsData[edgeId]) {
      setCommentsLoading(prev => ({ ...prev, [edgeId]: true }));
      try {
        const response = await moderationAPI.getModerationComments(edgeId);
        setCommentsData(prev => ({ ...prev, [edgeId]: response.data.comments || [] }));
      } catch (err) {
        console.error('Failed to load comments:', err);
      } finally {
        setCommentsLoading(prev => ({ ...prev, [edgeId]: false }));
      }
    }
    setExpandedComments(prev => ({ ...prev, [edgeId]: true }));
  };

  const handleAddComment = async (edgeId) => {
    const body = (newComment[edgeId] || '').trim();
    if (!body) return;

    try {
      const response = await moderationAPI.addModerationComment(edgeId, body);
      // Add new comment to local state
      setCommentsData(prev => ({
        ...prev,
        [edgeId]: [...(prev[edgeId] || []), response.data.comment]
      }));
      setNewComment(prev => ({ ...prev, [edgeId]: '' }));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add comment');
    }
  };

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.panel}>
          <div style={styles.loading}>Loading hidden concepts...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Hidden Concepts</h3>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {hiddenChildren.length === 0 ? (
          <div style={styles.empty}>No hidden concepts in this context.</div>
        ) : (
          <div style={styles.list}>
            {hiddenChildren.map((item) => (
              <div key={item.edgeId} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.conceptName}>
                    {item.conceptName}
                    {item.attributeName && (
                      <span style={styles.attribute}> ({item.attributeName})</span>
                    )}
                  </span>
                  <span style={styles.flagBadge}>
                    {item.flagCount} {item.flagCount === 1 ? 'flag' : 'flags'}
                  </span>
                </div>

                <div style={styles.meta}>
                  Added by {item.createdByUsername || 'unknown'} · {new Date(item.edgeCreatedAt).toLocaleDateString()}
                </div>

                {/* Vote buttons */}
                <div style={styles.voteRow}>
                  <button
                    onClick={() => handleVote(item.edgeId, 'show', item.userVoteType)}
                    style={{
                      ...styles.voteButton,
                      ...(item.userVoteType === 'show' ? styles.voteButtonActiveShow : {}),
                    }}
                    title="Vote to restore this concept"
                  >
                    Show ({item.showVoteCount})
                  </button>
                  <button
                    onClick={() => handleVote(item.edgeId, 'hide', item.userVoteType)}
                    style={{
                      ...styles.voteButton,
                      ...(item.userVoteType === 'hide' ? styles.voteButtonActiveHide : {}),
                    }}
                    title="Vote to keep hidden"
                  >
                    Hide ({item.hideVoteCount})
                  </button>

                  {isAdmin && (
                    <button
                      onClick={() => handleUnhide(item.edgeId)}
                      style={styles.unhideButton}
                      title="Admin: restore this concept to visible"
                    >
                      ↩ Unhide
                    </button>
                  )}
                </div>

                {/* Comments toggle */}
                <button
                  onClick={() => toggleComments(item.edgeId)}
                  style={styles.commentsToggle}
                >
                  💬 {expandedComments[item.edgeId] ? 'Hide' : 'Show'} comments
                  {commentsData[item.edgeId] ? ` (${commentsData[item.edgeId].length})` : ''}
                </button>

                {/* Comments section */}
                {expandedComments[item.edgeId] && (
                  <div style={styles.commentsSection}>
                    {commentsLoading[item.edgeId] ? (
                      <div style={styles.commentsLoading}>Loading comments...</div>
                    ) : (
                      <>
                        {(commentsData[item.edgeId] || []).length === 0 ? (
                          <div style={styles.noComments}>No comments yet.</div>
                        ) : (
                          (commentsData[item.edgeId] || []).map((comment) => (
                            <div key={comment.id} style={styles.comment}>
                              <div style={styles.commentHeader}>
                                <span style={styles.commentAuthor}>{comment.username}</span>
                                <span style={styles.commentDate}>
                                  {new Date(comment.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                              <div style={styles.commentBody}>{comment.body}</div>
                            </div>
                          ))
                        )}

                        {/* Add comment form */}
                        {user && (
                          <div style={styles.addComment}>
                            <textarea
                              value={newComment[item.edgeId] || ''}
                              onChange={(e) => setNewComment(prev => ({
                                ...prev,
                                [item.edgeId]: e.target.value
                              }))}
                              placeholder="Add a comment about this hidden concept..."
                              style={styles.commentInput}
                              rows={2}
                            />
                            <button
                              onClick={() => handleAddComment(item.edgeId)}
                              style={styles.commentSubmit}
                              disabled={!(newComment[item.edgeId] || '').trim()}
                            >
                              Post
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '80px',
    zIndex: 1000,
  },
  panel: {
    backgroundColor: 'white',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '640px',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #eee',
    position: 'sticky',
    top: 0,
    backgroundColor: 'white',
    zIndex: 1,
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#888',
    padding: '4px 8px',
    lineHeight: 1,
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  error: {
    padding: '12px 20px',
    backgroundColor: '#fee',
    color: '#c33',
    fontSize: '14px',
  },
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  list: {
    padding: '12px 20px 20px',
  },
  card: {
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '14px 16px',
    marginBottom: '12px',
    backgroundColor: '#fafafa',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  conceptName: {
    fontSize: '16px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  attribute: {
    fontWeight: '400',
    color: '#888',
  },
  flagBadge: {
    fontSize: '12px',
    color: '#555',
    backgroundColor: '#f0ede8',
    padding: '2px 8px',
    borderRadius: '10px',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: '12px',
    color: '#999',
    marginBottom: '10px',
  },
  voteRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  voteButton: {
    padding: '5px 12px',
    fontSize: '13px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    transition: 'all 0.15s',
  },
  voteButtonActiveShow: {
    backgroundColor: '#333',
    borderColor: '#333',
    color: '#faf9f6',
  },
  voteButtonActiveHide: {
    backgroundColor: '#555',
    borderColor: '#555',
    color: '#faf9f6',
  },
  unhideButton: {
    padding: '5px 12px',
    fontSize: '13px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#333',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginLeft: 'auto',
  },
  commentsToggle: {
    background: 'none',
    border: 'none',
    fontSize: '13px',
    color: '#666',
    cursor: 'pointer',
    padding: '4px 0',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  commentsSection: {
    marginTop: '8px',
    borderTop: '1px solid #eee',
    paddingTop: '8px',
  },
  commentsLoading: {
    fontSize: '13px',
    color: '#888',
    padding: '8px 0',
  },
  noComments: {
    fontSize: '13px',
    color: '#999',
    fontStyle: 'normal',
    padding: '8px 0',
  },
  comment: {
    padding: '8px 0',
    borderBottom: '1px solid #f0f0f0',
  },
  commentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  commentAuthor: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#555',
  },
  commentDate: {
    fontSize: '12px',
    color: '#999',
  },
  commentBody: {
    fontSize: '14px',
    color: '#333',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
  },
  addComment: {
    marginTop: '10px',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  commentInput: {
    flex: 1,
    padding: '8px 10px',
    fontSize: '13px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
    resize: 'vertical',
    minHeight: '40px',
  },
  commentSubmit: {
    padding: '8px 16px',
    fontSize: '13px',
    backgroundColor: '#333',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    alignSelf: 'flex-end',
  },
};

export default HiddenConceptsView;
