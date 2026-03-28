import React, { useState, useEffect } from 'react';
import { votesAPI } from '../services/api';
import SavedTabContent from '../pages/SavedTabContent';

/**
 * SavedPageOverlay — Phase 7c Overhaul
 *
 * Replaces the manual saved tabs system with automatic corpus-based grouping.
 * Saves are grouped by corpus membership (via annotations) — one tab per corpus
 * that has matching saves, plus an "Uncategorized" tab for saves not in any corpus.
 *
 * Props:
 *   - onBack: callback to close the overlay and return to normal tab content
 *   - onOpenConceptTab: callback to open a concept in a new graph tab
 */
const SavedPageOverlay = ({ onBack, onOpenConceptTab }) => {
  const [corpusTabs, setCorpusTabs] = useState([]);
  const [uncategorizedEdges, setUncategorizedEdges] = useState([]);
  const [conceptNames, setConceptNames] = useState({});
  const [activeTabKey, setActiveTabKey] = useState(null); // 'uncategorized' or corpus ID number
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

      const { corpusTabs: tabs, uncategorizedEdges: uncatEdges, conceptNames: names } = savesResponse.data;
      setCorpusTabs(tabs);
      setUncategorizedEdges(uncatEdges);
      setConceptNames(names);

      // Set initial active tab: first corpus tab, or uncategorized
      const allKeys = [
        ...tabs.map(t => t.corpusId),
        ...(uncatEdges.length > 0 ? ['uncategorized'] : []),
      ];
      if (allKeys.length > 0) {
        setActiveTabKey(allKeys[0]);
      } else {
        setActiveTabKey(null);
      }
    } catch (err) {
      setError('Failed to load saved concepts');
      console.error('Failed to load saves by corpus:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get the edges for the currently active tab
  const getActiveEdges = () => {
    if (activeTabKey === 'uncategorized') {
      return uncategorizedEdges;
    }
    const tab = corpusTabs.find(t => t.corpusId === activeTabKey);
    return tab ? tab.edges : [];
  };

  // Build the list of tab buttons
  const allTabs = [
    ...corpusTabs.map(t => ({
      key: t.corpusId,
      label: t.corpusName,
      isSubscribed: t.isSubscribed,
      edgeCount: t.edges.length,
    })),
    ...(uncategorizedEdges.length > 0 ? [{
      key: 'uncategorized',
      label: 'Uncategorized',
      isSubscribed: true,
      edgeCount: uncategorizedEdges.length,
    }] : []),
  ];

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

      {allTabs.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No graph votes yet.</p>
          <p style={styles.emptySubtext}>
            Vote on concepts by clicking the ▲ button on any concept in the graph.
            Your votes will automatically appear here, grouped by the corpuses
            they're annotated in.
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div style={styles.tabBar}>
            {allTabs.map(tab => {
              const isActive = tab.key === activeTabKey;
              return (
                <button
                  key={tab.key}
                  style={{
                    ...styles.tabButton,
                    ...(isActive ? styles.tabButtonActive : {}),
                  }}
                  onClick={() => setActiveTabKey(tab.key)}
                  title={
                    tab.key === 'uncategorized'
                      ? 'Votes not associated with any corpus'
                      : `${tab.label}${!tab.isSubscribed ? ' (unsubscribed)' : ''}`
                  }
                >
                  <span style={
                    (!tab.isSubscribed && tab.key !== 'uncategorized') ? styles.unsubscribedLabel : undefined
                  }>
                    {tab.label}
                  </span>
                  {!tab.isSubscribed && tab.key !== 'uncategorized' && (
                    <span style={styles.unsubscribedBadge}>unsubscribed</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTabKey && (
            <SavedTabContent
              key={`corpus-${activeTabKey}`}
              edges={getActiveEdges()}
              conceptNames={conceptNames}
              corpusId={activeTabKey === 'uncategorized' ? null : activeTabKey}
              onReload={loadData}
              onOpenConceptTab={(conceptId, path, conceptName, attributeName) => {
                onOpenConceptTab(conceptId, path, conceptName, attributeName);
                onBack();
              }}
            />
          )}
        </>
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
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0px',
    padding: '12px 20px 0 20px',
    maxWidth: '1200px',
    margin: '0 auto',
    borderBottom: '1px solid #e0e0e0',
    overflowX: 'auto',
  },
  tabButton: {
    padding: '10px 18px',
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  tabButtonActive: {
    color: '#333',
    borderBottomColor: '#333',
    fontWeight: '600',
  },
  unsubscribedLabel: {
    fontStyle: 'normal',
    opacity: 0.7,
  },
  unsubscribedBadge: {
    fontSize: '10px',
    color: '#b08030',
    fontStyle: 'normal',
    marginLeft: '4px',
    flexShrink: 0,
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
