import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { legalAPI } from '../services/api';

const InfringementNoticePage = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!body.trim()) { setError('Notice body is required.'); return; }
    try {
      setBusy(true);
      await legalAPI.submitInfringement({ name: name.trim(), email: email.trim(), body: body.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.container}>
        <button onClick={() => navigate('/legal')} style={styles.backLink}>← Legal</button>
        <h1 style={styles.heading}>Notice Submitted</h1>
        <p style={styles.body}>
          Your copyright infringement notice has been submitted. We will review it and
          respond to the email address you provided.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <button onClick={() => navigate('/legal')} style={styles.backLink}>← Legal</button>
      <h1 style={styles.heading}>Report Copyright Infringement</h1>
      <p style={styles.body}>
        If you believe that material on Orca infringes your copyright, you may submit a
        notification pursuant to the Digital Millennium Copyright Act (DMCA). Your notice
        should include the following elements:
      </p>
      <ol style={styles.list}>
        <li style={styles.listItem}>A clear description of the copyrighted work that you claim has been infringed (if multiple copyrighted works are covered by a single notification, you may provide a representative list of such works).</li>
        <li style={styles.listItem}>A description of the material on our website or within our service that you claim is infringing.</li>
        <li style={styles.listItem}>Information reasonably sufficient to permit us to locate the allegedly infringing material (please be as detailed as possible and provide web addresses (URLs) leading directly to the material).</li>
        <li style={styles.listItem}>Your contact information, including your address, telephone number, and an email address.</li>
        <li style={styles.listItem}>A statement that you have a good faith belief that use of the copyrighted materials in the manner asserted is not authorized by the copyright owner, its agent, or the law.</li>
        <li style={styles.listItem}>A statement that the information in the notification is accurate, and under penalty of perjury, that you are the copyright owner or authorized to act on the copyright owner's behalf.</li>
        <li style={styles.listItem}>Your physical or electronic signature (typing your full legal name is sufficient).</li>
      </ol>

      {error && <p style={styles.errorText}>{error}</p>}

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Full legal name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={styles.input}
          placeholder="Your full legal name"
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Email address</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={styles.input}
          placeholder="you@example.com"
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Notice</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          style={styles.textarea}
          rows={14}
          placeholder="Please include all the elements listed above in your notice."
        />
      </div>

      <button onClick={handleSubmit} disabled={busy} style={busy ? { ...styles.submitButton, opacity: 0.5 } : styles.submitButton}>
        {busy ? 'Submitting...' : 'Submit Notice'}
      </button>
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
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '16px',
  },
  list: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '24px',
    paddingLeft: '24px',
  },
  listItem: {
    marginBottom: '8px',
    lineHeight: 1.5,
  },
  errorText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    margin: '0 0 12px 0',
  },
  fieldGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  submitButton: {
    padding: '10px 24px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default InfringementNoticePage;
