import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usersAPI, authAPI } from '../services/api';

const ProfilePage = () => {
  const { userId } = useParams();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState(null);

  // ORCID state
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [orcidBusy, setOrcidBusy] = useState(false);
  const [orcidError, setOrcidError] = useState(null);
  const [orcidSuccess, setOrcidSuccess] = useState(null);

  // Dev-mode ORCID input
  const [devOrcidInput, setDevOrcidInput] = useState('');

  const isOwnProfile = user && String(user.id) === String(userId);
  const isDev = import.meta.env.MODE !== 'production';

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoadingProfile(true);
        setError(null);
        const res = await usersAPI.getUserProfile(userId);
        setProfile(res.data);
      } catch (err) {
        if (err.response?.status === 404) {
          setError('User not found');
        } else {
          setError('Failed to load profile');
        }
      } finally {
        setLoadingProfile(false);
      }
    };
    loadProfile();
  }, [userId]);

  const handleConnectOrcid = async () => {
    try {
      setOrcidBusy(true);
      setOrcidError(null);
      const res = await authAPI.getOrcidAuthorizeUrl();
      window.location.href = res.data.url;
    } catch (err) {
      setOrcidError(err.response?.data?.error || 'Failed to initiate ORCID connection');
      setOrcidBusy(false);
    }
  };

  const handleDisconnectOrcid = async () => {
    try {
      setOrcidBusy(true);
      setOrcidError(null);
      await authAPI.disconnectOrcid();
      setProfile(prev => ({ ...prev, orcidId: null }));
      await refreshUser();
      setDisconnectConfirm(false);
      setOrcidSuccess('ORCID disconnected');
      setTimeout(() => setOrcidSuccess(null), 2000);
    } catch (err) {
      setOrcidError(err.response?.data?.error || 'Failed to disconnect ORCID');
    } finally {
      setOrcidBusy(false);
    }
  };

  const handleDevConnect = async () => {
    if (!devOrcidInput.trim()) return;
    try {
      setOrcidBusy(true);
      setOrcidError(null);
      const res = await authAPI.devConnectOrcid(devOrcidInput.trim());
      setProfile(prev => ({ ...prev, orcidId: res.data.orcidId }));
      await refreshUser();
      setDevOrcidInput('');
      setOrcidSuccess('ORCID set successfully');
      setTimeout(() => setOrcidSuccess(null), 2000);
    } catch (err) {
      setOrcidError(err.response?.data?.error || 'Failed to set ORCID');
    } finally {
      setOrcidBusy(false);
    }
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (loadingProfile || authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.mutedText}>Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.errorText}>{error}</p>
          <button onClick={() => navigate('/')} style={styles.backLink}>← Back to Orca</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <button onClick={() => navigate(-1)} style={styles.backLink}>← Back</button>

        <h1 style={styles.username}>{profile.username}</h1>

        {profile.orcidId && (
          <div style={styles.orcidRow}>
            <span style={styles.orcidBadge}>iD</span>
            <a
              href={`https://orcid.org/${profile.orcidId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.orcidLink}
            >
              {profile.orcidId}
            </a>
          </div>
        )}

        <p style={styles.mutedText}>Member since {formatDate(profile.createdAt)}</p>
        <p style={styles.mutedText}>
          {profile.corpusCount} {profile.corpusCount === 1 ? 'corpus' : 'corpuses'} created
          {' · '}
          {profile.documentCount} {profile.documentCount === 1 ? 'document' : 'documents'} uploaded
        </p>

        {isOwnProfile && (
          <div style={styles.orcidSection}>
            {orcidError && <p style={styles.errorText}>{orcidError}</p>}
            {orcidSuccess && <p style={styles.successText}>{orcidSuccess}</p>}

            {!profile.orcidId ? (
              <button
                onClick={handleConnectOrcid}
                disabled={orcidBusy}
                style={styles.connectButton}
              >
                {orcidBusy ? 'Connecting...' : 'Connect ORCID'}
              </button>
            ) : (
              <div>
                {!disconnectConfirm ? (
                  <button
                    onClick={() => setDisconnectConfirm(true)}
                    style={styles.disconnectLink}
                  >
                    Disconnect ORCID
                  </button>
                ) : (
                  <div style={styles.confirmRow}>
                    <span style={styles.mutedText}>Remove your ORCID connection?</span>
                    <button onClick={handleDisconnectOrcid} disabled={orcidBusy} style={styles.confirmButton}>Confirm</button>
                    <button onClick={() => setDisconnectConfirm(false)} style={styles.cancelButton}>Cancel</button>
                  </div>
                )}
              </div>
            )}

            {isDev && (
              <div style={styles.devSection}>
                <p style={styles.devLabel}>Dev: Set ORCID manually</p>
                <div style={styles.devRow}>
                  <input
                    type="text"
                    value={devOrcidInput}
                    onChange={e => setDevOrcidInput(e.target.value)}
                    placeholder="0000-0001-2345-6789"
                    style={styles.devInput}
                  />
                  <button onClick={handleDevConnect} disabled={orcidBusy} style={styles.devButton}>Set</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#faf9f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    padding: '32px 40px',
    maxWidth: '520px',
    width: '100%',
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: 0,
    marginBottom: '20px',
    display: 'block',
  },
  username: {
    margin: '0 0 12px 0',
    fontSize: '28px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  orcidRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '12px',
  },
  orcidBadge: {
    display: 'inline-block',
    backgroundColor: '#a6ce39',
    color: 'white',
    fontSize: '10px',
    fontWeight: '700',
    fontFamily: 'sans-serif',
    padding: '1px 4px',
    borderRadius: '3px',
    lineHeight: '1.2',
  },
  orcidLink: {
    color: '#333',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    textDecoration: 'none',
  },
  mutedText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    margin: '0 0 6px 0',
    lineHeight: '1.5',
  },
  errorText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    margin: '0 0 8px 0',
  },
  successText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a7a5a',
    margin: '0 0 8px 0',
  },
  orcidSection: {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e0e0e0',
  },
  connectButton: {
    padding: '8px 20px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  disconnectLink: {
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: 0,
    textDecoration: 'underline',
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  confirmButton: {
    padding: '4px 12px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  cancelButton: {
    padding: '4px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#333',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  devSection: {
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: '1px dashed #ddd',
  },
  devLabel: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    margin: '0 0 8px 0',
  },
  devRow: {
    display: 'flex',
    gap: '8px',
  },
  devInput: {
    flex: 1,
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  devButton: {
    padding: '6px 14px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#333',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default ProfilePage;
