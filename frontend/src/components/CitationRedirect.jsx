import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { citationsAPI } from '../services/api';
import LoginModal from './LoginModal';

/**
 * CitationRedirect handles /cite/a/:annotationId URLs.
 * If logged in: resolves the annotation and navigates to it in the corpus tab.
 * If guest: shows the login modal.
 */
const CitationRedirect = () => {
  const { annotationId } = useParams();
  const { user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading');
  const [showLogin, setShowLogin] = useState(false);
  const [citationData, setCitationData] = useState(null);

  useEffect(() => {
    if (authLoading) return;

    if (isGuest) {
      setStatus('needsAuth');
      setShowLogin(true);
      return;
    }

    resolveCitation();
  }, [authLoading, isGuest, annotationId]);

  const resolveCitation = async () => {
    try {
      setStatus('loading');
      const res = await citationsAPI.resolveCitation(annotationId);
      const data = res.data;
      if (data.found) {
        setCitationData(data);
        setStatus('resolved');
      } else {
        setStatus('notFound');
      }
    } catch (err) {
      console.error('Failed to resolve citation:', err);
      setStatus('error');
    }
  };

  const handleContinue = () => {
    if (citationData) {
      // Navigate to AppShell with pending citation in location state
      navigate('/', {
        replace: true,
        state: {
          pendingCitation: {
            corpusId: citationData.corpusId,
            corpusName: citationData.corpusName,
            documentId: citationData.documentId,
            annotationId: parseInt(annotationId, 10),
          },
        },
      });
    } else {
      navigate('/', { replace: true });
    }
  };

  if (authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.text}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Annotation Citation</h2>

        {status === 'needsAuth' && (
          <p style={styles.text}>Please log in to view this annotation.</p>
        )}

        {status === 'loading' && (
          <p style={styles.text}>Resolving citation...</p>
        )}

        {status === 'resolved' && citationData && (
          <>
            <p style={styles.text}>
              Found annotation on "{citationData.documentTitle}" in {citationData.corpusName}.
            </p>
            <button onClick={handleContinue} style={styles.continueBtn}>
              View annotation →
            </button>
          </>
        )}

        {status === 'notFound' && (
          <>
            <p style={styles.text}>This annotation is no longer available.</p>
            <button onClick={() => navigate('/', { replace: true })} style={styles.continueBtn}>
              Continue to Orca
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <p style={styles.text}>Failed to resolve this citation.</p>
            <button onClick={() => navigate('/', { replace: true })} style={styles.continueBtn}>
              Continue to Orca
            </button>
          </>
        )}
      </div>

      <LoginModal
        isOpen={showLogin}
        onClose={() => { setShowLogin(false); navigate('/', { replace: true }); }}
        initialTab="login"
        notice="Log in to view this annotation."
      />
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#faf9f7',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  card: {
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '32px 40px',
    maxWidth: '420px',
    textAlign: 'center',
  },
  title: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '16px',
  },
  text: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#555',
    marginBottom: '16px',
  },
  continueBtn: {
    padding: '8px 20px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
  },
};

export default CitationRedirect;
