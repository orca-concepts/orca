import React from 'react';

const PrivacyPage = () => {
  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <h1 style={styles.heading}>Privacy Policy</h1>
        <p style={styles.body}>
          This is a placeholder. The Privacy Policy is currently under legal review
          and will be published here before public launch.
        </p>
        <div style={styles.footer}>Last updated: 2026-04-25</div>
      </div>
    </div>
  );
};

const styles = {
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#faf9f6',
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 20px',
  },
  container: {
    maxWidth: '760px',
    width: '100%',
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
  body: {
    fontSize: '17px',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '32px',
  },
  footer: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    borderTop: '1px solid #d0d0d0',
    paddingTop: '12px',
  },
};

export default PrivacyPage;
