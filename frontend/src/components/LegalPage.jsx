import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const LegalPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Legal</h1>

      <h2 style={styles.subheading}>Policies</h2>
      <div style={styles.linkList}>
        <button onClick={() => navigate('/terms')} style={styles.docLink}>
          <span style={styles.docTitle}>Terms of Service</span>
          <span style={styles.docDesc}>Rules governing use of Orca</span>
        </button>
        <button onClick={() => navigate('/privacy')} style={styles.docLink}>
          <span style={styles.docTitle}>Privacy Policy</span>
          <span style={styles.docDesc}>How we collect, use, and protect your data</span>
        </button>
        <button onClick={() => navigate('/copyright')} style={styles.docLink}>
          <span style={styles.docTitle}>Copyright Policy</span>
          <span style={styles.docDesc}>DMCA procedures and copyright compliance</span>
        </button>
      </div>

      <h2 style={styles.subheading}>Copyright Notices</h2>
      <div style={styles.linkList}>
        <button onClick={() => navigate('/report-infringement')} style={styles.docLink}>
          <span style={styles.docTitle}>Report Copyright Infringement</span>
          <span style={styles.docDesc}>Submit a DMCA takedown notice</span>
        </button>
        <button onClick={() => navigate('/counter-notice')} style={styles.docLink}>
          <span style={styles.docTitle}>Submit a Counter-Notification</span>
          <span style={styles.docDesc}>Respond to a DMCA takedown affecting your content</span>
        </button>
      </div>

      {user?.isAdmin && (
        <>
          <h2 style={styles.subheading}>Administration</h2>
          <div style={styles.linkList}>
            <button onClick={() => navigate('/admin/legal')} style={styles.docLink}>
              <span style={styles.docTitle}>Legal Administration</span>
              <span style={styles.docDesc}>Review infringement notices, counter-notices, and removal history</span>
            </button>
          </div>
        </>
      )}
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
  subheading: {
    fontSize: '20px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    margin: '24px 0 12px 0',
    color: '#333',
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
