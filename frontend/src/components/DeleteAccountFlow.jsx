import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, corpusAPI, combosAPI } from '../services/api';

const DeleteAccountFlow = ({ onClose }) => {
  const { user, logout } = useAuth();
  const [step, setStep] = useState(null); // null = loading, 1, 2, 3
  const [ownedCorpuses, setOwnedCorpuses] = useState([]);
  const [ownedCombos, setOwnedCombos] = useState([]); // Phase 42c
  const [corpusMembers, setCorpusMembers] = useState({}); // { corpusId: [users] }
  const [selectedTransfer, setSelectedTransfer] = useState({}); // { corpusId: userId }
  const [resolvedCorpuses, setResolvedCorpuses] = useState(new Set());
  const [resolvedCombos, setResolvedCombos] = useState(new Set()); // Phase 42c
  const [confirmUsername, setConfirmUsername] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [transferring, setTransferring] = useState({}); // { corpusId: true }

  // Load owned corpuses and combos on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [corpusRes, comboRes] = await Promise.all([
          corpusAPI.listMine().catch(() => ({ data: { corpuses: [] } })),
          combosAPI.getMyCombos().catch(() => ({ data: { combos: [] } })),
        ]);
        const corpuses = corpusRes.data.corpuses || corpusRes.data || [];
        const combos = comboRes.data.combos || comboRes.data || [];
        if (cancelled) return;
        if (corpuses.length === 0 && combos.length === 0) {
          setOwnedCorpuses([]);
          setOwnedCombos([]);
          setStep(2);
          return;
        }
        setOwnedCorpuses(corpuses);
        setOwnedCombos(combos);
        // Fetch members for each corpus
        const membersMap = {};
        for (const c of corpuses) {
          try {
            const mRes = await corpusAPI.listAllowedUsers(c.id);
            membersMap[c.id] = mRes.data.members || [];
          } catch {
            membersMap[c.id] = [];
          }
        }
        if (cancelled) return;
        setCorpusMembers(membersMap);
        setStep(1);
      } catch {
        if (!cancelled) {
          setError('Failed to load your data');
          setStep(1);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleTransfer = useCallback(async (corpusId) => {
    const newOwnerId = selectedTransfer[corpusId];
    if (!newOwnerId) return;
    setTransferring(prev => ({ ...prev, [corpusId]: true }));
    setError('');
    try {
      await corpusAPI.transferOwnership(corpusId, newOwnerId);
      setResolvedCorpuses(prev => new Set([...prev, corpusId]));
    } catch (err) {
      setError(err.response?.data?.error || 'Transfer failed');
    } finally {
      setTransferring(prev => ({ ...prev, [corpusId]: false }));
    }
  }, [selectedTransfer]);

  const handleDeleteCorpus = useCallback(async (corpusId) => {
    setTransferring(prev => ({ ...prev, [corpusId]: true }));
    setError('');
    try {
      await corpusAPI.deleteCorpus(corpusId);
      setResolvedCorpuses(prev => new Set([...prev, corpusId]));
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
    } finally {
      setTransferring(prev => ({ ...prev, [corpusId]: false }));
    }
  }, []);

  const allCorpusesResolved = ownedCorpuses.length === 0 || ownedCorpuses.every(c => resolvedCorpuses.has(c.id));
  const allCombosResolved = ownedCombos.length === 0 || ownedCombos.every(c => resolvedCombos.has(c.id));
  const allResolved = allCorpusesResolved && allCombosResolved;

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setError('');
    try {
      await authAPI.deleteAccount();
      onClose();
      setTimeout(() => logout(), 0);
      return;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 400 && (data?.corpuses || data?.ownedCombos)) {
        // Still owns corpuses or superconcepts — reload and go back to step 1
        if (data.corpuses) {
          setOwnedCorpuses(data.corpuses);
          setResolvedCorpuses(new Set());
          const membersMap = {};
          for (const c of data.corpuses) {
            try {
              const mRes = await corpusAPI.listAllowedUsers(c.id);
              membersMap[c.id] = mRes.data.members || [];
            } catch {
              membersMap[c.id] = [];
            }
          }
          setCorpusMembers(membersMap);
        }
        if (data.ownedCombos) {
          setOwnedCombos(data.ownedCombos);
          setResolvedCombos(new Set());
        }
        setStep(1);
        setError(data.error);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setDeleting(false);
    }
  }, [logout]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (step === null) {
    return (
      <div style={styles.overlay}>
        <div style={styles.container}>
          <p style={styles.text}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.heading}>
            {step === 1 ? 'Transfer Ownership' : step === 2 ? 'Document Notice' : 'Delete Your Account'}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {/* Step 1: Corpus and superconcept ownership */}
        {step === 1 && (
          <div>
            <p style={styles.text}>
              Transfer ownership or delete the items below before deleting your account.
            </p>

            {/* Corpuses */}
            {ownedCorpuses.length > 0 && (
              <>
                <p style={{ ...styles.text, fontWeight: '600', marginBottom: '8px' }}>
                  Corpuses ({ownedCorpuses.length})
                </p>
                <div style={styles.corpusList}>
                  {ownedCorpuses.map(corpus => {
                    const resolved = resolvedCorpuses.has(corpus.id);
                    const members = corpusMembers[corpus.id] || [];
                    const busy = transferring[corpus.id];
                    return (
                      <div key={corpus.id} style={{ ...styles.corpusRow, opacity: resolved ? 0.5 : 1 }}>
                        <span style={{ ...styles.corpusName, textDecoration: resolved ? 'line-through' : 'none' }}>
                          {corpus.name}
                        </span>
                        {resolved ? (
                          <span style={styles.resolvedLabel}>Done</span>
                        ) : members.length > 0 ? (
                          <div style={styles.corpusActions}>
                            <select
                              style={styles.select}
                              value={selectedTransfer[corpus.id] || ''}
                              onChange={e => setSelectedTransfer(prev => ({ ...prev, [corpus.id]: Number(e.target.value) }))}
                              disabled={busy}
                            >
                              <option value="">Select member...</option>
                              {members.map(m => (
                                <option key={m.user_id} value={m.user_id}>{m.username}</option>
                              ))}
                            </select>
                            <button
                              style={styles.actionButton}
                              onClick={() => handleTransfer(corpus.id)}
                              disabled={!selectedTransfer[corpus.id] || busy}
                            >
                              {busy ? 'Transferring...' : 'Transfer'}
                            </button>
                            <button
                              style={styles.actionButton}
                              onClick={() => handleDeleteCorpus(corpus.id)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <div style={styles.corpusActions}>
                            <span style={styles.noMembersNote}>No members to transfer to</span>
                            <button
                              style={styles.actionButton}
                              onClick={() => handleDeleteCorpus(corpus.id)}
                              disabled={busy}
                            >
                              {busy ? 'Deleting...' : 'Delete Corpus'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Superconcepts (Phase 42c) */}
            {ownedCombos.length > 0 && (
              <>
                <p style={{ ...styles.text, fontWeight: '600', marginBottom: '8px', marginTop: '16px' }}>
                  Superconcepts ({ownedCombos.length})
                </p>
                <p style={{ ...styles.text, fontSize: '13px', marginBottom: '8px' }}>
                  Transfer ownership from each superconcept's tab in the sidebar.
                </p>
                <div style={styles.corpusList}>
                  {ownedCombos.map(combo => {
                    const resolved = resolvedCombos.has(combo.id);
                    return (
                      <div key={combo.id} style={{ ...styles.corpusRow, opacity: resolved ? 0.5 : 1 }}>
                        <span style={{ ...styles.corpusName, textDecoration: resolved ? 'line-through' : 'none' }}>
                          {combo.name}
                        </span>
                        {resolved ? (
                          <span style={styles.resolvedLabel}>Done</span>
                        ) : (
                          <span style={styles.noMembersNote}>Transfer via superconcept tab</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.actionButton}>Cancel</button>
              <button
                onClick={() => { setError(''); setStep(2); }}
                style={styles.actionButton}
                disabled={!allResolved}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Document notice */}
        {step === 2 && (
          <div>
            <p style={styles.text}>
              Documents you've uploaded will remain in their corpuses but will no longer be associated with your account. If you'd like to delete any documents before closing your account, you can do so from within their corpuses.
            </p>
            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.actionButton}>Cancel</button>
              <button onClick={() => { setError(''); setStep(3); }} style={styles.actionButton}>Continue</button>
            </div>
          </div>
        )}

        {/* Step 3: Final confirmation */}
        {step === 3 && (
          <div>
            <p style={styles.text}>
              This will permanently delete your account. Your votes, subscriptions, saved items, and messages will be removed. Concepts, annotations, and documents you created will remain but will no longer be attributed to you. This cannot be undone.
            </p>
            <label style={styles.label}>Type your username to confirm:</label>
            <input
              type="text"
              value={confirmUsername}
              onChange={e => setConfirmUsername(e.target.value)}
              placeholder={user?.username}
              style={styles.input}
              autoFocus
            />
            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.actionButton}>Cancel</button>
              <button
                onClick={handleDeleteAccount}
                style={styles.actionButton}
                disabled={confirmUsername !== user?.username || deleting}
              >
                {deleting ? 'Deleting...' : 'Permanently Delete My Account'}
              </button>
            </div>
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  container: {
    backgroundColor: '#faf9f6',
    borderRadius: '8px',
    padding: '32px',
    maxWidth: '520px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
    border: '1px solid #ccc',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  heading: {
    margin: 0,
    fontSize: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#999',
    padding: '0 4px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  text: {
    fontSize: '15px',
    lineHeight: '1.5',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '16px',
  },
  error: {
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#f0ece4',
    padding: '8px 12px',
    borderRadius: '4px',
    marginBottom: '12px',
    border: '1px solid #ccc',
  },
  corpusList: {
    marginBottom: '20px',
  },
  corpusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #eee',
    gap: '12px',
    flexWrap: 'wrap',
  },
  corpusName: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '600',
    minWidth: '80px',
  },
  resolvedLabel: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  corpusActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  noMembersNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  select: {
    padding: '4px 8px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#333',
  },
  actionButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '20px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#333',
    boxSizing: 'border-box',
  },
};

export default DeleteAccountFlow;
