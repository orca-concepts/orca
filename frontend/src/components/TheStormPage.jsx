import React from 'react';

const TheStormPage = () => {
  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>The Storm</h1>
      <p style={styles.body}>
        This is placeholder text for the essay. The full essay will be added in a later phase.
      </p>
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
    fontWeight: 'normal',
    marginBottom: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  body: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default TheStormPage;
