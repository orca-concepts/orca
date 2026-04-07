import React, { useState } from 'react';

/**
 * AnnotationWarningModal — shown before creating an annotation
 * to warn users that annotations are permanent.
 *
 * Props:
 *   onConfirm(dontShowAgain: boolean) — called when user clicks "Create annotation"
 *   onCancel() — called when user clicks "Cancel"
 */
const AnnotationWarningModal = ({ onConfirm, onCancel }) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.title}>Annotations are permanent</div>
        <div style={styles.body}>
          Once created, annotations cannot be edited or removed. This is by design
          — Orca uses an append-only model where quality is curated through voting,
          not deletion. Please make sure your annotation is accurate before proceeding.
        </div>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={e => setDontShowAgain(e.target.checked)}
            style={styles.checkbox}
          />
          Don't show this again
        </label>
        <div style={styles.buttons}>
          <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
          <button onClick={() => onConfirm(dontShowAgain)} style={styles.confirmBtn}>
            Create annotation
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    fontFamily: "'EB Garamond', serif",
  },
  modal: {
    backgroundColor: '#fafaf7',
    border: '1px solid #ccc',
    borderRadius: 6,
    padding: '28px 32px',
    maxWidth: 440,
    width: '90%',
    fontFamily: "'EB Garamond', serif",
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 14,
    fontFamily: "'EB Garamond', serif",
  },
  body: {
    fontSize: 15,
    lineHeight: 1.55,
    color: '#333',
    marginBottom: 18,
    fontFamily: "'EB Garamond', serif",
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    color: '#555',
    marginBottom: 20,
    cursor: 'pointer',
    fontFamily: "'EB Garamond', serif",
  },
  checkbox: {
    cursor: 'pointer',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    padding: '7px 18px',
    border: '1px solid #ccc',
    borderRadius: 4,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: "'EB Garamond', serif",
  },
  confirmBtn: {
    padding: '7px 18px',
    border: '1px solid #999',
    borderRadius: 4,
    backgroundColor: '#333',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: "'EB Garamond', serif",
  },
};

export default AnnotationWarningModal;
