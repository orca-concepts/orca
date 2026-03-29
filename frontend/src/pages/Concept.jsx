import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { conceptsAPI, votesAPI, moderationAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConceptGrid from '../components/ConceptGrid';
import AddConceptModal from '../components/AddConceptModal';
import Breadcrumb from '../components/Breadcrumb';
import FlipView from '../components/FlipView';
import SearchField from '../components/SearchField';
import SwapModal from '../components/SwapModal';
import VoteSetBar from '../components/VoteSetBar';
import ConceptAnnotationPanel from '../components/ConceptAnnotationPanel';
import DiffModal from '../components/DiffModal';
import HiddenConceptsView from '../components/HiddenConceptsView';

const Concept = ({
  // Props when running inside AppShell (graph tab mode)
  graphTabId,
  initialConceptId,
  initialPath,
  initialViewMode,
  onNavigate,
  isGuest = false,
  onOpenCorpusTab,
  onOpenConceptTab,
  onRequestLogin,
}) => {
  // Determine if we're in "tab mode" (inside AppShell) or "standalone mode" (URL-routed)
  const isTabMode = !!graphTabId;

  // URL-based params (standalone mode only)
  const urlParams = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // The concept ID to load — from props (tab mode) or URL (standalone)
  const conceptId = isTabMode ? initialConceptId : urlParams.id;

  // Internal navigation state for tab mode
  const [tabConceptId, setTabConceptId] = useState(initialConceptId);
  const [tabPath, setTabPath] = useState(initialPath || []);
  const [tabViewMode, setTabViewMode] = useState(initialViewMode || 'children');

  // The effective concept ID and path (respects tab mode vs standalone)
  const effectiveConceptId = isTabMode ? tabConceptId : urlParams.id;
  const effectivePath = isTabMode
    ? tabPath
    : (searchParams.get('path') || '').split(',').filter(Boolean).map(Number);
  const effectiveViewMode = isTabMode
    ? tabViewMode
    : (searchParams.get('view') === 'flip' ? 'flip' : 'children');

  const [concept, setConcept] = useState(null);
  const [children, setChildren] = useState([]);
  const [path, setPath] = useState([]);
  const [currentEdgeVoteCount, setCurrentEdgeVoteCount] = useState(null);
  const [currentAttribute, setCurrentAttribute] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortMode, setSortMode] = useState('saves'); // 'saves' | 'new' | 'annotations' | 'top_annotation'
  
  // Vote set state
  const [voteSets, setVoteSets] = useState([]);
  const [edgeToSets, setEdgeToSets] = useState({});
  const [activeSetIndices, setActiveSetIndices] = useState([]);
  const [tieredView, setTieredView] = useState(false);

  // User's own vote set index (Phase 5f)
  const [userSetIndex, setUserSetIndex] = useState(null);

  // Parent edge ID for ranking context (Phase 5f)
  const [parentEdgeId, setParentEdgeId] = useState(null);

  // Swap modal state
  const [swapModalEdge, setSwapModalEdge] = useState(null);

  // Share link state
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  // Phase 14a: Diff modal state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffInitialConcept, setDiffInitialConcept] = useState(null);

  // Phase 16c: Hidden concepts state
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  
  // Phase 27d: Responsive layout
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 899px)');
    const handler = (e) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Flip view state
  const [parents, setParents] = useState([]);
  const [originEdgeId, setOriginEdgeId] = useState(null);
  const [loadingFlip, setLoadingFlip] = useState(false);
  const userToggledFlip = useRef(false);

  // Decontextualized flip view detection
  const hasPath = isTabMode
    ? effectivePath.length > 0
    : (searchParams.has('path') && searchParams.get('path') !== '');
  const isDecontextualized = effectiveViewMode === 'flip' && !hasPath;

  useEffect(() => {
    loadConcept();
  }, [effectiveConceptId, effectivePath.join(','), sortMode, effectiveViewMode]);

  // Sync internal state if AppShell navigates this tab externally
  // (e.g. search result clicked, or browser back/forward via popstate)
  const initialPathKey = (initialPath || []).join(',');
  useEffect(() => {
    if (!isTabMode) return;
    const conceptChanged = initialConceptId !== tabConceptId;
    const pathChanged = (initialPath || []).join(',') !== tabPath.join(',');
    const viewModeChanged = (initialViewMode || 'children') !== tabViewMode;
    if (conceptChanged || pathChanged || viewModeChanged) {
      setTabConceptId(initialConceptId);
      setTabPath(initialPath || []);
      setTabViewMode(initialViewMode || 'children');
      userToggledFlip.current = false;
    }
  }, [initialConceptId, initialPathKey, initialViewMode]);

  const loadConcept = async () => {
    try {
      setLoading(true);
      const pathParam = effectivePath.join(',');
      const sortParam = sortMode === 'saves' ? undefined : sortMode;
      const response = await conceptsAPI.getConceptWithChildren(
        effectiveConceptId, pathParam, sortParam
      );
      
      setConcept(response.data.concept);
      setChildren(response.data.children);
      setPath(response.data.path);
      setCurrentEdgeVoteCount(response.data.currentEdgeVoteCount);
      setCurrentAttribute(response.data.currentAttribute || null);
      setError(null);

      // If flip view, load parents too
      if (effectiveViewMode === 'flip') {
        const parentsResponse = await conceptsAPI.getConceptParents(effectiveConceptId, pathParam);
        setParents(parentsResponse.data.parents);
        setOriginEdgeId(parentsResponse.data.originEdgeId || null);
      }

      // Load vote sets for children view
      if (effectiveViewMode !== 'flip') {
        loadVoteSets(pathParam);
        // Phase 16c: Load hidden children count
        loadHiddenCount();
      }
    } catch (err) {
      setError('Failed to load concept');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadVoteSets = async (pathParam) => {
    try {
      const response = await conceptsAPI.getVoteSets(effectiveConceptId, pathParam);
      setVoteSets(response.data.voteSets || []);
      setEdgeToSets(response.data.edgeToSets || {});
      setUserSetIndex(response.data.userSetIndex != null ? response.data.userSetIndex : null);
      setParentEdgeId(response.data.parentEdgeId || null);
      setActiveSetIndices([]);
      setTieredView(false);
    } catch (err) {
      console.error('Failed to load vote sets:', err);
      setVoteSets([]);
      setEdgeToSets({});
      setUserSetIndex(null);
      setParentEdgeId(null);
    }
  };

  // Phase 16c: Load count of hidden children for the badge
  const loadHiddenCount = async () => {
    if (!user) { setHiddenCount(0); return; }
    try {
      const response = await moderationAPI.getHiddenChildren(effectiveConceptId, effectivePath);
      setHiddenCount((response.data.hiddenChildren || []).length);
    } catch (err) {
      // Silently fail — badge just won't show
      setHiddenCount(0);
    }
  };

  // ─── Navigation helpers ──────────────────────────────────

  // Navigate within this tab to a new concept
  const navigateInTab = (newConceptId, newPath, newViewMode) => {
    if (isTabMode) {
      setTabConceptId(newConceptId);
      setTabPath(newPath);
      setTabViewMode(newViewMode || 'children');

      if (onNavigate && graphTabId) {
        onNavigate(graphTabId, {
          tabType: 'concept',
          conceptId: newConceptId,
          path: newPath,
          viewMode: newViewMode || 'children',
          // label will be updated again once concept loads; omit here to avoid flash of wrong name
        });
      }
    } else {
      const pathStr = newPath.join(',');
      const viewParam = newViewMode === 'flip' ? '&view=flip' : '';
      navigate(`/concept/${newConceptId}?path=${pathStr}${viewParam}`);
    }
  };

  const navigateToRoot = () => {
    if (isTabMode) {
      setTabConceptId(null);
      setTabPath([]);
      setTabViewMode('children');
      if (onNavigate && graphTabId) {
        onNavigate(graphTabId, {
          tabType: 'root',
          conceptId: null,
          path: [],
          viewMode: 'children',
          label: 'Root',
        });
      }
    } else {
      navigate('/');
    }
  };

  // Update tab label when concept loads
  useEffect(() => {
    if (isTabMode && concept && onNavigate && graphTabId) {
      onNavigate(graphTabId, { label: concept.name });
    }
  }, [concept, currentAttribute]);

  // ─── Handlers (mostly unchanged from original) ──────────

  const loadFlipView = async () => {
    try {
      setLoadingFlip(true);
      const pathParam = effectivePath.join(',');
      const response = await conceptsAPI.getConceptParents(effectiveConceptId, pathParam);
      
      setParents(response.data.parents);
      setOriginEdgeId(response.data.originEdgeId || null);

      if (isTabMode) {
        navigateInTab(effectiveConceptId, effectivePath, 'flip');
      } else {
        const params = new URLSearchParams(searchParams);
        params.set('view', 'flip');
        navigate(`/concept/${effectiveConceptId}?${params.toString()}`);
      }
    } catch (err) {
      console.error('Failed to load flip view:', err);
      alert('Failed to load parent contexts');
    } finally {
      setLoadingFlip(false);
    }
  };

  const handleConceptClick = (childId) => {
    navigateInTab(childId, path, 'children');
  };

  const handleAddConcept = async (name) => {
    try {
      const pathString = path.slice(0, -1).join(',');
      await conceptsAPI.createChildConcept(name, effectiveConceptId, pathString);
      await loadConcept();
      setShowAddModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create concept');
    }
  };

  const handleVote = async (edgeId, hasVoted, childPath) => {
    try {
      if (hasVoted) {
        await votesAPI.removeVote(edgeId);
      } else {
        // Phase 20c: Saving — optimistically clear any swap vote for this edge in local state
        setChildren(prev => prev.map(c =>
          c.edge_id === edgeId
            ? { ...c, swap_count: Math.max(0, (c.swap_count || 1) - 1) }
            : c
        ));
        await votesAPI.addVote(edgeId, path);
      }
      await loadConcept();
    } catch (err) {
      console.error('Vote failed:', err);
      alert(err.response?.data?.error || 'Failed to vote');
    }
  };

  const handleBreadcrumbClick = (clickedIndex) => {
    if (clickedIndex === 0) {
      navigateToRoot();
    } else {
      const targetId = path[clickedIndex - 1];
      const newPath = path.slice(0, clickedIndex - 1);
      navigateInTab(targetId, newPath, 'children');
    }
  };

  const handleToggleView = () => {
    userToggledFlip.current = true;
    if (effectiveViewMode === 'children') {
      loadFlipView();
    } else {
      if (isTabMode) {
        setTabViewMode('children');
        if (onNavigate && graphTabId) {
          onNavigate(graphTabId, { viewMode: 'children' });
        }
      } else {
        const params = new URLSearchParams(searchParams);
        params.delete('view');
        navigate(`/concept/${effectiveConceptId}?${params.toString()}`);
      }
    }
  };

  const handleShareLink = async () => {
    const pathStr = effectivePath.slice(0, -1).join(',');
    const url = `${window.location.origin}/concept/${effectiveConceptId}${pathStr ? '?path=' + pathStr : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
    }
  };

  // When user clicks an alt parent card in Flip View, stay on the current concept
  // but switch to the clicked parent's context (Phase 38a)
  const handleFlipViewParentClick = (parent) => {
    navigateInTab(effectiveConceptId, parent.graph_path, 'children');
  };

  const handleConceptAdded = () => {
    loadConcept();
  };

  const handleSwapClick = (childConcept) => {
    setSwapModalEdge({
      edgeId: childConcept.edge_id,
      conceptName: childConcept.name,
      conceptId: childConcept.id,
    });
  };

  const handleSwapModalClose = () => setSwapModalEdge(null);
  const handleSwapVoteChanged = () => {
    // Phase 20c: Swap vote added — optimistically clear any save for this edge in local state
    if (swapModalEdge) {
      const eid = swapModalEdge.edgeId;
      setChildren(prev => prev.map(c =>
        c.edge_id === eid
          ? {
              ...c,
              user_voted: false,
              vote_count: c.user_voted ? Math.max(0, (parseInt(c.vote_count) || 1) - 1) : (parseInt(c.vote_count) || 0),
            }
          : c
      ));
    }
    loadConcept();
  };

  // Phase 14a: Open diff modal from right-click on a child card
  const handleCompareChildren = (child) => {
    // path state = graph_path used by the current concept's children query (e.g. [2] when viewing Cooking)
    // The child's own children live at graph_path = [...path, child.id]
    // But getBatchChildrenForDiff uses the same convention as getConceptWithChildren:
    // it takes the parent's path context, i.e. the graph_path on the child's edges = path (which already includes current concept)
    const childPath = [...(path || [])];

    // Build path names for display from breadcrumb data
    // path = [rootId, ..., currentConceptId], concept.name is the current concept
    let displayPathNames = [];
    if (concept && path.length > 0) {
      // We don't have all ancestor names readily available, but we can at least
      // pass what we know and let DiffModal resolve them via getConceptNames
      displayPathNames = []; // DiffModal will resolve from path IDs
    }

    setDiffInitialConcept({
      conceptId: child.id,
      name: child.name,
      attribute: child.attribute_name || '',
      path: childPath,
      pathNames: displayPathNames
    });
    setDiffModalOpen(true);
  };

  // Phase 16c: Flag a child concept as spam
  const handleFlag = async (child) => {
    if (!user) return;
    const confirmMsg = `Flag "${child.name}" as spam?\n\nOnce 10 users have flagged it, it will be hidden from all users. It can be reviewed and restored from the Hidden panel.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await moderationAPI.flagEdge(child.edge_id, 'spam');
      await loadConcept();
      await loadHiddenCount();
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.error?.includes('already flagged')) {
        alert('You have already flagged this concept.');
      } else {
        alert(err.response?.data?.error || 'Failed to flag concept');
      }
    }
  };

  const handleUnflag = async (child) => {
    if (!user) return;
    try {
      await moderationAPI.unflagEdge(child.edge_id);
      await loadConcept();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove flag');
    }
  };

  // --- Vote set filtering ---
  const handleSetClick = (setIndex) => {
    if (setIndex === null) {
      setActiveSetIndices([]);
      setTieredView(false);
      return;
    }
    setActiveSetIndices(prev => {
      const next = prev.includes(setIndex)
        ? prev.filter(i => i !== setIndex)
        : [...prev, setIndex];
      if (next.length < 2) setTieredView(false);
      return next;
    });
  };

  const handleTieredToggle = () => setTieredView(prev => !prev);

  const getEffectiveActiveSetIndices = () => {
    return activeSetIndices;
  };

  const getFilteredChildren = () => {
    const effectiveIndices = getEffectiveActiveSetIndices();
    if (effectiveIndices.length === 0) return children;
    const filtered = children.filter(child => {
      const childSets = edgeToSets[child.edge_id] || [];
      return childSets.some(setIdx => effectiveIndices.includes(setIdx));
    });
    return [...filtered].sort((a, b) => {
      const aSets = (edgeToSets[a.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      const bSets = (edgeToSets[b.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      if (bSets !== aSets) return bSets - aSets;
      return (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0);
    });
  };

  const getTieredSections = () => {
    const effectiveIndices = getEffectiveActiveSetIndices();
    if (effectiveIndices.length < 2) return null;
    const totalSelected = effectiveIndices.length;
    const filtered = children.filter(child => {
      const childSets = edgeToSets[child.edge_id] || [];
      return childSets.some(setIdx => effectiveIndices.includes(setIdx));
    });
    const byMatchCount = {};
    filtered.forEach(child => {
      const matchCount = (edgeToSets[child.edge_id] || []).filter(s => effectiveIndices.includes(s)).length;
      if (!byMatchCount[matchCount]) byMatchCount[matchCount] = [];
      byMatchCount[matchCount].push(child);
    });
    Object.values(byMatchCount).forEach(group => {
      group.sort((a, b) => (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0));
    });
    const sections = [];
    for (let count = totalSelected; count >= 1; count--) {
      if (byMatchCount[count] && byMatchCount[count].length > 0) {
        let label = count === totalSelected
          ? `In all ${totalSelected} selected patterns`
          : `In ${count} of ${totalSelected}`;
        sections.push({ label, matchCount: count, children: byMatchCount[count] });
      }
    }
    return sections;
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (error || !concept) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error || 'Concept not found'}</div>
      </div>
    );
  }

  const searchPath = path.slice(0, -1).join(',');


  const effectiveIndices = getEffectiveActiveSetIndices();
  const hasActiveFilters = effectiveIndices.length > 0;
  const displayChildren = getFilteredChildren();
  const tieredSections = (tieredView && effectiveIndices.length >= 2) ? getTieredSections() : null;
  const filteredCount = hasActiveFilters ? displayChildren.length : children.length;
  const totalActiveFilterCount = activeSetIndices.length;

  return (
    <div style={styles.container}>
      {/* Breadcrumb / header area (no app-level header — that's in AppShell) */}
      <div style={styles.headerBar}>
        <div style={styles.headerContent}>
          <div style={styles.breadcrumbWithBack}>
            {!isDecontextualized ? (
              <>
                <Breadcrumb
                  path={path}
                  currentConcept={concept}
                  currentAttribute={currentAttribute}
                  onBreadcrumbClick={handleBreadcrumbClick}
                />
                {currentAttribute && (
                  <span style={styles.graphAttributeBadge}>{currentAttribute.name}</span>
                )}
              </>
            ) : (
              <div style={styles.decontextTitle}>
                {concept.name}
                <span style={styles.decontextSubtitle}> — all parent contexts</span>
              </div>
            )}
          </div>
          <div style={styles.buttonSection}>
            {!(isDecontextualized && !userToggledFlip.current) && (
              <button
                onClick={handleToggleView}
                style={styles.flipButton}
                disabled={loadingFlip}
              >
                {loadingFlip ? 'Loading...' : effectiveViewMode === 'children' ? 'Flip View' : 'Children View'}
              </button>
            )}
            <div style={styles.shareButtonWrapper}>
              <button
                onClick={handleShareLink}
                style={styles.shareButton}
                title="Copy shareable link to clipboard"
              >
                {shareLinkCopied ? 'Copied!' : 'Share'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main style={styles.main}>
        <div style={effectiveConceptId ? (isNarrow ? styles.twoColumnLayoutNarrow : styles.twoColumnLayout) : undefined}>
          <div style={effectiveConceptId ? (isNarrow ? styles.leftColumnNarrow : styles.leftColumn) : undefined}>
            {effectiveViewMode === 'children' ? (
              <>
                <div style={styles.conceptHeader}>
                  <h2 style={styles.conceptName} title={concept.name}>
                    {concept.name}
                  </h2>
                  {currentEdgeVoteCount !== null && (
                    <span style={styles.voteTotal}>
                      {currentEdgeVoteCount} {currentEdgeVoteCount === 1 ? 'vote' : 'votes'}
                    </span>
                  )}
                  <div style={{ ...styles.sortRow, marginLeft: 'auto', flexShrink: 0 }}>
                    {[
                      { value: 'saves', label: 'Graph Votes' },
                      { value: 'new', label: 'Newest' },
                      { value: 'annotations', label: 'Annotations' },
                      { value: 'top_annotation', label: 'Top Annotation' },
                    ].map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => setSortMode(opt.value)}
                        style={{
                          ...styles.sortBtn,
                          ...(sortMode === opt.value ? styles.sortBtnActive : {}),
                          ...(i < 3 ? { borderRight: '1px solid #eee' } : {}),
                        }}
                      >{opt.label}</button>
                    ))}
                  </div>
                  {hiddenCount > 0 && user && (
                    <button
                      onClick={() => setShowHiddenPanel(true)}
                      style={styles.hiddenBadge}
                      title={`${hiddenCount} hidden concept${hiddenCount !== 1 ? 's' : ''} — click to review`}
                    >
                      {hiddenCount} hidden
                    </button>
                  )}
                </div>

                <VoteSetBar
                  voteSets={voteSets}
                  activeSetIndices={activeSetIndices}
                  onSetClick={handleSetClick}
                  tieredView={tieredView}
                  onTieredToggle={handleTieredToggle}
                  userSetIndex={userSetIndex}
                />

                {hasActiveFilters && (
                  <div style={styles.filterInfo}>
                    Showing {filteredCount} of {children.length} children matching selected patterns
                    {tieredView && effectiveIndices.length >= 2 && ' · tiered view'}
                  </div>
                )}

                {children.length === 0 ? (
                  <div style={styles.emptyState}>
                    <p>{isGuest ? 'No child concepts yet.' : 'No child concepts yet. Add one to get started!'}</p>
                  </div>
                ) : tieredSections ? (
                  tieredSections.map((section) => (
                    <ConceptGrid
                      key={`tier-${section.matchCount}`}
                      concepts={section.children}
                      onConceptClick={handleConceptClick}
                      onVote={isGuest ? undefined : handleVote}
                      onSwapClick={isGuest ? undefined : handleSwapClick}
                      onCompareChildren={handleCompareChildren}
                      onFlag={isGuest ? undefined : handleFlag}
                      onUnflag={isGuest ? undefined : handleUnflag}
                      showVotes={true}
                      path={path}
                      edgeToSets={edgeToSets}
                      tierLabel={section.label}
                    />
                  ))
                ) : (
                  <ConceptGrid
                    concepts={displayChildren}
                    onConceptClick={handleConceptClick}
                    onVote={isGuest ? undefined : handleVote}
                    onSwapClick={isGuest ? undefined : handleSwapClick}
                    onCompareChildren={handleCompareChildren}
                    onFlag={isGuest ? undefined : handleFlag}
                    onUnflag={isGuest ? undefined : handleUnflag}
                    showVotes={true}
                    path={path}
                    edgeToSets={edgeToSets}
                  />
                )}
              </>
            ) : (
              <FlipView
                concept={concept}
                parents={parents}
                originPath={path}
                originEdgeId={originEdgeId}
                mode={isDecontextualized ? 'exploratory' : 'contextual'}
                isGuest={isGuest}
                onParentClick={handleFlipViewParentClick}
              />
            )}
          </div>
          {effectiveConceptId && (
            <div style={isNarrow ? styles.rightColumnNarrow : styles.rightColumn}>
              <ConceptAnnotationPanel
                conceptId={effectiveConceptId}
                conceptName={concept.name}
                path={effectivePath}
                currentEdgeId={parentEdgeId}
                isGuest={isGuest}
                viewMode={effectiveViewMode}
                onOpenCorpusTab={onOpenCorpusTab}
                onRequestLogin={onRequestLogin}
                collapsible={isNarrow}
              />
            </div>
          )}
        </div>
      </main>

      <SearchField
        parentId={effectiveConceptId}
        path={searchPath}
        viewMode={effectiveViewMode}
        onConceptAdded={handleConceptAdded}
        graphTabId={graphTabId}
        onNavigate={onNavigate}
        isGuest={isGuest}
      />

      {showAddModal && (
        <AddConceptModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddConcept}
          title={`Add Child to "${concept.name}"`}
        />
      )}

      {swapModalEdge && (
        <SwapModal
          edgeId={swapModalEdge.edgeId}
          conceptName={swapModalEdge.conceptName}
          onClose={handleSwapModalClose}
          onSwapVoteChanged={handleSwapVoteChanged}
        />
      )}

      {/* Phase 14a: Diff Modal */}
      <DiffModal
        isOpen={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        initialConcept={diffInitialConcept}
        isGuest={isGuest}
      />

      {/* Phase 16c: Hidden Concepts Panel */}
      {showHiddenPanel && (
        <HiddenConceptsView
          parentId={effectiveConceptId}
          path={effectivePath}
          onClose={() => { setShowHiddenPanel(false); loadHiddenCount(); loadConcept(); }}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#f5f5f5',
  },
  headerBar: {
    backgroundColor: 'white',
    borderBottom: '1px solid #ddd',
    padding: '12px 20px',
  },
  headerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
  },
  breadcrumbWithBack: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  },
  decontextTitle: {
    fontSize: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  decontextSubtitle: {
    fontSize: '16px',
    color: '#888',
    fontStyle: 'normal',
  },
  buttonSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  flipButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '500',
  },
  shareButtonWrapper: {
    position: 'relative',
  },
  shareButton: {
    padding: '8px 16px',
    backgroundColor: '#f0f0f0',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  twoColumnLayout: {
    display: 'flex',
    gap: '0',
    alignItems: 'stretch',
  },
  twoColumnLayoutNarrow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  leftColumn: {
    flex: '0 0 65%',
    maxWidth: '65%',
    overflowY: 'auto',
    paddingRight: '20px',
  },
  leftColumnNarrow: {
    width: '100%',
  },
  rightColumn: {
    flex: '0 0 35%',
    maxWidth: '35%',
    overflowY: 'auto',
    borderLeft: '1px solid #e0d9cf',
    paddingLeft: '20px',
  },
  rightColumnNarrow: {
    width: '100%',
    borderTop: '1px solid #e0d9cf',
    paddingTop: '20px',
    marginTop: '20px',
  },
  conceptHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    marginBottom: '20px',
  },
  conceptName: {
    fontSize: '32px',
    margin: 0,
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
  },
  attributeTagHeader: {
    color: '#888',
    fontWeight: '400',
    fontSize: '24px',
  },
  graphAttributeBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    background: '#f0ede8',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#555',
    marginLeft: '8px',
    verticalAlign: 'middle',
    flexShrink: 0,
  },
  voteTotal: {
    fontSize: '16px',
    color: '#888',
  },
  sortRow: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  sortBtn: {
    padding: '3px 10px',
    border: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  sortBtnActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  hiddenBadge: {
    padding: '4px 10px',
    fontSize: '12px',
    backgroundColor: '#f5f0ea',
    color: '#555',
    border: '1px solid #d4d0c8',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    marginLeft: '8px',
  },
  filterInfo: {
    fontSize: '13px',
    color: '#888',
    fontStyle: 'normal',
    marginBottom: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#666',
  },
  error: {
    padding: '15px',
    backgroundColor: '#fee',
    color: '#c33',
    borderRadius: '4px',
    margin: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
};

export default Concept;
