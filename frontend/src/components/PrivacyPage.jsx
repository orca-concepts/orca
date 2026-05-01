import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const PrivacyPage = () => {
  const navigate = useNavigate();
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/legal/privacy-policy.html')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={styles.container}>
      <button onClick={() => navigate('/legal')} style={styles.backLink}>← Legal</button>
      <h1 style={styles.heading}>Privacy Policy</h1>
      {error && (
        <p style={{ color: '#a00', fontFamily: '"EB Garamond", Georgia, serif' }}>
          Could not load the Privacy Policy. Please refresh, or contact orcaconcepts@gmail.com if the problem persists.
        </p>
      )}
      {!error && html === null && <p style={{ fontFamily: '"EB Garamond", Georgia, serif' }}>Loading...</p>}
      {!error && html !== null && (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '760px',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#111',
    lineHeight: 1.6,
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
  heading: {
    fontSize: '28px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '24px',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
  },
};

export default PrivacyPage;
