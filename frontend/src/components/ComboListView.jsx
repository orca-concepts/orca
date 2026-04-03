import React, { useState, useEffect, useRef } from 'react';
import { combosAPI } from '../services/api';
import OrcidBadge from './OrcidBadge';

const ComboListView = ({ onBack, isGuest, onSubscribe, onUnsubscribe, comboSubscriptions, onComboClick, onRequestLogin }) => {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOption, setSortOption] = useState('subscribers');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const searchTimerRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchTerm]);

  useEffect(() => {
    loadCombos();
  }, [debouncedSearch, sortOption]);

  const loadCombos = async () => {
    try {
      setLoading(true);
      const res = await combosAPI.listCombos(debouncedSearch || undefined, sortOption);
      setCombos(res.data.combos || []);
    } catch (err) {
      console.error('Failed to load combos:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreateError('');
    try {
      setCreating(true);
      await combosAPI.createCombo(newName.trim(), newDescription.trim() || undefined);
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      await loadCombos();
      // Creator auto-subscribes — notify parent to reload subscriptions
      if (onSubscribe) onSubscribe();
    } catch (err) {
      if (err.response?.status === 409) {
        setCreateError('A superconcept with this name already exists');
      } else {
        setCreateError(err.response?.data?.error || 'Failed to create superconcept');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleSubscribeClick = async (e, comboId) => {
    e.stopPropagation();
    try {
      await combosAPI.subscribe(comboId);
      // Update local state optimistically
      setCombos(prev => prev.map(c =>
        c.id === comboId
          ? { ...c, user_subscribed: true, subscriber_count: (c.subscriber_count || 0) + 1 }
          : c
      ));
      if (onSubscribe) onSubscribe();
    } catch (err) {
      if (err.response?.status === 409) {
        // Already subscribed — update local state
        setCombos(prev => prev.map(c =>
          c.id === comboId ? { ...c, user_subscribed: true } : c
        ));
      } else {
        alert(err.response?.data?.error || 'Failed to subscribe');
      }
    }
  };

  const handleUnsubscribeClick = async (e, comboId) => {
    e.stopPropagation();
    try {
      await combosAPI.unsubscribe(comboId);
      setCombos(prev => prev.map(c =>
        c.id === comboId
          ? { ...c, user_subscribed: false, subscriber_count: Math.max(0, (c.subscriber_count || 1) - 1) }
          : c
      ));
      if (onUnsubscribe) onUnsubscribe(comboId);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unsubscribe');
    }
  };

  const handleComboNameClick = (combo) => {
    if (isGuest) {
      if (onRequestLogin) onRequestLogin();
      return;
    }
    if (onComboClick) onComboClick(combo);
  };

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <h2 style={styles.heading}>Browse Superconcepts</h2>
        <div style={styles.headerRight}>
          {!isGuest && (
            <button
              onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
              style={styles.createButton}
            >
              {showCreate ? 'Cancel' : '+ New Superconcept'}
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={styles.createForm}>
          <input
            type="text"
            placeholder="Superconcept name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            style={styles.input}
            maxLength={255}
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            style={styles.textarea}
            rows={2}
          />
          {createError && (
            <div style={styles.errorText}>{createError}</div>
          )}
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            style={{
              ...styles.submitButton,
              opacity: !newName.trim() || creating ? 0.5 : 1,
            }}
          >
            {creating ? 'Creating...' : 'Create Superconcept'}
          </button>
        </div>
      )}

      {/* Search and sort controls */}
      <div style={styles.controlsRow}>
        <div style={styles.searchWrapper}>
          <input
            type="text"
            placeholder="Search superconcepts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={styles.clearButton}
            >{'\u2715'}</button>
          )}
        </div>
        <div style={styles.sortToggle}>
          <button
            onClick={() => setSortOption('subscribers')}
            style={sortOption === 'subscribers' ? styles.sortButtonActive : styles.sortButton}
          >Subscribers</button>
          <button
            onClick={() => setSortOption('new')}
            style={sortOption === 'new' ? styles.sortButtonActive : styles.sortButton}
          >New</button>
        </div>
      </div>

      {/* Combo list */}
      {loading ? (
        <div style={styles.emptyState}>Loading superconcepts...</div>
      ) : combos.length === 0 ? (
        <div style={styles.emptyState}>
          {debouncedSearch
            ? `No superconcepts matching '${debouncedSearch}'`
            : 'No superconcepts have been created yet.'}
        </div>
      ) : (
        <div style={styles.list}>
          {combos.map(combo => (
            <div
              key={combo.id}
              style={styles.comboCard}
              onClick={() => handleComboNameClick(combo)}
            >
              <div style={styles.cardHeader}>
                <div style={styles.cardTitleArea}>
                  <span style={styles.comboName}>{combo.name}</span>
                </div>
                <div style={styles.cardBadges}>
                  {!isGuest && (
                    combo.user_subscribed ? (
                      <button
                        style={styles.unsubscribeButton}
                        onClick={(e) => handleUnsubscribeClick(e, combo.id)}
                      >Unsubscribe</button>
                    ) : (
                      <button
                        style={styles.subscribeButton}
                        onClick={(e) => handleSubscribeClick(e, combo.id)}
                      >Subscribe</button>
                    )
                  )}
                </div>
              </div>
              {combo.description && (
                <div style={styles.comboDescription}>
                  {combo.description.length > 150
                    ? combo.description.slice(0, 150) + '...'
                    : combo.description}
                </div>
              )}
              <div style={styles.cardMeta}>
                <span>Created by {combo.creator_username || '[deleted user]'}<OrcidBadge orcidId={combo.creator_orcid_id} /></span>
                <span style={styles.metaDot}>{'\u00B7'}</span>
                <span>{combo.edge_count || 0} concept{combo.edge_count != 1 ? 's' : ''}</span>
                <span style={styles.metaDot}>{'\u00B7'}</span>
                <span>{combo.subscriber_count || 0} subscriber{combo.subscriber_count != 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '20px',
  },
  backButton: {
    padding: '6px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  heading: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  headerRight: {
    display: 'flex',
    gap: '8px',
  },
  createButton: {
    padding: '6px 14px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  createForm: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
  },
  textarea: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    resize: 'vertical',
  },
  errorText: {
    color: '#c33',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  submitButton: {
    padding: '8px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    alignSelf: 'flex-start',
  },
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '16px',
  },
  searchWrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flex: 1,
    maxWidth: '300px',
  },
  searchInput: {
    width: '100%',
    padding: '6px 28px 6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#faf9f6',
    outline: 'none',
  },
  clearButton: {
    position: 'absolute',
    right: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#999',
    padding: '0 2px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: 1,
  },
  sortToggle: {
    display: 'flex',
    gap: '0',
  },
  sortButton: {
    padding: '4px 12px',
    border: '1px solid #ccc',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
  },
  sortButtonActive: {
    padding: '4px 12px',
    border: '1px solid #333',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '15px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  comboCard: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '14px 18px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  cardTitleArea: {
    flex: 1,
    minWidth: 0,
  },
  cardBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  subscribeButton: {
    padding: '2px 10px',
    border: '1px solid #333',
    borderRadius: '10px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unsubscribeButton: {
    padding: '2px 10px',
    border: '1px solid #ccc',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  comboName: {
    fontSize: '17px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  comboDescription: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginBottom: '6px',
    lineHeight: '1.4',
  },
  cardMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  metaDot: {
    margin: '0 6px',
  },
};

export default ComboListView;
