import React, { useState } from 'react';

export default function CorpusMembersPanel({
  isOwner,
  isAllowedUser,
  isGuest,
  membersCount,
  members,
  membersLoading,
  inviteTokens,
  inviteTokensLoading,
  onGenerateInvite,
  onDeleteInviteToken,
  onRemoveMember,
  onLeaveCorpus,
  onTransferOwnership,
}) {
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedTokenId, setCopiedTokenId] = useState(null);
  const [leavingCorpus, setLeavingCorpus] = useState(false);
  const [showTransferUI, setShowTransferUI] = useState(false);
  const [selectedTransferTarget, setSelectedTransferTarget] = useState(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const handleGenerateInvite = async () => {
    setGeneratingInvite(true);
    try {
      await onGenerateInvite();
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyInviteToken = async (token, tokenId) => {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = window.document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      window.document.body.appendChild(textarea);
      textarea.select();
      window.document.execCommand('copy');
      window.document.body.removeChild(textarea);
    }
    setCopiedTokenId(tokenId);
    setTimeout(() => setCopiedTokenId(null), 2000);
  };

  const handleDeleteInviteToken = async (tokenId) => {
    if (!window.confirm('Revoke this invite link?')) return;
    await onDeleteInviteToken(tokenId);
  };

  const handleRemoveMember = async (userId, username) => {
    if (!window.confirm(`Remove ${username} from corpus?`)) return;
    await onRemoveMember(userId, username);
  };

  const handleLeaveCorpus = async () => {
    setLeavingCorpus(true);
    try {
      await onLeaveCorpus();
    } catch (err) {
      // error handled by caller
    }
    setLeavingCorpus(false);
  };

  const handleConfirmTransfer = async () => {
    setTransferring(true);
    try {
      await onTransferOwnership(selectedTransferTarget);
      setShowTransferUI(false);
      setSelectedTransferTarget(null);
      setConfirmingTransfer(false);
    } catch (err) {
      // error handled by caller
    }
    setTransferring(false);
  };

  const handleCancelTransfer = () => {
    setSelectedTransferTarget(null);
    setConfirmingTransfer(false);
    setShowTransferUI(false);
  };

  return (
    <div style={styles.membersPanel}>
      <h3 style={styles.membersPanelHeading}>Corpus Members</h3>

      {membersLoading ? (
        <div style={styles.membersPanelHint}>Loading...</div>
      ) : (isOwner || isAllowedUser) ? (
        <>
          {isOwner && (
            <div style={styles.membersInviteSection}>
              <div style={styles.membersInviteHeader}>
                <span style={styles.membersInviteLabel}>Invite Links</span>
                <button
                  style={styles.membersGenerateBtn}
                  onClick={handleGenerateInvite}
                  disabled={generatingInvite}
                >
                  {generatingInvite ? 'Generating...' : '+ New Invite Link'}
                </button>
              </div>
              {inviteTokensLoading ? (
                <div style={styles.membersPanelHint}>Loading...</div>
              ) : inviteTokens.length === 0 ? (
                <div style={styles.membersPanelEmpty}>No invite links yet.</div>
              ) : (
                <div style={styles.membersTokenList}>
                  {inviteTokens.map(tok => {
                    const created = new Date(tok.created_at).toLocaleDateString();
                    const usesText = tok.max_uses
                      ? `${tok.use_count} / ${tok.max_uses} uses`
                      : `${tok.use_count} uses`;
                    const now = new Date();
                    const expired = tok.expires_at && new Date(tok.expires_at) < now;
                    const maxReached = tok.max_uses && tok.use_count >= tok.max_uses;
                    let statusText = null;
                    if (expired) {
                      statusText = 'expired';
                    } else if (maxReached) {
                      statusText = 'max uses reached';
                    } else if (tok.expires_at) {
                      statusText = `expires ${new Date(tok.expires_at).toLocaleDateString()}`;
                    }

                    return (
                      <div key={tok.id} style={styles.membersTokenCard}>
                        <span style={styles.membersTokenMeta}>
                          {created}
                          <span style={styles.metaDot}>&middot;</span>
                          {usesText}
                          {statusText && (
                            <>
                              <span style={styles.metaDot}>&middot;</span>
                              {statusText}
                            </>
                          )}
                        </span>
                        <span style={styles.membersTokenActions}>
                          <button
                            style={styles.membersCopyBtn}
                            onClick={() => handleCopyInviteToken(tok.token, tok.id)}
                          >
                            {copiedTokenId === tok.id ? 'Copied' : 'Copy Link'}
                          </button>
                          <button
                            style={styles.membersRevokeBtn}
                            onClick={() => handleDeleteInviteToken(tok.id)}
                            title="Revoke"
                          >
                            &#10005;
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={styles.membersList}>
            <div style={styles.membersListHeader}>
              {membersCount} member{membersCount !== 1 ? 's' : ''}
            </div>
            {members.length === 0 ? (
              <div style={styles.membersPanelEmpty}>No members yet.</div>
            ) : (
              members.map(au => (
                <div key={au.user_id} style={styles.membersRow}>
                  <span style={styles.membersUsername}>{au.username}</span>
                  {isOwner && (
                    <button
                      style={styles.membersRemoveBtn}
                      onClick={() => handleRemoveMember(au.user_id, au.username)}
                      title="Remove member"
                    >
                      &#10005;
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {isAllowedUser && !isOwner && (
            <button
              style={styles.membersLeaveBtn}
              onClick={handleLeaveCorpus}
              disabled={leavingCorpus}
            >
              {leavingCorpus ? 'Leaving...' : 'Leave corpus'}
            </button>
          )}

          {isOwner && onTransferOwnership && members.length > 0 && (
            <div style={styles.transferSection}>
              {!showTransferUI ? (
                <button
                  style={styles.transferToggleBtn}
                  onClick={() => setShowTransferUI(true)}
                >
                  Transfer ownership
                </button>
              ) : confirmingTransfer ? (
                <div style={styles.transferConfirm}>
                  <div style={styles.transferConfirmText}>
                    Transfer ownership of this corpus to {members.find(m => m.user_id === selectedTransferTarget)?.username}? You will become a regular member.
                  </div>
                  <div style={styles.transferConfirmActions}>
                    <button
                      style={styles.transferConfirmBtn}
                      onClick={handleConfirmTransfer}
                      disabled={transferring}
                    >
                      {transferring ? 'Transferring...' : 'Confirm'}
                    </button>
                    <button
                      style={styles.transferCancelBtn}
                      onClick={handleCancelTransfer}
                      disabled={transferring}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={styles.transferPickList}>
                  <div style={styles.transferPickLabel}>Select new owner:</div>
                  {members.map(m => (
                    <div key={m.user_id} style={styles.transferPickRow}>
                      <span style={styles.membersUsername}>{m.username}</span>
                      <button
                        style={styles.transferPickBtn}
                        onClick={() => {
                          setSelectedTransferTarget(m.user_id);
                          setConfirmingTransfer(true);
                        }}
                      >
                        Transfer to {m.username}
                      </button>
                    </div>
                  ))}
                  <button
                    style={styles.transferCancelBtn}
                    onClick={handleCancelTransfer}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={styles.membersPanelCount}>
          {membersCount} corpus member{membersCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

const styles = {
  membersPanel: {
    padding: '16px 20px',
    borderBottom: '1px solid #e8e0d0',
    backgroundColor: '#fdfcf9',
  },
  membersPanelHeading: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 10px 0',
  },
  membersPanelHint: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontStyle: 'normal',
    padding: '8px 0',
  },
  membersPanelEmpty: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
    fontStyle: 'normal',
    padding: '4px 0',
  },
  membersPanelCount: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    padding: '4px 0',
  },
  membersInviteSection: {
    marginBottom: '14px',
    paddingBottom: '14px',
    borderBottom: '1px solid #f0ebe0',
  },
  membersInviteHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  membersInviteLabel: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#555',
  },
  membersGenerateBtn: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a4a2a',
    background: 'none',
    border: '1px solid #c8bfaf',
    borderRadius: '4px',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  membersTokenList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  membersTokenCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    border: '1px solid #f0ebe0',
    borderRadius: '4px',
    backgroundColor: '#fff',
  },
  membersTokenMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  metaDot: {
    margin: '0 6px',
  },
  membersTokenActions: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexShrink: 0,
  },
  membersCopyBtn: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a4a2a',
    background: 'none',
    border: '1px solid #d4c9b8',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  membersRevokeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#ccc',
    padding: '2px 6px',
  },
  membersList: {
    marginBottom: '8px',
  },
  membersListHeader: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#555',
    marginBottom: '8px',
  },
  membersRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    borderBottom: '1px solid #f0f0f0',
  },
  membersUsername: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  membersRemoveBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#ccc',
    padding: '2px 6px',
  },
  membersLeaveBtn: {
    marginTop: '10px',
    padding: '6px 16px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a5a5a',
    backgroundColor: '#fff',
    border: '1px solid #d4b8b8',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  transferSection: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #f0ebe0',
  },
  transferToggleBtn: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
  },
  transferPickList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  transferPickLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    marginBottom: '2px',
  },
  transferPickRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 10px',
    border: '1px solid #f0ebe0',
    borderRadius: '4px',
    backgroundColor: '#fff',
  },
  transferPickBtn: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a4a2a',
    background: 'none',
    border: '1px solid #c8bfaf',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
  },
  transferConfirm: {
    padding: '8px 10px',
    border: '1px solid #f0ebe0',
    borderRadius: '4px',
    backgroundColor: '#fff',
  },
  transferConfirmText: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    marginBottom: '8px',
  },
  transferConfirmActions: {
    display: 'flex',
    gap: '8px',
  },
  transferConfirmBtn: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a4a2a',
    background: 'none',
    border: '1px solid #c8bfaf',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
  },
  transferCancelBtn: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    background: 'none',
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
  },
};
