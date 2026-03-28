import React, { useState, useEffect } from 'react';
import { corpusAPI } from '../services/api';

const OrphanRescueModal = ({ onClose, onRescued }) => {
  const [orphans, setOrphans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Per-document state: which corpus the user has selected for rescue
  const [rescueTargets, setRescueTargets] = useState({}); // { docId: corpusId }

  // Available corpuses the user can rescue into (own + allowed)
  const [availableCorpuses, setAvailableCorpuses] = useState([]);
  const [loadingCorpuses, setLoadingCorpuses] = useState(true);

  // Track which docs are currently being rescued/dismissed (for button loading state)
  const [busyDocs, setBusyDocs] = useState(new Set());

  // New corpus creation inline
  const [creatingCorpus, setCreatingCorpus] = useState(false);
  const [newCorpusName, setNewCorpusName] = useState('');
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    loadOrphans();
    loadAvailableCorpuses();
  }, []);

  const loadOrphans = async () => {
    try {
      setLoading(true);
      const res = await corpusAPI.getOrphanedDocuments();
      setOrphans(res.data.orphanedDocuments || []);
    } catch (err) {
      console.error('Failed to load orphaned documents:', err);
      setError('Failed to load orphaned documents');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableCorpuses = async () => {
    try {
      setLoadingCorpuses(true);
      // Load user's own corpuses + corpuses they're subscribed to (which includes allowed-user corpuses)
      const [mineRes, subsRes] = await Promise.all([
        corpusAPI.listMine().catch(() => ({ data: { corpuses: [] } })),
        corpusAPI.getMySubscriptions().catch(() => ({ data: { subscriptions: [] } })),
      ]);
      // Merge and deduplicate by corpus id
      const ownCorpuses = (mineRes.data.corpuses || []).map(c => ({
        id: c.id,
        name: c.name,
        source: 'own',
      }));
      const subCorpuses = (subsRes.data.subscriptions || []).map(c => ({
        id: c.id,
        name: c.name,
        source: 'subscribed',
      }));
      const seen = new Set();
      const merged = [];
      for (const c of [...ownCorpuses, ...subCorpuses]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          merged.push(c);
        }
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableCorpuses(merged);
    } catch (err) {
      console.error('Failed to load corpuses:', err);
    } finally {
      setLoadingCorpuses(false);
    }
  };

  const handleRescue = async (docId) => {
    const corpusId = rescueTargets[docId];
    if (!corpusId) return;

    setBusyDocs(prev => new Set(prev).add(docId));
    try {
      await corpusAPI.rescueDocument(docId, corpusId);
      // Remove from list
      setOrphans(prev => prev.filter(d => d.id !== docId));
      if (onRescued) onRescued();
    } catch (err) {
      console.error('Failed to rescue document:', err);
      alert(err.response?.data?.error || 'Failed to rescue document');
    } finally {
      setBusyDocs(prev => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleDismiss = async (docId) => {
    setBusyDocs(prev => new Set(prev).add(docId));
    try {
      await corpusAPI.dismissOrphan(docId);
      setOrphans(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      console.error('Failed to dismiss document:', err);
      alert(err.response?.data?.error || 'Failed to dismiss document');
    } finally {
      setBusyDocs(prev => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleDismissAll = async () => {
    if (!confirm(`Permanently delete all ${orphans.length} orphaned document(s)? This cannot be undone.`)) return;
    const ids = orphans.map(d => d.id);
    for (const id of ids) {
      try {
        await corpusAPI.dismissOrphan(id);
      } catch (err) {
        console.error(`Failed to dismiss document ${id}:`, err);
      }
    }
    setOrphans([]);
  };

  const handleCreateCorpus = async () => {
    if (!newCorpusName.trim()) return;
    setCreateError(null);
    try {
      const res = await corpusAPI.create(newCorpusName.trim());
      const newCorpus = res.data.corpus || res.data;
      setAvailableCorpuses(prev => [...prev, { id: newCorpus.id, name: newCorpus.name, source: 'own' }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCorpusName('');
      setCreatingCorpus(false);
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create corpus');
    }
  };

  // If loading or no orphans, handle those states
  if (loading) {
    return (
      <div style={styles.backdrop} onClick={onClose}>
        <div style={styles.modal} onClick={e => e.stopPropagation()}>
          <p style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (orphans.length === 0) {
    // Auto-close if nothing to show (shouldn't normally render in this case)
    return null;
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Orphaned Documents</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <p style={styles.description}>
          The following document(s) you uploaded are no longer in any corpus — likely because the corpus they were in was deleted.
          You can rescue them by adding them to another corpus, or dismiss them to delete permanently.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {/* Document list */}
        <div style={styles.docList}>
          {orphans.map(doc => (
            <div key={doc.id} style={styles.docRow}>
              <div style={styles.docInfo}>
                <span style={styles.docTitle}>{doc.title}</span>
                <span style={styles.docMeta}>
                  {doc.format === 'markdown' ? 'Markdown' : 'Plain text'} · uploaded {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
              <div style={styles.docActions}>
                <select
                  style={styles.corpusSelect}
                  value={rescueTargets[doc.id] || ''}
                  onChange={e => setRescueTargets(prev => ({ ...prev, [doc.id]: parseInt(e.target.value) || '' }))}
                  disabled={busyDocs.has(doc.id) || loadingCorpuses}
                >
                  <option value="">Select a corpus...</option>
                  {availableCorpuses.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  style={{
                    ...styles.rescueButton,
                    opacity: (!rescueTargets[doc.id] || busyDocs.has(doc.id)) ? 0.5 : 1,
                  }}
                  onClick={() => handleRescue(doc.id)}
                  disabled={!rescueTargets[doc.id] || busyDocs.has(doc.id)}
                >
                  {busyDocs.has(doc.id) ? '...' : 'Rescue'}
                </button>
                <button
                  style={styles.dismissButton}
                  onClick={() => handleDismiss(doc.id)}
                  disabled={busyDocs.has(doc.id)}
                >
                  {busyDocs.has(doc.id) ? '...' : 'Dismiss'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Create new corpus inline */}
        <div style={styles.createSection}>
          {!creatingCorpus ? (
            <button
              style={styles.createCorpusLink}
              onClick={() => setCreatingCorpus(true)}
            >
              + Create a new corpus to rescue into
            </button>
          ) : (
            <div style={styles.createCorpusRow}>
              <input
                style={styles.createCorpusInput}
                type="text"
                placeholder="New corpus name"
                value={newCorpusName}
                onChange={e => setNewCorpusName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateCorpus()}
                autoFocus
              />
              <button style={styles.createCorpusButton} onClick={handleCreateCorpus}>Create</button>
              <button style={styles.createCorpusCancelButton} onClick={() => { setCreatingCorpus(false); setNewCorpusName(''); setCreateError(null); }}>Cancel</button>
            </div>
          )}
          {createError && <p style={styles.error}>{createError}</p>}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          {orphans.length > 1 && (
            <button style={styles.dismissAllButton} onClick={handleDismissAll}>
              Dismiss all ({orphans.length})
            </button>
          )}
          <button style={styles.laterButton} onClick={onClose}>
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    width: '600px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px 0',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#999',
    padding: '4px 8px',
  },
  description: {
    padding: '12px 24px 0',
    fontSize: '13px',
    color: '#666',
    lineHeight: '1.5',
    margin: 0,
  },
  error: {
    color: '#c33',
    fontSize: '13px',
    padding: '4px 24px',
    margin: 0,
  },
  docList: {
    padding: '16px 24px',
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  docRow: {
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  docInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  docTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  docMeta: {
    fontSize: '12px',
    color: '#999',
  },
  docActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  corpusSelect: {
    flex: 1,
    padding: '6px 8px',
    fontSize: '13px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  rescueButton: {
    padding: '6px 14px',
    backgroundColor: '#2a7d4f',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
  },
  dismissButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#999',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
  },
  createSection: {
    padding: '0 24px 8px',
  },
  createCorpusLink: {
    background: 'none',
    border: 'none',
    color: '#2a7d4f',
    cursor: 'pointer',
    fontSize: '13px',
    padding: 0,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  createCorpusRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  createCorpusInput: {
    flex: 1,
    padding: '6px 8px',
    fontSize: '13px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  createCorpusButton: {
    padding: '6px 14px',
    backgroundColor: '#2a7d4f',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  createCorpusCancelButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '12px 24px 20px',
    borderTop: '1px solid #eee',
  },
  dismissAllButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#c33',
    border: '1px solid #e0c0c0',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  laterButton: {
    padding: '8px 16px',
    backgroundColor: '#f5f5f5',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default OrphanRescueModal;
