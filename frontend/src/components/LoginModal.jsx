import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * LoginModal — inline modal overlay for phone OTP login and registration.
 * Props:
 *   - isOpen: boolean
 *   - onClose: () => void  (dismiss, return to guest browsing)
 *   - initialTab: 'login' | 'signup' (default 'login')
 *   - notice: optional string shown above the form (e.g. pending invite message)
 */
const LoginModal = ({ isOpen, onClose, initialTab = 'login', notice }) => {
  const { sendCode, phoneRegister, phoneLogin } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Shared state
  const [step, setStep] = useState(1);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Sign Up only
  const [username, setUsername] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [ageVerified, setAgeVerified] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Reset when initialTab changes (e.g. opened from different trigger)
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      resetForm();
    }
  }, [isOpen, initialTab]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Escape key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      window.document.addEventListener('keydown', handleKeyDown);
      return () => window.document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  const resetForm = () => {
    setStep(1);
    setPhoneDigits('');
    setCode('');
    setUsername('');
    setSignUpEmail('');
    setAgeVerified(false);
    setEmailError('');
    setError('');
    setLoading(false);
    setResendCooldown(0);
  };

  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    resetForm();
  };

  const handlePhoneChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 10);
    setPhoneDigits(raw);
  };

  const handleCodeChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(raw);
  };

  const handleSendCode = async () => {
    setError('');
    if (phoneDigits.length !== 10) {
      setError('Enter a 10-digit phone number');
      return;
    }
    if (activeTab === 'signup' && !username.trim()) {
      setError('Username is required');
      return;
    }
    setLoading(true);
    try {
      await sendCode('+1' + phoneDigits);
      setStep(2);
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send code');
    }
    setLoading(false);
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      await sendCode('+1' + phoneDigits);
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    }
    setLoading(false);
  };

  const handleVerifyLogin = async () => {
    setError('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setLoading(true);
    const result = await phoneLogin('+1' + phoneDigits, code);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const isEmailValid = (val) => {
    const at = val.indexOf('@');
    return at > 0 && val.indexOf('.', at) !== -1;
  };

  const handleVerifyRegister = async () => {
    setError('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setLoading(true);
    const result = await phoneRegister('+1' + phoneDigits, code, username, signUpEmail, ageVerified);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  const renderLoginStep1 = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Phone number</label>
        <div style={styles.phoneRow}>
          <span style={styles.phonePrefix}>+1</span>
          <input
            type="text"
            value={phoneDigits}
            onChange={handlePhoneChange}
            placeholder="Phone number"
            style={styles.phoneInput}
            disabled={loading}
            autoFocus
          />
        </div>
      </div>
      <button
        onClick={handleSendCode}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Sending...' : 'Send Code'}
      </button>
    </div>
  );

  const renderLoginStep2 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Code sent to +1 {phoneDigits}</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <input
          type="text"
          value={code}
          onChange={handleCodeChange}
          placeholder="6-digit code"
          maxLength={6}
          style={styles.input}
          disabled={loading}
          autoFocus
        />
      </div>
      <button
        onClick={handleVerifyLogin}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Verifying...' : 'Verify & Log In'}
      </button>
      <div style={styles.linksRow}>
        <span
          onClick={resendCooldown > 0 ? undefined : handleResendCode}
          style={resendCooldown > 0 ? { ...styles.link, ...styles.disabledLink } : styles.link}
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
        </span>
        <span
          onClick={() => { setStep(1); setCode(''); setError(''); setResendCooldown(0); }}
          style={styles.link}
        >
          Back
        </span>
      </div>
    </div>
  );

  const renderSignupStep1 = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.slice(0, 30))}
          placeholder="Username"
          maxLength={30}
          style={styles.input}
          disabled={loading}
          autoFocus
        />
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Phone number</label>
        <div style={styles.phoneRow}>
          <span style={styles.phonePrefix}>+1</span>
          <input
            type="text"
            value={phoneDigits}
            onChange={handlePhoneChange}
            placeholder="Phone number"
            style={styles.phoneInput}
            disabled={loading}
          />
        </div>
      </div>
      <button
        onClick={handleSendCode}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Sending...' : 'Send Code'}
      </button>
    </div>
  );

  const signupStep2Disabled = loading || code.length !== 6 || !signUpEmail.trim() || !isEmailValid(signUpEmail) || !ageVerified;

  const renderSignupStep2 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Code sent to +1 {phoneDigits}</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <input
          type="text"
          value={code}
          onChange={handleCodeChange}
          placeholder="6-digit code"
          maxLength={6}
          style={styles.input}
          disabled={loading}
          autoFocus
        />
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Email address</label>
        <input
          type="email"
          value={signUpEmail}
          onChange={(e) => { setSignUpEmail(e.target.value); setEmailError(''); }}
          onBlur={() => {
            if (signUpEmail.trim() && !isEmailValid(signUpEmail)) {
              setEmailError('Please enter a valid email address');
            }
          }}
          placeholder="Email address"
          style={styles.input}
          disabled={loading}
        />
        {emailError && <div style={{ fontSize: '13px', fontFamily: '"EB Garamond", Georgia, serif', color: '#c00', marginTop: '2px' }}>{emailError}</div>}
      </div>
      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={ageVerified}
          onChange={(e) => setAgeVerified(e.target.checked)}
          disabled={loading}
        />
        <span style={styles.checkboxLabel}>I confirm I am at least 18 years old</span>
      </label>
      <button
        onClick={handleVerifyRegister}
        style={signupStep2Disabled ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={signupStep2Disabled}
      >
        {loading ? 'Verifying...' : 'Verify & Create Account'}
      </button>
      <div style={styles.linksRow}>
        <span
          onClick={resendCooldown > 0 ? undefined : handleResendCode}
          style={resendCooldown > 0 ? { ...styles.link, ...styles.disabledLink } : styles.link}
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
        </span>
        <span
          onClick={() => { setStep(1); setCode(''); setError(''); setResendCooldown(0); }}
          style={styles.link}
        >
          Back
        </span>
      </div>
    </div>
  );

  return (
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={styles.modal}>
        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={activeTab === 'login' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => handleTabSwitch('login')}
          >
            Log In
          </button>
          <button
            style={activeTab === 'signup' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => handleTabSwitch('signup')}
          >
            Sign Up
          </button>
        </div>

        {/* Notice (e.g. pending invite) */}
        {notice && <div style={styles.notice}>{notice}</div>}

        {/* Login flow */}
        {activeTab === 'login' && step === 1 && renderLoginStep1()}
        {activeTab === 'login' && step === 2 && renderLoginStep2()}

        {/* Signup flow */}
        {activeTab === 'signup' && step === 1 && renderSignupStep1()}
        {activeTab === 'signup' && step === 2 && renderSignupStep2()}
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
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    backgroundColor: '#faf9f6',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    width: '100%',
    maxWidth: '380px',
    padding: '28px 32px 32px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #d0d0d0',
    marginBottom: '20px',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontWeight: '400',
  },
  tabActive: {
    color: '#333',
    borderBottomColor: '#333',
    fontWeight: '600',
  },
  notice: {
    padding: '10px 12px',
    backgroundColor: '#f5f0e8',
    border: '1px solid #e0d8c8',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    marginBottom: '16px',
    lineHeight: '1.4',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  label: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '500',
  },
  input: {
    padding: '8px 12px',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
    backgroundColor: '#fff',
    color: '#333',
  },
  phoneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  phonePrefix: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '500',
    userSelect: 'none',
  },
  phoneInput: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
    backgroundColor: '#fff',
    color: '#333',
  },
  submitBtn: {
    padding: '10px',
    fontSize: '15px',
    fontWeight: '500',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    marginTop: '4px',
  },
  disabledBtn: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    padding: '9px 12px',
    backgroundColor: '#fef0f0',
    color: '#c00',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  confirmText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    textAlign: 'center',
  },
  linksRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  disabledLink: {
    color: '#aaa',
    cursor: 'default',
    textDecoration: 'none',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  checkboxLabel: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
};

export default LoginModal;
