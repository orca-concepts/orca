import React, { useState, useEffect, useRef } from 'react';
import { messagesAPI } from '../services/api';

/**
 * MessageThread — Phase 31c
 *
 * Chat-style conversation view for a single message thread.
 * On mount, calls getThread(threadId) which returns all messages
 * and auto-marks the thread as read on the backend.
 *
 * Props:
 *   - threadId: the thread to display
 *   - onBack: callback to return to the thread list
 */
const MessageThread = ({ threadId, onBack }) => {
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadThread();
  }, [threadId]);

  const loadThread = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await messagesAPI.getThread(threadId);
      setThread(res.data.thread);
      setMessages(res.data.messages || []);
    } catch (err) {
      setError('Failed to load thread');
      console.error('Failed to load thread:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendReply = async () => {
    if (!replyBody.trim() || sending) return;
    try {
      setSending(true);
      const res = await messagesAPI.replyToThread(threadId, replyBody.trim());
      setMessages(prev => [...prev, res.data.message]);
      setReplyBody('');
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined })
      + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateSeparator = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - msgDate) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined });
  };

  const getDateKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <span style={styles.headerTitle}>Thread</span>
        </div>
        <div style={styles.loadingText}>Loading thread...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <span style={styles.headerTitle}>Thread</span>
        </div>
        <div style={styles.errorText}>{error}</div>
      </div>
    );
  }

  const threadLabel = thread
    ? `${thread.external_username} — ${thread.thread_type === 'to_authors' ? 'to authors' : 'to annotator'}`
    : 'Thread';

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <span style={styles.headerTitle}>{threadLabel}</span>
      </div>

      {thread?.quote_text && (
        <div style={styles.quoteBar}>
          "{thread.quote_text.length > 120
            ? thread.quote_text.substring(0, 120) + '...'
            : thread.quote_text}"
        </div>
      )}

      <div style={styles.messageList}>
        {messages.length === 0 ? (
          <div style={styles.emptyMessages}>No messages in this thread.</div>
        ) : messages.map((msg, i) => {
          const showDateSep = i === 0 || getDateKey(msg.created_at) !== getDateKey(messages[i - 1].created_at);
          return (
            <React.Fragment key={msg.id}>
              {showDateSep && (
                <div style={styles.dateSeparator}>
                  <span style={styles.dateSeparatorLine} />
                  <span style={styles.dateSeparatorText}>{formatDateSeparator(msg.created_at)}</span>
                  <span style={styles.dateSeparatorLine} />
                </div>
              )}
              <div style={styles.message}>
                <div style={styles.messageMeta}>
                  <span style={styles.senderName}>{msg.sender_username}</span>
                  <span style={styles.messageTime}>{formatTimestamp(msg.created_at)}</span>
                </div>
                <div style={styles.messageBody}>{msg.body}</div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.replyBar}>
        <textarea
          style={styles.replyInput}
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={2}
        />
        <button
          onClick={handleSendReply}
          style={{
            ...styles.sendButton,
            ...((!replyBody.trim() || sending) ? styles.sendButtonDisabled : {}),
          }}
          disabled={!replyBody.trim() || sending}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#faf9f7',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderBottom: '1px solid #e8e6e2',
    backgroundColor: 'white',
  },
  backButton: {
    padding: '4px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  headerTitle: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
  },
  loadingText: {
    textAlign: 'center',
    padding: '40px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontSize: '15px',
  },
  errorText: {
    textAlign: 'center',
    padding: '40px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#833',
    fontSize: '15px',
  },
  quoteBar: {
    padding: '8px 16px',
    backgroundColor: '#f5f4f0',
    borderBottom: '1px solid #e8e6e2',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#888',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  emptyMessages: {
    textAlign: 'center',
    padding: '40px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontSize: '15px',
  },
  dateSeparator: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '4px 0',
  },
  dateSeparatorLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#e0ddd8',
  },
  dateSeparatorText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#aaa',
    whiteSpace: 'nowrap',
  },
  message: {
    padding: '10px 14px',
    backgroundColor: 'white',
    border: '1px solid #e8e6e2',
    borderRadius: '6px',
  },
  messageMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  senderName: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  messageTime: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#aaa',
  },
  messageBody: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  replyBar: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #e8e6e2',
    backgroundColor: 'white',
  },
  replyInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#333',
    resize: 'none',
    outline: 'none',
    backgroundColor: '#faf9f7',
  },
  sendButton: {
    padding: '8px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#333',
    alignSelf: 'flex-end',
  },
  sendButtonDisabled: {
    borderColor: '#ccc',
    color: '#ccc',
    cursor: 'default',
  },
};

export default MessageThread;
