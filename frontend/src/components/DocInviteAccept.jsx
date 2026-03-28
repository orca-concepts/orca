import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { corpusAPI } from '../services/api';
import LoginModal from './LoginModal';

/**
 * DocInviteAccept — handles /doc-invite/:token URLs.
 * If logged in: accepts the document co-author invite and shows success/error.
 * If guest: shows the login modal with a note about the pending invite.
 */
const DocInviteAccept = () => {
  const { token } = useParams();
  const { user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [documentId, setDocumentId] = useState(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (isGuest) {
      setStatus('needsAuth');
      setShowLogin(true);
      return;
    }

    acceptInvite();
  }, [authLoading, isGuest, token]);

  const acceptInvite = async () => {
    try {
      setStatus('loading');
      const res = await corpusAPI.acceptDocumentInvite(token);
      setStatus('success');
      setDocumentId(res.data.documentId || null);
      setMessage('You are now a co-author of this document.');
    } catch (err) {
      setStatus('error');
      const errorMsg = err.response?.data?.error || 'Failed to accept invite.';
      setMessage(errorMsg);
    }
  };

  if (authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Document Co-Author Invite</h2>

        {status === 'needsAuth' && (
          <p style={styles.loadingText}>Please log in or sign up to accept this invite.</p>
        )}

        {status === 'loading' && (
          <p style={styles.loadingText}>Accepting invite...</p>
        )}

        {status === 'success' && (
          <>
            <div style={styles.successIcon}>&#10003;</div>
            <p style={styles.successText}>{message}</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              style={styles.continueButton}
            >
              Continue to Orca
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <p style={styles.errorText}>{message}</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              style={styles.continueButton}
            >
              Continue to Orca
            </button>
          </>
        )}
      </div>

      <LoginModal
        isOpen={showLogin}
        onClose={() => { setShowLogin(false); navigate('/', { replace: true }); }}
        initialTab="login"
        notice="You have a pending document co-author invite. Log in or sign up to accept it."
      />
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
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
  },
  title: {
    margin: '0 0 20px 0',
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  loadingText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontStyle: 'normal',
  },
  successIcon: {
    fontSize: '36px',
    color: '#5a7a5a',
    marginBottom: '12px',
  },
  successText: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.5',
    margin: '0 0 20px 0',
  },
  errorText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    lineHeight: '1.5',
    margin: '0 0 20px 0',
  },
  continueButton: {
    padding: '8px 20px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default DocInviteAccept;
