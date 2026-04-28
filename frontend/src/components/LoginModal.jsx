import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CURRENT_TOS_VERSION } from '../config/constants';

/**
 * LoginModal — inline modal overlay for password login, phone OTP registration, and forgot password.
 * Props:
 *   - isOpen: boolean
 *   - onClose: () => void  (dismiss, return to guest browsing)
 *   - initialTab: 'login' | 'signup' (default 'login')
 *   - notice: optional string shown above the form (e.g. pending invite message)
 */
const LoginModal = ({ isOpen, onClose, initialTab = 'login', notice }) => {
  const { login, sendCode, phoneRegister, forgotPasswordSendCode, forgotPasswordReset } = useAuth();

  // 'login' | 'signup' | 'forgot'
  const [mode, setMode] = useState(initialTab === 'signup' ? 'signup' : 'login');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Signup state
  const [signupStep, setSignupStep] = useState(1); // 1=phone, 2=OTP, 3=details
  const [phoneDigits, setPhoneDigits] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirm, setSignUpConfirm] = useState('');
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  // Forgot state
  const [forgotStep, setForgotStep] = useState(1); // 1=phone, 2=OTP, 3=new password
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Shared state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Reset when opened or initialTab changes
  useEffect(() => {
    if (isOpen) {
      setMode(initialTab === 'signup' ? 'signup' : 'login');
      resetAll();
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

  const resetAll = () => {
    setIdentifier('');
    setPassword('');
    setShowPassword(false);
    setSignupStep(1);
    setPhoneDigits('');
    setCode('');
    setUsername('');
    setSignUpEmail('');
    setSignUpPassword('');
    setSignUpConfirm('');
    setShowSignUpPassword(false);
    setTosAccepted(false);
    setForgotStep(1);
    setForgotPhone('');
    setForgotCode('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setShowNewPassword(false);
    setError('');
    setLoading(false);
    setResendCooldown(0);
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    resetAll();
  };

  const handlePhoneChange = (value, setter) => {
    setter(value.replace(/\D/g, '').slice(0, 10));
  };

  const handleCodeChange = (value, setter) => {
    setter(value.replace(/\D/g, '').slice(0, 6));
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ── LOGIN ──
  const handleLogin = async (e) => {
    e && e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Username/email and password are required');
      return;
    }
    setLoading(true);
    const result = await login(identifier.trim(), password);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── SIGNUP Step 1: Send code ──
  const handleSignupSendCode = async () => {
    setError('');
    if (phoneDigits.length !== 10) {
      setError('Enter a 10-digit phone number');
      return;
    }
    setLoading(true);
    try {
      await sendCode('+1' + phoneDigits, 'register');
      setSignupStep(2);
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send code');
    }
    setLoading(false);
  };

  // ── SIGNUP Step 2: Verify code ──
  const handleSignupVerifyCode = async () => {
    setError('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    // Move to step 3 (details) — code verification happens on final submit
    setSignupStep(3);
  };

  // ── SIGNUP Step 3: Create account ──
  const handleSignupCreate = async () => {
    setError('');
    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!signUpEmail.trim()) {
      setError('Email address is required');
      return;
    }
    const atIdx = signUpEmail.indexOf('@');
    if (atIdx < 1 || signUpEmail.indexOf('.', atIdx) === -1) {
      setError('Please enter a valid email address');
      return;
    }
    if (!signUpPassword) {
      setError('Password is required');
      return;
    }
    if (signUpPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (signUpPassword !== signUpConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (!tosAccepted) {
      setError('You must accept the Terms of Service and Privacy Policy');
      return;
    }
    setLoading(true);
    const result = await phoneRegister('+1' + phoneDigits, code, username.trim(), signUpEmail.trim(), signUpPassword, tosAccepted, CURRENT_TOS_VERSION);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── SIGNUP resend ──
  const handleSignupResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      await sendCode('+1' + phoneDigits, 'register');
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    }
    setLoading(false);
  };

  // ── FORGOT Step 1: Send code ──
  const handleForgotSendCode = async () => {
    setError('');
    if (forgotPhone.length !== 10) {
      setError('Enter a 10-digit phone number');
      return;
    }
    setLoading(true);
    try {
      await forgotPasswordSendCode('+1' + forgotPhone);
      setForgotStep(2);
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send code');
    }
    setLoading(false);
  };

  // ── FORGOT Step 2: Verify code ──
  const handleForgotVerifyCode = async () => {
    setError('');
    if (forgotCode.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setForgotStep(3);
  };

  // ── FORGOT Step 3: Reset password ──
  const handleForgotReset = async () => {
    setError('');
    if (!newPassword) {
      setError('New password is required');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    const result = await forgotPasswordReset('+1' + forgotPhone, forgotCode, newPassword);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── FORGOT resend ──
  const handleForgotResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      await forgotPasswordSendCode('+1' + forgotPhone);
      setResendCooldown(30);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  const passwordToggle = (show, setShow) => (
    <span
      onClick={() => setShow(!show)}
      style={styles.passwordToggle}
    >
      {show ? 'Hide' : 'Show'}
    </span>
  );

  // ── RENDER: Login ──
  const renderLogin = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Username or email</label>
        <input
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="Username or email"
          style={styles.input}
          disabled={loading}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Password</label>
        <div style={styles.passwordRow}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ ...styles.input, flex: 1 }}
            disabled={loading}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          {passwordToggle(showPassword, setShowPassword)}
        </div>
      </div>
      <button
        onClick={handleLogin}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Logging in...' : 'Log In'}
      </button>
      <div style={styles.linksRow}>
        <span onClick={() => switchMode('forgot')} style={styles.link}>Forgot password?</span>
      </div>
      <div style={styles.switchRow}>
        <span style={styles.switchText}>Don't have an account? </span>
        <span onClick={() => switchMode('signup')} style={styles.link}>Sign up</span>
      </div>
    </div>
  );

  // ── RENDER: Signup Step 1 (phone) ──
  const renderSignupStep1 = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Phone number</label>
        <div style={styles.phoneRow}>
          <span style={styles.phonePrefix}>+1</span>
          <input
            type="text"
            value={phoneDigits}
            onChange={(e) => handlePhoneChange(e.target.value, setPhoneDigits)}
            placeholder="Phone number"
            style={styles.phoneInput}
            disabled={loading}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSignupSendCode()}
          />
        </div>
      </div>
      <button
        onClick={handleSignupSendCode}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Sending...' : 'Send Code'}
      </button>
      <div style={styles.switchRow}>
        <span style={styles.switchText}>Already have an account? </span>
        <span onClick={() => switchMode('login')} style={styles.link}>Log in</span>
      </div>
    </div>
  );

  // ── RENDER: Signup Step 2 (OTP code) ──
  const renderSignupStep2 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Code sent to +1 {phoneDigits}</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <input
          type="text"
          value={code}
          onChange={(e) => handleCodeChange(e.target.value, setCode)}
          placeholder="6-digit code"
          maxLength={6}
          style={styles.input}
          disabled={loading}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleSignupVerifyCode()}
        />
      </div>
      <button
        onClick={handleSignupVerifyCode}
        style={code.length !== 6 ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={code.length !== 6}
      >
        Next
      </button>
      <div style={styles.linksRow}>
        <span
          onClick={resendCooldown > 0 ? undefined : handleSignupResend}
          style={resendCooldown > 0 ? { ...styles.link, ...styles.disabledLink } : styles.link}
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
        </span>
        <span
          onClick={() => { setSignupStep(1); setCode(''); setError(''); setResendCooldown(0); }}
          style={styles.link}
        >
          Back
        </span>
      </div>
    </div>
  );

  // ── RENDER: Signup Step 3 (details + password) ──
  const renderSignupStep3 = () => (
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
        <label style={styles.label}>Email address</label>
        <input
          type="email"
          value={signUpEmail}
          onChange={(e) => setSignUpEmail(e.target.value)}
          placeholder="Email address"
          style={styles.input}
          disabled={loading}
        />
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Password</label>
        <div style={styles.passwordRow}>
          <input
            type={showSignUpPassword ? 'text' : 'password'}
            value={signUpPassword}
            onChange={(e) => setSignUpPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            style={{ ...styles.input, flex: 1 }}
            disabled={loading}
          />
          {passwordToggle(showSignUpPassword, setShowSignUpPassword)}
        </div>
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Confirm password</label>
        <input
          type={showSignUpPassword ? 'text' : 'password'}
          value={signUpConfirm}
          onChange={(e) => setSignUpConfirm(e.target.value)}
          placeholder="Confirm password"
          style={styles.input}
          disabled={loading}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', lineHeight: 1.4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
          disabled={loading}
          style={{ marginTop: '3px', flexShrink: 0 }}
        />
        <span>
          I have read and agree to the{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</a>,{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</a>, and{' '}
          <a href="/copyright-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Copyright Policy</a>.
          I confirm I am at least 18 years old.
        </span>
      </label>
      <button
        onClick={handleSignupCreate}
        style={(loading || !tosAccepted) ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading || !tosAccepted}
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
      <div style={styles.linksRow}>
        <span
          onClick={() => { setSignupStep(2); setError(''); }}
          style={styles.link}
        >
          Back
        </span>
      </div>
    </div>
  );

  // ── RENDER: Forgot Step 1 (phone) ──
  const renderForgotStep1 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Enter the phone number associated with your account</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Phone number</label>
        <div style={styles.phoneRow}>
          <span style={styles.phonePrefix}>+1</span>
          <input
            type="text"
            value={forgotPhone}
            onChange={(e) => handlePhoneChange(e.target.value, setForgotPhone)}
            placeholder="Phone number"
            style={styles.phoneInput}
            disabled={loading}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleForgotSendCode()}
          />
        </div>
      </div>
      <button
        onClick={handleForgotSendCode}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Sending...' : 'Send Code'}
      </button>
      <div style={styles.linksRow}>
        <span onClick={() => switchMode('login')} style={styles.link}>Back to log in</span>
      </div>
    </div>
  );

  // ── RENDER: Forgot Step 2 (OTP code) ──
  const renderForgotStep2 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Code sent to +1 {forgotPhone}</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <input
          type="text"
          value={forgotCode}
          onChange={(e) => handleCodeChange(e.target.value, setForgotCode)}
          placeholder="6-digit code"
          maxLength={6}
          style={styles.input}
          disabled={loading}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleForgotVerifyCode()}
        />
      </div>
      <button
        onClick={handleForgotVerifyCode}
        style={forgotCode.length !== 6 ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={forgotCode.length !== 6}
      >
        Next
      </button>
      <div style={styles.linksRow}>
        <span
          onClick={resendCooldown > 0 ? undefined : handleForgotResend}
          style={resendCooldown > 0 ? { ...styles.link, ...styles.disabledLink } : styles.link}
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
        </span>
        <span
          onClick={() => { setForgotStep(1); setForgotCode(''); setError(''); setResendCooldown(0); }}
          style={styles.link}
        >
          Back
        </span>
      </div>
    </div>
  );

  // ── RENDER: Forgot Step 3 (new password) ──
  const renderForgotStep3 = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>New password</label>
        <div style={styles.passwordRow}>
          <input
            type={showNewPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            style={{ ...styles.input, flex: 1 }}
            disabled={loading}
            autoFocus
          />
          {passwordToggle(showNewPassword, setShowNewPassword)}
        </div>
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Confirm new password</label>
        <input
          type={showNewPassword ? 'text' : 'password'}
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          placeholder="Confirm new password"
          style={styles.input}
          disabled={loading}
          onKeyDown={(e) => e.key === 'Enter' && handleForgotReset()}
        />
      </div>
      <button
        onClick={handleForgotReset}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Resetting...' : 'Reset Password'}
      </button>
      <div style={styles.linksRow}>
        <span onClick={() => switchMode('login')} style={styles.link}>Back to log in</span>
      </div>
    </div>
  );

  // Mode title
  const modeTitle = mode === 'login' ? 'Log In' : mode === 'signup' ? 'Sign Up' : 'Reset Password';

  return (
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={styles.modal}>
        {/* Title */}
        <div style={styles.title}>{modeTitle}</div>

        {/* Notice (e.g. pending invite) */}
        {notice && <div style={styles.notice}>{notice}</div>}

        {/* Login */}
        {mode === 'login' && renderLogin()}

        {/* Signup */}
        {mode === 'signup' && signupStep === 1 && renderSignupStep1()}
        {mode === 'signup' && signupStep === 2 && renderSignupStep2()}
        {mode === 'signup' && signupStep === 3 && renderSignupStep3()}

        {/* Forgot Password */}
        {mode === 'forgot' && forgotStep === 1 && renderForgotStep1()}
        {mode === 'forgot' && forgotStep === 2 && renderForgotStep2()}
        {mode === 'forgot' && forgotStep === 3 && renderForgotStep3()}
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
  title: {
    fontSize: '20px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    textAlign: 'center',
    marginBottom: '20px',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
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
  passwordRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  passwordToggle: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
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
  switchRow: {
    textAlign: 'center',
    marginTop: '4px',
  },
  switchText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
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
