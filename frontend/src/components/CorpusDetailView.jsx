import React, { useState, useEffect } from 'react';
import { corpusAPI, documentsAPI } from '../services/api';
import CorpusDocumentList from './CorpusDocumentList';
import CorpusUploadForm from './CorpusUploadForm';
import CorpusMembersPanel from './CorpusMembersPanel';
import OrcidBadge from './OrcidBadge';

const CorpusDetailView = ({ corpusId, onBack, onOpenDocument, isGuest, onSubscribe, onUnsubscribe, isSubscribed, currentUserId, onSelectCorpus }) => {
  const [corpus, setCorpus] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Shared component data
  const [favoriteDocIds, setFavoriteDocIds] = useState(new Set());
  const [allTags, setAllTags] = useState([]);

  // Phase 7g/26b: Allowed users management state
  const [showAllowedUsers, setShowAllowedUsers] = useState(false);
  const [allowedUsersCount, setAllowedUsersCount] = useState(0);
  const [allowedUsersMembers, setAllowedUsersMembers] = useState([]);
  const [allowedUsersLoading, setAllowedUsersLoading] = useState(false);
  const [inviteTokens, setInviteTokens] = useState([]);
  const [inviteTokensLoading, setInviteTokensLoading] = useState(false);
  const [isAllowedUser, setIsAllowedUser] = useState(false);

  useEffect(() => {
    loadCorpus();
  }, [corpusId]);

  const loadCorpus = async () => {
    try {
      setLoading(true);
      const res = await corpusAPI.getCorpus(corpusId);
      setCorpus(res.data.corpus);
      setDocuments(res.data.documents);
      // Check allowed user status (Phase 7g)
      if (!isGuest) {
        try {
          const statusRes = await corpusAPI.checkAllowedStatus(corpusId);
          setIsAllowedUser(statusRes.data.isAllowedUser);
        } catch (err) {
          // Silently fail — guest or network issue
        }
      }
      // Load favorites
      if (!isGuest) {
        try {
          const favRes = await corpusAPI.getDocumentFavorites(corpusId);
          setFavoriteDocIds(new Set(favRes.data.favoriteDocIds || []));
        } catch (err) {
          // Silently fail
        }
      }
      // Load all tags
      try {
        const tagRes = await documentsAPI.listTags();
        setAllTags(tagRes.data.tags || []);
      } catch (err) {
        // Silently fail
      }
    } catch (err) {
      console.error('Failed to load corpus:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCorpus = async () => {
    if (!window.confirm(`Delete "${corpus.name}"? All documents only in this corpus will also be deleted. This cannot be undone.`)) return;
    try {
      await corpusAPI.deleteCorpus(corpusId);
      onBack(); // Return to corpus list
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete corpus');
    }
  };

  const handleStartEdit = () => {
    setEditName(corpus.name);
    setEditDescription(corpus.description || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    try {
      await corpusAPI.update(corpusId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setEditing(false);
      await loadCorpus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update corpus');
    }
  };

  // ─── Phase 7g: Allowed Users Management ────────────

  const handleToggleAllowedUsers = async () => {
    const newState = !showAllowedUsers;
    setShowAllowedUsers(newState);
    if (newState) {
      await loadAllowedUsers();
      if (isOwner) {
        await loadInviteTokens();
      }
    }
  };

  const loadAllowedUsers = async () => {
    try {
      setAllowedUsersLoading(true);
      const res = await corpusAPI.listAllowedUsers(corpusId);
      setAllowedUsersCount(res.data.count || 0);
      setAllowedUsersMembers(res.data.members || []);
    } catch (err) {
      console.error('Failed to load allowed users:', err);
      setAllowedUsersCount(0);
      setAllowedUsersMembers([]);
    } finally {
      setAllowedUsersLoading(false);
    }
  };

  const loadInviteTokens = async () => {
    try {
      setInviteTokensLoading(true);
      const res = await corpusAPI.getInviteTokens(corpusId);
      setInviteTokens(res.data.tokens || []);
    } catch (err) {
      console.error('Failed to load invite tokens:', err);
      setInviteTokens([]);
    } finally {
      setInviteTokensLoading(false);
    }
  };

  // Callbacks for CorpusDocumentList
  const handleDocListOpenDocument = (docId) => {
    onOpenDocument(docId, corpus.name);
  };

  const handleDocListRemoveDocument = async (docId, title) => {
    if (!window.confirm(`Remove "${title}" from this corpus? If it's not in any other corpus, the document will be deleted.`)) return;
    try {
      await corpusAPI.removeDocument(corpusId, docId);
      await loadCorpus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove document');
    }
  };

  const handleDocListDeleteDocument = async (docId) => {
    await documentsAPI.deleteDocument(docId);
    await loadCorpus();
  };

  const handleDocListToggleFavorite = async (docId) => {
    try {
      const res = await corpusAPI.toggleDocumentFavorite(corpusId, docId);
      setFavoriteDocIds(prev => {
        const next = new Set(prev);
        if (res.data.favorited) next.add(docId); else next.delete(docId);
        return next;
      });
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const handleDocListAssignTag = async (docId, tag) => {
    await documentsAPI.assignTag(docId, tag.id);
    setDocuments(prev => prev.map(d =>
      d.id === docId ? { ...d, tags: [{ id: tag.id, name: tag.name }] } : d
    ));
  };

  const handleDocListRemoveTag = async (docId, tagId) => {
    await documentsAPI.removeTag(docId, tagId);
    setDocuments(prev => prev.map(d =>
      d.id === docId ? { ...d, tags: [] } : d
    ));
  };

  // Callbacks for CorpusUploadForm
  const handleUploadDocument = async (cId, file, title, tags, copyrightConfirmed) => {
    await corpusAPI.uploadDocument(cId, file, title, tags, copyrightConfirmed);
  };

  const handleSearchDocuments = async (query, excludeCorpusId) => {
    return await corpusAPI.searchDocuments(query, excludeCorpusId);
  };

  const handleAddDocToCorpus = async (cId, docId) => {
    await corpusAPI.addDocument(cId, docId);
  };

  const handleUploadComplete = () => {
    loadCorpus();
  };

  // Callbacks for CorpusMembersPanel
  const handleMembersGenerateInvite = async (maxUses, expiresInDays) => {
    const res = await corpusAPI.generateInviteToken(corpusId, maxUses, expiresInDays);
    loadInviteTokens();
    return res;
  };

  const handleMembersDeleteToken = async (tokenId) => {
    await corpusAPI.deleteInviteToken(tokenId);
    loadInviteTokens();
  };

  const handleMembersRemoveUser = async (userId, username) => {
    await corpusAPI.removeAllowedUser(corpusId, userId);
    loadAllowedUsers();
  };

  const handleMembersLeave = async () => {
    await corpusAPI.leaveCorpus(corpusId);
    if (onUnsubscribe) onUnsubscribe(corpusId);
  };

  const handleTransferOwnership = async (newOwnerId) => {
    await corpusAPI.transferOwnership(corpusId, newOwnerId);
    loadCorpus();
    loadAllowedUsers();
  };

  if (loading) {
    return <div style={styles.loading}>Loading corpus...</div>;
  }

  if (!corpus) {
    return <div style={styles.loading}>Corpus not found.</div>;
  }

  // Check if current user is the owner by comparing user IDs
  // currentUserId comes from the JWT (user?.userId), corpus.created_by from the DB
  // Use == for loose comparison in case one is string and the other is number
  const ownerUserId = currentUserId || null;
  const isOwner = !isGuest && ownerUserId != null && corpus.created_by == ownerUserId;

  return (
    <div style={styles.container}>
      <style>{`@keyframes orca-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Corpuses</button>
      </div>

      {/* Corpus info */}
      <div style={styles.corpusInfo}>
        {editing ? (
          <div style={styles.editForm}>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={styles.editInput}
              maxLength={255}
              autoFocus
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              style={styles.editTextarea}
              rows={2}
            />
            <div style={styles.editActions}>
              <button onClick={handleSaveEdit} style={styles.saveButton}>Save</button>
              <button onClick={() => setEditing(false)} style={styles.cancelButton}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.titleRow}>
              <h2 style={styles.corpusTitle}>{corpus.name}</h2>
              {isAllowedUser && (
                <span style={styles.allowedBadge}>Member</span>
              )}
            </div>
            {corpus.description && (
              <p style={styles.corpusDescription}>{corpus.description}</p>
            )}
            <div style={styles.metaRow}>
              <span>Created by {corpus.owner_username}<OrcidBadge orcidId={corpus.owner_orcid_id} /></span>
              <span style={styles.metaDot}>·</span>
              <span>{new Date(corpus.created_at).toLocaleDateString()}</span>
              <span style={styles.metaDot}>·</span>
              <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
              <span style={styles.metaDot}>·</span>
              <span>{corpus.subscriber_count || 0} subscriber{corpus.subscriber_count != 1 ? 's' : ''}</span>
            </div>
            <div style={styles.ownerActions}>
              {isOwner && (
                <>
                  <button onClick={handleStartEdit} style={styles.editButton}>Edit</button>
                  <button onClick={handleDeleteCorpus} style={styles.deleteButton}>Delete Corpus</button>
                </>
              )}
              {!isGuest && (
                <button onClick={handleToggleAllowedUsers} style={styles.editButton}>
                  {showAllowedUsers ? 'Hide Members' : 'Members'}
                </button>
              )}
              {!isGuest && onSubscribe && !isSubscribed && (
                <button
                  onClick={() => onSubscribe(corpusId, corpus.name)}
                  style={styles.subscribeButton}
                >Subscribe</button>
              )}
              {!isGuest && onUnsubscribe && isSubscribed && (
                <button
                  onClick={() => {
                    if (window.confirm(`Unsubscribe from "${corpus.name}"? This removes the corpus tab from your sidebar. You can resubscribe anytime.`)) {
                      onUnsubscribe(corpusId);
                    }
                  }}
                  style={styles.unsubscribeButton}
                >Unsubscribe</button>
              )}
            </div>
          </>
        )}
      </div>

      {showAllowedUsers && (
        <CorpusMembersPanel
          isOwner={isOwner}
          isAllowedUser={isAllowedUser}
          isGuest={isGuest}
          corpusId={corpusId}
          membersCount={allowedUsersCount}
          members={allowedUsersMembers}
          membersLoading={allowedUsersLoading}
          inviteTokens={inviteTokens}
          inviteTokensLoading={inviteTokensLoading}
          onGenerateInvite={handleMembersGenerateInvite}
          onDeleteInviteToken={handleMembersDeleteToken}
          onRemoveMember={handleMembersRemoveUser}
          onLeaveCorpus={handleMembersLeave}
          onTransferOwnership={handleTransferOwnership}
          onMembersChanged={loadAllowedUsers}
        />
      )}

      <CorpusUploadForm
        corpusId={corpusId}
        isGuest={isGuest}
        isOwner={isOwner}
        isAllowedUser={isAllowedUser}
        allTags={allTags}
        onUpload={handleUploadDocument}
        onSearchDocuments={handleSearchDocuments}
        onAddDocument={handleAddDocToCorpus}
        onComplete={handleUploadComplete}
      />

      <CorpusDocumentList
        documents={documents}
        corpusId={corpusId}
        currentUserId={currentUserId}
        isGuest={isGuest}
        isOwner={isOwner}
        isMember={isAllowedUser}
        favorites={favoriteDocIds}
        allTags={allTags}
        onOpenDocument={handleDocListOpenDocument}
        onRemoveDocument={handleDocListRemoveDocument}
        onDeleteDocument={handleDocListDeleteDocument}
        onToggleFavorite={handleDocListToggleFavorite}
        onAssignTag={handleDocListAssignTag}
        onRemoveTag={handleDocListRemoveTag}
      />
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
    marginBottom: '16px',
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
  corpusInfo: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '18px 22px',
    marginBottom: '20px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '4px',
  },
  corpusTitle: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  modeBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    padding: '2px 8px',
    border: '1px solid #ddd',
    borderRadius: '10px',
  },
  corpusDescription: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    margin: '6px 0',
    lineHeight: '1.4',
  },
  metaRow: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '8px',
  },
  metaDot: {
    margin: '0 6px',
  },
  ownerActions: {
    marginTop: '12px',
    display: 'flex',
    gap: '8px',
  },
  editButton: {
    padding: '4px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  deleteButton: {
    padding: '4px 12px',
    border: '1px solid #e0c0c0',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
  },
  subscribeButton: {
    padding: '4px 12px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unsubscribeButton: {
    padding: '4px 12px',
    border: '1px solid #e0c0c0',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  editInput: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
  },
  editTextarea: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    resize: 'vertical',
  },
  editActions: {
    display: 'flex',
    gap: '8px',
  },
  saveButton: {
    padding: '6px 14px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  cancelButton: {
    padding: '6px 14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  // Duplicate detection styles (Phase 7b)
  duplicatePanel: {
    backgroundColor: '#fefcf3',
    border: '1px solid #e8d9a0',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '4px',
  },
  duplicateHeader: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#8a7020',
    marginBottom: '6px',
  },
  duplicateHint: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    margin: '0 0 12px 0',
    lineHeight: '1.4',
    fontStyle: 'normal',
  },
  duplicateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
  },
  duplicateCard: {
    backgroundColor: 'white',
    border: '1px solid #e8d9a0',
    borderRadius: '4px',
    padding: '10px 14px',
  },
  duplicateTitle: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  similarityBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    padding: '1px 6px',
    border: '1px solid #e8d9a0',
    borderRadius: '8px',
    fontWeight: '400',
  },
  duplicateMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '2px',
  },
  duplicateCorpuses: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    marginTop: '4px',
    fontStyle: 'normal',
  },
  duplicateActions: {
    display: 'flex',
    gap: '8px',
  },
  proceedButton: {
    padding: '6px 14px',
    border: '1px solid #8a7020',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
  },
  cancelDuplicateButton: {
    padding: '6px 14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  // Phase 7g: Allowed Users styles
  allowedBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a7a5a',
    padding: '2px 8px',
    border: '1px solid #b0d0b0',
    borderRadius: '10px',
    backgroundColor: '#f0f8f0',
  },
};

export default CorpusDetailView;
