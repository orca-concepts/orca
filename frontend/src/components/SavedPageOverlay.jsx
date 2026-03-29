import React, { useState, useEffect } from 'react';
import { votesAPI } from '../services/api';
import SavedTabContent from '../pages/SavedTabContent';

/**
 * SavedPageOverlay — Phase 38d: Flat Graph Votes Page with Corpus Badges
 *
 * Shows ALL user's graph votes in a single flat list (no corpus tabs).
 * Each tree card shows corpus badges if any concept in the tree appears
 * as an annotation in a subscribed corpus.
 *
 * Props:
 *   - onBack: callback to close the overlay and return to normal tab content
 *   - onOpenConceptTab: callback to open a concept in a new graph tab
 */
const SavedPageOverlay = ({ onBack, onOpenConceptTab }) => {
  const [saves, setSaves] = useState([]);
  const [conceptNames, setConceptNames] = useState({});
  const [conceptCorpusBadges, setConceptCorpusBadges] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const savesResponse = await votesAPI.getUserSavesByCorpus();
      const { saves: allSaves, conceptNames: names, conceptCorpusBadges: badges } = savesResponse.data;

      setSaves(allSaves || []);
      setConceptNames(names || {});
      setConceptCorpusBadges(badges || {});
    } catch (err) {
      setError('Failed to load graph votes');
      console.error('Failed to load saves:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>← Back</button>
          <h2 style={styles.heading}>Graph Votes</h2>
        </div>
        <div style={styles.loading}>Loading graph votes...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>← Back</button>
        <h2 style={styles.heading}>Graph Votes</h2>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      {saves.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No graph votes yet.</p>
          <p style={styles.emptySubtext}>
            Vote on concepts by clicking the ▲ button on any concept in the graph.
          </p>
        </div>
      ) : (
        <SavedTabContent
          edges={saves}
          conceptNames={conceptNames}
          conceptCorpusBadges={conceptCorpusBadges}
          corpusId={null}
          onReload={loadData}
          onOpenConceptTab={(conceptId, path, conceptName, attributeName) => {
            onOpenConceptTab(conceptId, path, conceptName, attributeName);
            onBack();
          }}
        />
      )}
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
  loading: {
    textAlign: 'center',
    padding: '60px',
    fontSize: '15px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  errorBar: {
    padding: '12px 20px',
    backgroundColor: '#fee',
    color: '#c33',
    maxWidth: '1200px',
    margin: '12px auto 0',
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
    fontStyle: 'normal',
    maxWidth: '500px',
    margin: '0 auto',
    lineHeight: 1.6,
  },
};

export default SavedPageOverlay;
