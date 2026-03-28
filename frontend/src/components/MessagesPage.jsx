import React, { useState, useEffect, useCallback } from 'react';
import { messagesAPI } from '../services/api';
import MessageThread from './MessageThread';

/**
 * MessagesPage — Phase 31b/c
 *
 * Three-level page-by-page drill-down for annotation-based messaging:
 *   Level 1: Documents grouped under collapsible "My Documents" / "Others' Documents" sections
 *   Level 2: Annotations within a document
 *   Level 3: Threads within an annotation
 *   Thread view: Chat conversation for a single thread
 *
 * Props:
 *   - onBack: callback to close the Messages page
 */
const MessagesPage = ({ onBack, initialAnnotationId, initialAnnotationIds, onInitialAnnotationConsumed, onRefreshUnread }) => {
  // Drill-down state: { level: 'docs'|'annotations'|'threads'|'thread', document?, annotation?, threadId? }
  const [nav, setNav] = useState({ level: 'docs' });

  // Data
  const [myDocsData, setMyDocsData] = useState(null);
  const [othersDocsData, setOthersDocsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Collapsible sections — both expanded by default
  const [myDocsExpanded, setMyDocsExpanded] = useState(true);
  const [othersDocsExpanded, setOthersDocsExpanded] = useState(true);

  const loadTopLevel = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [myRes, othersRes] = await Promise.all([
        messagesAPI.getThreads('my_docs').catch(() => ({ data: { documents: [] } })),
        messagesAPI.getThreads('others_docs').catch(() => ({ data: { documents: [] } })),
      ]);
      setMyDocsData(myRes.data.documents || []);
      setOthersDocsData(othersRes.data.documents || []);
    } catch (err) {
      setError('Failed to load messages');
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopLevel();
  }, [loadTopLevel]);

  // Auto-navigate to a specific annotation's threads when deep-linked
  useEffect(() => {
    if (!initialAnnotationId || loading || !myDocsData || !othersDocsData) return;
    // Build set of annotation IDs to search for (includes equivalent annotations across versions)
    const searchIds = new Set([initialAnnotationId, ...(initialAnnotationIds || [])]);
    // Search both sections for any matching annotation
    for (const docs of [myDocsData, othersDocsData]) {
      for (const doc of docs) {
        // Check both annotation_id and annotation_ids array (version-aware grouping)
        const ann = doc.annotations?.find(a =>
          searchIds.has(a.annotation_id) ||
          (a.annotation_ids && a.annotation_ids.some(id => searchIds.has(id)))
        );
        if (ann) {
          setNav({ level: 'threads', document: doc, annotation: ann });
          if (onInitialAnnotationConsumed) onInitialAnnotationConsumed();
          return;
        }
      }
    }
    // Annotation not found in threads data — consume anyway to avoid loops
    if (onInitialAnnotationConsumed) onInitialAnnotationConsumed();
  }, [initialAnnotationId, initialAnnotationIds, loading, myDocsData, othersDocsData, onInitialAnnotationConsumed]);

  const sectionUnread = (docs) =>
    (docs || []).reduce((sum, d) => sum + (d.unread_count || 0), 0);

  // Navigation helpers
  const goToDocument = (doc) => setNav({ level: 'annotations', document: doc });
  const goToAnnotation = (doc, ann) => setNav({ level: 'threads', document: doc, annotation: ann });
  const goToThread = (doc, ann, threadId) => setNav({ level: 'thread', document: doc, annotation: ann, threadId });
  const goBack = () => {
    if (nav.level === 'thread') {
      setNav({ level: 'threads', document: nav.document, annotation: nav.annotation });
      // Immediately refresh unread count after reading a thread
      if (onRefreshUnread) onRefreshUnread();
    }
    else if (nav.level === 'threads') setNav({ level: 'annotations', document: nav.document });
    else if (nav.level === 'annotations') setNav({ level: 'docs' });
    else onBack();
  };

  // Truncate text helper
  const truncate = (text, max = 80) => {
    if (!text) return '(no quote)';
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined });
  };

  // ── Render Helpers ──

  const renderUnreadBadge = (count) => {
    if (!count || count <= 0) return null;
    return <span style={styles.unreadBadge}>{count}</span>;
  };

  // Render a document list section
  const renderDocSection = (label, docs, expanded, onToggle) => {
    const unread = sectionUnread(docs);
    const emptyText = label === 'My Documents'
      ? 'No threads on your documents yet.'
      : 'No threads on others\' documents yet.';
    return (
      <div style={styles.section}>
        <button
          style={styles.sectionHeader}
          onClick={onToggle}
        >
          <span style={styles.sectionToggle}>{expanded ? '▾' : '▸'}</span>
          <span style={styles.sectionLabel}>{label}</span>
          {renderUnreadBadge(unread)}
        </button>
        {expanded && (
          <div style={styles.sectionBody}>
            {(!docs || docs.length === 0) ? (
              <div style={styles.sectionEmpty}>{emptyText}</div>
            ) : (
              docs.map(doc => (
                <button
                  key={doc.document_id}
                  style={styles.listItem}
                  onClick={() => goToDocument(doc)}
                >
                  <span style={styles.listItemText}>{doc.document_title}</span>
                  <span style={styles.listItemRight}>
                    {renderUnreadBadge(doc.unread_count)}
                    <span style={styles.listItemArrow}>▸</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Level 1: Documents grouped by section ──
  const renderDocuments = () => {
    const noThreads = (!myDocsData || myDocsData.length === 0) && (!othersDocsData || othersDocsData.length === 0);
    if (noThreads) {
      return (
        <div style={styles.emptyState}>
          No messages yet. Start a conversation from any annotation on a document.
        </div>
      );
    }
    return (
      <div style={styles.list}>
        {renderDocSection(
          'My Documents', myDocsData, myDocsExpanded,
          () => setMyDocsExpanded(prev => !prev)
        )}
        {renderDocSection(
          "Others' Documents", othersDocsData, othersDocsExpanded,
          () => setOthersDocsExpanded(prev => !prev)
        )}
      </div>
    );
  };

  // ── Level 2: Annotations within a document ──
  const renderAnnotations = () => {
    const annotations = nav.document?.annotations || [];
    if (annotations.length === 0) {
      return <div style={styles.emptyState}>No annotations with threads.</div>;
    }
    return (
      <div style={styles.list}>
        {annotations.map(ann => (
          <button
            key={ann.annotation_id}
            style={styles.listItem}
            onClick={() => goToAnnotation(nav.document, ann)}
          >
            <div style={styles.annotationPreview}>
              <span style={styles.annotationPath}>
                {(ann.path_names || []).map((name, i) => (
                  <span key={i}>
                    <span style={styles.pathSegment}>{name}</span>
                    <span style={styles.pathArrow}> → </span>
                  </span>
                ))}
                <span style={styles.conceptName}>{ann.concept_name}</span>
              </span>
              {ann.quote_text && (
                <span style={styles.quoteText}>{truncate(ann.quote_text)}</span>
              )}
              {ann.annotation_comment && (
                <span style={styles.commentText}>{truncate(ann.annotation_comment, 60)}</span>
              )}
            </div>
            <span style={styles.listItemRight}>
              {renderUnreadBadge(ann.unread_count)}
              <span style={styles.listItemArrow}>▸</span>
            </span>
          </button>
        ))}
      </div>
    );
  };

  // ── Level 3: Threads within an annotation ──
  const renderThreads = () => {
    const threads = nav.annotation?.threads || [];
    if (threads.length === 0) {
      return <div style={styles.emptyState}>No threads for this annotation.</div>;
    }
    return (
      <div style={styles.list}>
        {threads.map(t => (
          <button
            key={t.thread_id}
            style={styles.threadItem}
            onClick={() => goToThread(nav.document, nav.annotation, t.thread_id)}
          >
            <div style={styles.threadInfo}>
              <span style={styles.threadUsername}>{t.external_username}</span>
              <span style={styles.threadType}>
                {t.thread_type === 'to_authors' ? 'to authors' : 'to annotator'}
              </span>
            </div>
            <div style={styles.threadMeta}>
              <span style={styles.threadMessageCount}>
                {t.message_count} message{t.message_count !== 1 ? 's' : ''}
              </span>
              <span style={styles.threadTime}>{formatTime(t.last_message_at)}</span>
              {renderUnreadBadge(t.unread_count)}
            </div>
          </button>
        ))}
      </div>
    );
  };

  // ── Heading per level ──
  const getHeading = () => {
    if (nav.level === 'docs') return 'Messages';
    if (nav.level === 'annotations') return nav.document?.document_title || 'Document';
    if (nav.level === 'threads') return truncate(nav.annotation?.concept_name || nav.annotation?.quote_text, 40) || 'Annotation';
    return 'Messages';
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <h2 style={styles.heading}>Messages</h2>
        </div>
        <div style={styles.loadingText}>Loading messages...</div>
      </div>
    );
  }

  if (nav.level === 'thread') {
    return (
      <div style={styles.container}>
        <MessageThread
          threadId={nav.threadId}
          onBack={goBack}
        />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={goBack} style={styles.backButton}>← Back</button>
        <h2 style={styles.heading}>{getHeading()}</h2>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      <div style={styles.content}>
        {nav.level === 'docs' && renderDocuments()}
        {nav.level === 'annotations' && renderAnnotations()}
        {nav.level === 'threads' && renderThreads()}
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#faf9f7',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 20px 0 20px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  backButton: {
    padding: '6px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  heading: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  loadingText: {
    textAlign: 'center',
    padding: '60px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontSize: '15px',
  },
  errorBar: {
    padding: '8px 20px',
    margin: '10px 20px 0 20px',
    maxWidth: '1200px',
    backgroundColor: '#fff0f0',
    border: '1px solid #ecc',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#833',
  },
  content: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '16px 20px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  // Collapsible section styles
  section: {
    marginBottom: '12px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 4px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    fontWeight: '600',
    color: '#555',
    width: '100%',
    textAlign: 'left',
  },
  sectionToggle: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#999',
    width: '14px',
    display: 'inline-block',
  },
  sectionLabel: {
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingLeft: '20px',
  },
  sectionEmpty: {
    padding: '12px 0',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#aaa',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: 'white',
    border: '1px solid #e8e6e2',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
    textAlign: 'left',
    width: '100%',
  },
  listItemText: {
    flex: 1,
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
  },
  listItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  listItemArrow: {
    color: '#aaa',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unreadBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '20px',
    height: '20px',
    padding: '0 6px',
    borderRadius: '10px',
    backgroundColor: '#333',
    color: 'white',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#888',
  },
  annotationPreview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: 1,
    minWidth: 0,
  },
  annotationPath: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#888',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pathSegment: {
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  pathArrow: {
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
  },
  conceptName: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '700',
    color: '#333',
  },
  quoteText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#888',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  commentText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#888',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  threadItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: 'white',
    border: '1px solid #e8e6e2',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  threadInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  threadUsername: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
    fontWeight: '600',
  },
  threadType: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#aaa',
  },
  threadMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  threadMessageCount: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#888',
  },
  threadTime: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#aaa',
  },
};

export default MessagesPage;
