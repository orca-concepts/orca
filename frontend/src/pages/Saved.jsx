import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { votesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const Saved = () => {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [edges, setEdges] = useState([]);
  const [conceptNames, setConceptNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());

  // Tab management state
  const [showNewTabInput, setShowNewTabInput] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const newTabInputRef = useRef(null);
  const renameInputRef = useRef(null);

  useEffect(() => { loadTabs(); }, []);

  useEffect(() => {
    if (activeTabId !== null) loadSaves();
  }, [activeTabId]);

  useEffect(() => {
    if (showNewTabInput && newTabInputRef.current) newTabInputRef.current.focus();
  }, [showNewTabInput]);

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  const loadTabs = async () => {
    try {
      const response = await votesAPI.getUserTabs();
      const loadedTabs = response.data.tabs;
      setTabs(loadedTabs);
      if (loadedTabs.length > 0 && activeTabId === null) {
        setActiveTabId(loadedTabs[0].id);
      }
    } catch (err) {
      console.error('Failed to load tabs:', err);
      setError('Failed to load saved tabs');
    }
  };

  const loadSaves = async () => {
    try {
      setLoading(true);
      const response = await votesAPI.getUserSaves(activeTabId);
      setEdges(response.data.edges);
      setConceptNames(response.data.conceptNames);
      setError(null);
    } catch (err) {
      setError('Failed to load saved concepts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const buildTrees = () => {
    const rootEdges = edges.filter(e => e.parentId === null);
    const nonRootEdges = edges.filter(e => e.parentId !== null);
    const childrenMap = {};
    nonRootEdges.forEach(edge => {
      const key = `${edge.parentId}-${JSON.stringify(edge.graphPath)}`;
      if (!childrenMap[key]) childrenMap[key] = [];
      childrenMap[key].push(edge);
    });
    const buildNode = (edge) => {
      const childPath = edge.parentId === null
        ? [edge.childId] : [...edge.graphPath, edge.childId];
      const childKey = `${edge.childId}-${JSON.stringify(childPath)}`;
      const childEdges = childrenMap[childKey] || [];
      childEdges.sort((a, b) => b.voteCount - a.voteCount);
      return { ...edge, children: childEdges.map(buildNode) };
    };
    const trees = rootEdges.map(buildNode);
    trees.sort((a, b) => b.voteCount - a.voteCount);
    return trees;
  };

  const handleUnsave = async (edgeId) => {
    try {
      await votesAPI.removeVoteFromTab(edgeId, activeTabId);
      await loadSaves();
    } catch (err) {
      console.error('Unsave failed:', err);
      alert(err.response?.data?.error || 'Failed to unsave');
    }
  };

  const handleConceptClick = (node) => {
    if (node.parentId === null) {
      navigate(`/concept/${node.childId}`);
    } else {
      const pathParam = node.graphPath.join(',');
      navigate(`/concept/${node.childId}?path=${pathParam}`);
    }
  };

  const toggleCollapse = (nodeKey) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      next.has(nodeKey) ? next.delete(nodeKey) : next.add(nodeKey);
      return next;
    });
  };

  const collapseAll = () => {
    const trees = buildTrees();
    const keys = new Set();
    const collect = (node) => {
      if (node.children && node.children.length > 0) {
        keys.add(getNodeKey(node));
        node.children.forEach(collect);
      }
    };
    trees.forEach(collect);
    setCollapsedNodes(keys);
  };

  const expandAll = () => setCollapsedNodes(new Set());
  const getNodeKey = (node) => `${node.edgeId}`;

  // --- Tab CRUD ---
  const handleCreateTab = async () => {
    const name = newTabName.trim();
    if (!name) return;
    try {
      const response = await votesAPI.createTab(name);
      setShowNewTabInput(false);
      setNewTabName('');
      await loadTabs();
      setActiveTabId(response.data.tab.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create tab');
    }
  };

  const handleRenameTab = async () => {
    const name = renameValue.trim();
    if (!name || !renamingTabId) return;
    try {
      await votesAPI.renameTab(renamingTabId, name);
      setRenamingTabId(null);
      setRenameValue('');
      await loadTabs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename tab');
    }
  };

  const handleDeleteTab = async (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (!window.confirm(`Delete "${tab.name}"? Saves only in this tab will be removed.`)) return;
    try {
      await votesAPI.deleteTab(tabId);
      if (activeTabId === tabId) {
        const remaining = tabs.filter(t => t.id !== tabId);
        if (remaining.length > 0) setActiveTabId(remaining[0].id);
      }
      await loadTabs();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete tab');
    }
  };

  const handleNewTabKeyDown = (e) => {
    if (e.key === 'Enter') handleCreateTab();
    if (e.key === 'Escape') { setShowNewTabInput(false); setNewTabName(''); }
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameTab();
    if (e.key === 'Escape') { setRenamingTabId(null); setRenameValue(''); }
  };

  const totalSaved = edges.length;

  const renderNode = (node, depth = 0) => {
    const nodeKey = getNodeKey(node);
    const isCollapsed = collapsedNodes.has(nodeKey);
    const hasChildren = node.children && node.children.length > 0;
    const isRoot = node.parentId === null;

    return (
      <div key={nodeKey} style={{ marginLeft: isRoot ? 0 : 24 }}>
        <div style={{ ...styles.nodeRow, ...(isRoot ? styles.rootNodeRow : {}) }}>
          {hasChildren ? (
            <button onClick={() => toggleCollapse(nodeKey)} style={styles.collapseButton}
              title={isCollapsed ? 'Expand' : 'Collapse'}>
              {isCollapsed ? '\u25B8' : '\u25BE'}
            </button>
          ) : (
            <span style={styles.collapseButtonPlaceholder}>{'\u00B7'}</span>
          )}
          <span
            style={{ ...styles.conceptName, ...(isRoot ? styles.rootConceptName : {}) }}
            onClick={() => handleConceptClick(node)}
            title={`Click to navigate to ${node.childName} in context`}
          >
            {node.childName}
          </span>
          {isRoot && node.attributeName && (
            <span style={styles.attributeBadge}>{node.attributeName}</span>
          )}
          <span style={styles.voteCount}>{'\u25B2'} {node.voteCount}</span>
          {node.swapCount > 0 && (
            <span style={styles.swapIndicator} title={`${node.swapCount} swap vote(s)`}>
              {'\u21C4'} {node.swapCount}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleUnsave(node.edgeId); }}
            style={styles.unsaveButton}
            title="Remove from this tab (cascades to descendants)"
          >{'\u2715'}</button>
        </div>
        {hasChildren && !isCollapsed && (
          <div style={styles.childrenContainer}>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const trees = !loading ? buildTrees() : [];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.headerLeft}>
            <h1 style={styles.title} onClick={() => navigate('/')} title="Back to root concepts">
              orca
            </h1>
            <span style={styles.pageLabel}>Graph Votes</span>
          </div>
          <div style={styles.userSection}>
            <span style={styles.username}>{user?.username}</span>
            <button onClick={logout} style={styles.logoutButton}>Logout</button>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <div style={styles.tabBarInner}>
          {tabs.map(tab => (
            <div key={tab.id} style={styles.tabItem}>
              {renamingTabId === tab.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRenameTab}
                  style={styles.renameInput}
                  maxLength={255}
                />
              ) : (
                <button
                  style={{
                    ...styles.tabButton,
                    ...(activeTabId === tab.id ? styles.tabButtonActive : {}),
                  }}
                  onClick={() => setActiveTabId(tab.id)}
                  onDoubleClick={() => {
                    setRenamingTabId(tab.id);
                    setRenameValue(tab.name);
                  }}
                  title="Click to switch, double-click to rename"
                >
                  {tab.name}
                </button>
              )}
              {tabs.length > 1 && activeTabId === tab.id && (
                <button
                  style={styles.tabDeleteButton}
                  onClick={() => handleDeleteTab(tab.id)}
                  title={`Delete "${tab.name}" tab`}
                >{'\u2715'}</button>
              )}
            </div>
          ))}

          {/* New tab button / input */}
          {showNewTabInput ? (
            <input
              ref={newTabInputRef}
              value={newTabName}
              onChange={(e) => setNewTabName(e.target.value)}
              onKeyDown={handleNewTabKeyDown}
              onBlur={() => {
                if (newTabName.trim()) handleCreateTab();
                else { setShowNewTabInput(false); setNewTabName(''); }
              }}
              placeholder="Tab name..."
              style={styles.newTabInput}
              maxLength={255}
            />
          ) : (
            <button
              style={styles.newTabButton}
              onClick={() => setShowNewTabInput(true)}
              title="Create a new saved tab"
            >+</button>
          )}
        </div>
      </div>

      <main style={styles.main}>
        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.toolbar}>
          <span style={styles.savedCount}>
            {totalSaved} graph vote{totalSaved !== 1 ? 's' : ''} across {trees.length} graph{trees.length !== 1 ? 's' : ''}
          </span>
          {trees.length > 0 && (
            <div style={styles.toolbarButtons}>
              <button onClick={collapseAll} style={styles.toolbarButton}>Collapse All</button>
              <button onClick={expandAll} style={styles.toolbarButton}>Expand All</button>
            </div>
          )}
        </div>

        {loading ? (
          <div style={styles.loadingText}>Loading graph votes...</div>
        ) : trees.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>No graph votes in this tab.</p>
            <p style={styles.emptySubtext}>
              Vote on concepts by clicking the {'\u25B2'} button on any concept in the graph.
              Your votes will appear here organized by their root graph.
            </p>
          </div>
        ) : (
          <div style={styles.treesContainer}>
            {trees.map(tree => (
              <div key={getNodeKey(tree)} style={styles.treeCard}>
                {renderNode(tree)}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#faf9f7' },
  header: { backgroundColor: 'white', borderBottom: '1px solid #ddd', padding: '20px' },
  headerContent: {
    maxWidth: '1200px', margin: '0 auto', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center', gap: '20px',
  },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: '16px' },
  title: {
    fontSize: '28px', fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600', color: '#333', margin: 0, cursor: 'pointer',
  },
  pageLabel: {
    fontSize: '20px', fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888', fontStyle: 'normal',
  },
  userSection: { display: 'flex', alignItems: 'center', gap: '15px' },
  username: { fontSize: '14px', color: '#666' },
  logoutButton: {
    padding: '8px 16px', backgroundColor: 'transparent', color: '#333',
    border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },

  // Tab bar
  tabBar: {
    backgroundColor: 'white', borderBottom: '1px solid #ddd',
    padding: '0 20px',
  },
  tabBarInner: {
    maxWidth: '1200px', margin: '0 auto', display: 'flex',
    alignItems: 'center', gap: '0px', overflowX: 'auto',
  },
  tabItem: { display: 'flex', alignItems: 'center', position: 'relative' },
  tabButton: {
    padding: '12px 20px', border: 'none', borderBottom: '2px solid transparent',
    backgroundColor: 'transparent', cursor: 'pointer', fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif', color: '#888',
    transition: 'all 0.15s', whiteSpace: 'nowrap',
  },
  tabButtonActive: {
    color: '#333', borderBottomColor: '#333', fontWeight: '600',
  },
  tabDeleteButton: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '11px', color: '#ccc', padding: '2px 4px',
    position: 'absolute', top: '4px', right: '2px',
    lineHeight: 1, borderRadius: '2px',
  },
  newTabButton: {
    padding: '8px 14px', border: 'none', backgroundColor: 'transparent',
    cursor: 'pointer', fontSize: '18px', color: '#bbb', lineHeight: 1,
    transition: 'color 0.15s',
  },
  newTabInput: {
    padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px',
    fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none', width: '140px',
  },
  renameInput: {
    padding: '10px 16px', border: '1px solid #ddd', borderRadius: '4px',
    fontSize: '15px', fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none', width: '120px',
  },

  main: { maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' },
  toolbar: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: '24px',
  },
  savedCount: {
    fontSize: '14px', color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif', fontStyle: 'normal',
  },
  toolbarButtons: { display: 'flex', gap: '8px' },
  toolbarButton: {
    padding: '6px 14px', backgroundColor: '#f0f0f0', border: '1px solid #ddd',
    borderRadius: '4px', cursor: 'pointer', fontSize: '13px', color: '#555',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  treesContainer: { display: 'flex', flexDirection: 'column', gap: '16px' },
  treeCard: {
    backgroundColor: 'white', borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '20px', overflow: 'hidden',
  },
  nodeRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px 4px', borderRadius: '4px', transition: 'background-color 0.15s',
  },
  rootNodeRow: {
    paddingBottom: '10px', marginBottom: '4px', borderBottom: '1px solid #eee',
  },
  collapseButton: {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px',
    color: '#999', padding: '0 4px', lineHeight: 1, flexShrink: 0,
    width: '20px', textAlign: 'center',
  },
  collapseButtonPlaceholder: {
    fontSize: '14px', color: '#ccc', padding: '0 4px', width: '20px',
    textAlign: 'center', display: 'inline-block', flexShrink: 0,
  },
  conceptName: {
    fontSize: '15px', fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333', cursor: 'pointer', flex: 1, lineHeight: 1.4,
  },
  rootConceptName: { fontSize: '18px', fontWeight: '600' },
  attributeTag: { color: '#999', fontWeight: '400', fontSize: '14px' },
  attributeBadge: {
    display: 'inline-block',
    padding: '1px 7px',
    background: '#e8f4f8',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#555',
    flexShrink: 0,
  },
  voteCount: {
    fontSize: '13px', color: '#888', flexShrink: 0,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  swapIndicator: {
    fontSize: '13px', color: '#8050b0', flexShrink: 0,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unsaveButton: {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px',
    color: '#ccc', padding: '2px 6px', borderRadius: '3px', flexShrink: 0,
    transition: 'color 0.15s', lineHeight: 1,
  },
  childrenContainer: { borderLeft: '1px solid #e8e8e8', marginLeft: '10px' },
  emptyState: { textAlign: 'center', padding: '80px 20px' },
  emptyText: {
    fontSize: '20px', color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '8px',
  },
  emptySubtext: {
    fontSize: '15px', color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif', fontStyle: 'normal',
    maxWidth: '400px', margin: '0 auto', lineHeight: 1.6,
  },
  loadingText: {
    textAlign: 'center', padding: '80px', fontSize: '16px', color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  error: {
    padding: '15px', backgroundColor: '#fee', color: '#c33',
    borderRadius: '4px', marginBottom: '20px',
  },
};

export default Saved;
