import React, { useState, useEffect, useCallback } from 'react';
import { conceptsAPI } from '../services/api';

// ============================================================
// DiffModal.jsx — Phase 14a + 14b
//
// Phase 14a: Basic concept diff modal with side-by-side panes,
//   three-group child categorization (Shared/Similar/Unique),
//   search-to-add panes, configurable Jaccard threshold.
//
// Phase 14b: Drill-down navigation within each pane.
//   - Click a child to drill into its children
//   - Independent per-pane drill-down
//   - Breadcrumb trail per pane to navigate back
//   - Cross-level comparison (groups recomputed at each pane's current level)
// ============================================================

// Jaccard similarity: |A ∩ B| / |A ∪ B|
function jaccardSimilarity(setA, setB) {
  if (setA.length === 0 && setB.length === 0) return 0;
  const a = new Set(setA);
  const b = new Set(setB);
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Compute the three groups for each pane based on all panes' children
function computeGroups(panes, similarityThreshold) {
  if (panes.length <= 1) {
    return panes.map(pane => ({
      shared: [],
      similar: [],
      unique: pane.children || []
    }));
  }

  return panes.map((currentPane, currentIdx) => {
    const otherPanes = panes.filter((_, idx) => idx !== currentIdx);
    const otherChildKeys = new Set();
    otherPanes.forEach(p => {
      (p.children || []).forEach(child => {
        otherChildKeys.add(`${child.name} [${child.attribute}]`);
      });
    });

    const shared = [];
    const similar = [];
    const unique = [];

    (currentPane.children || []).forEach(child => {
      const childKey = `${child.name} [${child.attribute}]`;

      // Check if shared (same name + attribute exists in another pane)
      if (otherChildKeys.has(childKey)) {
        shared.push(child);
        return;
      }

      // Check if similar (different name, but grandchildren overlap >= threshold)
      let isSimilar = false;
      let similarTo = [];

      for (const otherPane of otherPanes) {
        for (const otherChild of (otherPane.children || [])) {
          const otherKey = `${otherChild.name} [${otherChild.attribute}]`;
          if (otherKey === childKey) continue;

          if (child.grandchildren.length > 0 || otherChild.grandchildren.length > 0) {
            const sim = jaccardSimilarity(child.grandchildren, otherChild.grandchildren);
            if (sim >= similarityThreshold) {
              isSimilar = true;
              similarTo.push({
                name: otherChild.name,
                attribute: otherChild.attribute,
                similarity: Math.round(sim * 100),
                paneLabel: otherPane.conceptName
              });
            }
          }
        }
      }

      if (isSimilar) {
        similar.push({ ...child, similarTo });
      } else {
        unique.push(child);
      }
    });

    return { shared, similar, unique };
  });
}


export default function DiffModal({ isOpen, onClose, initialConcept, isGuest }) {
  // initialConcept: { conceptId, name, attribute, path, pathNames }
  const [panes, setPanes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState(0.5);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [parentContexts, setParentContexts] = useState([]);
  const [contextsLoading, setContextsLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Build path names from path IDs
  const buildPathNames = useCallback(async (pathArray) => {
    if (!pathArray || pathArray.length === 0) return [];
    try {
      const response = await conceptsAPI.getConceptNames(pathArray.join(','));
      const concepts = response.data.concepts || [];
      const nameMap = {};
      concepts.forEach(c => { nameMap[c.id] = c.name; });
      return pathArray.map(id => nameMap[id] || `#${id}`);
    } catch {
      return pathArray.map(id => `#${id}`);
    }
  }, []);

  // Initialize with the first concept when modal opens
  useEffect(() => {
    if (!isOpen || !initialConcept) return;

    const init = async () => {
      // Resolve path names if not provided
      let pathNames = initialConcept.pathNames || [];
      if (pathNames.length === 0 && initialConcept.path && initialConcept.path.length > 0) {
        pathNames = await buildPathNames(initialConcept.path);
      }

      const firstPane = {
        conceptId: initialConcept.conceptId,
        conceptName: initialConcept.name,
        attribute: initialConcept.attribute,
        path: initialConcept.path,
        pathNames,
        children: [],
        loaded: false,
        // Phase 14b: drill-down stack
        // Each entry: { conceptId, conceptName, attribute, path, pathNames, children }
        drillStack: []
      };
      setPanes([firstPane]);
      setGroups([]);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedResult(null);
      setParentContexts([]);
      setShowSearch(false);
    };

    init();
  }, [isOpen, initialConcept, buildPathNames]);

  // Load children whenever panes change (for unloaded panes)
  useEffect(() => {
    if (panes.length === 0) return;

    const unloadedPanes = panes.filter(p => !p.loaded);
    if (unloadedPanes.length === 0) {
      // All loaded — recompute groups
      setGroups(computeGroups(panes, threshold));
      return;
    }

    const loadChildren = async () => {
      setLoading(true);
      try {
        const panesToFetch = unloadedPanes.map(p => ({
          conceptId: p.conceptId,
          path: p.path
        }));

        const response = await conceptsAPI.getBatchChildrenForDiff(panesToFetch);
        const results = response.data.results;

        setPanes(prev => {
          const updated = prev.map(p => {
            if (p.loaded) return p;
            const match = results.find(
              r => r.conceptId === p.conceptId &&
                   JSON.stringify(r.path) === JSON.stringify(p.path)
            );
            if (match) {
              return { ...p, children: match.children, loaded: true };
            }
            return { ...p, children: [], loaded: true };
          });
          return updated;
        });
      } catch (err) {
        console.error('Failed to load diff children:', err);
        setPanes(prev => prev.map(p => p.loaded ? p : { ...p, children: [], loaded: true }));
      } finally {
        setLoading(false);
      }
    };

    loadChildren();
  }, [panes, threshold]);

  // Recompute groups when threshold changes and all panes are loaded
  useEffect(() => {
    const allLoaded = panes.length > 0 && panes.every(p => p.loaded);
    if (allLoaded) {
      setGroups(computeGroups(panes, threshold));
    }
  }, [threshold, panes]);

  // Search handler
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResults([]);
    setSelectedResult(null);
    setParentContexts([]);
    try {
      const response = await conceptsAPI.searchConcepts(searchQuery.trim());
      setSearchResults(response.data.results || []);
    } catch (err) {
      console.error('Diff search error:', err);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  // When a search result is selected, load its parent contexts
  const handleSelectResult = useCallback(async (concept) => {
    setSelectedResult(concept);
    setContextsLoading(true);
    setParentContexts([]);
    try {
      // Get parent contexts (where this concept is a child)
      const response = await conceptsAPI.getConceptParents(concept.id);
      const parents = (response.data.parents || []).map(p => ({
        parentId: p.id,
        parentName: p.name,
        edgeId: p.edge_id,
        path: p.graph_path || [],
        attribute: p.attribute_name,
        isRoot: false
      }));

      // Also check if this concept exists as a root
      const rootResponse = await conceptsAPI.getRootConcepts();
      const rootMatch = (rootResponse.data.concepts || []).find(
        r => r.id === concept.id
      );
      if (rootMatch) {
        parents.unshift({
          parentId: null,
          parentName: null,
          edgeId: rootMatch.edge_id,
          path: [],
          attribute: rootMatch.attribute_name,
          isRoot: true
        });
      }

      setParentContexts(parents);
    } catch (err) {
      console.error('Failed to load parent contexts:', err);
    } finally {
      setContextsLoading(false);
    }
  }, []);

  // Add a concept as a new pane
  const handleAddPane = useCallback(async (concept, context) => {
    const pathArray = context.isRoot ? [] : (context.path || []);
    const pathNames = await buildPathNames(pathArray);

    const newPane = {
      conceptId: concept.id,
      conceptName: concept.name,
      attribute: context.attribute || '',
      path: pathArray,
      pathNames,
      children: [],
      loaded: false,
      drillStack: []
    };

    setPanes(prev => [...prev, newPane]);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResult(null);
    setParentContexts([]);
  }, [buildPathNames]);

  // Remove a pane
  const handleRemovePane = useCallback((index) => {
    setPanes(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ============================================================
  // Phase 14b: Drill-down into a child
  // ============================================================
  const handleDrillDown = useCallback(async (paneIdx, child) => {
    // child has: { childId, name, attribute, edgeId, saveCount, grandchildren }
    // (childId comes from the batch endpoint, same pattern as getConceptWithChildren)
    //
    // Current pane is showing concept C at path P.
    // The children of C have graph_path = [...P, C].
    // To drill into child D, we want D's children, which have graph_path = [...P, C, D].
    // The batch endpoint expects { conceptId: D, path: [...P, C] } and builds [...P, C, D].
    // So the new path = [...currentPane.path, currentPane.conceptId].

    const childConceptId = child.childId || child.conceptId || child.id;
    if (!childConceptId) {
      console.warn('Cannot drill down: child has no concept ID', child);
      return;
    }

    setPanes(prev => {
      const pane = prev[paneIdx];
      if (!pane) return prev;

      // Build the new path for the drilled-down child
      const newPath = [...(pane.path || []), pane.conceptId];

      // Save current level onto the drill stack
      const stackEntry = {
        conceptId: pane.conceptId,
        conceptName: pane.conceptName,
        attribute: pane.attribute,
        path: pane.path,
        pathNames: pane.pathNames,
        children: pane.children
      };

      const updated = [...prev];
      updated[paneIdx] = {
        ...pane,
        conceptId: childConceptId,
        conceptName: child.name,
        attribute: child.attribute,
        path: newPath,
        pathNames: [...(pane.pathNames || []), pane.conceptName],
        children: [],
        loaded: false,
        drillStack: [...pane.drillStack, stackEntry]
      };
      return updated;
    });
  }, []);

  // Phase 14b: Navigate back to a breadcrumb level
  const handleBreadcrumbClick = useCallback((paneIdx, stackIdx) => {
    // stackIdx is the index in drillStack to navigate back to.
    // We restore that stack entry as the current pane state,
    // and truncate the drill stack to everything before it.
    setPanes(prev => {
      const pane = prev[paneIdx];
      if (!pane || !pane.drillStack[stackIdx]) return prev;

      const target = pane.drillStack[stackIdx];
      const updated = [...prev];
      updated[paneIdx] = {
        ...pane,
        conceptId: target.conceptId,
        conceptName: target.conceptName,
        attribute: target.attribute,
        path: target.path,
        pathNames: target.pathNames,
        children: target.children,
        loaded: true, // we already have the children cached in the stack
        drillStack: pane.drillStack.slice(0, stackIdx)
      };
      return updated;
    });
  }, []);

  if (!isOpen) return null;

  const allLoaded = panes.every(p => p.loaded);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Compare Children</h2>
          <div style={styles.headerRight}>
            <label style={styles.thresholdLabel}>
              Similarity:
              <select
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                style={styles.thresholdSelect}
              >
                <option value={0.3}>30%</option>
                <option value={0.4}>40%</option>
                <option value={0.5}>50%</option>
                <option value={0.6}>60%</option>
                <option value={0.7}>70%</option>
                <option value={0.8}>80%</option>
              </select>
            </label>
            <button
              style={styles.addButton}
              onClick={() => setShowSearch(!showSearch)}
              title="Add another concept to compare"
            >
              + Add concept
            </button>
            <button style={styles.closeButton} onClick={onClose}>{'\u2715'}</button>
          </div>
        </div>

        {/* Search panel */}
        {showSearch && (
          <div style={styles.searchPanel}>
            <div style={styles.searchRow}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search for a concept to compare..."
                style={styles.searchInput}
                autoFocus
              />
              <button onClick={handleSearch} style={styles.searchButton} disabled={searchLoading}>
                {searchLoading ? '\u2026' : 'Search'}
              </button>
              <button onClick={() => setShowSearch(false)} style={styles.searchCancelButton}>
                Cancel
              </button>
            </div>

            {/* Search results */}
            {searchResults.length > 0 && !selectedResult && (
              <div style={styles.searchResults}>
                {searchResults.map(r => (
                  <div
                    key={r.id}
                    style={styles.searchResultItem}
                    onClick={() => handleSelectResult(r)}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0ece4'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span style={styles.resultName}>{r.name}</span>
                    {r.childAttributes && r.childAttributes.length > 0 && (
                      <span style={styles.resultAttributes}>
                        {r.childAttributes.map(a =>
                          typeof a === 'string' ? a : a.attribute_name
                        ).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Parent context selection */}
            {selectedResult && (
              <div style={styles.contextPanel}>
                <div style={styles.contextHeader}>
                  <span>
                    Select a context for <strong>{selectedResult.name}</strong>:
                  </span>
                  <button
                    onClick={() => { setSelectedResult(null); setParentContexts([]); }}
                    style={styles.backToResults}
                  >
                    {'\u2190'} back
                  </button>
                </div>
                {contextsLoading ? (
                  <div style={styles.loadingText}>Loading contexts{'\u2026'}</div>
                ) : parentContexts.length === 0 ? (
                  <div style={styles.loadingText}>No contexts found</div>
                ) : (
                  <div style={styles.contextList}>
                    {parentContexts.map((ctx, i) => {
                      const pathDisplay = ctx.isRoot
                        ? '(root)'
                        : ctx.parentName
                          ? `\u2026\u2192 ${ctx.parentName} \u2192 ${selectedResult.name}`
                          : `path: [${(ctx.path || []).join(', ')}]`;
                      return (
                        <div
                          key={i}
                          style={styles.contextItem}
                          onClick={() => handleAddPane(selectedResult, ctx)}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0ece4'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <span style={styles.contextPath}>{pathDisplay}</span>
                          {ctx.attribute && <span style={styles.contextAttr}>{ctx.attribute}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading indicator */}
        {loading && <div style={styles.loadingBar}>Loading children{'\u2026'}</div>}

        {/* Panes */}
        <div style={styles.panesContainer}>
          {panes.map((pane, paneIdx) => {
            const group = groups[paneIdx] || { shared: [], similar: [], unique: [] };
            const hasDrillStack = pane.drillStack && pane.drillStack.length > 0;

            return (
              <div key={paneIdx} style={styles.pane}>
                {/* Pane header */}
                <div style={styles.paneHeader}>
                  <div style={styles.paneTitle}>
                    <span style={styles.paneName}>{pane.conceptName}</span>
                    {pane.attribute && (
                      <span style={styles.paneAttr}>{pane.attribute}</span>
                    )}
                  </div>
                  {pane.pathNames && pane.pathNames.length > 0 ? (
                    <div style={styles.panePath}>
                      {pane.pathNames.join(' \u2192 ')} {'\u2192'} {pane.conceptName}
                    </div>
                  ) : (
                    <div style={styles.panePath}>(root)</div>
                  )}
                  {panes.length > 1 && (
                    <button
                      style={styles.removePaneButton}
                      onClick={() => handleRemovePane(paneIdx)}
                      title="Remove this pane"
                    >
                      {'\u2715'}
                    </button>
                  )}
                </div>

                {/* Phase 14b: Drill-down breadcrumb trail */}
                {hasDrillStack && (
                  <div style={styles.breadcrumbBar}>
                    {pane.drillStack.map((entry, stackIdx) => (
                      <React.Fragment key={stackIdx}>
                        <span
                          style={styles.breadcrumbLink}
                          onClick={() => handleBreadcrumbClick(paneIdx, stackIdx)}
                          onMouseEnter={e => e.currentTarget.style.color = '#333'}
                          onMouseLeave={e => e.currentTarget.style.color = '#7a7a7a'}
                          title={`Back to ${entry.conceptName}${entry.attribute ? ' (' + entry.attribute + ')' : ''}`}
                        >
                          {entry.conceptName}
                        </span>
                        <span style={styles.breadcrumbArrow}>{'\u2192'}</span>
                      </React.Fragment>
                    ))}
                    <span style={styles.breadcrumbCurrent}>
                      {pane.conceptName}
                    </span>
                  </div>
                )}

                {/* Children grouped */}
                {!pane.loaded ? (
                  <div style={styles.paneLoading}>Loading{'\u2026'}</div>
                ) : pane.children.length === 0 ? (
                  <div style={styles.emptyPane}>No children</div>
                ) : panes.length === 1 ? (
                  // Only one pane — no grouping, just list all children
                  <div style={styles.paneBody}>
                    <div style={styles.groupSection}>
                      <div style={styles.groupHeader}>
                        Children
                        <span style={styles.groupCount}>{pane.children.length}</span>
                      </div>
                      {pane.children.map(child => (
                        <ChildCard
                          key={child.edgeId}
                          child={child}
                          type="unique"
                          onDrillDown={() => handleDrillDown(paneIdx, child)}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={styles.paneBody}>
                    {/* Shared */}
                    {group.shared.length > 0 && (
                      <div style={styles.groupSection}>
                        <div style={styles.groupHeader}>
                          <span style={groupDotStyle('#5a8a5a')} />
                          Shared
                          <span style={styles.groupCount}>{group.shared.length}</span>
                        </div>
                        {group.shared.map(child => (
                          <ChildCard
                            key={child.edgeId}
                            child={child}
                            type="shared"
                            onDrillDown={() => handleDrillDown(paneIdx, child)}
                          />
                        ))}
                      </div>
                    )}

                    {/* Similar */}
                    {group.similar.length > 0 && (
                      <div style={styles.groupSection}>
                        <div style={styles.groupHeader}>
                          <span style={groupDotStyle('#8a7a3a')} />
                          Similar
                          <span style={styles.groupCount}>{group.similar.length}</span>
                        </div>
                        {group.similar.map(child => (
                          <ChildCard
                            key={child.edgeId}
                            child={child}
                            type="similar"
                            onDrillDown={() => handleDrillDown(paneIdx, child)}
                          />
                        ))}
                      </div>
                    )}

                    {/* Unique */}
                    {group.unique.length > 0 && (
                      <div style={styles.groupSection}>
                        <div style={styles.groupHeader}>
                          <span style={groupDotStyle('#7a7a7a')} />
                          Unique
                          <span style={styles.groupCount}>{group.unique.length}</span>
                        </div>
                        {group.unique.map(child => (
                          <ChildCard
                            key={child.edgeId}
                            child={child}
                            type="unique"
                            onDrillDown={() => handleDrillDown(paneIdx, child)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty pane placeholder when only 1 pane */}
          {panes.length === 1 && allLoaded && (
            <div style={styles.emptyPanePlaceholder}>
              <div style={styles.emptyPaneText}>
                Click <strong>+ Add concept</strong> above to compare with another concept's children
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// Child card sub-component — Phase 14b: now clickable for drill-down
function ChildCard({ child, type, onDrillDown }) {
  const borderColors = { shared: '#5a8a5a', similar: '#8a7a3a', unique: '#7a7a7a' };
  const borderColor = borderColors[type] || '#7a7a7a';

  return (
    <div
      style={{ ...styles.childCard, borderLeft: `3px solid ${borderColor}`, cursor: 'pointer' }}
      onClick={onDrillDown}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f5f3ee'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}
      title={`Drill into ${child.name}${child.attribute ? ' (' + child.attribute + ')' : ''}`}
    >
      <div style={styles.childMain}>
        <span style={styles.childName}>{child.name}</span>
        {child.attribute && <span style={styles.childAttr}>{child.attribute}</span>}
        <span style={styles.childSaves}>{child.saveCount}</span>
        <span style={styles.drillArrow}>{'\u25B8'}</span>
      </div>
      {type === 'similar' && child.similarTo && child.similarTo.length > 0 && (
        <div style={styles.similarInfo}>
          {child.similarTo.map((s, i) => (
            <span key={i} style={styles.similarTag}>
              {'\u2248'} {s.name}{s.attribute ? ' (' + s.attribute + ')' : ''} ({s.similarity}%)
            </span>
          ))}
        </div>
      )}
      {child.grandchildren && child.grandchildren.length > 0 && (
        <div style={styles.grandchildPreview}>
          {child.grandchildren.slice(0, 5).join(', ')}
          {child.grandchildren.length > 5 && ` +${child.grandchildren.length - 5} more`}
        </div>
      )}
    </div>
  );
}


// Helper for colored group dots
function groupDotStyle(color) {
  return {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: color,
    display: 'inline-block',
    flexShrink: 0
  };
}

// ============================================================
// Styles — consistent with Orca's Zen aesthetic
// ============================================================
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  modal: {
    backgroundColor: '#faf9f6',
    borderRadius: '4px',
    border: '1px solid #d4d0c8',
    width: '90vw',
    maxWidth: '1200px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #e8e4dc',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  thresholdLabel: {
    fontSize: '13px',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  thresholdSelect: {
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '13px',
    padding: '2px 4px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
  addButton: {
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '14px',
    padding: '5px 12px',
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  closeButton: {
    fontSize: '18px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#999',
    padding: '4px 8px',
    lineHeight: 1,
  },
  searchPanel: {
    padding: '12px 20px',
    borderBottom: '1px solid #e8e4dc',
    backgroundColor: '#f5f3ee',
    flexShrink: 0,
  },
  searchRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '15px',
    padding: '6px 10px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
  searchButton: {
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '14px',
    padding: '6px 14px',
    backgroundColor: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  searchCancelButton: {
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '14px',
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #ccc',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  searchResults: {
    marginTop: '8px',
    maxHeight: '150px',
    overflowY: 'auto',
    border: '1px solid #ddd',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
  searchResultItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #f0ece4',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  resultName: {
    fontWeight: '600',
    color: '#333',
  },
  resultAttributes: {
    fontSize: '13px',
    color: '#888',
  },
  contextPanel: {
    marginTop: '8px',
  },
  contextHeader: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  backToResults: {
    fontFamily: '"EB Garamond", "Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#666',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  contextList: {
    maxHeight: '120px',
    overflowY: 'auto',
    border: '1px solid #ddd',
    borderRadius: '3px',
    backgroundColor: '#fff',
  },
  contextItem: {
    padding: '6px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #f0ece4',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
  },
  contextPath: {
    color: '#555',
    fontStyle: 'normal',
  },
  contextAttr: {
    color: '#888',
    fontSize: '13px',
  },
  loadingText: {
    fontSize: '13px',
    color: '#888',
    padding: '8px 0',
    fontStyle: 'normal',
  },
  loadingBar: {
    padding: '8px 20px',
    fontSize: '13px',
    color: '#888',
    backgroundColor: '#f5f3ee',
    borderBottom: '1px solid #e8e4dc',
    fontStyle: 'normal',
    flexShrink: 0,
  },
  panesContainer: {
    display: 'flex',
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  pane: {
    flex: '1 0 280px',
    maxWidth: '400px',
    minWidth: '280px',
    borderRight: '1px solid #e8e4dc',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  paneHeader: {
    padding: '12px 14px',
    borderBottom: '1px solid #e8e4dc',
    backgroundColor: '#f5f3ee',
    position: 'relative',
    flexShrink: 0,
  },
  paneTitle: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    paddingRight: '24px',
  },
  paneName: {
    fontWeight: '700',
    fontSize: '16px',
    color: '#333',
  },
  paneAttr: {
    fontSize: '13px',
    color: '#888',
  },
  panePath: {
    fontSize: '12px',
    color: '#999',
    marginTop: '2px',
    fontStyle: 'normal',
  },
  removePaneButton: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#bbb',
    padding: '2px 6px',
    lineHeight: 1,
  },
  // Phase 14b: Breadcrumb trail styles
  breadcrumbBar: {
    padding: '6px 14px',
    borderBottom: '1px solid #e8e4dc',
    backgroundColor: '#faf8f4',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '2px',
    fontSize: '13px',
    flexShrink: 0,
  },
  breadcrumbLink: {
    color: '#7a7a7a',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
    textUnderlineOffset: '2px',
    transition: 'color 0.15s',
  },
  breadcrumbArrow: {
    color: '#ccc',
    margin: '0 2px',
    fontSize: '11px',
  },
  breadcrumbCurrent: {
    color: '#333',
    fontWeight: '600',
  },
  paneLoading: {
    padding: '20px',
    textAlign: 'center',
    color: '#999',
    fontStyle: 'normal',
  },
  emptyPane: {
    padding: '20px',
    textAlign: 'center',
    color: '#bbb',
    fontStyle: 'normal',
  },
  paneBody: {
    padding: '8px 0',
    flex: 1,
    overflowY: 'auto',
  },
  groupSection: {
    marginBottom: '8px',
  },
  groupHeader: {
    padding: '4px 14px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#777',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  groupCount: {
    fontSize: '11px',
    color: '#aaa',
    fontWeight: '400',
  },
  childCard: {
    margin: '2px 14px',
    padding: '6px 10px',
    backgroundColor: '#fff',
    border: '1px solid #e8e4dc',
    borderRadius: '3px',
  },
  childMain: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
  },
  childName: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#333',
  },
  childAttr: {
    fontSize: '12px',
    color: '#888',
  },
  childSaves: {
    fontSize: '12px',
    color: '#aaa',
    marginLeft: 'auto',
  },
  // Phase 14b: drill arrow indicator on child cards
  drillArrow: {
    fontSize: '11px',
    color: '#ccc',
    marginLeft: '4px',
    flexShrink: 0,
  },
  similarInfo: {
    marginTop: '3px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  similarTag: {
    fontSize: '11px',
    color: '#8a7a3a',
    backgroundColor: '#f8f4e8',
    padding: '1px 6px',
    borderRadius: '2px',
    border: '1px solid #e8e0c0',
  },
  grandchildPreview: {
    marginTop: '3px',
    fontSize: '11px',
    color: '#bbb',
    fontStyle: 'normal',
    lineHeight: 1.3,
  },
  emptyPanePlaceholder: {
    flex: '1 0 280px',
    maxWidth: '400px',
    minWidth: '280px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
  },
  emptyPaneText: {
    fontSize: '14px',
    color: '#bbb',
    textAlign: 'center',
    lineHeight: 1.6,
  },
};
