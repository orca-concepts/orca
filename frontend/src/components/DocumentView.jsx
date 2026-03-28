import React, { useState, useEffect } from 'react';
import { documentsAPI } from '../services/api';

const DocumentView = ({ documentId, onBack, onOpenCorpus }) => {
  const [document, setDocument] = useState(null);
  const [corpuses, setCorpuses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDocument();
  }, [documentId]);

  const loadDocument = async () => {
    try {
      setLoading(true);
      const res = await documentsAPI.getDocument(documentId);
      setDocument(res.data.document);
      setCorpuses(res.data.corpuses);
    } catch (err) {
      console.error('Failed to load document:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading document...</div>;
  }

  if (!document) {
    return <div style={styles.loading}>Document not found.</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
      </div>

      {/* Document info */}
      <div style={styles.docInfo}>
        <h2 style={styles.docTitle}>{document.title}</h2>
        <div style={styles.metaRow}>
          <span>{document.format}</span>
          <span style={styles.metaDot}>·</span>
          <span>uploaded by {document.uploader_username}</span>
          <span style={styles.metaDot}>·</span>
          <span>{new Date(document.created_at).toLocaleDateString()}</span>
        </div>

        {/* Corpus membership */}
        {corpuses.length > 0 && (
          <div style={styles.corpusList}>
            <span style={styles.corpusLabel}>In corpuses: </span>
            {corpuses.map((c, i) => (
              <React.Fragment key={c.id}>
                {i > 0 && <span style={styles.metaDot}>·</span>}
                <span
                  style={styles.corpusLink}
                  onClick={() => onOpenCorpus(c.id)}
                >
                  {c.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Document body */}
      <div style={styles.bodyContainer}>
        {document.format === 'markdown' ? (
          // For now, render markdown as preformatted text
          // A proper markdown renderer can be added later
          <pre style={styles.bodyTextPre}>{document.body}</pre>
        ) : (
          <div style={styles.bodyText}>{document.body}</div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  loading: {
    textAlign: 'center',
    padding: '60px',
    fontSize: '15px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '16px',
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
  docInfo: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '18px 22px',
    marginBottom: '20px',
  },
  docTitle: {
    margin: '0 0 6px 0',
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  metaRow: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  metaDot: {
    margin: '0 6px',
  },
  corpusList: {
    marginTop: '8px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
  },
  corpusLabel: {
    color: '#888',
  },
  corpusLink: {
    color: '#333',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
  },
  bodyContainer: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '24px 28px',
  },
  bodyText: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  bodyTextPre: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    margin: 0,
  },
};

export default DocumentView;
