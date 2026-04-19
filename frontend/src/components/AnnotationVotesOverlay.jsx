import React, { useState, useEffect } from 'react';
import { votesAPI } from '../services/api';

/**
 * AnnotationVotesOverlay — Phase 51a: Annotation Votes sidebar view
 *
 * Full-page overlay listing every annotation the current user has voted for,
 * organized by Corpus -> Document with collapsible sections.
 *
 * Props:
 *   - onBack: callback to close the overlay
 *   - onOpenAnnotation: (corpusId, corpusName, documentId, annotationId) => void
 */
const AnnotationVotesOverlay = ({ onBack, onOpenAnnotation }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCorpuses, setExpandedCorpuses] = useState(new Set());
  const [expandedDocuments, setExpandedDocuments] = useState(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await votesAPI.getMyAnnotationVotes();
      const corpuses = response.data.corpuses;
      setData(corpuses);
      // Default: all expanded
      const corpusIds = new Set(corpuses.map(c => c.corpusId));
      const docKeys = new Set();
      for (const corpus of corpuses) {
        for (const doc of corpus.documents) {
          docKeys.add(`${corpus.corpusId}-${doc.documentId}`);
        }
      }
      setExpandedCorpuses(corpusIds);
      setExpandedDocuments(docKeys);
    } catch (err) {
      setError('Failed to load annotation votes');
      console.error('Failed to load annotation votes:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCorpus = (corpusId) => {
    setExpandedCorpuses(prev => {
      const next = new Set(prev);
      if (next.has(corpusId)) next.delete(corpusId);
      else next.add(corpusId);
      return next;
    });
  };

  const toggleDocument = (corpusId, documentId) => {
    const key = `${corpusId}-${documentId}`;
    setExpandedDocuments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAnnotationClick = (corpusId, corpusName, documentId, annotationId) => {
    if (onOpenAnnotation) {
      onOpenAnnotation(corpusId, corpusName, documentId, annotationId);
    }
  };

  // Count totals for a corpus
  const getCorpusCounts = (corpus) => {
    const docCount = corpus.documents.length;
    const annCount = corpus.documents.reduce((sum, doc) => sum + doc.annotations.length, 0);
    return { docCount, annCount };
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <h2 style={styles.heading}>Annotation Votes</h2>
        </div>
        <div style={styles.loadingState}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <h2 style={styles.heading}>Annotation Votes</h2>
        </div>
        <div style={styles.errorBar}>{error}</div>
      </div>
    );
  }

  const totalAnnotations = data ? data.reduce((sum, c) => sum + c.documents.reduce((s, d) => s + d.annotations.length, 0), 0) : 0;

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <h2 style={styles.heading}>Annotation Votes</h2>
      </div>

      <div style={styles.content}>
        {!data || data.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>You haven't voted for any annotations yet.</p>
            <p style={styles.emptySubtext}>
              Vote on annotations by clicking the ▲ button on annotation cards when viewing documents in a corpus tab.
            </p>
          </div>
        ) : (
          <div style={styles.listContainer}>
            <div style={styles.summaryText}>
              {totalAnnotations} annotation{totalAnnotations !== 1 ? 's' : ''} across {data.length} corpus{data.length !== 1 ? 'es' : ''}
            </div>
            {data.map(corpus => {
              const { docCount, annCount } = getCorpusCounts(corpus);
              const isCorpusExpanded = expandedCorpuses.has(corpus.corpusId);
              return (
                <div key={corpus.corpusId} style={styles.corpusSection}>
                  <div
                    style={styles.corpusHeader}
                    onClick={() => toggleCorpus(corpus.corpusId)}
                  >
                    <span style={styles.collapseArrow}>{isCorpusExpanded ? '▾' : '▸'}</span>
                    <span style={styles.corpusName}>{corpus.corpusName}</span>
                    <span style={styles.corpusCounts}>
                      {docCount} document{docCount !== 1 ? 's' : ''}, {annCount} annotation{annCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {isCorpusExpanded && corpus.documents.map(doc => {
                    const docKey = `${corpus.corpusId}-${doc.documentId}`;
                    const isDocExpanded = expandedDocuments.has(docKey);
                    return (
                      <div key={doc.documentId} style={styles.documentSection}>
                        <div
                          style={styles.documentHeader}
                          onClick={() => toggleDocument(corpus.corpusId, doc.documentId)}
                        >
                          <span style={styles.collapseArrow}>{isDocExpanded ? '▾' : '▸'}</span>
                          <span style={styles.documentTitle}>{doc.documentTitle}</span>
                          <span style={styles.documentCounts}>
                            {doc.annotations.length} annotation{doc.annotations.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {isDocExpanded && doc.annotations.map(ann => (
                          <div
                            key={ann.annotationId}
                            style={styles.annotationCard}
                            onClick={() => handleAnnotationClick(corpus.corpusId, corpus.corpusName, doc.documentId, ann.annotationId)}
                          >
                            <div style={styles.annotationConceptRow}>
                              <span style={styles.conceptName}>{ann.conceptName}</span>
                              <span style={styles.attributeBadge}>[{ann.attributeName}]</span>
                            </div>
                            {ann.quoteText && (
                              <div style={styles.quoteText}>
                                {ann.quoteText.length > 180 ? ann.quoteText.slice(0, 180) + '...' : ann.quoteText}
                              </div>
                            )}
                            <div style={styles.annotationMeta}>
                              ▲ {ann.voteCount} vote{ann.voteCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
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
  },
  backButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  heading: {
    margin: 0,
    fontSize: '22px',
    fontWeight: '600',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  content: {
    padding: '16px 20px',
    maxWidth: '900px',
  },
  loadingState: {
    textAlign: 'center',
    padding: '80px 20px',
    fontSize: '16px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  errorBar: {
    padding: '12px 20px',
    margin: '12px 20px',
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  emptyState: {
    textAlign: 'center',
    padding: '80px 20px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  emptyText: {
    fontSize: '20px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '8px',
  },
  emptySubtext: {
    fontSize: '15px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
    maxWidth: '500px',
    margin: '0 auto',
    lineHeight: 1.6,
  },
  listContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  summaryText: {
    fontSize: '14px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '8px',
  },
  corpusSection: {
    marginBottom: '8px',
  },
  corpusHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#f0eeea',
    borderRadius: '4px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  collapseArrow: {
    fontSize: '12px',
    color: '#888',
    width: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  corpusName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  corpusCounts: {
    fontSize: '13px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginLeft: 'auto',
  },
  documentSection: {
    marginLeft: '16px',
    marginTop: '4px',
  },
  documentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    backgroundColor: '#f7f5f2',
    borderRadius: '3px',
    cursor: 'pointer',
    userSelect: 'none',
  },
  documentTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#444',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  documentCounts: {
    fontSize: '12px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginLeft: 'auto',
  },
  annotationCard: {
    marginLeft: '20px',
    marginTop: '4px',
    padding: '8px 12px',
    backgroundColor: 'white',
    border: '1px solid #e8e6e2',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  annotationConceptRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
  },
  conceptName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  attributeBadge: {
    fontSize: '12px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  quoteText: {
    fontSize: '13px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: 1.5,
    marginBottom: '4px',
  },
  annotationMeta: {
    fontSize: '12px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default AnnotationVotesOverlay;
