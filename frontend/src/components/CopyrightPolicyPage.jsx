import React from 'react';
import { useNavigate } from 'react-router-dom';

const CopyrightPolicyPage = () => {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <button onClick={() => navigate('/legal')} style={styles.backLink}>← Legal</button>
      <h1 style={styles.heading}>Copyright Policy</h1>
      <p style={styles.body}>
        This is a placeholder. The Copyright Policy is currently under legal review
        and will be published here before public launch.
      </p>
      <div style={styles.footer}>Last updated: 2026-04-28</div>
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

export default CopyrightPolicyPage;
