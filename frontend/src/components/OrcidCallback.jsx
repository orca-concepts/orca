import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';

const OrcidCallback = () => {
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus('error');
      setErrorMessage('You must be logged in to connect an ORCID');
      return;
    }

    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      setErrorMessage('ORCID authorization was denied or failed');
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMessage('No authorization code received from ORCID');
      return;
    }

    // If ORCID is already connected, this is a back-button loop:
    // user hit Back from profile → landed on orcid.org/authorize →
    // ORCID auto-redirected here with a fresh code. Go back 2 entries
    // to skip past both this callback and the orcid.org authorize page.
    if (user.orcidId) {
      window.history.go(-2);
      return;
    }

    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const exchangeCode = async () => {
      try {
        await authAPI.orcidCallback(code);
        await refreshUser();
        navigate(`/profile/${user.id}`, { replace: true });
      } catch (err) {
        exchangedRef.current = false;
        setStatus('error');
        setErrorMessage(err.response?.data?.error || 'Failed to connect ORCID');
      }
    };

    exchangeCode();
  }, [authLoading, user]);

  if (authLoading || status === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Connecting your ORCID...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <p style={styles.errorText}>{errorMessage}</p>
        <button onClick={() => navigate('/', { replace: true })} style={styles.continueButton}>
          Continue to Orca
        </button>
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
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
  },
  loadingText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  errorText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    lineHeight: '1.5',
    margin: '0 0 16px 0',
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

export default OrcidCallback;
