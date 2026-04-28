import React from 'react';
import { useNavigate } from 'react-router-dom';

const LegalPage = () => {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Legal</h1>
      <div style={styles.linkList}>
        <button onClick={() => navigate('/terms')} style={styles.docLink}>
          <span style={styles.docTitle}>Terms of Service</span>
          <span style={styles.docDesc}>Rules governing use of Orca</span>
        </button>
        <button onClick={() => navigate('/privacy')} style={styles.docLink}>
          <span style={styles.docTitle}>Privacy Policy</span>
          <span style={styles.docDesc}>How we collect, use, and protect your data</span>
        </button>
        <button onClick={() => navigate('/copyright-policy')} style={styles.docLink}>
          <span style={styles.docTitle}>Copyright Policy</span>
          <span style={styles.docDesc}>DMCA procedures and copyright compliance</span>
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '760px',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: 1.6,
  },
  heading: {
    fontSize: '28px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '24px',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
  },
  linkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  docLink: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '16px 20px',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    backgroundColor: 'white',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  docTitle: {
    fontSize: '18px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  docDesc: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
};

export default LegalPage;
