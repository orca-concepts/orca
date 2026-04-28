import React, { useState, useEffect } from 'react';
import { adminAPI } from '../services/api';

const VALID_TARGET_TYPES = ['document_version', 'annotation', 'concept', 'edge', 'web_link', 'page_comment', 'moderation_comment'];

const AdminLegalRemovalsPanel = () => {
  const [infringers, setInfringers] = useState([]);
  const [notices, setNotices] = useState([]);
  const [counterNotices, setCounterNotices] = useState([]);
  const [removals, setRemovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Expand body text per row
  const [expandedNotices, setExpandedNotices] = useState({});
  const [expandedCounter, setExpandedCounter] = useState({});
  const [expandedRemovalNotes, setExpandedRemovalNotes] = useState({});
  const [expandedInfringerStrikes, setExpandedInfringerStrikes] = useState({});

  // Strike dismissal state
  const [clearingStrike, setClearingStrike] = useState(null); // strike id being dismissed
  const [clearReason, setClearReason] = useState('');
  const [clearSubmitting, setClearSubmitting] = useState(false);

  // Inline removal form state per notice
  const [activeForm, setActiveForm] = useState(null); // notice id
  const [formData, setFormData] = useState({ target_type: 'document_version', target_id: '', internal_notes: '' });
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  // Success result after removal
  const [removalResult, setRemovalResult] = useState(null); // { noticeId, email, username, removalId }
  const [copiedEmail, setCopiedEmail] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [infringersRes, noticesRes, counterRes, removalsRes] = await Promise.all([
        adminAPI.getRepeatInfringers(),
        adminAPI.getNotices(),
        adminAPI.getCounterNotices(),
        adminAPI.getRemovals(),
      ]);
      setInfringers(infringersRes.data.infringers || []);
      setNotices(noticesRes.data.notices || []);
      setCounterNotices(counterRes.data.counterNotices || []);
      setRemovals(removalsRes.data.removals || []);
      setError(null);
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Only administrators can access this page.');
      } else {
        setError('Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmitRemoval = async (noticeId) => {
    if (!formData.target_id) {
      setFormError('target_id is required');
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await adminAPI.legalRemove({
        target_type: formData.target_type,
        target_id: parseInt(formData.target_id),
        removal_reason: 'dmca',
        notice_reference: `copyright_infringement_notices.id=${noticeId}`,
        internal_notes: formData.internal_notes || null,
      });
      setRemovalResult({
        noticeId,
        email: res.data.affected_user_email,
        username: res.data.affected_username,
        removalId: res.data.legal_removal_id,
      });
      setActiveForm(null);
      setFormData({ target_type: 'document_version', target_id: '', internal_notes: '' });
      await loadData();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Removal failed');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleClearStrike = async (strikeId) => {
    if (!clearReason.trim()) return;
    setClearSubmitting(true);
    try {
      await adminAPI.clearStrike(strikeId, clearReason.trim());
      setClearingStrike(null);
      setClearReason('');
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to clear strike');
    } finally {
      setClearSubmitting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    });
  };

  const truncate = (text, max) => {
    if (!text || text.length <= max) return text || '';
    return text.slice(0, max) + '...';
  };

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleString();
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loadingText}>Loading...</p></div>;
  }

  if (error) {
    return <div style={styles.container}><p style={styles.errorText}>{error}</p></div>;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.pageTitle}>Legal Administration</h2>

      {/* Section 0: Repeat Infringers */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Repeat Infringers (3+ strikes / 12 months)</h3>
        {infringers.length === 0 ? (
          <p style={styles.emptyText}>No users at threshold.</p>
        ) : (
          <div style={styles.tableContainer}>
            {infringers.map(inf => (
              <div key={inf.user_id} style={styles.row}>
                <div style={styles.rowHeader}>
                  <span style={styles.rowId}>{inf.username}</span>
                  <span style={styles.rowMeta}>{inf.active_strike_count} active strike{inf.active_strike_count !== 1 ? 's' : ''}</span>
                  <span style={styles.rowDate}>Account created {formatDate(inf.account_created_at)}</span>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Email:</span>
                  <span style={styles.detailValue}>
                    {inf.email || 'none'}
                    {inf.email && (
                      <button
                        onClick={() => copyToClipboard(inf.email)}
                        style={styles.copyButton}
                      >
                        Copy
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <button
                    style={styles.expandButton}
                    onClick={() => setExpandedInfringerStrikes(prev => ({ ...prev, [inf.user_id]: !prev[inf.user_id] }))}
                  >
                    {expandedInfringerStrikes[inf.user_id] ? 'Hide strikes' : 'Show strikes'}
                  </button>
                </div>
                {expandedInfringerStrikes[inf.user_id] && (
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {inf.strikes.map(s => (
                      <div key={s.strike_id} style={{ padding: '8px', border: '1px solid #e0dcd6', borderRadius: '3px', backgroundColor: '#faf8f5' }}>
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Strike date:</span>
                          <span style={styles.detailValue}>{formatDate(s.struck_at)}</span>
                        </div>
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Removed:</span>
                          <span style={styles.detailValue}>{s.target_type} #{s.target_id} ({s.removal_reason})</span>
                        </div>
                        {s.notice_reference && (
                          <div style={styles.detailRow}>
                            <span style={styles.detailLabel}>Notice ref:</span>
                            <span style={styles.detailValue}>{s.notice_reference}</span>
                          </div>
                        )}
                        {s.internal_notes && (
                          <div style={styles.detailRow}>
                            <span style={styles.detailLabel}>Notes:</span>
                            <span style={styles.detailValue}>{truncate(s.internal_notes, 120)}</span>
                          </div>
                        )}
                        <div style={{ marginTop: '6px' }}>
                          {clearingStrike === s.strike_id ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                              <textarea
                                value={clearReason}
                                onChange={e => setClearReason(e.target.value)}
                                placeholder="Reason for dismissal"
                                rows={1}
                                style={styles.formTextarea}
                              />
                              <button
                                onClick={() => handleClearStrike(s.strike_id)}
                                disabled={clearSubmitting || !clearReason.trim()}
                                style={styles.submitButton}
                              >
                                {clearSubmitting ? 'Clearing...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => { setClearingStrike(null); setClearReason(''); }}
                                style={styles.cancelButton}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setClearingStrike(s.strike_id); setClearReason(''); }}
                              style={styles.removeButton}
                            >
                              Dismiss strike
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ ...styles.instructionBlock, marginTop: '12px' }}>
          <p style={styles.instructionText}>
            To suspend a user account, run the following manually in psql after reviewing their strike history above:
          </p>
          <p style={{ ...styles.instructionText, fontFamily: 'monospace', fontSize: '12px', marginTop: '6px' }}>
            UPDATE users SET &lt;suspension_column_name&gt; = NOW() WHERE id = &lt;user_id&gt;;
          </p>
          <p style={{ ...styles.instructionText, marginTop: '6px' }}>
            Then email the user from orcaconcepts@gmail.com explaining the suspension and appeal process.
          </p>
        </div>
      </section>

      {/* Section 1: Infringement Notices */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Incoming Infringement Notices</h3>
        {notices.length === 0 ? (
          <p style={styles.emptyText}>No infringement notices received.</p>
        ) : (
          <div style={styles.tableContainer}>
            {notices.map(notice => (
              <div key={notice.id} style={styles.row}>
                <div style={styles.rowHeader}>
                  <span style={styles.rowId}>#{notice.id}</span>
                  <span style={styles.rowDate}>{formatDate(notice.created_at)}</span>
                  <span style={styles.rowMeta}>{notice.submitter_name} ({notice.submitter_email})</span>
                </div>
                <div style={styles.rowBody}>
                  {expandedNotices[notice.id]
                    ? notice.body
                    : truncate(notice.body, 200)
                  }
                  {notice.body && notice.body.length > 200 && (
                    <button
                      style={styles.expandButton}
                      onClick={() => setExpandedNotices(prev => ({ ...prev, [notice.id]: !prev[notice.id] }))}
                    >
                      {expandedNotices[notice.id] ? 'Collapse' : 'Expand'}
                    </button>
                  )}
                </div>

                {/* Action area */}
                <div style={styles.actionArea}>
                  {notice.acted_on ? (
                    <span style={styles.actedOnBadge}>Acted on</span>
                  ) : (
                    <>
                      {activeForm === notice.id ? (
                        <div style={styles.inlineForm}>
                          <div style={styles.formRow}>
                            <label style={styles.formLabel}>Target type:</label>
                            <select
                              value={formData.target_type}
                              onChange={e => setFormData(prev => ({ ...prev, target_type: e.target.value }))}
                              style={styles.formSelect}
                            >
                              {VALID_TARGET_TYPES.map(t => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </div>
                          <div style={styles.formRow}>
                            <label style={styles.formLabel}>Target ID:</label>
                            <input
                              type="number"
                              value={formData.target_id}
                              onChange={e => setFormData(prev => ({ ...prev, target_id: e.target.value }))}
                              style={styles.formInput}
                              placeholder="e.g. 42"
                            />
                            <span style={styles.helperText}>Find in psql: SELECT id FROM concepts WHERE name = '...'</span>
                          </div>
                          <div style={styles.formRow}>
                            <label style={styles.formLabel}>Internal notes:</label>
                            <textarea
                              value={formData.internal_notes}
                              onChange={e => setFormData(prev => ({ ...prev, internal_notes: e.target.value }))}
                              style={styles.formTextarea}
                              rows={2}
                            />
                          </div>
                          {formError && <p style={styles.formError}>{formError}</p>}
                          <div style={styles.formButtons}>
                            <button
                              onClick={() => handleSubmitRemoval(notice.id)}
                              disabled={formSubmitting}
                              style={styles.submitButton}
                            >
                              {formSubmitting ? 'Removing...' : 'Submit removal'}
                            </button>
                            <button
                              onClick={() => { setActiveForm(null); setFormError(null); }}
                              style={styles.cancelButton}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setActiveForm(notice.id); setRemovalResult(null); }}
                          style={styles.removeButton}
                        >
                          Remove content
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Success result */}
                {removalResult && removalResult.noticeId === notice.id && (
                  <div style={styles.successBlock}>
                    <p style={styles.successTitle}>Content removed (removal #{removalResult.removalId})</p>
                    {removalResult.email ? (
                      <div style={styles.emailBlock}>
                        <span style={styles.emailLabel}>Affected user email:</span>
                        <span style={styles.emailValue}>{removalResult.email}</span>
                        <button
                          onClick={() => copyToClipboard(removalResult.email)}
                          style={styles.copyButton}
                        >
                          {copiedEmail ? 'Copied' : 'Copy'}
                        </button>
                        {removalResult.username && (
                          <span style={styles.emailMeta}>(username: {removalResult.username})</span>
                        )}
                      </div>
                    ) : (
                      <p style={styles.emailMeta}>No email on file for affected user (account may be deleted).</p>
                    )}
                    <div style={styles.reminderBlock}>
                      <p style={styles.reminderTitle}>Action required:</p>
                      <p style={styles.reminderText}>
                        Manually email this user from orcaconcepts@gmail.com to satisfy
                        {' '}
                        {'\u00A7'}512(g)(2)(A). Suggested template:
                      </p>
                      <p style={styles.templateText}>
                        "A copyright holder has filed a takedown notice for content you posted.
                        We have removed the content as required by federal law (17 U.S.C.
                        {' '}
                        {'\u00A7'}512). You may file a counter-notification if you believe this was in
                        error at https://orcaconcepts.org/counter-notice."
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Counter-Notices */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Counter-Notices</h3>
        <div style={styles.instructionBlock}>
          <p style={styles.instructionText}>
            Counter-notices are forwarded to the original copyright complainant manually. To process:
            (1) read the body to identify which infringement notice this responds to,
            (2) cross-reference with the Incoming Infringement Notices section above to find the original complainant's email,
            (3) forward the counter-notice to them from orcaconcepts@gmail.com,
            (4) wait 10 business days; if no court-action notification is received, restore the content
            via psql (UPDATE concepts SET is_hidden=false, legal_hold=false WHERE id=&lt;id&gt;;
            INSERT a note into legal_removals.restored_at and restored_reason).
          </p>
        </div>
        {counterNotices.length === 0 ? (
          <p style={styles.emptyText}>No counter-notices received.</p>
        ) : (
          <div style={styles.tableContainer}>
            {counterNotices.map(cn => (
              <div key={cn.id} style={styles.row}>
                <div style={styles.rowHeader}>
                  <span style={styles.rowId}>#{cn.id}</span>
                  <span style={styles.rowDate}>{formatDate(cn.created_at)}</span>
                  <span style={styles.rowMeta}>{cn.submitter_name} ({cn.submitter_email})</span>
                </div>
                <div style={styles.rowBody}>
                  {expandedCounter[cn.id]
                    ? cn.body
                    : truncate(cn.body, 400)
                  }
                  {cn.body && cn.body.length > 400 && (
                    <button
                      style={styles.expandButton}
                      onClick={() => setExpandedCounter(prev => ({ ...prev, [cn.id]: !prev[cn.id] }))}
                    >
                      {expandedCounter[cn.id] ? 'Collapse' : 'Expand'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Legal Removals Audit History */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Legal Removals (Audit History)</h3>
        <div style={styles.instructionBlock}>
          <p style={styles.instructionText}>
            Click "Mark notified" after you have sent the {'\u00A7'}512(g)(2)(A) notification email from orcaconcepts@gmail.com.
          </p>
        </div>
        {removals.length === 0 ? (
          <p style={styles.emptyText}>No legal removals recorded.</p>
        ) : (
          <div style={styles.tableContainer}>
            {removals.map(r => (
              <div key={r.id} style={styles.row}>
                <div style={styles.rowHeader}>
                  <span style={styles.rowId}>#{r.id}</span>
                  <span style={styles.rowDate}>{formatDate(r.removed_at)}</span>
                  <span style={styles.rowMeta}>
                    {r.target_type} #{r.target_id}
                    {' | '}
                    {r.removal_reason}
                  </span>
                </div>
                <div style={styles.rowDetails}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Notice ref:</span>
                    <span style={styles.detailValue}>{r.notice_reference || 'none'}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Affected user:</span>
                    <span style={styles.detailValue}>
                      {r.affected_username || '[deleted user]'}
                      {r.affected_email ? ` (${r.affected_email})` : ''}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Notes:</span>
                    <span style={styles.detailValue}>
                      {r.internal_notes
                        ? (expandedRemovalNotes[r.id]
                          ? r.internal_notes
                          : truncate(r.internal_notes, 100))
                        : 'none'}
                      {r.internal_notes && r.internal_notes.length > 100 && (
                        <button
                          style={styles.expandButton}
                          onClick={() => setExpandedRemovalNotes(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                        >
                          {expandedRemovalNotes[r.id] ? 'Collapse' : 'Expand'}
                        </button>
                      )}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Notified:</span>
                    <span style={styles.detailValue}>
                      {r.user_notified_at ? formatDate(r.user_notified_at) : (
                        <button
                          onClick={async () => {
                            try {
                              await adminAPI.markNotified(r.id);
                              await loadData();
                            } catch (err) {
                              alert(err.response?.data?.error || 'Failed to mark as notified');
                            }
                          }}
                          style={styles.removeButton}
                        >
                          Mark notified
                        </button>
                      )}
                    </span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Status:</span>
                    <span style={styles.detailValue}>
                      {r.restored_at
                        ? `Restored ${formatDate(r.restored_at)}${r.restored_reason ? ` — ${r.restored_reason}` : ''}`
                        : 'Active'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '24px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 'normal',
    marginBottom: '24px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'normal',
    marginBottom: '12px',
    paddingBottom: '6px',
    borderBottom: '1px solid #d4d0c8',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  loadingText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  errorText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  emptyText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontSize: '14px',
  },
  tableContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  row: {
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    padding: '12px',
    backgroundColor: '#faf8f5',
  },
  rowHeader: {
    display: 'flex',
    gap: '12px',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    marginBottom: '6px',
  },
  rowId: {
    fontWeight: 'bold',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  rowDate: {
    fontSize: '13px',
    color: '#777',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  rowMeta: {
    fontSize: '13px',
    color: '#555',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  rowBody: {
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#333',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '8px',
  },
  expandButton: {
    background: 'none',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: '12px',
    textDecoration: 'underline',
    marginLeft: '6px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: '0',
  },
  actionArea: {
    marginTop: '8px',
  },
  actedOnBadge: {
    fontSize: '13px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  removeButton: {
    padding: '4px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: 'transparent',
    border: '1px solid #999',
    borderRadius: '3px',
    cursor: 'pointer',
    color: '#333',
  },
  inlineForm: {
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    padding: '10px',
    backgroundColor: '#f5f3ef',
    marginTop: '4px',
  },
  formRow: {
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  formLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    minWidth: '90px',
    color: '#333',
  },
  formSelect: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: '3px 6px',
    border: '1px solid #999',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
  formInput: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: '3px 6px',
    border: '1px solid #999',
    borderRadius: '3px',
    width: '80px',
  },
  helperText: {
    fontSize: '11px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  formTextarea: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    padding: '4px 6px',
    border: '1px solid #999',
    borderRadius: '3px',
    width: '100%',
    maxWidth: '400px',
    resize: 'vertical',
  },
  formError: {
    fontSize: '13px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '6px',
  },
  formButtons: {
    display: 'flex',
    gap: '8px',
  },
  submitButton: {
    padding: '4px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: 'transparent',
    border: '1px solid #999',
    borderRadius: '3px',
    cursor: 'pointer',
    color: '#333',
  },
  cancelButton: {
    padding: '4px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: 'transparent',
    border: '1px solid #ccc',
    borderRadius: '3px',
    cursor: 'pointer',
    color: '#888',
  },
  successBlock: {
    marginTop: '10px',
    padding: '12px',
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    backgroundColor: '#faf8f5',
  },
  successTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '8px',
  },
  emailBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '10px',
    padding: '8px',
    backgroundColor: '#f0ede8',
    borderRadius: '3px',
  },
  emailLabel: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: 'bold',
  },
  emailValue: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: 'bold',
  },
  copyButton: {
    padding: '2px 8px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: 'transparent',
    border: '1px solid #999',
    borderRadius: '3px',
    cursor: 'pointer',
    color: '#333',
  },
  emailMeta: {
    fontSize: '13px',
    color: '#777',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  reminderBlock: {
    marginTop: '8px',
    padding: '8px',
    backgroundColor: '#f0ede8',
    borderRadius: '3px',
  },
  reminderTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '4px',
  },
  reminderText: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    marginBottom: '4px',
  },
  templateText: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    lineHeight: '1.5',
  },
  instructionBlock: {
    padding: '10px',
    backgroundColor: '#f5f3ef',
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    marginBottom: '12px',
  },
  instructionText: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    lineHeight: '1.6',
  },
  rowDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  detailRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  detailLabel: {
    color: '#777',
    minWidth: '90px',
    flexShrink: 0,
  },
  detailValue: {
    color: '#333',
    wordBreak: 'break-word',
  },
};

export default AdminLegalRemovalsPanel;
