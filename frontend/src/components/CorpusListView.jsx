import React, { useState, useEffect } from 'react';
import { corpusAPI } from '../services/api';
import OrcidBadge from './OrcidBadge';

const CorpusListView = ({ onSelectCorpus, onBack, isGuest, onSubscribe, corpusTabs }) => {
  const [corpuses, setCorpuses] = useState([]);
  const [myCorpuses, setMyCorpuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [myCorpusSearch, setMyCorpusSearch] = useState('');
  const [allCorpusSearch, setAllCorpusSearch] = useState('');

  useEffect(() => {
    loadCorpuses();
  }, []);

  const loadCorpuses = async () => {
    try {
      setLoading(true);
      const allRes = await corpusAPI.listAll();
      setCorpuses(allRes.data.corpuses);

      if (!isGuest) {
        const mineRes = await corpusAPI.listMine();
        setMyCorpuses(mineRes.data.corpuses);
      }
    } catch (err) {
      console.error('Failed to load corpuses:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      setCreating(true);
      const res = await corpusAPI.create(newName.trim(), newDescription.trim() || undefined, 'public');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      // Refresh lists
      await loadCorpuses();
      // Navigate into the newly created corpus
      onSelectCorpus(res.data.corpus.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create corpus');
    } finally {
      setCreating(false);
    }
  };

  const filteredMyCorpuses = myCorpuses.filter(c =>
    c.name.toLowerCase().includes(myCorpusSearch.toLowerCase())
  );
  const filteredAllCorpuses = corpuses.filter(c =>
    c.name.toLowerCase().includes(allCorpusSearch.toLowerCase())
  );

  if (loading) {
    return <div style={styles.loading}>Loading corpuses...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <h2 style={styles.heading}>Corpuses</h2>
        <div style={styles.headerRight}>
          {!isGuest && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              style={styles.createButton}
            >
              {showCreate ? 'Cancel' : '+ New Corpus'}
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={styles.createForm}>
          <input
            type="text"
            placeholder="Corpus name"
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
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            style={{
              ...styles.submitButton,
              opacity: !newName.trim() || creating ? 0.5 : 1,
            }}
          >
            {creating ? 'Creating...' : 'Create Corpus'}
          </button>
        </div>
      )}

      {/* My Corpuses section */}
      {!isGuest && (
        <div style={styles.section}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionHeading}>My Corpuses</h3>
            <div style={styles.searchWrapper}>
              <input
                type="text"
                placeholder="Search..."
                value={myCorpusSearch}
                onChange={(e) => setMyCorpusSearch(e.target.value)}
                style={styles.searchInput}
              />
              {myCorpusSearch && (
                <button
                  onClick={() => setMyCorpusSearch('')}
                  style={styles.clearButton}
                >✕</button>
              )}
            </div>
          </div>
          {filteredMyCorpuses.length === 0 ? (
            <div style={styles.emptyState}>
              {myCorpusSearch
                ? 'No matching corpuses found.'
                : 'You haven\'t created any corpuses yet.'}
            </div>
          ) : (
            <div style={styles.list}>
              {filteredMyCorpuses.map(corpus => (
                <div
                  key={corpus.id}
                  style={styles.corpusCard}
                  onClick={() => onSelectCorpus(corpus.id)}
                >
                  <div style={styles.cardHeader}>
                    <div>
                      <span style={styles.corpusName}>{corpus.name}</span>
                    </div>
                    <div style={styles.cardBadges}>
                      {onSubscribe && (
                        corpusTabs?.some(t => t.id === corpus.id) ? (
                          <span style={styles.subscribedBadge}>subscribed</span>
                        ) : (
                          <button
                            style={styles.subscribeButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSubscribe(corpus.id, corpus.name);
                            }}
                          >Subscribe</button>
                        )
                      )}
                    </div>
                  </div>
                  {corpus.description && (
                    <div style={styles.corpusDescription}>{corpus.description}</div>
                  )}
                  <div style={styles.cardMeta}>
                    <span>{corpus.document_count || 0} document{corpus.document_count != 1 ? 's' : ''}</span>
                    <span style={styles.metaDot}>·</span>
                    <span>{corpus.subscriber_count || 0} subscriber{corpus.subscriber_count != 1 ? 's' : ''}</span>
                    <span style={styles.metaDot}>·</span>
                    <span>by {corpus.owner_username || 'you'}<OrcidBadge orcidId={corpus.owner_orcid_id} /></span>
                    <span style={styles.metaDot}>·</span>
                    <span>{new Date(corpus.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All Corpuses section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionHeading}>All Corpuses</h3>
          <div style={styles.searchWrapper}>
            <input
              type="text"
              placeholder="Search..."
              value={allCorpusSearch}
              onChange={(e) => setAllCorpusSearch(e.target.value)}
              style={styles.searchInput}
            />
            {allCorpusSearch && (
              <button
                onClick={() => setAllCorpusSearch('')}
                style={styles.clearButton}
              >✕</button>
            )}
          </div>
        </div>
        {filteredAllCorpuses.length === 0 ? (
          <div style={styles.emptyState}>
            {allCorpusSearch
              ? 'No matching corpuses found.'
              : 'No corpuses exist yet. Create one to get started!'}
          </div>
        ) : (
          <div style={styles.list}>
            {filteredAllCorpuses.map(corpus => (
              <div
                key={corpus.id}
                style={styles.corpusCard}
                onClick={() => onSelectCorpus(corpus.id)}
              >
                <div style={styles.cardHeader}>
                  <div>
                    <span style={styles.corpusName}>{corpus.name}</span>
                  </div>
                  <div style={styles.cardBadges}>
                    {!isGuest && onSubscribe && (
                      corpusTabs?.some(t => t.id === corpus.id) ? (
                        <span style={styles.subscribedBadge}>subscribed</span>
                      ) : (
                        <button
                          style={styles.subscribeButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubscribe(corpus.id, corpus.name);
                          }}
                        >Subscribe</button>
                      )
                    )}
                  </div>
                </div>
                {corpus.description && (
                  <div style={styles.corpusDescription}>{corpus.description}</div>
                )}
                <div style={styles.cardMeta}>
                  <span>{corpus.document_count || 0} document{corpus.document_count != 1 ? 's' : ''}</span>
                  <span style={styles.metaDot}>·</span>
                  <span>{corpus.subscriber_count || 0} subscriber{corpus.subscriber_count != 1 ? 's' : ''}</span>
                  <span style={styles.metaDot}>·</span>
                  <span>by {corpus.owner_username || 'you'}<OrcidBadge orcidId={corpus.owner_orcid_id} /></span>
                  <span style={styles.metaDot}>·</span>
                  <span>{new Date(corpus.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  loading: {
    textAlign: 'center',
    padding: '60px',
    fontSize: '15px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
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
  section: {
    marginBottom: '24px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
  },
  sectionHeading: {
    margin: 0,
    fontSize: '17px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  searchWrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
  },
  searchInput: {
    padding: '3px 22px 3px 8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: "'EB Garamond', serif",
    backgroundColor: '#faf9f6',
    outline: 'none',
    width: '130px',
  },
  clearButton: {
    position: 'absolute',
    right: '4px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#999',
    padding: '0 2px',
    fontFamily: "'EB Garamond', serif",
    lineHeight: 1,
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '15px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  corpusCard: {
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
  cardBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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
  subscribedBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#6a9e6a',
    padding: '2px 8px',
    border: '1px solid #c0dcc0',
    borderRadius: '10px',
  },
  corpusName: {
    fontSize: '17px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  corpusDescription: {
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

export default CorpusListView;
