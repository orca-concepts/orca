import React, { useState, useEffect } from 'react';
import { corpusAPI } from '../services/api';

/**
 * AnnotateFromGraphPicker — lightweight picker modal.
 *
 * Lists subscribed corpuses with their documents. Shows existing annotations for
 * the current concept on each document to help prevent duplicates.
 * Clicking a document triggers navigation to the corpus tab doc viewer
 * with the annotation creation panel pre-loaded.
 */
const AnnotateFromGraphPicker = ({ isOpen, onClose, onSelectDocument, conceptId, conceptName, edgeId }) => {
  const [corpuses, setCorpuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedCorpusId, setExpandedCorpusId] = useState(null);
  const [corpusDocuments, setCorpusDocuments] = useState({}); // corpusId -> docs array
  const [corpusDocsLoading, setCorpusDocsLoading] = useState({}); // corpusId -> bool
  const [docAnnotations, setDocAnnotations] = useState({}); // "corpusId-docId" -> annotations array

  // Load subscribed corpuses when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setCorpuses([]);
    setExpandedCorpusId(null);
    setCorpusDocuments({});
    setCorpusDocsLoading({});
    setDocAnnotations({});
    setLoading(true);
    corpusAPI.getMySubscriptions()
      .then(res => {
        const subs = res.data.subscriptions || res.data || [];
        setCorpuses(subs);
      })
      .catch(() => setCorpuses([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Load documents when corpus expanded
  const handleExpandCorpus = async (cId) => {
    if (expandedCorpusId === cId) {
      setExpandedCorpusId(null);
      return;
    }
    setExpandedCorpusId(cId);
    if (corpusDocuments[cId]) {
      // Already cached — just load annotations for these docs
      loadAnnotationsForDocs(cId, corpusDocuments[cId]);
      return;
    }
    setCorpusDocsLoading(prev => ({ ...prev, [cId]: true }));
    try {
      const res = await corpusAPI.getCorpus(cId);
      const docs = res.data.documents || [];
      setCorpusDocuments(prev => ({ ...prev, [cId]: docs }));
      loadAnnotationsForDocs(cId, docs);
    } catch {
      setCorpusDocuments(prev => ({ ...prev, [cId]: [] }));
    } finally {
      setCorpusDocsLoading(prev => ({ ...prev, [cId]: false }));
    }
  };

  // Load existing annotations for concept on each document
  const loadAnnotationsForDocs = async (cId, docs) => {
    if (!conceptId || !docs.length) return;
    const results = await Promise.all(
      docs.map(doc =>
        corpusAPI.getAnnotationsForConceptOnDocument(cId, doc.id, conceptId)
          .then(res => ({ docId: doc.id, annotations: res.data.annotations || [] }))
          .catch(() => ({ docId: doc.id, annotations: [] }))
      )
    );
    const newAnnotations = {};
    for (const r of results) {
      // Filter to only annotations matching the current edge (same context)
      const matching = edgeId
        ? r.annotations.filter(a => a.edge_id === edgeId)
        : r.annotations;
      if (matching.length > 0) {
        newAnnotations[`${cId}-${r.docId}`] = matching;
      }
    }
    setDocAnnotations(prev => ({ ...prev, ...newAnnotations }));
  };

  const handleDocClick = (cId, docId) => {
    onSelectDocument(cId, docId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Add "{conceptName}" as Annotation</div>
            <div style={styles.subtitle}>Select a document to annotate</div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          {loading && <div style={styles.hint}>Loading corpuses...</div>}
          {!loading && corpuses.length === 0 && (
            <div style={styles.hint}>No subscribed corpuses. Subscribe to a corpus first.</div>
          )}
          {corpuses.map(corpus => {
            const cId = corpus.corpus_id || corpus.id;
            const isExpanded = expandedCorpusId === cId;
            const docs = corpusDocuments[cId] || [];
            const docsLoading = corpusDocsLoading[cId];
            return (
              <div key={cId} style={styles.corpusSection}>
                <button
                  onClick={() => handleExpandCorpus(cId)}
                  style={styles.corpusRow}
                >
                  <span style={styles.expandArrow}>{isExpanded ? '▾' : '▸'}</span>
                  <span style={styles.corpusName}>{corpus.name}</span>
                  {corpus.document_count != null && (
                    <span style={styles.docCount}>
                      {corpus.document_count} doc{Number(corpus.document_count) !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div style={styles.docsContainer}>
                    {docsLoading && <div style={styles.hint}>Loading documents...</div>}
                    {!docsLoading && docs.length === 0 && (
                      <div style={styles.hint}>No documents in this corpus.</div>
                    )}
                    {!docsLoading && docs.map(doc => {
                      const key = `${cId}-${doc.id}`;
                      const existing = docAnnotations[key] || [];
                      return (
                        <div key={doc.id}>
                          <button
                            onClick={() => handleDocClick(cId, doc.id)}
                            style={styles.docCard}
                          >
                            <span style={styles.docTitle}>{doc.title}</span>
                            {doc.tag_name && (
                              <span style={styles.tagBadge}>{doc.tag_name}</span>
                            )}
                          </button>
                          {existing.length > 0 && (
                            <div style={styles.existingSection}>
                              <div style={styles.existingLabel}>
                                {existing.length} existing annotation{existing.length !== 1 ? 's' : ''} for this concept:
                              </div>
                              {existing.map(ann => (
                                <div key={ann.id} style={styles.existingItem}>
                                  {ann.quote_text && (
                                    <div style={styles.existingQuote}>
                                      "{ann.quote_text.length > 80 ? ann.quote_text.slice(0, 80) + '...' : ann.quote_text}"
                                    </div>
                                  )}
                                  {ann.comment && (
                                    <div style={styles.existingComment}>
                                      {ann.comment.length > 80 ? ann.comment.slice(0, 80) + '...' : ann.comment}
                                    </div>
                                  )}
                                  {!ann.quote_text && !ann.comment && (
                                    <div style={styles.existingComment}>(document-level annotation)</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    fontFamily: "'EB Garamond', serif",
  },
  modal: {
    backgroundColor: '#faf9f6',
    border: '1px solid #d0d0d0',
    borderRadius: '8px',
    width: '500px',
    maxWidth: '90vw',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'EB Garamond', serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '16px 20px 12px',
    borderBottom: '1px solid #eee',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    fontFamily: "'EB Garamond', serif",
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: '14px',
    color: '#888',
    fontFamily: "'EB Garamond', serif",
    marginTop: '2px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 0 0 12px',
    color: '#666',
    fontFamily: "'EB Garamond', serif",
  },
  body: {
    padding: '12px 20px 20px',
    overflowY: 'auto',
    flex: 1,
  },
  hint: {
    fontSize: '14px',
    color: '#888',
    fontFamily: "'EB Garamond', serif",
    padding: '8px 0',
  },
  corpusSection: {
    marginBottom: '4px',
  },
  corpusRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '8px 6px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #eee',
    cursor: 'pointer',
    fontFamily: "'EB Garamond', serif",
    fontSize: '15px',
    textAlign: 'left',
  },
  expandArrow: {
    marginRight: '8px',
    fontSize: '12px',
    color: '#666',
    width: '12px',
  },
  corpusName: {
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
    fontFamily: "'EB Garamond', serif",
  },
  docCount: {
    fontSize: '13px',
    color: '#999',
    fontFamily: "'EB Garamond', serif",
  },
  docsContainer: {
    paddingLeft: '20px',
    paddingTop: '4px',
    paddingBottom: '4px',
  },
  docCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 10px',
    background: 'none',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: "'EB Garamond', serif",
    fontSize: '14px',
    textAlign: 'left',
    marginBottom: '4px',
  },
  docTitle: {
    flex: 1,
    color: '#1a1a1a',
    fontFamily: "'EB Garamond', serif",
  },
  tagBadge: {
    fontSize: '11px',
    color: '#888',
    border: '1px solid #ddd',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: "'EB Garamond', serif",
    flexShrink: 0,
  },
  existingSection: {
    paddingLeft: '12px',
    marginBottom: '6px',
    borderLeft: '2px solid #eee',
    marginLeft: '10px',
  },
  existingLabel: {
    fontSize: '12px',
    color: '#999',
    fontFamily: "'EB Garamond', serif",
    padding: '2px 0 4px',
  },
  existingItem: {
    padding: '2px 0',
  },
  existingQuote: {
    fontSize: '12px',
    color: '#666',
    fontFamily: "'EB Garamond', serif",
  },
  existingComment: {
    fontSize: '12px',
    color: '#888',
    fontFamily: "'EB Garamond', serif",
  },
};

export default AnnotateFromGraphPicker;
