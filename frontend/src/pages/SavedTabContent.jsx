import React, { useState, useEffect } from 'react';
import { votesAPI } from '../services/api';

/**
 * SavedTabContent — Phase 38d: Flat Graph Votes Page
 *
 * Renders all saved concept trees in a single flat list.
 * Tree cards show corpus badges if any concept in the tree appears
 * as an annotation in a subscribed corpus.
 *
 * Props:
 *   - edges: array of saved edge objects
 *   - conceptNames: { id: name } lookup for path display
 *   - conceptCorpusBadges: { conceptId: [{corpusId, corpusName}] } lookup
 *   - corpusId: always null in flat model (kept for tree order compatibility)
 *   - onReload: callback to reload all data from parent after unsave
 *   - onOpenConceptTab: callback to open a concept in a new graph tab
 */
const SavedTabContent = ({ edges, conceptNames, conceptCorpusBadges, corpusId, onReload, onOpenConceptTab }) => {
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());
  const [treeOrder, setTreeOrder] = useState(null); // null = not loaded yet; [] = loaded, no custom order

  useEffect(() => {
    loadTreeOrder();
  }, []);

  const loadTreeOrder = async () => {
    try {
      // Always use corpusId = null for flat model ordering
      const response = await votesAPI.getTreeOrderV2(null);
      setTreeOrder(response.data.treeOrder || []);
    } catch (err) {
      console.error('Failed to load tree order:', err);
      setTreeOrder([]);
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

    // Apply custom tree order if available
    if (treeOrder && treeOrder.length > 0) {
      const orderMap = {};
      treeOrder.forEach(item => {
        orderMap[item.root_concept_id] = item.display_order;
      });

      trees.sort((a, b) => {
        const orderA = orderMap[a.childId];
        const orderB = orderMap[b.childId];
        const hasOrderA = orderA !== undefined;
        const hasOrderB = orderB !== undefined;

        if (hasOrderA && hasOrderB) return orderA - orderB;
        if (hasOrderA && !hasOrderB) return -1;
        if (!hasOrderA && hasOrderB) return 1;
        // Default: sort by total vote count across tree, descending
        return getTotalVoteCount(b) - getTotalVoteCount(a);
      });
    } else {
      // Default sort: total vote count across tree, descending
      trees.sort((a, b) => getTotalVoteCount(b) - getTotalVoteCount(a));
    }

    return trees;
  };

  // Sum all vote counts across a tree (root + all descendants)
  const getTotalVoteCount = (node) => {
    let total = node.voteCount || 0;
    if (node.children) {
      node.children.forEach(child => { total += getTotalVoteCount(child); });
    }
    return total;
  };

  // Collect all unique corpus badges for a tree
  const getTreeCorpusBadges = (tree) => {
    if (!conceptCorpusBadges) return [];
    const seen = new Set();
    const badges = [];
    const collect = (node) => {
      const nodeBadges = conceptCorpusBadges[node.childId];
      if (nodeBadges) {
        nodeBadges.forEach(b => {
          if (!seen.has(b.corpusId)) {
            seen.add(b.corpusId);
            badges.push(b);
          }
        });
      }
      if (node.children) node.children.forEach(collect);
    };
    collect(tree);
    return badges;
  };

  const handleUnsave = async (edgeId) => {
    try {
      await votesAPI.removeVote(edgeId);
      // Reload all data from parent (since unsaving affects trees)
      if (onReload) await onReload();
    } catch (err) {
      console.error('Unsave failed:', err);
      alert(err.response?.data?.error || 'Failed to unsave');
    }
  };

  const handleConceptClick = (node) => {
    const path = node.parentId === null ? [] : node.graphPath;
    onOpenConceptTab(node.childId, path, node.childName, node.attributeName);
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

  const moveTree = async (trees, index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= trees.length) return;

    const reordered = [...trees];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);

    const order = reordered.map((tree, i) => ({
      rootConceptId: tree.childId,
      displayOrder: i,
    }));

    // Optimistic update
    setTreeOrder(order.map(o => ({
      root_concept_id: o.rootConceptId,
      display_order: o.displayOrder,
    })));

    // Persist to backend — always use corpusId=null for flat model
    try {
      await votesAPI.updateTreeOrderV2(null, order);
    } catch (err) {
      console.error('Failed to save tree order:', err);
      loadTreeOrder();
    }
  };

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
            title={`Click to open ${node.childName} in a new tab`}
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
            title="Unsave (cascades to descendants)"
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

  const trees = buildTrees();
  const totalSaved = edges.length;

  return (
    <div style={styles.container}>
      <main style={styles.main}>
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

        {trees.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>No graph votes yet.</p>
            <p style={styles.emptySubtext}>
              Vote on concepts by clicking the ▲ button on any concept in the graph.
            </p>
          </div>
        ) : (
          <div style={styles.treesContainer}>
            {trees.map((tree, index) => {
              const badges = getTreeCorpusBadges(tree);
              return (
                <div key={getNodeKey(tree)} style={styles.treeCard}>
                  <div style={styles.treeCardHeader}>
                    <div style={styles.reorderButtons}>
                      <button
                        onClick={() => moveTree(trees, index, -1)}
                        disabled={index === 0}
                        style={{
                          ...styles.arrowButton,
                          ...(index === 0 ? styles.arrowButtonDisabled : {}),
                        }}
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => moveTree(trees, index, +1)}
                        disabled={index === trees.length - 1}
                        style={{
                          ...styles.arrowButton,
                          ...(index === trees.length - 1 ? styles.arrowButtonDisabled : {}),
                        }}
                        title="Move down"
                      >▼</button>
                    </div>
                    <div style={styles.treeCardContent}>
                      {badges.length > 0 && (
                        <div style={styles.badgeRow}>
                          {badges.map(b => (
                            <span key={b.corpusId} style={styles.corpusBadge} title={b.corpusName}>
                              {b.corpusName}
                            </span>
                          ))}
                        </div>
                      )}
                      {renderNode(tree)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#faf9f7',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  savedCount: {
    fontSize: '14px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
  },
  toolbarButtons: { display: 'flex', gap: '8px' },
  toolbarButton: {
    padding: '6px 14px',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#555',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  treesContainer: { display: 'flex', flexDirection: 'column', gap: '16px' },
  treeCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    padding: '20px',
    overflow: 'hidden',
  },
  treeCardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  treeCardContent: {
    flex: 1,
    minWidth: 0,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '8px',
  },
  corpusBadge: {
    display: 'inline-block',
    padding: '1px 8px',
    border: '1px solid #ddd',
    borderRadius: '12px',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    background: 'transparent',
    maxWidth: '180px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  reorderButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flexShrink: 0,
    paddingTop: '4px',
  },
  arrowButton: {
    background: 'none',
    border: '1px solid #ddd',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '10px',
    color: '#888',
    padding: '2px 5px',
    lineHeight: 1,
    transition: 'color 0.15s, border-color 0.15s',
  },
  arrowButtonDisabled: {
    color: '#ddd',
    borderColor: '#eee',
    cursor: 'default',
  },
  nodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 4px',
    borderRadius: '4px',
    transition: 'background-color 0.15s',
  },
  rootNodeRow: {
    paddingBottom: '10px',
    marginBottom: '4px',
    borderBottom: '1px solid #eee',
  },
  collapseButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#999',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
    width: '20px',
    textAlign: 'center',
  },
  collapseButtonPlaceholder: {
    fontSize: '14px',
    color: '#ccc',
    padding: '0 4px',
    width: '20px',
    textAlign: 'center',
    display: 'inline-block',
    flexShrink: 0,
  },
  conceptName: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    cursor: 'pointer',
    flex: 1,
    lineHeight: 1.4,
  },
  rootConceptName: { fontSize: '18px', fontWeight: '600' },
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
    fontSize: '13px',
    color: '#888',
    flexShrink: 0,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  swapIndicator: {
    fontSize: '13px',
    color: '#8050b0',
    flexShrink: 0,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  unsaveButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#ccc',
    padding: '2px 6px',
    borderRadius: '3px',
    flexShrink: 0,
    transition: 'color 0.15s',
    lineHeight: 1,
  },
  childrenContainer: { borderLeft: '1px solid #e8e8e8', marginLeft: '10px' },
  emptyState: { textAlign: 'center', padding: '80px 20px' },
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
    maxWidth: '400px',
    margin: '0 auto',
    lineHeight: 1.6,
  },
};

export default SavedTabContent;
