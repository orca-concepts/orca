import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { votesAPI, corpusAPI, messagesAPI, combosAPI } from '../services/api';
import { arrayMove } from '@dnd-kit/sortable';
import Root from '../pages/Root';
import Concept from '../pages/Concept';
import SavedTabContent from '../pages/SavedTabContent';
import SavedPageOverlay from '../components/SavedPageOverlay';
import CorpusTabContent from '../components/CorpusTabContent';
import CorpusListView from '../components/CorpusListView';
import CorpusDetailView from '../components/CorpusDetailView';
import DocumentView from '../components/DocumentView';
import OrphanRescueModal from '../components/OrphanRescueModal';
import LoginModal from '../components/LoginModal';
import DeleteAccountFlow from '../components/DeleteAccountFlow';
import SidebarDndContext, { SortableItem, SortableGroupWrapper, GroupMemberContext } from '../components/SidebarDndContext';
import InfoPage from '../components/InfoPage';
import MessagesPage from '../components/MessagesPage';
import ComboListView from '../components/ComboListView';
import ComboTabContent from '../components/ComboTabContent';

const AppShell = () => {
  const { logout, logoutEverywhere, user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Phase 30g: Info page detection and header nav
  const INFO_SLUGS = ['using-orca', 'constitution', 'donate'];
  const infoSlug = INFO_SLUGS.find(s => location.pathname === `/${s}`);

  // Graph tabs (new Phase 5c — persistent navigation panes)
  const [graphTabs, setGraphTabs] = useState([]);

  // Corpus tabs (Phase 7c — subscription-based persistent tabs)
  const [corpusTabs, setCorpusTabs] = useState([]);

  // Pending document to open after switching to a corpus tab (Phase 7d-4)
  const [pendingCorpusDocumentId, setPendingCorpusDocumentId] = useState(null);

  // Phase 27c: Pending annotation to highlight after navigating to a document
  const [pendingAnnotationId, setPendingAnnotationId] = useState(null);

  // Phase 38h: Pending annotation from graph — pre-fill annotation creation panel
  const [pendingAnnotationFromGraph, setPendingAnnotationFromGraph] = useState(null);

  // Tab groups (Phase 5d)
  const [tabGroups, setTabGroups] = useState([]);

  // Sidebar Items (Phase 19b — unified ordered list)
  const [sidebarItems, setSidebarItems] = useState([]);

  // DnD state (Phase 19c)
  const [activeDragId, setActiveDragId] = useState(null); // sidebar_item.id being dragged
  const [overGroupItemId, setOverGroupItemId] = useState(null); // sidebar_item.id of group being hovered

  // Phase 28f: Login modal state
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalTab, setLoginModalTab] = useState('login');
  const [loginModalNotice, setLoginModalNotice] = useState('');

  // Phase 35d: Account dropdown menu and delete flow
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const accountMenuRef = useRef(null);

  const handleRequestLogin = useCallback(() => {
    setLoginModalTab('login');
    setLoginModalNotice('Log in to view documents and annotations');
    setShowLoginModal(true);
  }, []);

  // Active tab: { type: 'corpus', id: N } or { type: 'graph', id: N }
  const [activeTab, setActiveTab] = useState(null);

  // Group renaming state
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [groupRenameValue, setGroupRenameValue] = useState('');
  const groupRenameInputRef = useRef(null);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, tabType, tabId } or { x, y, groupId }

  // Loading
  const [loading, setLoading] = useState(true);

  // Corpus view state: null (not showing), or { view: 'list' | 'detail' | 'document', corpusId?, documentId? }
  const [corpusView, setCorpusView] = useState(null);

  // Saved Page overlay state (Phase 7c-3)
  const [savedPageOpen, setSavedPageOpen] = useState(false);

  // Phase 39b: Combo browse overlay state
  const [comboView, setComboView] = useState(null); // null | { view: 'list' }

  // Phase 39b: Combo subscriptions (persistent combo tabs)
  const [comboSubscriptions, setComboSubscriptions] = useState([]);

  // Phase 31b: Messages page state
  const [messagesPageOpen, setMessagesPageOpen] = useState(false);
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);
  const [messagesInitialAnnotationId, setMessagesInitialAnnotationId] = useState(null);
  const [messagesInitialAnnotationIds, setMessagesInitialAnnotationIds] = useState(null); // equivalent annotation IDs for version-aware deep-linking

  // Phase 9b: Orphan rescue modal state
  const [showOrphanModal, setShowOrphanModal] = useState(false);
  const [orphanCount, setOrphanCount] = useState(0);
  // Phase 12b: Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Guest tab ID counter (ephemeral, local-only tabs for non-logged-in users)
  const guestTabCounter = useRef(1);

  // Phase 30c: Browser history integration for graph tab navigation
  const popstateInProgressRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Load all tabs + groups on mount (skip for guests)
  useEffect(() => {
    document.title = 'orca';
    if (isGuest) {
      // Guest mode: create one ephemeral local-only graph tab
      const guestTab = {
        id: 'guest-1',
        tab_type: 'root',
        concept_id: null,
        path: [],
        view_mode: 'children',
        label: 'Root',
        group_id: null,
      };
      setGraphTabs([guestTab]);
      setActiveTab({ type: 'graph', id: 'guest-1' });
      setLoading(false);
    } else {
      loadAllTabs();
    }
  }, [isGuest]);

  // Phase 30c: Build URL for graph tab history entries
  const buildGraphTabUrl = (tabId, tabType, conceptId, path, viewMode) => {
    const params = new URLSearchParams();
    params.set('gtab', String(tabId));
    if (tabType === 'concept' && conceptId) {
      params.set('c', String(conceptId));
      if (path && path.length > 0) {
        params.set('p', path.join(','));
      }
      if (viewMode === 'flip') {
        params.set('v', 'flip');
      }
    }
    return '?' + params.toString();
  };

  // Phase 30c: Popstate listener for browser back/forward within graph tabs
  useEffect(() => {
    const handlePopstate = (event) => {
      const state = event.state;
      if (!state || !state.orcaNav) return;

      popstateInProgressRef.current = true;

      // Switch to the correct tab if needed
      const cur = activeTabRef.current;
      if (!cur || cur.type !== 'graph' || cur.id !== state.tabId) {
        setActiveTab({ type: 'graph', id: state.tabId });
      }

      // Update the graph tab's state
      const updates = {
        tab_type: state.tabType,
        concept_id: state.conceptId,
        path: state.path || [],
        view_mode: state.viewMode || 'children',
      };
      setGraphTabs(prev => prev.map(t =>
        t.id === state.tabId ? { ...t, ...updates } : t
      ));

      // Persist to DB (non-blocking)
      if (!isGuest) {
        votesAPI.updateGraphTab(state.tabId, {
          tabType: state.tabType,
          conceptId: state.conceptId,
          path: state.path || [],
          viewMode: state.viewMode || 'children',
        }).catch(err => console.error('Failed to persist popstate nav:', err));
      }

      document.title = 'orca';
      popstateInProgressRef.current = false;
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [isGuest]);

  // Phase 30c: Seed initial history entry once tabs are loaded
  useEffect(() => {
    if (loading || !activeTab || activeTab.type !== 'graph') return;
    // Only seed if history state is not already ours (first load)
    if (window.history.state && window.history.state.orcaNav) return;
    const tab = graphTabs.find(t => t.id === activeTab.id);
    if (!tab) return;
    const state = {
      orcaNav: true,
      tabId: tab.id,
      tabType: tab.tab_type,
      conceptId: tab.concept_id,
      path: tab.path || [],
      viewMode: tab.view_mode || 'children',
    };
    const url = buildGraphTabUrl(tab.id, tab.tab_type, tab.concept_id, tab.path, tab.view_mode);
    window.history.replaceState(state, '', url);
  }, [loading, activeTab, graphTabs]);

  // Phase 31b: Fetch unread message count on mount and periodically
  const refreshUnreadCount = useCallback(async () => {
    if (isGuest || authLoading) return;
    try {
      const res = await messagesAPI.getUnreadCount();
      setMessagesUnreadCount(res.data.unread_count || 0);
    } catch (err) {
      // Non-critical — don't break the app
    }
  }, [isGuest, authLoading]);

  useEffect(() => {
    if (isGuest || authLoading) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [isGuest, authLoading, refreshUnreadCount]);

  // Phase 9b: Check for orphaned documents on mount (logged-in users only)
  useEffect(() => {
    if (isGuest || authLoading) return;
    const checkOrphans = async () => {
      try {
        const res = await corpusAPI.getOrphanedDocuments();
        const count = (res.data.orphanedDocuments || []).length;
        setOrphanCount(count);
        if (count > 0) {
          setShowOrphanModal(true);
        }
      } catch (err) {
        // Silently fail — orphan check is non-critical
        console.error('Orphan check failed:', err);
      }
    };
    checkOrphans();
  }, [isGuest, authLoading]);

  useEffect(() => {
    if (renamingGroupId && groupRenameInputRef.current) {
      groupRenameInputRef.current.focus();
      groupRenameInputRef.current.select();
    }
  }, [renamingGroupId]);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.document.addEventListener('click', handleClick);
      return () => window.document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // Phase 38j: Handle pending citation from CitationRedirect route
  useEffect(() => {
    const state = location.state;
    if (state?.pendingCitation && !isGuest) {
      const { corpusId, corpusName, documentId, annotationId } = state.pendingCitation;
      // Clear the state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
      // Use the existing subscribe-and-navigate pattern
      handleSubscribeToCorpus(corpusId, corpusName || '', documentId, annotationId);
    }
  }, [location.state, isGuest]);

  // Close account menu on click outside
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClick = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setShowAccountMenu(false);
      }
    };
    window.document.addEventListener('mousedown', handleClick);
    return () => window.document.removeEventListener('mousedown', handleClick);
  }, [showAccountMenu]);

  const loadAllTabs = async () => {
    try {
      setLoading(true);
      const [graphRes, groupsRes, subsRes, sidebarRes, comboSubsRes] = await Promise.all([
        votesAPI.getGraphTabs().catch(() => ({ data: { graphTabs: [] } })),
        votesAPI.getTabGroups().catch(() => ({ data: { tabGroups: [] } })),
        corpusAPI.getMySubscriptions().catch(() => ({ data: { subscriptions: [] } })),
        votesAPI.getSidebarItems().catch(err => {
          console.warn('getSidebarItems failed, sidebar order will be default:', err);
          return { data: { items: [] } };
        }),
        combosAPI.getSubscriptions().catch(() => ({ data: { subscriptions: [] } })),
      ]);
      const loadedGraph = graphRes.data.graphTabs;
      const loadedGroups = groupsRes.data.tabGroups;
      const loadedCorpusTabs = (subsRes.data.subscriptions || []).map(sub => ({
        id: sub.id, // corpus ID
        corpus_id: sub.id, // explicit alias
        name: sub.name,
        subscriber_count: sub.subscriber_count,
        group_id: null,
      }));
      const loadedComboSubs = (comboSubsRes.data.subscriptions || []).map(sub => ({
        id: sub.id, // combo ID
        combo_id: sub.id,
        name: sub.name,
        subscriber_count: sub.subscriber_count,
      }));
      setGraphTabs(loadedGraph);
      setTabGroups(loadedGroups);
      setCorpusTabs(loadedCorpusTabs);
      setComboSubscriptions(loadedComboSubs);
      setSidebarItems(sidebarRes.data.items || []);

      // Set active tab: prefer first graph tab, then first corpus tab
      if (loadedGraph.length > 0) {
        setActiveTab({ type: 'graph', id: loadedGraph[0].id });
      } else if (loadedCorpusTabs.length > 0) {
        setActiveTab({ type: 'corpus', id: loadedCorpusTabs[0].id });
      } else {
        // No tabs at all — will auto-create a default graph tab
        createDefaultGraphTab();
      }
    } catch (err) {
      console.error('Failed to load tabs:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshSidebarItems = async () => {
    try {
      const res = await votesAPI.getSidebarItems();
      setSidebarItems(res.data.items || []);
    } catch (err) {
      // non-critical
    }
  };

  // ─── Sidebar DnD Handlers (Phase 19c) ──────────────────

  const handleDragStart = ({ active }) => {
    setActiveDragId(active.id);
  };

  const handleDragOver = ({ active, over }) => {
    if (!over) { setOverGroupItemId(null); return; }
    const activeItem = sidebarItems.find(i => i.id === active.id);
    const overItem = sidebarItems.find(i => i.id === over.id);
    // Highlight a group when dragging any graph_tab over it
    if (activeItem?.item_type === 'graph_tab' && overItem?.item_type === 'group') {
      setOverGroupItemId(over.id);
    } else {
      setOverGroupItemId(null);
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveDragId(null);
    setOverGroupItemId(null);
    if (!over || active.id === over.id) return;

    const activeItem = sidebarItems.find(i => i.id === active.id);
    const overItem = sidebarItems.find(i => i.id === over.id);
    if (!activeItem || !overItem) return;

    const activeTab = activeItem.item_type === 'graph_tab'
      ? graphTabs.find(t => t.id === activeItem.item_id) : null;
    const activeIsGrouped = !!activeTab?.group_id;

    // Case 1: Drop any graph_tab onto a group → move to that group
    if (activeItem.item_type === 'graph_tab' && overItem.item_type === 'group') {
      const tabId = activeItem.item_id;
      const newGroupId = overItem.item_id;
      const oldGroupId = activeTab?.group_id || null;
      if (oldGroupId === newGroupId) return;
      setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: newGroupId } : t));
      try {
        if (oldGroupId) await votesAPI.removeTabFromGroup('graph', tabId);
        await votesAPI.addTabToGroup('graph', tabId, newGroupId);
        await refreshSidebarItems();
      } catch (err) {
        setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: oldGroupId } : t));
        console.error('Failed to move tab into group:', err);
      }
      return;
    }

    // Case 2: Grouped graph_tab dropped on a non-group top-level item → pull out of group
    if (activeIsGrouped && overItem.item_type !== 'group') {
      const tabId = activeItem.item_id;
      const oldGroupId = activeTab.group_id;
      setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: null } : t));
      try {
        await votesAPI.removeTabFromGroup('graph', tabId);
        await refreshSidebarItems();
      } catch (err) {
        setGraphTabs(prev => prev.map(t => t.id === tabId ? { ...t, group_id: oldGroupId } : t));
        console.error('Failed to pull tab out of group:', err);
      }
      return;
    }

    // Case 3: Reorder top-level items
    const topLevelItems = sidebarItems.filter(item => {
      if (item.item_type === 'graph_tab') {
        return !graphTabs.find(t => t.id === item.item_id)?.group_id;
      }
      return true;
    });
    const oldIndex = topLevelItems.findIndex(i => i.id === active.id);
    const newIndex = topLevelItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reorderedTop = arrayMove(topLevelItems, oldIndex, newIndex)
      .map((item, i) => ({ ...item, display_order: (i + 1) * 10 }));

    // Optimistic update
    setSidebarItems(prev => {
      const grouped = prev.filter(item =>
        item.item_type === 'graph_tab' &&
        !!graphTabs.find(t => t.id === item.item_id)?.group_id
      );
      return [...reorderedTop, ...grouped];
    });

    try {
      await votesAPI.reorderSidebarItems(
        reorderedTop.map(item => ({ id: item.id, display_order: item.display_order }))
      );
    } catch (err) {
      await refreshSidebarItems();
      console.error('Failed to reorder sidebar items:', err);
    }
  };

  // ─── Graph Tab Actions ───────────────────────────────────

  const handleCreateGraphTab = async () => {
    if (isGuest) {
      // Guest mode: ephemeral local-only tab
      guestTabCounter.current += 1;
      const newTab = {
        id: `guest-${guestTabCounter.current}`,
        tab_type: 'root',
        concept_id: null,
        path: [],
        view_mode: 'children',
        label: 'Root',
        group_id: null,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }
    try {
      const res = await votesAPI.createGraphTab('root', null, [], 'children', 'Root');
      const newTab = res.data.graphTab;
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to create graph tab:', err);
    }
  };

  const handleCloseGraphTab = async (tabId) => {
    if (isGuest) {
      // Guest mode: just remove from local state
      setGraphTabs(prev => {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const remaining = prev.filter(t => t.id !== tabId);
        if (activeTab?.type === 'graph' && activeTab?.id === tabId) {
          if (remaining.length > 0) {
            const nextIndex = Math.min(closedIndex, remaining.length - 1);
            setActiveTab({ type: 'graph', id: remaining[nextIndex].id });
          } else {
            // Create a new ephemeral tab
            guestTabCounter.current += 1;
            const newTab = {
              id: `guest-${guestTabCounter.current}`,
              tab_type: 'root', concept_id: null, path: [],
              view_mode: 'children', label: 'Root', group_id: null,
            };
            setActiveTab({ type: 'graph', id: newTab.id });
            return [newTab];
          }
        }
        return remaining;
      });
      return;
    }
    try {
      await votesAPI.closeGraphTab(tabId);
      setGraphTabs(prev => {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const remaining = prev.filter(t => t.id !== tabId);

        // If we closed the active tab, switch to the adjacent tab (Chrome-style)
        if (activeTab?.type === 'graph' && activeTab?.id === tabId) {
          if (remaining.length > 0) {
            const nextIndex = Math.min(closedIndex, remaining.length - 1);
            setActiveTab({ type: 'graph', id: remaining[nextIndex].id });
          } else {
            createDefaultGraphTab();
          }
        }
        return remaining;
      });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to close graph tab:', err);
    }
  };

  const createDefaultGraphTab = async () => {
    try {
      const res = await votesAPI.createGraphTab('root', null, [], 'children', 'Root');
      const newTab = res.data.graphTab;
      setGraphTabs([newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to auto-create graph tab:', err);
      if (corpusTabs.length > 0) {
        setActiveTab({ type: 'corpus', id: corpusTabs[0].id });
      }
    }
  };

  const handleDuplicateGraphTab = async (tabId) => {
    const tab = graphTabs.find(t => t.id === tabId);
    if (!tab) return;
    if (isGuest) {
      guestTabCounter.current += 1;
      const newTab = {
        ...tab,
        id: `guest-${guestTabCounter.current}`,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }
    try {
      const res = await votesAPI.createGraphTab(
        tab.tab_type, tab.concept_id, tab.path, tab.view_mode, tab.label
      );
      const newTab = res.data.graphTab;
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to duplicate graph tab:', err);
    }
  };

  const handleGraphTabNavigate = useCallback(async (tabId, updates) => {
    const normalized = {};
    if (updates.tabType !== undefined)   normalized.tab_type   = updates.tabType;
    if (updates.conceptId !== undefined) normalized.concept_id = updates.conceptId;
    if (updates.path !== undefined)      normalized.path       = updates.path;
    if (updates.viewMode !== undefined)  normalized.view_mode  = updates.viewMode;
    if (updates.label !== undefined)     normalized.label      = updates.label;

    // Phase 30c: Determine if this is a navigation change (not just a label update)
    const isNavChange = updates.conceptId !== undefined || updates.path !== undefined ||
                        updates.viewMode !== undefined || updates.tabType !== undefined;

    setGraphTabs(prev => {
      const updated = prev.map(t =>
        t.id === tabId ? { ...t, ...normalized } : t
      );

      // Phase 30c: Push browser history for navigation changes (not label-only, not popstate)
      if (isNavChange && !popstateInProgressRef.current) {
        const tab = updated.find(t => t.id === tabId);
        if (tab) {
          const state = {
            orcaNav: true,
            tabId: tab.id,
            tabType: tab.tab_type,
            conceptId: tab.concept_id,
            path: tab.path || [],
            viewMode: tab.view_mode || 'children',
          };
          const url = buildGraphTabUrl(tab.id, tab.tab_type, tab.concept_id, tab.path, tab.view_mode);
          window.history.pushState(state, '', url);
          document.title = 'orca';
        }
      }

      return updated;
    });

    // Guest mode: no DB persistence
    if (isGuest) return;

    try {
      await votesAPI.updateGraphTab(tabId, updates);
    } catch (err) {
      console.error('Failed to update graph tab:', err);
    }
  }, [isGuest]);

  const handleOpenConceptTab = useCallback(async (conceptId, path, conceptName, attributeName, sourceCorpusTabId, viewMode) => {
    const label = conceptName || 'Concept';
    const tabType = conceptId ? 'concept' : 'root';
    const effectiveViewMode = viewMode || 'children';

    if (isGuest) {
      guestTabCounter.current += 1;
      const newTab = {
        id: `guest-${guestTabCounter.current}`,
        tab_type: tabType,
        concept_id: conceptId,
        path: path,
        view_mode: effectiveViewMode,
        label,
        group_id: null,
      };
      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      return;
    }

    try {
      const res = await votesAPI.createGraphTab(tabType, conceptId, path, effectiveViewMode, label);
      const newTab = res.data.graphTab;

      setGraphTabs(prev => [...prev, newTab]);
      setActiveTab({ type: 'graph', id: newTab.id });
      await refreshSidebarItems();
    } catch (err) {
      console.error('Failed to open concept tab:', err);
    }
  }, [isGuest, corpusTabs, tabGroups]);

  // ─── Corpus Tab Actions (Phase 7c) ──────────────────────

  const handleSubscribeToCorpus = useCallback(async (corpusId, corpusName, documentId, annotationId) => {
    if (isGuest) {
      handleRequestLogin();
      return;
    }
    try {
      await corpusAPI.subscribe(corpusId);
      const newTab = {
        id: corpusId,
        corpus_id: corpusId,
        name: corpusName,
        group_id: null,
      };
      setCorpusTabs(prev => [...prev, newTab]);
      if (documentId) setPendingCorpusDocumentId(documentId);
      if (annotationId) setPendingAnnotationId(annotationId);
      setActiveTab({ type: 'corpus', id: corpusId });
      await refreshSidebarItems();
    } catch (err) {
      if (err.response?.status === 409) {
        // Already subscribed — ensure the tab is in local state and switch to it
        setCorpusTabs(prev => {
          if (prev.some(t => t.id === corpusId)) return prev;
          return [...prev, { id: corpusId, corpus_id: corpusId, name: corpusName, group_id: null }];
        });
        if (documentId) setPendingCorpusDocumentId(documentId);
        if (annotationId) setPendingAnnotationId(annotationId);
        setActiveTab({ type: 'corpus', id: corpusId });
        await refreshSidebarItems();
      } else if (err.response?.status === 401) {
        handleRequestLogin();
      } else {
        alert(err.response?.data?.error || 'Failed to subscribe');
      }
    }
  }, [isGuest, handleRequestLogin]);

  // Phase 38h: Navigate to a corpus tab doc viewer with annotation creation pre-filled
  const handleAnnotateFromGraph = useCallback(async (corpusId, documentId, annotationInfo) => {
    if (isGuest) {
      handleRequestLogin();
      return;
    }
    // Subscribe if needed (handles 409 for already-subscribed)
    try {
      await corpusAPI.subscribe(corpusId);
      setCorpusTabs(prev => {
        if (prev.some(t => t.id === corpusId)) return prev;
        return [...prev, { id: corpusId, corpus_id: corpusId, name: '', group_id: null }];
      });
      await refreshSidebarItems();
    } catch (err) {
      if (err.response?.status === 409) {
        // Already subscribed — ensure tab exists
        setCorpusTabs(prev => {
          if (prev.some(t => t.id === corpusId)) return prev;
          return [...prev, { id: corpusId, corpus_id: corpusId, name: '', group_id: null }];
        });
      } else if (err.response?.status === 401) {
        handleRequestLogin();
        return;
      } else {
        alert(err.response?.data?.error || 'Failed to subscribe');
        return;
      }
    }
    // Set pending states and switch to corpus tab
    setPendingCorpusDocumentId(documentId);
    setPendingAnnotationFromGraph(annotationInfo);
    setActiveTab({ type: 'corpus', id: corpusId });
    setSavedPageOpen(false);
    setCorpusView(null);
    setComboView(null);
    setMessagesPageOpen(false);
  }, [isGuest, handleRequestLogin]);

  const handleUnsubscribeFromCorpus = useCallback(async (corpusId) => {
    try {
      await corpusAPI.unsubscribe(corpusId);
      setCorpusTabs(prev => {
        const remaining = prev.filter(t => t.id !== corpusId);
        // If we just removed the active tab, switch to first graph tab or first remaining corpus tab
        if (activeTab?.type === 'corpus' && activeTab?.id === corpusId) {
          if (graphTabs.length > 0) {
            setActiveTab({ type: 'graph', id: graphTabs[0].id });
          } else if (remaining.length > 0) {
            setActiveTab({ type: 'corpus', id: remaining[0].id });
          } else {
            createDefaultGraphTab();
          }
        }
        return remaining;
      });
      await refreshSidebarItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unsubscribe');
    }
  }, [activeTab, graphTabs]);

  // ─── Combo Subscribe/Unsubscribe (Phase 39b) ──────────────

  const reloadComboSubscriptions = useCallback(async () => {
    try {
      const res = await combosAPI.getSubscriptions();
      setComboSubscriptions((res.data.subscriptions || []).map(sub => ({
        id: sub.id,
        combo_id: sub.id,
        name: sub.name,
        subscriber_count: sub.subscriber_count,
      })));
      await refreshSidebarItems();
    } catch (err) {
      // non-critical
    }
  }, []);

  const handleSubscribeToCombo = useCallback(async (comboId, comboName) => {
    if (isGuest) {
      handleRequestLogin();
      return;
    }
    try {
      await combosAPI.subscribe(comboId);
      const newSub = { id: comboId, combo_id: comboId, name: comboName, subscriber_count: 0 };
      setComboSubscriptions(prev => [...prev, newSub]);
      setActiveTab({ type: 'combo', id: comboId });
      setComboView(null);
      setCorpusView(null);
      setSavedPageOpen(false);
      setMessagesPageOpen(false);
      await refreshSidebarItems();
    } catch (err) {
      if (err.response?.status === 409) {
        // Already subscribed — just switch to the tab
        setActiveTab({ type: 'combo', id: comboId });
        setComboView(null);
        setCorpusView(null);
        setSavedPageOpen(false);
        setMessagesPageOpen(false);
      } else if (err.response?.status === 401) {
        handleRequestLogin();
      } else {
        alert(err.response?.data?.error || 'Failed to subscribe');
      }
    }
  }, [isGuest, handleRequestLogin]);

  const handleUnsubscribeFromCombo = useCallback(async (comboId) => {
    try {
      await combosAPI.unsubscribe(comboId);
      setComboSubscriptions(prev => {
        const remaining = prev.filter(s => s.id !== comboId);
        if (activeTab?.type === 'combo' && activeTab?.id === comboId) {
          if (graphTabs.length > 0) {
            setActiveTab({ type: 'graph', id: graphTabs[0].id });
          } else if (corpusTabs.length > 0) {
            setActiveTab({ type: 'corpus', id: corpusTabs[0].id });
          } else if (remaining.length > 0) {
            setActiveTab({ type: 'combo', id: remaining[0].id });
          } else {
            createDefaultGraphTab();
          }
        }
        return remaining;
      });
      await refreshSidebarItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unsubscribe');
    }
  }, [activeTab, graphTabs, corpusTabs]);

  // ─── Tab Group Actions (Phase 5d) ─────────────────────────

  const handleCreateGroup = async (name) => {
    try {
      const res = await votesAPI.createTabGroup(name || 'Group');
      const newGroup = res.data.tabGroup;
      setTabGroups(prev => [...prev, newGroup]);
      await refreshSidebarItems();
      return newGroup;
    } catch (err) {
      console.error('Failed to create tab group:', err);
      return null;
    }
  };

  const handleRenameGroup = async () => {
    const name = groupRenameValue.trim();
    if (!name || !renamingGroupId) return;
    try {
      await votesAPI.renameTabGroup(renamingGroupId, name);
      setTabGroups(prev => prev.map(g =>
        g.id === renamingGroupId ? { ...g, name } : g
      ));
      setRenamingGroupId(null);
      setGroupRenameValue('');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename group');
    }
  };

  const handleGroupRenameKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameGroup();
    if (e.key === 'Escape') { setRenamingGroupId(null); setGroupRenameValue(''); }
  };

  const handleDeleteGroup = async (groupId) => {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    if (!window.confirm(`Delete group "${group.name}"? Tabs inside will become ungrouped.`)) return;
    try {
      await votesAPI.deleteTabGroup(groupId);
      setTabGroups(prev => prev.filter(g => g.id !== groupId));
      // Ungroup all graph tabs that were in this group
      setGraphTabs(prev => prev.map(t =>
        t.group_id === groupId ? { ...t, group_id: null } : t
      ));
      await refreshSidebarItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete group');
    }
  };

  const handleToggleGroup = async (groupId) => {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    const newExpanded = !group.is_expanded;
    // Optimistic update
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, is_expanded: newExpanded } : g
    ));
    try {
      await votesAPI.toggleTabGroup(groupId, newExpanded);
    } catch (err) {
      // Revert on failure
      setTabGroups(prev => prev.map(g =>
        g.id === groupId ? { ...g, is_expanded: !newExpanded } : g
      ));
    }
  };

  const handleAddTabToGroup = async (tabType, tabId, groupId) => {
    try {
      await votesAPI.addTabToGroup(tabType, tabId, groupId);
      if (tabType === 'corpus') {
        setCorpusTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: groupId } : t
        ));
      } else {
        setGraphTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: groupId } : t
        ));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add tab to group');
    }
  };

  const handleRemoveTabFromGroup = async (tabType, tabId) => {
    try {
      await votesAPI.removeTabFromGroup(tabType, tabId);
      if (tabType === 'corpus') {
        setCorpusTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: null } : t
        ));
      } else {
        setGraphTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, group_id: null } : t
        ));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove tab from group');
    }
  };

  // Create a new group and immediately add the right-clicked tab to it
  const handleGroupFromContextMenu = async (tabType, tabId) => {
    const groupName = window.prompt('Group name:');
    if (!groupName?.trim()) return;
    const group = await handleCreateGroup(groupName.trim());
    if (group) {
      await handleAddTabToGroup(tabType, tabId, group.id);
    }
  };

  // ─── Context Menu ───────────────────────────────────────

  const handleTabContextMenu = (e, tabType, tabId) => {
    e.preventDefault();
    const menuWidth = 240;
    const menuHeight = 200;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ x, y, tabType, tabId });
  };

  const handleGroupContextMenu = (e, groupId) => {
    e.preventDefault();
    const menuWidth = 240;
    const menuHeight = 150;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ x, y, groupId, tabType: 'group' });
  };

  const handleContextMenuAction = (action) => {
    if (!contextMenu) return;
    const { tabType, tabId, groupId } = contextMenu;

    if (action === 'duplicate' && tabType === 'graph') {
      handleDuplicateGraphTab(tabId);
    } else if (action === 'newWindow') {
      if (tabType === 'graph') {
        const tab = graphTabs.find(t => t.id === tabId);
        if (tab) {
          const url = tab.concept_id
            ? `/concept/${tab.concept_id}${tab.path?.length ? '?path=' + tab.path.join(',') : ''}`
            : '/';
          window.open(url, '_blank');
        }
      }
    } else if (action === 'close' && tabType === 'graph') {
      handleCloseGraphTab(tabId);
    } else if (action === 'createGroup') {
      handleGroupFromContextMenu(tabType, tabId);
    } else if (action === 'addToGroup') {
      if (tabGroups.length === 0) {
        handleGroupFromContextMenu(tabType, tabId);
      } else {
        const groupNames = tabGroups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
        const choice = window.prompt(`Add to which group?\n${groupNames}\n\nEnter number (or type a new name to create):`);
        if (!choice?.trim()) { setContextMenu(null); return; }
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < tabGroups.length) {
          handleAddTabToGroup(tabType, tabId, tabGroups[idx].id);
        } else {
          handleCreateGroup(choice.trim()).then(group => {
            if (group) handleAddTabToGroup(tabType, tabId, group.id);
          });
        }
      }
    } else if (action === 'removeFromGroup') {
      handleRemoveTabFromGroup(tabType, tabId);
    } else if (action === 'renameGroup' && tabType === 'group') {
      setRenamingGroupId(groupId);
      const group = tabGroups.find(g => g.id === groupId);
      setGroupRenameValue(group?.name || '');
    } else if (action === 'deleteGroup' && tabType === 'group') {
      handleDeleteGroup(groupId);
    }

    setContextMenu(null);
  };

  // ─── Tab Bar Layout Logic ──────────────────────────────

  // Check if a group contains the active tab
  const groupContainsActiveTab = (group) => {
    if (!activeTab) return false;
    if (activeTab.type === 'graph') {
      return graphTabs.some(t => t.id === activeTab.id && t.group_id === group.id);
    }
    if (activeTab.type === 'corpus') {
      return corpusTabs.some(t => t.id === activeTab.id && t.group_id === group.id);
    }
    return false;
  };

  // ─── Render ─────────────────────────────────────────────

  const isActiveTab = (type, id) =>
    activeTab?.type === type && activeTab?.id === id;

  if (loading || authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  // Sidebar: Graph tabs split by group membership (used by guest mode + group rendering)
  const ungroupedGraphTabs = graphTabs.filter(t => !t.group_id);

  // DnD: top-level items and their sortable IDs (Phase 19c)
  const topLevelSidebarItems = sidebarItems.filter(item => {
    if (item.item_type === 'graph_tab') {
      return !graphTabs.find(t => t.id === item.item_id)?.group_id;
    }
    return true;
  });
  const topLevelSortableIds = topLevelSidebarItems.map(i => i.id);

  // Drag overlay ghost
  const activeDragItem = activeDragId != null ? sidebarItems.find(i => i.id === activeDragId) : null;
  const activeDragLabel = activeDragItem
    ? activeDragItem.item_type === 'corpus' ? corpusTabs.find(t => t.id === activeDragItem.item_id)?.name
    : activeDragItem.item_type === 'combo' ? comboSubscriptions.find(c => c.id === activeDragItem.item_id)?.name
    : activeDragItem.item_type === 'group' ? tabGroups.find(g => g.id === activeDragItem.item_id)?.name
    : activeDragItem.item_type === 'graph_tab' ? graphTabs.find(t => t.id === activeDragItem.item_id)?.label
    : null
    : null;
  const activeDragOverlay = activeDragLabel ? (
    <div style={styles.dragOverlay}>{activeDragLabel}</div>
  ) : null;

  // Render a sidebar item for a subscribed corpus tab
  const renderSidebarCorpusItem = (tab) => {
    const isActive = isActiveTab('corpus', tab.id);

    return (
      <div
        key={`corpus-${tab.id}`}
        style={{
          ...styles.sidebarItem,
          ...(isActive ? styles.sidebarItemActive : {}),
        }}
        onClick={() => {
          setActiveTab({ type: 'corpus', id: tab.id });
          setCorpusView(null);
          setComboView(null);
          setSavedPageOpen(false);
          setMessagesPageOpen(false);
        }}
        onContextMenu={(e) => handleTabContextMenu(e, 'corpus', tab.id)}
        title={`${tab.name} — right-click for options`}
      >
        <span style={styles.sidebarArrowPlaceholder} />
        <span style={styles.sidebarItemLabel}>{tab.name}</span>
      </div>
    );
  };

  // Render a sidebar item for a combo tab (Phase 39b)
  const renderSidebarComboItem = (combo) => {
    const isActive = isActiveTab('combo', combo.id);

    return (
      <div
        key={`combo-${combo.id}`}
        style={{
          ...styles.sidebarItem,
          ...(isActive ? styles.sidebarItemActive : {}),
        }}
        onClick={() => {
          setActiveTab({ type: 'combo', id: combo.id });
          setCorpusView(null);
          setComboView(null);
          setSavedPageOpen(false);
          setMessagesPageOpen(false);
        }}
        onContextMenu={(e) => handleTabContextMenu(e, 'combo', combo.id)}
        title={`${combo.name} — right-click for options`}
      >
        <span style={styles.sidebarArrowPlaceholder} />
        <span style={styles.sidebarItemLabel}>{combo.name}</span>
      </div>
    );
  };

  // Render a sidebar item for a graph tab
  const renderSidebarGraphItem = (tab, depth = 0) => {
    const isActive = isActiveTab('graph', tab.id);

    return (
      <div
        key={`graph-${tab.id}`}
        style={{
          ...styles.sidebarItem,
          paddingLeft: `${12 + depth * 16}px`,
          ...(isActive ? styles.sidebarItemActive : {}),
        }}
        onClick={() => { setActiveTab({ type: 'graph', id: tab.id }); setCorpusView(null); setComboView(null); setSavedPageOpen(false); setMessagesPageOpen(false); }}
        onContextMenu={(e) => handleTabContextMenu(e, 'graph', tab.id)}
        title={`${tab.label} — right-click for options`}
      >
        <span style={styles.sidebarArrowPlaceholder} />
        <span style={styles.sidebarGraphIcon}>⬡</span>
        <span style={styles.sidebarItemLabel}>{tab.label}</span>
        <button
          style={styles.sidebarCloseButton}
          onClick={(e) => { e.stopPropagation(); handleCloseGraphTab(tab.id); }}
          title="Close tab"
        >{'\u2715'}</button>
      </div>
    );
  };

  // Render a sidebar group. sidebarItemId is the sidebar_items.id for DnD.
  const renderSidebarGroup = (group, sidebarItemId = null) => {
    const isExpanded = group.is_expanded;
    const memberGraph = graphTabs.filter(t => t.group_id === group.id);
    // Sidebar item IDs for member graph tabs (for the inner SortableContext)
    const memberGraphSidebarIds = memberGraph
      .map(tab => sidebarItems.find(si => si.item_type === 'graph_tab' && si.item_id === tab.id)?.id)
      .filter(Boolean);
    const hasActiveInside = groupContainsActiveTab(group);
    const memberCount = memberGraph.length;
    // Amber highlight when a graph_tab is dragged over this group
    const isDropTarget = overGroupItemId != null && overGroupItemId === sidebarItemId;

    const renderHeader = (dragHandleProps = {}) => (
      <div
        {...dragHandleProps}
        style={{
          ...styles.sidebarItem,
          ...styles.sidebarGroupHeader,
          ...(hasActiveInside && !isExpanded ? styles.sidebarItemActive : {}),
          ...(isDropTarget ? styles.sidebarDropTarget : {}),
        }}
        onClick={() => handleToggleGroup(group.id)}
        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
        onDoubleClick={() => {
          setRenamingGroupId(group.id);
          setGroupRenameValue(group.name);
        }}
        title={`${group.name} (${memberCount} tab${memberCount !== 1 ? 's' : ''}) — right-click for options`}
      >
        <span style={styles.sidebarArrow}>{isExpanded ? '▾' : '▸'}</span>
        {renamingGroupId === group.id ? (
          <input
            ref={groupRenameInputRef}
            value={groupRenameValue}
            onChange={(e) => setGroupRenameValue(e.target.value)}
            onKeyDown={handleGroupRenameKeyDown}
            onBlur={handleRenameGroup}
            onClick={(e) => e.stopPropagation()}
            style={styles.sidebarRenameInput}
            maxLength={255}
          />
        ) : (
          <>
            <span style={styles.sidebarItemLabel}>{group.name}</span>
            <span style={styles.sidebarGroupCount}>{memberCount}</span>
          </>
        )}
      </div>
    );

    const renderMembers = (withDnd) => (
      <>
        {withDnd && memberGraphSidebarIds.length > 0 ? (
          <GroupMemberContext ids={memberGraphSidebarIds}>
            {memberGraph.map(tab => {
              const si = sidebarItems.find(s => s.item_type === 'graph_tab' && s.item_id === tab.id);
              if (!si) return renderSidebarGraphItem(tab, 1);
              return (
                <SortableItem key={si.id} id={si.id}>
                  {renderSidebarGraphItem(tab, 1)}
                </SortableItem>
              );
            })}
          </GroupMemberContext>
        ) : (
          memberGraph.map(tab => renderSidebarGraphItem(tab, 1))
        )}
      </>
    );

    if (sidebarItemId != null) {
      return (
        <SortableGroupWrapper key={`group-${group.id}`} id={sidebarItemId}>
          {({ dragHandleProps }) => (
            <div>
              {renderHeader(dragHandleProps)}
              {isExpanded && renderMembers(true)}
            </div>
          )}
        </SortableGroupWrapper>
      );
    }
    return (
      <div key={`group-${group.id}`}>
        {renderHeader()}
        {isExpanded && renderMembers(false)}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.titleRow}>
            <h1 style={styles.title} onClick={() => navigate('/')} role="button" tabIndex={0}>orca</h1>
            <button style={{ ...styles.navLink, ...(infoSlug === 'using-orca' ? styles.navLinkActive : {}) }} onClick={() => navigate('/using-orca')}>Using Orca</button>
            <button style={{ ...styles.navLink, ...(infoSlug === 'constitution' ? styles.navLinkActive : {}) }} onClick={() => navigate('/constitution')}>Constitution</button>
            <button style={{ ...styles.navLink, ...(infoSlug === 'donate' ? styles.navLinkActive : {}) }} onClick={() => navigate('/donate')}>Donate</button>
          </div>
          {isGuest ? (
            <div style={styles.userSection}>
              <button onClick={() => { setLoginModalTab('login'); setLoginModalNotice(''); setShowLoginModal(true); }} style={styles.loginButton}>Log in</button>
              <button onClick={() => { setLoginModalTab('signup'); setLoginModalNotice(''); setShowLoginModal(true); }} style={styles.signupButton}>Sign up</button>
            </div>
          ) : (
            <div style={styles.userSection}>
              <span style={styles.username}>{user?.username}</span>
              <div ref={accountMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowAccountMenu(prev => !prev)}
                  style={styles.logoutButton}
                >
                  Log out ▾
                </button>
                {showAccountMenu && (
                  <div style={styles.accountDropdown}>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); logout(); }}
                    >Log out</button>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); logoutEverywhere(); }}
                    >Log out everywhere</button>
                    <button
                      style={styles.accountDropdownItem}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0ece4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onClick={() => { setShowAccountMenu(false); setShowDeleteFlow(true); }}
                    >Delete account</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>



      {/* Phase 30g: Info pages replace normal layout */}
      {infoSlug ? (
        <div style={styles.mainLayout}>
          <div style={styles.contentArea}>
            <InfoPage slug={infoSlug} onRequestLogin={handleRequestLogin} />
          </div>
        </div>
      ) : (
      /* Main layout: Sidebar + Content */
      <div style={styles.mainLayout}>
        {/* ─── Sidebar ─── */}
        {!sidebarCollapsed && (
          <nav style={styles.sidebar}>
            {/* Action buttons at top */}
            <div style={styles.sidebarActions}>
              {!isGuest && (
                <button
                  onClick={() => { setCorpusView(null); setComboView(null); setSavedPageOpen(true); setMessagesPageOpen(false); }}
                  style={styles.sidebarActionButton}
                  title="View your graph votes"
                >Graph Votes</button>
              )}
              <button
                onClick={() => { setSavedPageOpen(false); setMessagesPageOpen(false); setComboView(null); setCorpusView({ view: 'list' }); }}
                style={styles.sidebarActionButton}
                title="Browse and manage corpuses"
              >Browse Corpuses</button>
              <button
                onClick={() => { setSavedPageOpen(false); setMessagesPageOpen(false); setCorpusView(null); setComboView({ view: 'list' }); }}
                style={styles.sidebarActionButton}
                title="Browse and manage combos"
              >Browse Combos</button>
              {!isGuest && (
                <button
                  data-messages-btn
                  onClick={() => { setSavedPageOpen(false); setCorpusView(null); setComboView(null); setMessagesPageOpen(true); }}
                  style={styles.sidebarActionButton}
                  title="View your message threads"
                >Messages{messagesUnreadCount > 0 ? ` (${messagesUnreadCount})` : ''}</button>
              )}
            </div>

            <div style={styles.sidebarDivider} />

            {/* Scrollable tree area */}
            <div style={styles.sidebarTree}>
              {isGuest ? (
                // Guests: simple ephemeral graph tab list (no DnD)
                ungroupedGraphTabs.map(tab => renderSidebarGraphItem(tab))
              ) : sidebarItems.length > 0 ? (
                // Logged in with sidebar order: DnD-enabled unified list
                <SidebarDndContext
                  topLevelIds={topLevelSortableIds}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  overlayContent={activeDragOverlay}
                >
                  {topLevelSidebarItems.map(item => {
                    if (item.item_type === 'corpus') {
                      const tab = corpusTabs.find(t => t.id === item.item_id);
                      if (!tab || tab.group_id) return null;
                      return (
                        <SortableItem key={item.id} id={item.id}>
                          {renderSidebarCorpusItem(tab)}
                        </SortableItem>
                      );
                    }
                    if (item.item_type === 'group') {
                      const group = tabGroups.find(g => g.id === item.item_id);
                      if (!group) return null;
                      return renderSidebarGroup(group, item.id);
                    }
                    if (item.item_type === 'combo') {
                      const combo = comboSubscriptions.find(c => c.id === item.item_id);
                      if (!combo) return null;
                      return (
                        <SortableItem key={item.id} id={item.id}>
                          {renderSidebarComboItem(combo)}
                        </SortableItem>
                      );
                    }
                    if (item.item_type === 'graph_tab') {
                      const tab = graphTabs.find(t => t.id === item.item_id);
                      if (!tab || tab.group_id) return null;
                      return (
                        <SortableItem key={item.id} id={item.id}>
                          {renderSidebarGraphItem(tab)}
                        </SortableItem>
                      );
                    }
                    return null;
                  })}
                </SidebarDndContext>
              ) : (
                // Fallback: sidebar order not loaded, render without DnD
                [
                  ...corpusTabs.filter(t => !t.group_id).map(t => ({ item_type: 'corpus', item_id: t.id, _key: `c-${t.id}` })),
                  ...comboSubscriptions.map(c => ({ item_type: 'combo', item_id: c.id, _key: `cb-${c.id}` })),
                  ...tabGroups.map(g => ({ item_type: 'group', item_id: g.id, _key: `g-${g.id}` })),
                  ...graphTabs.filter(t => !t.group_id).map(t => ({ item_type: 'graph_tab', item_id: t.id, _key: `gt-${t.id}` })),
                ].map(item => {
                  if (item.item_type === 'corpus') return renderSidebarCorpusItem(corpusTabs.find(t => t.id === item.item_id));
                  if (item.item_type === 'combo') return renderSidebarComboItem(comboSubscriptions.find(c => c.id === item.item_id));
                  if (item.item_type === 'group') return renderSidebarGroup(tabGroups.find(g => g.id === item.item_id));
                  if (item.item_type === 'graph_tab') return renderSidebarGraphItem(graphTabs.find(t => t.id === item.item_id));
                  return null;
                })
              )}

              {/* New graph tab button */}
              <button
                style={styles.sidebarNewTabButton}
                onClick={handleCreateGraphTab}
                title="Open a new graph tab"
              >+ New graph</button>
            </div>

            {/* Collapse sidebar button */}
            <div style={styles.sidebarFooter}>
              <button
                onClick={() => setSidebarCollapsed(true)}
                style={styles.sidebarCollapseButton}
                title="Collapse sidebar"
              >« Hide</button>
            </div>
          </nav>
        )}

        {/* Collapsed sidebar toggle */}
        {sidebarCollapsed && (
          <div style={styles.sidebarCollapsedBar}>
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={styles.sidebarExpandButton}
              title="Expand sidebar"
            >»</button>
          </div>
        )}

        {/* ─── Content Area ─── */}
        <div style={styles.contentArea}>
          {/* Saved Page overlay (Phase 7c-3) */}
          {savedPageOpen && (
            <SavedPageOverlay
              onBack={() => setSavedPageOpen(false)}
              onOpenConceptTab={handleOpenConceptTab}
            />
          )}

          {/* Phase 31b: Messages page overlay */}
          {messagesPageOpen && (
            <MessagesPage
              onBack={() => { setMessagesPageOpen(false); setMessagesInitialAnnotationId(null); setMessagesInitialAnnotationIds(null); }}
              initialAnnotationId={messagesInitialAnnotationId}
              initialAnnotationIds={messagesInitialAnnotationIds}
              onInitialAnnotationConsumed={() => { setMessagesInitialAnnotationId(null); setMessagesInitialAnnotationIds(null); }}
              onRefreshUnread={refreshUnreadCount}
            />
          )}

          {/* Corpus views — overlay normal content when active */}
          {!savedPageOpen && !messagesPageOpen && corpusView && corpusView.view === 'list' && (
            <CorpusListView
              onSelectCorpus={(id) => setCorpusView({ view: 'detail', corpusId: id })}
              onBack={() => setCorpusView(null)}
              isGuest={isGuest}
              onSubscribe={handleSubscribeToCorpus}
              corpusTabs={corpusTabs}
            />
          )}
          {!savedPageOpen && !messagesPageOpen && corpusView && corpusView.view === 'detail' && (
            <CorpusDetailView
              corpusId={corpusView.corpusId}
              onBack={() => setCorpusView({ view: 'list' })}
              onSelectCorpus={(id) => setCorpusView({ view: 'detail', corpusId: id })}
              onOpenDocument={async (docId, corpusName) => {
                const targetCorpusId = corpusView.corpusId;
                const targetCorpusName = corpusTabs.find(t => t.id === targetCorpusId)?.name || corpusName || `Corpus ${targetCorpusId}`;
                handleSubscribeToCorpus(targetCorpusId, targetCorpusName, docId);
                setCorpusView(null);
              }}
              isGuest={isGuest}
              onSubscribe={handleSubscribeToCorpus}
              onUnsubscribe={handleUnsubscribeFromCorpus}
              isSubscribed={corpusTabs.some(t => t.id === corpusView.corpusId)}
              currentUserId={user?.id}
            />
          )}
          {!savedPageOpen && !messagesPageOpen && corpusView && corpusView.view === 'document' && (
            <DocumentView
              documentId={corpusView.documentId}
              onBack={() => setCorpusView({ view: 'detail', corpusId: corpusView.corpusId })}
              onOpenCorpus={(id) => setCorpusView({ view: 'detail', corpusId: id })}
            />
          )}

          {/* Phase 39b: Browse Combos overlay */}
          {!savedPageOpen && !messagesPageOpen && !corpusView && comboView && comboView.view === 'list' && (
            <ComboListView
              onBack={() => setComboView(null)}
              isGuest={isGuest}
              comboSubscriptions={comboSubscriptions}
              onSubscribe={() => reloadComboSubscriptions()}
              onUnsubscribe={(comboId) => handleUnsubscribeFromCombo(comboId)}
              onComboClick={(combo) => {
                handleSubscribeToCombo(combo.id, combo.name);
              }}
              onRequestLogin={() => {
                setLoginModalTab('login');
                setLoginModalNotice('Log in to subscribe to combos');
                setShowLoginModal(true);
              }}
            />
          )}

          {/* Normal tab content — hidden when overlays are active */}
          {!savedPageOpen && !messagesPageOpen && !corpusView && !comboView && (
            <>
              {/* Combo tab content — render all, hide inactive to preserve state */}
              {!isGuest && comboSubscriptions.map(combo => {
                const isActive = activeTab?.type === 'combo' && activeTab?.id === combo.id;
                return (
                  <div
                    key={`combo-${combo.id}`}
                    style={isActive ? styles.tabPane : styles.tabPaneHidden}
                  >
                    <ComboTabContent
                      comboId={combo.id}
                      user={user}
                      isGuest={isGuest}
                      onUnsubscribe={handleUnsubscribeFromCombo}
                      onNavigateToDocument={(corpusId, corpusName, documentId, annotationId) => {
                        handleSubscribeToCorpus(corpusId, corpusName, documentId, annotationId);
                        setComboView(null);
                      }}
                      onRequestLogin={handleRequestLogin}
                    />
                  </div>
                );
              })}
              {/* Corpus tab content — render all, hide inactive to preserve document state */}
              {!isGuest && corpusTabs.map(ct => {
                const isActive = activeTab?.type === 'corpus' && activeTab?.id === ct.id;
                return (
                  <div
                    key={`corpus-${ct.id}`}
                    style={isActive ? styles.tabPane : styles.tabPaneHidden}
                  >
                    <CorpusTabContent
                      corpusId={ct.id}
                      isGuest={isGuest}
                      onUnsubscribe={handleUnsubscribeFromCorpus}
                      onOpenConceptTab={(conceptId, path, conceptName, attributeName, _sourceId, viewMode) =>
                        handleOpenConceptTab(conceptId, path, conceptName, attributeName, ct.id, viewMode)
                      }
                      onOpenCorpusTab={handleSubscribeToCorpus}
                      onViewThreads={(annotationId, equivalentIds) => {
                        setMessagesInitialAnnotationId(annotationId);
                        setMessagesInitialAnnotationIds(equivalentIds || null);
                        setSavedPageOpen(false);
                        setCorpusView(null);
                        setComboView(null);
                        setMessagesPageOpen(true);
                      }}
                      pendingDocumentId={activeTab?.type === 'corpus' && activeTab?.id === ct.id ? pendingCorpusDocumentId : null}
                      onPendingDocumentConsumed={() => setPendingCorpusDocumentId(null)}
                      pendingAnnotationId={activeTab?.type === 'corpus' && activeTab?.id === ct.id ? pendingAnnotationId : null}
                      onPendingAnnotationConsumed={() => setPendingAnnotationId(null)}
                      pendingAnnotationFromGraph={activeTab?.type === 'corpus' && activeTab?.id === ct.id ? pendingAnnotationFromGraph : null}
                      onPendingAnnotationFromGraphConsumed={() => setPendingAnnotationFromGraph(null)}
                    />
                  </div>
                );
              })}
              {/* Render all graph tabs; hide inactive to preserve nav history */}
              {graphTabs.map(tab => {
                const isActive = activeTab?.type === 'graph' && activeTab?.id === tab.id;
                return (
                  <div
                    key={`graph-${tab.id}`}
                    style={isActive ? styles.tabPane : styles.tabPaneHidden}
                  >
                    {tab.tab_type === 'root' && !tab.concept_id ? (
                      <Root
                        graphTabId={tab.id}
                        onNavigate={handleGraphTabNavigate}
                        isGuest={isGuest}
                      />
                    ) : (
                      <Concept
                        graphTabId={tab.id}
                        initialConceptId={tab.concept_id}
                        initialPath={tab.path || []}
                        initialViewMode={tab.view_mode || 'children'}
                        onNavigate={handleGraphTabNavigate}
                        isGuest={isGuest}
                        onOpenCorpusTab={handleSubscribeToCorpus}
                        onOpenConceptTab={handleOpenConceptTab}
                        onRequestLogin={handleRequestLogin}
                        onAnnotateFromGraph={handleAnnotateFromGraph}
                      />
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Graph tab context menu */}
          {contextMenu.tabType === 'graph' && (
            <>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('duplicate')}
              >Duplicate tab</button>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('newWindow')}
              >Open in new window</button>
              <div style={styles.contextMenuDivider} />
              {graphTabs.find(t => t.id === contextMenu.tabId)?.group_id ? (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction('removeFromGroup')}
                >Remove from group</button>
              ) : (
                <button
                  style={styles.contextMenuItem}
                  onClick={() => handleContextMenuAction(tabGroups.length > 0 ? 'addToGroup' : 'createGroup')}
                >{tabGroups.length > 0 ? 'Add to group...' : 'Create group with this tab...'}</button>
              )}
              <div style={styles.contextMenuDivider} />
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => handleContextMenuAction('close')}
              >Close tab</button>
            </>
          )}

          {/* Corpus tab context menu — unsubscribe only (no group management for corpuses in Phase 12) */}
          {contextMenu.tabType === 'corpus' && (
            <>
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => { handleUnsubscribeFromCorpus(contextMenu.tabId); setContextMenu(null); }}
              >Unsubscribe</button>
            </>
          )}

          {/* Combo tab context menu — unsubscribe only */}
          {contextMenu.tabType === 'combo' && (
            <>
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => { handleUnsubscribeFromCombo(contextMenu.tabId); setContextMenu(null); }}
              >Unsubscribe</button>
            </>
          )}

          {/* Group context menu */}
          {contextMenu.tabType === 'group' && (
            <>
              <button
                style={styles.contextMenuItem}
                onClick={() => handleContextMenuAction('renameGroup')}
              >Rename group</button>
              <div style={styles.contextMenuDivider} />
              <button
                style={{ ...styles.contextMenuItem, color: '#555' }}
                onClick={() => handleContextMenuAction('deleteGroup')}
              >Delete group (keeps tabs)</button>
            </>
          )}
        </div>
      )}

      {/* Phase 9b: Orphan Rescue Modal */}
      {showOrphanModal && (
        <OrphanRescueModal
          onClose={() => setShowOrphanModal(false)}
          onRescued={() => {
            corpusAPI.getOrphanedDocuments().then(res => {
              setOrphanCount((res.data.orphanedDocuments || []).length);
            }).catch(() => {});
          }}
        />
      )}

      {/* Phase 28f: Login/Signup Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        initialTab={loginModalTab}
        notice={loginModalNotice}
      />

      {/* Phase 35d: Delete Account Flow */}
      {showDeleteFlow && (
        <DeleteAccountFlow onClose={() => setShowDeleteFlow(false)} />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#faf9f7',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    backgroundColor: 'white',
    borderBottom: '1px solid #eee',
    padding: '10px 20px',
    flexShrink: 0,
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    cursor: 'pointer',
  },
  navLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    padding: '2px 4px',
  },
  navLinkActive: {
    color: '#333',
    fontWeight: '600',
  },
  userSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  username: {
    fontSize: '14px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  logoutButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  accountDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '4px',
    backgroundColor: '#faf9f6',
    border: '1px solid #ccc',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    zIndex: 9999,
    minWidth: '170px',
    overflow: 'hidden',
  },
  accountDropdownItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #eee',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  loginButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  signupButton: {
    padding: '6px 14px',
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },

  // ─── Main Layout (Sidebar + Content) ──────────
  mainLayout: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
  },

  // ─── Sidebar ──────────────────────────────────
  sidebar: {
    width: '220px',
    flexShrink: 0,
    backgroundColor: 'white',
    borderRight: '1px solid #e8e6e2',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  sidebarActions: {
    display: 'flex',
    gap: '6px',
    padding: '10px 10px 6px 10px',
  },
  sidebarActionButton: {
    flex: 1,
    padding: '6px 8px',
    backgroundColor: 'transparent',
    color: '#555',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    textAlign: 'center',
  },
  sidebarDivider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '6px 10px',
  },
  sidebarTree: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '0 0 8px 0',
  },

  // Sidebar items (shared by corpus, graph, group headers)
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 10px 5px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    position: 'relative',
    borderLeft: '3px solid transparent',
    gap: '4px',
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
    color: '#333',
    fontWeight: '600',
    borderLeftColor: '#333',
  },
  sidebarArrow: {
    fontSize: '9px',
    width: '12px',
    textAlign: 'center',
    flexShrink: 0,
    cursor: 'pointer',
    color: '#999',
  },
  sidebarArrowPlaceholder: {
    width: '12px',
    flexShrink: 0,
  },
  sidebarCorpusIcon: {
    fontSize: '12px',
    flexShrink: 0,
  },
  sidebarGraphIcon: {
    fontSize: '11px',
    flexShrink: 0,
    color: '#999',
  },
  sidebarItemLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sidebarCloseButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '9px',
    color: '#ccc',
    padding: '2px 4px',
    lineHeight: 1,
    borderRadius: '2px',
    flexShrink: 0,
    opacity: 0.6,
  },
  sidebarGroupHeader: {
    fontWeight: '500',
  },
  sidebarGroupCount: {
    fontSize: '10px',
    color: '#bbb',
    marginLeft: '4px',
    fontWeight: '400',
    flexShrink: 0,
  },
  sidebarRenameInput: {
    flex: 1,
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '3px',
    padding: '2px 6px',
    outline: 'none',
  },
  sidebarNewTabButton: {
    display: 'block',
    width: '100%',
    padding: '6px 12px 6px 28px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
    textAlign: 'left',
  },
  // DnD drop target highlight (Phase 19c)
  sidebarDropTarget: {
    backgroundColor: 'rgba(232, 217, 160, 0.5)',
    borderRadius: '4px',
  },
  // DnD drag overlay ghost (Phase 19c)
  dragOverlay: {
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    padding: '6px 12px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#444',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    maxWidth: '200px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'grabbing',
  },
  sidebarFooter: {
    borderTop: '1px solid #eee',
    padding: '6px 10px',
    flexShrink: 0,
  },
  sidebarCollapseButton: {
    display: 'block',
    width: '100%',
    padding: '4px 8px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
    textAlign: 'center',
  },

  // Collapsed sidebar
  sidebarCollapsedBar: {
    width: '24px',
    flexShrink: 0,
    backgroundColor: 'white',
    borderRight: '1px solid #e8e6e2',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '10px',
  },
  sidebarExpandButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#bbb',
    padding: '4px 2px',
    lineHeight: 1,
  },

  // ─── Content Area ──────────────────────────────
  contentArea: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
  },
  tabPane: {
    display: 'block',
    height: '100%',
  },
  tabPaneHidden: {
    display: 'none',
  },

  // ─── Context Menu ──────────────────────────────
  contextMenu: {
    position: 'fixed',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    padding: '4px 0',
    zIndex: 9999,
    minWidth: '220px',
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 16px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    textAlign: 'left',
  },
  contextMenuDivider: {
    height: '1px',
    backgroundColor: '#eee',
    margin: '4px 0',
  },

  loading: {
    textAlign: 'center',
    padding: '80px',
    fontSize: '16px',
    color: '#666',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default AppShell;
