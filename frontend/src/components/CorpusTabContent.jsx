import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { corpusAPI, documentsAPI, conceptsAPI, messagesAPI, citationsAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import AnnotationPanel from './AnnotationPanel';
import CorpusDocumentList from './CorpusDocumentList';
import CorpusUploadForm from './CorpusUploadForm';
import CorpusMembersPanel from './CorpusMembersPanel';


// Find all occurrences of text in body, return array of { idx, before, match, after }
const buildOccurrenceItems = (text, body) => {
  if (!text || !body) return [];
  const items = [];
  let searchFrom = 0;
  while (true) {
    const pos = body.indexOf(text, searchFrom);
    if (pos === -1) break;
    const ctxStart = Math.max(0, pos - 40);
    const ctxEnd = Math.min(body.length, pos + text.length + 40);
    items.push({
      idx: items.length + 1,
      before: (ctxStart > 0 ? '…' : '') + body.substring(ctxStart, pos),
      match: body.substring(pos, pos + text.length),
      after: body.substring(pos + text.length, ctxEnd) + (ctxEnd < body.length ? '…' : ''),
    });
    searchFrom = pos + 1;
  }
  return items;
};

/**
 * CorpusTabContent renders the content for a corpus tab in the main tab bar.
 * It has two sub-views:
 *   1. Document list (default) — shows corpus info + documents
 *   2. Document viewer — shows a selected document's full text
 *
 * Props:
 *   - corpusId: the corpus to display
 *   - isGuest: boolean
 *   - onUnsubscribe: callback when user unsubscribes (AppShell removes the tab)
 */
const CorpusTabContent = ({ corpusId, isGuest, onUnsubscribe, onOpenConceptTab, onOpenCorpusTab, onViewThreads, pendingDocumentId, onPendingDocumentConsumed, pendingAnnotationId, onPendingAnnotationConsumed, pendingAnnotationFromGraph, onPendingAnnotationFromGraphConsumed }) => {
  const { user } = useAuth();

  // Sub-view: 'list' (document list) or { view: 'document', documentId }
  const [subView, setSubView] = useState('list');

  // Document list state
  const [corpus, setCorpus] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Document viewer state
  const [document, setDocument] = useState(null);
  const [docCorpuses, setDocCorpuses] = useState([]);
  const [docLoading, setDocLoading] = useState(false);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Annotation state (Phase 7d)
  const [annotations, setAnnotations] = useState([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [selectionQuoteText, setSelectionQuoteText] = useState(null); // text selected in body
  const [selectionBtnPos, setSelectionBtnPos] = useState(null); // {x, y} for floating button
  const [showAnnotationPanel, setShowAnnotationPanel] = useState(false);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null); // clicked annotation detail
  const [quoteNotFoundAnnId, setQuoteNotFoundAnnId] = useState(null); // brief "not found" state
  const [occurrencePicker, setOccurrencePicker] = useState(null); // { text, sourceId, sourceType, items }
  const [conceptNavState, setConceptNavState] = useState({}); // { [conceptId]: { idx, total } }
  // Phase 31c: Annotation messaging state
  const [annMsgStatus, setAnnMsgStatus] = useState({}); // { [annotationId]: { is_participant, is_author, author_group_size, threads } }
  const [annMsgComposing, setAnnMsgComposing] = useState(null); // { annotationId, threadType } when composing first message
  const [annMsgBody, setAnnMsgBody] = useState('');
  const [annMsgSending, setAnnMsgSending] = useState(false);
  // Phase 38h: Pre-filled concept/edge from graph annotation flow
  const [prefilledConcept, setPrefilledConcept] = useState(null);
  const [prefilledEdge, setPrefilledEdge] = useState(null);

  // Phase 38j: Citation links state
  const [citations, setCitations] = useState([]);
  const [copiedAnnotationId, setCopiedAnnotationId] = useState(null);

  const bodyRef = useRef(null);
  const highlightMarkRef = useRef(null);


  // Phase 7h: Document versioning state
  const [versionHistory, setVersionHistory] = useState([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);

  // Phase 22a: Version file upload state
  const [showVersionUpload, setShowVersionUpload] = useState(false);
  const [versionFile, setVersionFile] = useState(null);
  const [versionDragOver, setVersionDragOver] = useState(false);
  const [versionFileError, setVersionFileError] = useState('');
  const [versionCopyrightConfirmed, setVersionCopyrightConfirmed] = useState(false);

  // Phase 21c: Version chain for navigator
  const [versionChain, setVersionChain] = useState([]);
  // Phase 31d: Annotation fingerprints across version chain for version nav buttons
  const [versionAnnMap, setVersionAnnMap] = useState([]);

  // Phase 38i: Delete any version from version history
  const [deleteVersionTarget, setDeleteVersionTarget] = useState(null); // { id, versionNumber, hasOtherVersions }
  const [deletingVersion, setDeletingVersion] = useState(false);

  // Phase 22a: file input ref for version upload
  const versionFileInputRef = useRef(null);

  // Phase 7i: Live concept linking state
  const [conceptLinks, setConceptLinks] = useState([]);
  const [conceptLinksLoading, setConceptLinksLoading] = useState(false);

  // Phase 26a: Document co-author state
  const [authorData, setAuthorData] = useState(null); // { count, authors? }
  const [showAuthorPanel, setShowAuthorPanel] = useState(false);
  const [generatingDocInvite, setGeneratingDocInvite] = useState(false);
  const [docInviteLink, setDocInviteLink] = useState(null);
  const [copiedDocInvite, setCopiedDocInvite] = useState(false);


  // Annotation filter and user identity status
  const [layerFilter, setLayerFilter] = useState(null); // null = default (all), 'corpus_members', 'author'
  const [attributeFilter, setAttributeFilter] = useState('all'); // 'all' or an attribute name like 'value'
  const [enabledAttributes, setEnabledAttributes] = useState([]);
  const [annotationSort, setAnnotationSort] = useState('votes'); // 'votes' or 'position'
  const [isAllowedUser, setIsAllowedUser] = useState(false);
  const [isCorpusOwner, setIsCorpusOwner] = useState(false);
  const [isAuthor, setIsAuthor] = useState(false);

  // Phase 26b: Members panel state
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [membersCount, setMembersCount] = useState(0);
  const [membersList, setMembersList] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteTokens, setInviteTokens] = useState([]);
  const [inviteTokensLoading, setInviteTokensLoading] = useState(false);

  // Document favorites (Phase 7c Overhaul — per-corpus favoriting)
  const [favoriteDocIds, setFavoriteDocIds] = useState(new Set());

  // Phase 17b: Document tags
  const [allTags, setAllTags] = useState([]);       // all available tags from backend

  useEffect(() => {
    loadCorpus();
  }, [corpusId]);

  // Fetch enabled attributes for the attribute filter (Phase 38f)
  useEffect(() => {
    conceptsAPI.getAttributes()
      .then(res => setEnabledAttributes(res.data.attributes || []))
      .catch(() => setEnabledAttributes([]));
  }, []);

  // Auto-open a pending document if passed from annotation panel or External Links (Phase 7d-4 / 27c)
  useEffect(() => {
    if (!pendingDocumentId || loading) return;
    // If we're on the doc list, or viewing a different document, open the pending one
    if (subView === 'list' || (subView?.documentId && subView.documentId !== pendingDocumentId)) {
      handleOpenDocument(pendingDocumentId);
      if (onPendingDocumentConsumed) onPendingDocumentConsumed();
    } else if (subView?.documentId === pendingDocumentId) {
      // Already viewing this document — just consume the pending state
      // (pendingAnnotationId effect will handle scroll-to separately)
      if (onPendingDocumentConsumed) onPendingDocumentConsumed();
    }
  }, [pendingDocumentId, loading]);

  // Phase 27c: After annotations load, select + scroll to the pending annotation
  useEffect(() => {
    if (!pendingAnnotationId || annotations.length === 0) return;
    const ann = annotations.find(a => a.id === pendingAnnotationId);
    if (!ann) return;
    // Select the annotation in the sidebar (but do NOT open the creation panel)
    setSelectedAnnotation(ann);
    setShowAnnotationPanel(false);
    // If it has a quote, navigate to it in the document body
    if (ann.quote_text) {
      setTimeout(() => {
        navigateToOccurrence(ann.quote_text, ann.quote_occurrence || 1);
      }, 300);
    }
    if (onPendingAnnotationConsumed) onPendingAnnotationConsumed();
  }, [pendingAnnotationId, annotations]);

  // Phase 38h: After document loads, open annotation panel with pre-filled concept from graph
  useEffect(() => {
    if (!pendingAnnotationFromGraph) return;
    // Wait for the document to be loaded (subView has a documentId)
    if (!subView?.documentId) return;
    const info = pendingAnnotationFromGraph;
    // Set pre-filled concept and edge for the annotation panel
    setPrefilledConcept({ id: info.conceptId, name: info.conceptName });
    setPrefilledEdge({
      edge_id: info.edgeId,
      attribute_name: info.attributeName,
      isPrefilledFromGraph: true,
    });
    // Open the annotation creation panel
    setShowAnnotationPanel(true);
    setSelectedAnnotation(null);
    setSelectionQuoteText(null);
    if (onPendingAnnotationFromGraphConsumed) onPendingAnnotationFromGraphConsumed();
  }, [pendingAnnotationFromGraph, subView]);

  const loadCorpus = async () => {
    try {
      setLoading(true);
      const res = await corpusAPI.getCorpus(corpusId);
      setCorpus(res.data.corpus);
      setDocuments(res.data.documents);
      // Phase 7g: Check allowed user status
      if (!isGuest) {
        try {
          const statusRes = await corpusAPI.checkAllowedStatus(corpusId);
          setIsAllowedUser(statusRes.data.isAllowedUser || false);
          setIsCorpusOwner(statusRes.data.isOwner || false);
        } catch (err) {
          // Silently fail
        }
        // Load document favorites
        try {
          const favRes = await corpusAPI.getDocumentFavorites(corpusId);
          setFavoriteDocIds(new Set(favRes.data.favoriteDocIds || []));
        } catch (err) {
          // Silently fail — favorites are non-critical
        }
      }
      // Phase 17b: Load all available tags
      try {
        const tagRes = await documentsAPI.listTags();
        setAllTags(tagRes.data.tags || []);
      } catch (err) {
        // Silently fail — tags are non-critical
      }
    } catch (err) {
      console.error('Failed to load corpus:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDocument = async (docId) => {
    try {
      setDocLoading(true);
      setSubView({ view: 'document', documentId: docId });
      // Reset co-author state
      setAuthorData(null);
      setShowAuthorPanel(false);
      setDocInviteLink(null);
      const [res, chainRes] = await Promise.all([
        documentsAPI.getDocument(docId).catch(() => null),
        documentsAPI.getVersionChain(docId).catch(() => ({ data: { versions: [] } })),
      ]);
      if (!res) {
        setDocLoading(false);
        return;
      }
      setDocument(res.data.document);
      setDocCorpuses(res.data.corpuses);
      const versions = chainRes.data.versions || [];
      setVersionChain(versions);
      // Phase 31d: Load annotation fingerprints across versions for version nav buttons
      if (versions.length > 1) {
        documentsAPI.getVersionAnnotationMap(docId)
          .then(mapRes => setVersionAnnMap(mapRes.data.annotations || []))
          .catch(() => setVersionAnnMap([]));
      } else {
        setVersionAnnMap([]);
      }
      // Load annotations for this document in this corpus — await so they're ready before render
      await loadAnnotations(docId);
      // Phase 7i/21a: Load concept links (cached)
      const doc = res.data.document;
      if (doc && doc.body) {
        loadConceptLinks(doc.id);
      } else {
        setConceptLinks([]);
      }
      // Phase 26a: Load co-author info
      loadDocumentAuthors(docId);
      // Phase 38j: Load citations for this document
      documentsAPI.getCitations(docId)
        .then(res => setCitations(res.data.citations || []))
        .catch(() => setCitations([]));
    } catch (err) {
      console.error('Failed to load document:', err);
    } finally {
      setDocLoading(false);
    }
  };

  // Phase 26a: Co-author helpers
  const loadDocumentAuthors = async (docId) => {
    try {
      const res = await corpusAPI.getDocumentAuthors(docId);
      setAuthorData(res.data);
    } catch (err) {
      console.error('Failed to load document authors:', err);
    }
  };

  const handleGenerateDocInvite = async () => {
    if (!document) return;
    try {
      setGeneratingDocInvite(true);
      const res = await corpusAPI.generateDocumentInviteToken(document.id);
      const fullUrl = `${window.location.origin}/doc-invite/${res.data.token}`;
      setDocInviteLink(fullUrl);
    } catch (err) {
      console.error('Failed to generate document invite:', err);
    } finally {
      setGeneratingDocInvite(false);
    }
  };

  const handleCopyDocInvite = () => {
    if (!docInviteLink) return;
    navigator.clipboard.writeText(docInviteLink);
    setCopiedDocInvite(true);
    setTimeout(() => setCopiedDocInvite(false), 2000);
  };

  const handleRemoveDocAuthor = async (targetUserId) => {
    if (!document) return;
    try {
      await corpusAPI.removeDocumentAuthor(document.id, targetUserId);
      loadDocumentAuthors(document.id);
    } catch (err) {
      console.error('Failed to remove co-author:', err);
    }
  };

  const handleLeaveDocAuthorship = async () => {
    if (!document) return;
    try {
      await corpusAPI.leaveDocumentAuthorship(document.id);
      loadDocumentAuthors(document.id);
      setShowAuthorPanel(false);
    } catch (err) {
      console.error('Failed to leave document:', err);
    }
  };

  const isDocAuthor = authorData?.authors != null; // authors array only returned to authors

  const loadAnnotations = async (docId) => {
    try {
      setAnnotationsLoading(true);
      const res = await corpusAPI.getDocumentAnnotations(corpusId, docId, layerFilter || undefined);
      const rawAnnotations = res.data.annotations || [];

      // Resolve path names for each annotation's graph_path
      const allPathIds = new Set();
      for (const ann of rawAnnotations) {
        const gp = ann.graph_path || [];
        for (const pid of gp) {
          allPathIds.add(pid);
        }
        // Also add parent_id if present
        if (ann.parent_id) allPathIds.add(ann.parent_id);
      }

      let nameMap = {};
      if (allPathIds.size > 0) {
        try {
          const namesRes = await conceptsAPI.getConceptNames(Array.from(allPathIds).join(','));
          // Response is { concepts: [{ id, name }, ...] } — convert to { id: name } map
          const conceptsList = namesRes.data.concepts || [];
          for (const c of conceptsList) {
            nameMap[c.id] = c.name;
          }
        } catch (err) {
          console.warn('Failed to resolve annotation path names:', err);
        }
      }

      // Enrich annotations with resolved path
      const enriched = rawAnnotations.map(ann => {
        const gp = ann.graph_path || [];
        // graph_path = path from root to parent, INCLUSIVE of parent at the end.
        // So gp already contains the parent concept ID as the last element.
        // We resolve names for the path ABOVE the parent (all but last in gp).
        // The parent name is then the last element in the resolved chain.
        // The leaf concept (ann.concept_name [attr]) is appended separately in the render.
        const ancestorNames = gp.map(pid => nameMap[pid] || `#${pid}`);
        
        // Store both names and IDs in parallel for Phase 13 cross-referencing
        const fullChain = [...ancestorNames];
        const fullChainIds = [...gp];

        return {
          ...ann,
          resolvedPathNames: fullChain,
          resolvedPathIds: fullChainIds,
        };
      });

      setAnnotations(enriched);
      // Phase 26e-2: track author/member status for filter-jump logic
      if (res.data.isAuthor !== undefined) setIsAuthor(res.data.isAuthor);
    } catch (err) {
      console.error('Failed to load annotations:', err);
      setAnnotations([]);
    } finally {
      setAnnotationsLoading(false);
    }
  };

  const handleBackToList = () => {
    setSubView('list');
    setDocument(null);
    setDocCorpuses([]);
    setAnnotations([]);
    setSelectionQuoteText(null);
    setSelectionBtnPos(null);
    setShowAnnotationPanel(false);
    setSelectedAnnotation(null);
    // Phase 7h: Clear version state
    setVersionHistory([]);
    setShowVersionHistory(false);
    // Phase 21c: Clear version chain
    setVersionChain([]);
    // Phase 22a: Clear version upload state
    setShowVersionUpload(false);
    setVersionFile(null);
    setVersionFileError('');
    setVersionCopyrightConfirmed(false);
    // Phase 7i: Clear concept links
    setConceptLinks([]);
    // Phase 38j: Clear citations
    setCitations([]);
  };

  // Phase 7i-5: Load concept links using cached endpoint (for finalized documents)
  const loadConceptLinks = async (documentId) => {
    try {
      setConceptLinksLoading(true);
      const res = await conceptsAPI.getDocumentConceptLinks(documentId);
      setConceptLinks(res.data.matches || []);
    } catch (err) {
      console.warn('Failed to load concept links:', err);
      setConceptLinks([]);
    } finally {
      setConceptLinksLoading(false);
    }
  };

  // Phase 7i: Click a concept link underline → open decontextualized Flip View in new graph tab
  const handleConceptLinkClick = (conceptId, conceptName) => {
    if (onOpenConceptTab) {
      // Pass null for path (decontextualized), null for attribute, null for sourceCorpusTabId,
      // and 'flip' for viewMode (6th parameter)
      onOpenConceptTab(conceptId, [], conceptName, null, null, 'flip');
    }
  };

  // Phase 7i-4: Build segments with concept link underlines for a preview panel
  // (used for draft editing preview and upload preview)
  const buildConceptLinkSegments = (text, links) => {
    if (!links || links.length === 0) return null;
    const segments = [];
    let pos = 0;
    for (const cl of links) {
      if (cl.start > pos) {
        segments.push({ type: 'text', content: text.substring(pos, cl.start) });
      }
      segments.push({
        type: 'conceptLink',
        content: text.substring(cl.start, cl.end),
        conceptId: cl.conceptId,
        conceptName: cl.conceptName,
      });
      pos = cl.end;
    }
    if (pos < text.length) {
      segments.push({ type: 'text', content: text.substring(pos, text.length) });
    }
    return segments;
  };

  // Reload annotations when filter changes
  useEffect(() => {
    if (subView?.documentId) {
      loadAnnotations(subView.documentId);
    }
  }, [layerFilter]);

  // Reset concept navigation state, attribute filter, and sort when document changes
  useEffect(() => {
    setConceptNavState({});
    setAttributeFilter('all');
    setAnnotationSort('votes');
  }, [subView?.documentId]);


  // ─── Quote position cache for position-based sort (Phase 38g) ───
  const annotationsWithPositions = useMemo(() => {
    if (!annotations || !document?.body) return annotations;
    return annotations.map(a => {
      if (!a.quote_text) return { ...a, _quotePosition: -1 };
      let pos = -1;
      let searchFrom = 0;
      const occurrence = a.quote_occurrence || 1;
      for (let i = 0; i < occurrence; i++) {
        pos = document.body.indexOf(a.quote_text, searchFrom);
        if (pos === -1) break;
        searchFrom = pos + 1;
      }
      return { ...a, _quotePosition: pos === -1 ? -1 : pos };
    });
  }, [annotations, document?.body]);

  // ─── Text Selection for Annotations ───────────────
  const handleMouseUp = useCallback((e) => {
    if (isGuest) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      if (!showAnnotationPanel) {
        setSelectionQuoteText(null);
        setSelectionBtnPos(null);
      }
      return;
    }
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const bodyEl = bodyRef.current;
    if (!bodyEl || !bodyEl.contains(range.startContainer)) return;
    const rect = range.getBoundingClientRect();
    setSelectionQuoteText(text);
    setSelectionBtnPos({ x: rect.right, y: rect.top });
  }, [isGuest, showAnnotationPanel]);

  // Navigate to the nth occurrence (1-based) of text in the document body
  const navigateToOccurrence = (text, occurrenceIdx, caseInsensitive = false) => {
    if (!text || !bodyRef.current) return false;
    // Remove any existing highlight mark
    if (highlightMarkRef.current && highlightMarkRef.current.parentNode) {
      const prev = highlightMarkRef.current;
      while (prev.firstChild) prev.parentNode.insertBefore(prev.firstChild, prev);
      prev.remove();
      highlightMarkRef.current = null;
    }
    // Build full text from body text nodes
    // Note: use window.document — 'document' is shadowed by the document state variable
    const walker = window.document.createTreeWalker(bodyRef.current, NodeFilter.SHOW_TEXT, null);
    let fullText = '';
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push({ node, start: fullText.length });
      fullText += node.textContent;
    }
    // Find the nth occurrence (optionally case-insensitive)
    const searchIn = caseInsensitive ? fullText.toLowerCase() : fullText;
    const searchFor = caseInsensitive ? text.toLowerCase() : text;
    let count = 0;
    let searchFrom = 0;
    let matchIdx = -1;
    while (true) {
      const pos = searchIn.indexOf(searchFor, searchFrom);
      if (pos === -1) break;
      count++;
      if (count === occurrenceIdx) { matchIdx = pos; break; }
      searchFrom = pos + 1;
    }
    if (matchIdx === -1) return false;
    const matchEnd = matchIdx + text.length;
    const range = window.document.createRange();
    let startSet = false;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const tnEnd = tn.start + tn.node.textContent.length;
      if (!startSet && matchIdx < tnEnd) {
        range.setStart(tn.node, matchIdx - tn.start);
        startSet = true;
      }
      if (startSet && matchEnd <= tnEnd) {
        range.setEnd(tn.node, matchEnd - tn.start);
        break;
      }
    }
    try {
      const mark = window.document.createElement('mark');
      mark.style.cssText = 'background:rgba(255,210,0,0.55);border-radius:2px;padding:0 1px;transition:opacity 0.6s';
      range.surroundContents(mark);
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightMarkRef.current = mark;
      setTimeout(() => {
        if (mark.parentNode) {
          mark.style.opacity = '0';
          setTimeout(() => {
            if (mark.parentNode) {
              while (mark.firstChild) mark.parentNode.insertBefore(mark.firstChild, mark);
              mark.remove();
            }
            highlightMarkRef.current = null;
          }, 700);
        }
      }, 2300);
    } catch (e) {
      // Cross-node selection — scroll using range bounding rect
      try {
        const rect = range.getBoundingClientRect();
        if (rect.top !== 0 || rect.bottom !== 0) {
          window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 2, behavior: 'smooth' });
        }
      } catch {}
    }
    return true;
  };

  // Open the occurrence picker, or navigate directly if only one match
  const openOccurrencePicker = (text, sourceId, sourceType, storedOccurrence) => {
    const docBody = document?.body || '';
    const items = buildOccurrenceItems(text, docBody);
    if (items.length === 0) {
      if (sourceType === 'annotation') {
        setQuoteNotFoundAnnId(sourceId);
        setTimeout(() => setQuoteNotFoundAnnId(null), 2500);
      }
      return;
    }
    if (items.length === 1) {
      navigateToOccurrence(text, 1);
      return;
    }
    // Multiple occurrences — auto-navigate to stored occurrence if available, then show picker
    if (storedOccurrence && storedOccurrence <= items.length) {
      navigateToOccurrence(text, storedOccurrence);
    }
    setOccurrencePicker({ text, sourceId, sourceType, items });
  };

  // Navigate concept step-through (case-insensitive). direction: +1 = next, -1 = prev.
  const navigateConcept = (conceptId, conceptName, direction) => {
    const body = document?.body || '';
    const lower = body.toLowerCase();
    const search = conceptName.toLowerCase();
    let total = 0;
    let pos = 0;
    while (true) {
      const found = lower.indexOf(search, pos);
      if (found === -1) break;
      total++;
      pos = found + 1;
    }
    if (total === 0) {
      setConceptNavState(prev => ({ ...prev, [conceptId]: { idx: 0, total: 0 } }));
      setTimeout(() => setConceptNavState(prev => {
        const next = { ...prev };
        delete next[conceptId];
        return next;
      }), 2000);
      return;
    }
    const current = conceptNavState[conceptId];
    let nextIdx;
    if (!current || current.total !== total) {
      nextIdx = direction === -1 ? total : 1;
    } else {
      nextIdx = current.idx + direction;
      if (nextIdx < 1) nextIdx = total;
      if (nextIdx > total) nextIdx = 1;
    }
    navigateToOccurrence(conceptName, nextIdx, true);
    setConceptNavState(prev => ({ ...prev, [conceptId]: { idx: nextIdx, total } }));
  };

  const handleAnnotationCreated = () => {
    setShowAnnotationPanel(false);
    setSelectionQuoteText(null);
    setSelectionBtnPos(null);
    window.getSelection()?.removeAllRanges();
    // Phase 26e-2: switch filter to "all" if the new annotation won't appear in the current view
    const isCorpusMember = isCorpusOwner || isAllowedUser;
    if (layerFilter === 'corpus_members' && !isCorpusMember) {
      setLayerFilter(null); // useEffect will reload annotations with filter=all
    } else if (layerFilter === 'author' && !isAuthor) {
      setLayerFilter(null);
    } else if (subView?.documentId) {
      loadAnnotations(subView.documentId);
    }
  };

  const handleAnnotationClick = (annotation) => {
    const newSelected = selectedAnnotation?.id === annotation.id ? null : annotation;
    setSelectedAnnotation(newSelected);
    // Phase 31c: Fetch messaging status when expanding an annotation
    if (newSelected && !isGuest && !annMsgStatus[annotation.id]) {
      messagesAPI.getAnnotationStatus(annotation.id)
        .then(res => setAnnMsgStatus(prev => ({ ...prev, [annotation.id]: res.data })))
        .catch(() => {});
    }
  };

  // Phase 31c: Create a message thread from an annotation card
  const handleCreateThread = async (annotationId, threadType) => {
    if (!annMsgBody.trim() || annMsgSending) return;
    try {
      setAnnMsgSending(true);
      await messagesAPI.createThread(annotationId, threadType, annMsgBody.trim());
      // Refresh status for this annotation
      const res = await messagesAPI.getAnnotationStatus(annotationId);
      setAnnMsgStatus(prev => ({ ...prev, [annotationId]: res.data }));
      setAnnMsgComposing(null);
      setAnnMsgBody('');
    } catch (err) {
      console.error('Failed to create thread:', err);
    } finally {
      setAnnMsgSending(false);
    }
  };

  // Phase 26c-1: Annotation deletion removed — annotations are now permanent

  // ─── Annotation Voting (Phase 7f) ──────────────────
  const handleAnnotationVote = async (annotationId) => {
    try {
      const res = await corpusAPI.voteOnAnnotation(annotationId);
      const newCount = res.data.voteCount;
      // Update the annotation in local state
      setAnnotations(prev => prev.map(a =>
        a.id === annotationId ? { ...a, vote_count: newCount, user_voted: true } : a
      ));
      // Also update selectedAnnotation if it's the one we just voted on
      if (selectedAnnotation?.id === annotationId) {
        setSelectedAnnotation(prev => ({ ...prev, vote_count: newCount, user_voted: true }));
      }
    } catch (err) {
      console.error('Failed to vote on annotation:', err);
    }
  };

  const handleAnnotationUnvote = async (annotationId) => {
    try {
      const res = await corpusAPI.unvoteAnnotation(annotationId);
      const newCount = res.data.voteCount;
      setAnnotations(prev => prev.map(a =>
        a.id === annotationId ? { ...a, vote_count: newCount, user_voted: false } : a
      ));
      if (selectedAnnotation?.id === annotationId) {
        setSelectedAnnotation(prev => ({ ...prev, vote_count: newCount, user_voted: false }));
      }
    } catch (err) {
      console.error('Failed to remove annotation vote:', err);
    }
  };

  // ─── Phase 38j: Citation helpers ────────────────────
  const handleCiteAnnotation = (annotationId) => {
    const citationUrl = `${window.location.origin}/cite/a/${annotationId}`;
    navigator.clipboard.writeText(citationUrl).then(() => {
      setCopiedAnnotationId(annotationId);
      setTimeout(() => setCopiedAnnotationId(null), 2000);
    }).catch(() => {
      // Fallback for insecure contexts
      const textArea = window.document.createElement('textarea');
      textArea.value = citationUrl;
      window.document.body.appendChild(textArea);
      textArea.select();
      window.document.execCommand('copy');
      window.document.body.removeChild(textArea);
      setCopiedAnnotationId(annotationId);
      setTimeout(() => setCopiedAnnotationId(null), 2000);
    });
  };

  const handleNavigateToCitation = async (citation) => {
    if (!citation.available || !citation.annotationId) return;
    try {
      const res = await citationsAPI.resolveCitation(citation.annotationId);
      const data = res.data;
      if (!data.found) return;
      // Navigate to the cited annotation's document in the correct corpus tab
      if (onOpenCorpusTab) {
        onOpenCorpusTab(data.corpusId, data.corpusName, data.documentId, data.annotationId);
      }
    } catch (err) {
      console.error('Failed to resolve citation:', err);
    }
  };

  // ─── Document Versioning (Phase 7h / 22a) ────────────────────

  const validateFileExtension = (file) => {
    const allowed = ['.txt', '.md', '.pdf', '.docx'];
    const name = file.name.toLowerCase();
    return allowed.some(ext => name.endsWith(ext));
  };

  const handleToggleVersionUpload = () => {
    setShowVersionUpload(v => !v);
    setVersionFile(null);
    setVersionFileError('');
  };

  const handleVersionFileSelect = (file) => {
    if (!validateFileExtension(file)) {
      setVersionFileError('Unsupported file type. Please upload a .txt, .md, .pdf, or .docx file.');
      setVersionFile(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setVersionFileError('File is too large. Maximum upload size is 10 MB.');
      setVersionFile(null);
      return;
    }
    setVersionFileError('');
    setVersionFile(file);
  };

  const doVersionUpload = async () => {
    if (creatingVersion || !document || !versionFile) return;
    try {
      setCreatingVersion(true);
      const res = await corpusAPI.createVersion(corpusId, document.id, versionFile, versionCopyrightConfirmed);
      const newDoc = res.data.document;
      setShowVersionUpload(false);
      setVersionFile(null);
      setVersionCopyrightConfirmed(false);
      handleOpenDocument(newDoc.id);
      await loadCorpus();
    } catch (err) {
      setVersionFileError(err.response?.data?.error || 'Failed to create version');
    } finally {
      setCreatingVersion(false);
    }
  };

  const handleLoadVersionHistory = async () => {
    if (!document) return;
    try {
      const res = await corpusAPI.getVersionHistory(document.id);
      setVersionHistory(res.data.versions || []);
      setShowVersionHistory(true);
    } catch (err) {
      console.error('Failed to load version history:', err);
    }
  };

  const handleOpenVersion = (docId) => {
    setShowVersionHistory(false);
    setVersionHistory([]);
    handleOpenDocument(docId);
  };

  // Helper: build text segments with concept link underlines woven in
  const addTextWithConceptLinks = (segments, fullText, regionStart, regionEnd) => {
    if (!conceptLinks || conceptLinks.length === 0) {
      segments.push({ type: 'text', content: fullText.substring(regionStart, regionEnd) });
      return;
    }

    // Find concept links that fall entirely within this region
    const linksInRegion = conceptLinks.filter(
      cl => cl.start >= regionStart && cl.end <= regionEnd
    );

    if (linksInRegion.length === 0) {
      segments.push({ type: 'text', content: fullText.substring(regionStart, regionEnd) });
      return;
    }

    let pos = regionStart;
    for (const cl of linksInRegion) {
      // Plain text before this concept link
      if (cl.start > pos) {
        segments.push({ type: 'text', content: fullText.substring(pos, cl.start) });
      }
      // The concept link segment
      segments.push({
        type: 'conceptLink',
        content: fullText.substring(cl.start, cl.end),
        conceptId: cl.conceptId,
        conceptName: cl.conceptName,
      });
      pos = cl.end;
    }
    // Remaining text after last concept link
    if (pos < regionEnd) {
      segments.push({ type: 'text', content: fullText.substring(pos, regionEnd) });
    }
  };

  const handleStartEdit = () => {
    setEditName(corpus.name);
    setEditDescription(corpus.description || '');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    try {
      await corpusAPI.update(corpusId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setEditing(false);
      await loadCorpus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update corpus');
    }
  };

  // ─── Render: Loading ───────────────────────────────

  if (loading) {
    return <div style={styles.loading}>Loading corpus...</div>;
  }

  if (!corpus) {
    return <div style={styles.loading}>Corpus not found.</div>;
  }

  // ─── Phase 26b: Members panel handlers ─────────────
  const handleToggleMembersPanel = async () => {
    const newState = !showMembersPanel;
    setShowMembersPanel(newState);
    if (newState) {
      await loadMembers();
      if (isCorpusOwner) {
        loadInviteTokens();
      }
    }
  };

  const loadMembers = async () => {
    try {
      setMembersLoading(true);
      const res = await corpusAPI.listAllowedUsers(corpusId);
      setMembersCount(res.data.count || 0);
      setMembersList(res.data.members || []);
    } catch (err) {
      console.error('Failed to load members:', err);
      setMembersCount(0);
      setMembersList([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const loadInviteTokens = async () => {
    try {
      setInviteTokensLoading(true);
      const res = await corpusAPI.getInviteTokens(corpusId);
      setInviteTokens(res.data.tokens || []);
    } catch (err) {
      console.error('Failed to load invite tokens:', err);
      setInviteTokens([]);
    } finally {
      setInviteTokensLoading(false);
    }
  };

  // ─── Callbacks for shared components ─────────────

  // Callbacks for CorpusDocumentList
  const handleDocListRemoveDocument = async (docId, title) => {
    if (!window.confirm(`Remove "${title}" from this corpus?`)) return;
    try {
      await corpusAPI.removeDocument(corpusId, docId);
      loadCorpus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove document');
    }
  };

  const handleDocListDeleteDocument = async (docId) => {
    await documentsAPI.deleteDocument(docId);
    loadCorpus();
  };

  // Phase 38i: Delete any version from version history
  const handleDeleteVersion = async (versionId) => {
    try {
      setDeletingVersion(true);
      await documentsAPI.deleteDocument(versionId);

      // Determine where to navigate after deletion
      const remainingVersions = versionChain.filter(v => v.id !== versionId);

      if (remainingVersions.length === 0) {
        // Last version deleted — close document view, refresh corpus
        setDocument(null);
        setSubView({ view: 'list' });
        setVersionChain([]);
        setVersionHistory([]);
        setShowVersionHistory(false);
        loadCorpus();
      } else if (document && document.id === versionId) {
        // User was viewing the deleted version — navigate to nearest surviving version
        const deletedIdx = versionChain.findIndex(v => v.id === versionId);
        // Prefer previous version, then next
        const nextVersion = deletedIdx > 0
          ? remainingVersions[Math.min(deletedIdx - 1, remainingVersions.length - 1)]
          : remainingVersions[0];
        setShowVersionHistory(false);
        setVersionHistory([]);
        handleOpenDocument(nextVersion.id);
        loadCorpus();
      } else {
        // User was viewing a different version — just refresh the chain and history
        const updatedChainRes = await documentsAPI.getVersionChain(document.id).catch(() => ({ data: { versions: [] } }));
        setVersionChain(updatedChainRes.data.versions || []);
        if (showVersionHistory) {
          const histRes = await corpusAPI.getVersionHistory(document.id).catch(() => ({ data: { versions: [] } }));
          setVersionHistory(histRes.data.versions || []);
        }
        loadCorpus();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete version');
    } finally {
      setDeletingVersion(false);
      setDeleteVersionTarget(null);
    }
  };

  const handleDocListToggleFavorite = async (docId) => {
    if (isGuest) return;
    try {
      const res = await corpusAPI.toggleDocumentFavorite(corpusId, docId);
      setFavoriteDocIds(prev => {
        const next = new Set(prev);
        if (res.data.favorited) next.add(docId); else next.delete(docId);
        return next;
      });
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const handleDocListAssignTag = async (docId, tag) => {
    await documentsAPI.assignTag(docId, tag.id);
    setDocuments(prev => prev.map(d =>
      d.id === docId ? { ...d, tags: [{ id: tag.id, name: tag.name }] } : d
    ));
  };

  const handleDocListRemoveTag = async (docId, tagId) => {
    await documentsAPI.removeTag(docId, tagId);
    setDocuments(prev => prev.map(d =>
      d.id === docId ? { ...d, tags: [] } : d
    ));
  };

  // Callbacks for CorpusUploadForm
  const handleUploadDocument = async (cId, file, title, tags, copyrightConfirmed) => {
    await corpusAPI.uploadDocument(cId, file, title, tags, copyrightConfirmed);
  };

  const handleSearchDocuments = async (query, excludeCorpusId) => {
    const res = await corpusAPI.searchDocuments(query, excludeCorpusId);
    return res;
  };

  const handleAddDocToCorpus = async (cId, docId) => {
    await corpusAPI.addDocument(cId, docId);
  };

  const handleUploadComplete = () => {
    loadCorpus();
  };

  // Callbacks for CorpusMembersPanel
  const handleMembersGenerateInvite = async () => {
    const res = await corpusAPI.generateInviteToken(corpusId);
    loadInviteTokens();
    return res;
  };

  const handleMembersDeleteToken = async (tokenId) => {
    await corpusAPI.deleteInviteToken(tokenId);
    loadInviteTokens();
  };

  const handleMembersRemoveUser = async (userId, username) => {
    await corpusAPI.removeAllowedUser(corpusId, userId);
    loadMembers();
  };

  const handleMembersLeave = async () => {
    await corpusAPI.leaveCorpus(corpusId);
    if (onUnsubscribe) onUnsubscribe(corpusId);
  };

  const handleTransferOwnership = async (newOwnerId) => {
    await corpusAPI.transferOwnership(corpusId, newOwnerId);
    loadCorpus();
    loadMembers();
  };

  const handleDeleteCorpus = async () => {
    if (!window.confirm(`Delete "${corpus?.name}"? All documents only in this corpus will also be deleted. This cannot be undone.`)) return;
    try {
      await corpusAPI.deleteCorpus(corpusId);
      if (onUnsubscribe) onUnsubscribe(corpusId);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete corpus');
    }
  };

  const isOwner = isCorpusOwner;


  // ─── Render: Document Viewer Sub-View ──────────────

  if (subView !== 'list') {
    if (docLoading) {
      return <div style={styles.loading}>Loading document...</div>;
    }

    if (!document) {
      return (
        <div style={styles.container}>
          <button onClick={handleBackToList} style={styles.backButton}>← {corpus.name}</button>
          <div style={styles.loading}>Document not found.</div>
        </div>
      );
    }

    // Phase 22b-3: concept underlines removed — concepts are listed in the sidebar panel

    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={handleBackToList} style={styles.backButton}>← {corpus.name}</button>
          {annotations.length > 0 && (
            <span style={styles.annotationCount}>
              {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
            </span>
          )}
          <div style={styles.filterStack}>
            {/* Phase 26d: Identity-based filter toggle (visible to all logged-in users) */}
            {!isGuest && (
              <div style={styles.layerToggle}>
                <button
                  onClick={() => setLayerFilter(null)}
                  style={{
                    ...styles.layerToggleBtn,
                    ...(layerFilter === null ? styles.layerToggleBtnActive : {}),
                  }}
                >All</button>
                <button
                  onClick={() => setLayerFilter('corpus_members')}
                  style={{
                    ...styles.layerToggleBtn,
                    ...(layerFilter === 'corpus_members' ? styles.layerToggleBtnActive : {}),
                  }}
                >Corpus Members</button>
                <button
                  onClick={() => setLayerFilter('author')}
                  style={{
                    ...styles.layerToggleBtn,
                    ...(layerFilter === 'author' ? styles.layerToggleBtnActive : {}),
                  }}
                >Author</button>
              </div>
            )}
            {/* Phase 38f: Attribute filter toggle */}
            {enabledAttributes.length > 1 && (
              <div style={styles.layerToggle}>
                <button
                  onClick={() => setAttributeFilter('all')}
                  style={{
                    ...styles.layerToggleBtn,
                    ...(attributeFilter === 'all' ? styles.layerToggleBtnActive : {}),
                  }}
                >All</button>
                {enabledAttributes.map(attr => (
                  <button
                    key={attr.id}
                    onClick={() => setAttributeFilter(attr.name)}
                    style={{
                      ...styles.layerToggleBtn,
                      ...(attributeFilter === attr.name ? styles.layerToggleBtnActive : {}),
                    }}
                  >{attr.name.charAt(0).toUpperCase() + attr.name.slice(1)}</button>
                ))}
              </div>
            )}
            {/* Phase 38g: Annotation sort toggle */}
            <div style={styles.layerToggle}>
              <span style={styles.sortLabel}>Sort:</span>
              <button
                onClick={() => setAnnotationSort('votes')}
                style={{
                  ...styles.layerToggleBtn,
                  ...(annotationSort === 'votes' ? styles.layerToggleBtnActive : {}),
                }}
              >Votes</button>
              <button
                onClick={() => setAnnotationSort('position')}
                style={{
                  ...styles.layerToggleBtn,
                  ...(annotationSort === 'position' ? styles.layerToggleBtnActive : {}),
                }}
              >Position</button>
            </div>
          </div>
        </div>

        <div style={styles.docInfo}>
          <div style={styles.docTitleRow}>
            <h2 style={styles.docTitle}>{document.title}</h2>
            {document.version_number > 1 && (
              <span style={styles.versionBadge}>v{document.version_number}</span>
            )}
          </div>
          <div style={styles.metaRow}>
            <span>{document.format}</span>
            <span style={styles.metaDot}>·</span>
            <span>uploaded by {document.uploader_username}</span>
            <span style={styles.metaDot}>·</span>
            <span>{new Date(document.created_at).toLocaleDateString()}</span>
            {authorData && (
              <>
                <span style={styles.metaDot}>&middot;</span>
                <span
                  style={isDocAuthor ? styles.authorCountClickable : undefined}
                  onClick={isDocAuthor ? () => setShowAuthorPanel(p => !p) : undefined}
                >
                  {authorData.count === 1 ? '1 author' : `${authorData.count} co-authors`}
                </span>
              </>
            )}
          </div>

          {/* Phase 26a: Co-author management panel */}
          {showAuthorPanel && isDocAuthor && authorData.authors && (
            <div style={styles.authorPanel}>
              <div style={styles.authorPanelHeader}>
                <span style={styles.authorPanelTitle}>Co-Authors</span>
                <span
                  style={styles.authorPanelClose}
                  onClick={() => setShowAuthorPanel(false)}
                >&times;</span>
              </div>

              <div style={styles.authorList}>
                {authorData.authors.map(a => (
                  <div key={a.userId} style={styles.authorRow}>
                    <span style={styles.authorName}>
                      {a.username}
                      {a.isUploader && <span style={styles.uploaderLabel}> (uploader)</span>}
                    </span>
                    {!a.isUploader && isDocAuthor && a.userId !== user?.id && (
                      <button
                        style={styles.authorRemoveBtn}
                        onClick={() => handleRemoveDocAuthor(a.userId)}
                      >Remove</button>
                    )}
                  </div>
                ))}
              </div>

              <div style={styles.coauthorWarning}>
                New co-authors will see all existing message threads on this document.
              </div>

              <div style={styles.authorActions}>
                <button
                  style={styles.authorActionBtn}
                  onClick={handleGenerateDocInvite}
                  disabled={generatingDocInvite}
                >
                  {generatingDocInvite ? 'Generating...' : 'Generate Invite Link'}
                </button>

                {docInviteLink && (
                  <div style={styles.inviteLinkRow}>
                    <input
                      style={styles.inviteLinkInput}
                      value={docInviteLink}
                      readOnly
                      onFocus={e => e.target.select()}
                    />
                    <button
                      style={styles.copyBtn}
                      onClick={handleCopyDocInvite}
                    >{copiedDocInvite ? 'Copied' : 'Copy'}</button>
                  </div>
                )}

                {/* Leave button — only for co-authors, not the uploader */}
                {authorData.authors.some(a => a.userId === user?.id && !a.isUploader) && (
                  <button
                    style={styles.leaveBtn}
                    onClick={handleLeaveDocAuthorship}
                  >Leave Document</button>
                )}
              </div>
            </div>
          )}

          {docCorpuses.length > 0 && (
            <div style={styles.corpusMembership}>
              <span style={styles.corpusMemberLabel}>In corpuses: </span>
              {docCorpuses.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && <span style={styles.metaDot}>·</span>}
                  {c.id === corpusId ? (
                    <span style={styles.corpusLinkCurrent}>
                      {c.name} (current)
                    </span>
                  ) : (
                    <span
                      style={styles.corpusLink}
                      onClick={() => onOpenCorpusTab && onOpenCorpusTab(c.id, c.name, subView.documentId)}
                      title={`Open in ${c.name} corpus tab`}
                    >
                      {c.name}
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
          {/* Phase 7h/22a: Version actions row */}
          <div style={styles.versionActionRow}>
            {/* New Version button — only for document authors (uploader or coauthors) */}
            {!isGuest && isDocAuthor && (
              <button
                onClick={handleToggleVersionUpload}
                style={styles.versionButton}
              >
                {showVersionUpload ? 'Cancel' : '+ New Version'}
              </button>
            )}
            {/* Version history button — always available for any viewer */}
            <button
              onClick={handleLoadVersionHistory}
              style={styles.versionButton}
            >
              Version history
            </button>
          </div>
        </div>

        {/* Phase 21c: Version navigator — shown when document has sibling versions */}
        {versionChain.length > 1 && (() => {
          const currentIdx = versionChain.findIndex(v => v.id === document.id);
          return (
            <div style={styles.versionNav}>
              <button
                style={styles.versionNavArrow}
                disabled={currentIdx <= 0}
                onClick={() => currentIdx > 0 && handleOpenVersion(versionChain[currentIdx - 1].id)}
                title="Previous version"
              >←</button>
              {versionChain.map((v) => (
                <span
                  key={v.id}
                  style={{
                    ...styles.versionNavItem,
                    ...(v.id === document.id ? styles.versionNavItemCurrent : {}),
                  }}
                  onClick={() => v.id !== document.id && handleOpenVersion(v.id)}
                  title={v.id !== document.id ? `Switch to v${v.version_number}` : undefined}
                >v{v.version_number}</span>
              ))}
              <button
                style={styles.versionNavArrow}
                disabled={currentIdx >= versionChain.length - 1}
                onClick={() => currentIdx < versionChain.length - 1 && handleOpenVersion(versionChain[currentIdx + 1].id)}
                title="Next version"
              >→</button>
            </div>
          );
        })()}

        {/* Phase 22a: Version file upload panel */}
        {showVersionUpload && (
          <div style={styles.versionUploadPanel}>
            <div style={styles.versionUploadHeader}>Upload a new version</div>
            <div
              style={{
                ...styles.dropZone,
                ...(creatingVersion ? styles.dropZoneUploading : versionDragOver ? styles.dropZoneActive : {}),
              }}
              onDragOver={(e) => { if (creatingVersion) return; e.preventDefault(); setVersionDragOver(true); }}
              onDragLeave={() => setVersionDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setVersionDragOver(false);
                if (creatingVersion) return;
                const file = e.dataTransfer.files[0];
                if (file) handleVersionFileSelect(file);
              }}
              onClick={() => { if (!creatingVersion) versionFileInputRef.current?.click(); }}
            >
              {creatingVersion ? (
                <span style={styles.dropZoneUploadingText}>
                  <span style={styles.uploadSpinner} />
                  Uploading…
                </span>
              ) : versionFile ? (
                <span style={styles.dropZoneFileName}>{versionFile.name}</span>
              ) : (
                <span style={styles.dropZoneHint}>
                  Drop a file here, or click to choose
                  <span style={styles.dropZoneFormats}>.txt · .md · .pdf · .docx</span>
                </span>
              )}
            </div>
            <input
              ref={versionFileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) handleVersionFileSelect(file);
                e.target.value = '';
              }}
            />
            {versionFileError && <div style={styles.fileError}>{versionFileError}</div>}
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={versionCopyrightConfirmed}
                onChange={(e) => setVersionCopyrightConfirmed(e.target.checked)}
                disabled={creatingVersion}
              />
              <span style={styles.checkboxLabel}>I confirm I have the right to upload this content (I own it or it is in the public domain)</span>
            </label>
            <div style={styles.versionUploadActions}>
              <button
                onClick={doVersionUpload}
                disabled={!versionFile || !versionCopyrightConfirmed || creatingVersion}
                style={{
                  ...styles.submitButton,
                  opacity: !versionFile || !versionCopyrightConfirmed || creatingVersion ? 0.5 : 1,
                }}
              >
                {creatingVersion ? 'Uploading...' : 'Upload version'}
              </button>
            </div>
          </div>
        )}

        {/* Phase 7h: Version history panel */}
        {showVersionHistory && versionHistory.length > 0 && (
          <div style={styles.versionHistoryPanel}>
            <div style={styles.versionHistoryHeader}>
              <span style={styles.versionHistoryTitle}>Version History</span>
              <button
                onClick={() => setShowVersionHistory(false)}
                style={styles.closeBtn}
              >✕</button>
            </div>
            <div style={styles.versionList}>
              {versionHistory.map(v => (
                <div
                  key={v.id}
                  style={{
                    ...styles.versionCard,
                    ...(v.id === document.id ? styles.versionCardCurrent : {}),
                  }}
                  onClick={() => v.id !== document.id && handleOpenVersion(v.id)}
                >
                  <div style={styles.versionCardTitle}>
                    <span>
                      v{v.version_number}
                      {v.id === document.id && <span style={styles.currentBadge}>current</span>}
                    </span>
                    {!isGuest && user && v.uploaded_by === user.id && (
                      <button
                        style={styles.versionDeleteBtn}
                        title="Delete this version"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteVersionTarget({
                            id: v.id,
                            versionNumber: v.version_number,
                            hasOtherVersions: versionHistory.length > 1,
                            hasDownstream: versionHistory.some(other => other.source_document_id === v.id),
                          });
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <div style={styles.versionCardMeta}>
                    by {v.uploader_username || 'deleted user'} · {new Date(v.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase 38i: Delete version confirmation modal */}
        {deleteVersionTarget && (
          <div style={styles.deleteVersionOverlay} onClick={() => { if (!deletingVersion) setDeleteVersionTarget(null); }}>
            <div style={styles.deleteVersionModal} onClick={e => e.stopPropagation()}>
              <div style={styles.deleteVersionHeader}>
                <span style={styles.deleteVersionTitle}>Delete Version</span>
                <span
                  style={styles.deleteVersionClose}
                  onClick={() => { if (!deletingVersion) setDeleteVersionTarget(null); }}
                >✕</span>
              </div>
              <div style={styles.deleteVersionBody}>
                <p style={styles.deleteVersionText}>
                  Delete v{deleteVersionTarget.versionNumber} of "{document?.title}"?
                </p>
                <p style={styles.deleteVersionText}>
                  This will permanently remove this version and its annotations, messages, and favorites. This cannot be undone.
                </p>
                {deleteVersionTarget.hasOtherVersions && (
                  <p style={styles.deleteVersionNote}>
                    Other versions will not be affected.
                  </p>
                )}
                {deleteVersionTarget.hasDownstream && (
                  <p style={styles.deleteVersionNote}>
                    Versions created from this one will become standalone documents.
                  </p>
                )}
              </div>
              <div style={styles.deleteVersionActions}>
                <button
                  style={styles.deleteVersionCancelBtn}
                  onClick={() => { if (!deletingVersion) setDeleteVersionTarget(null); }}
                  disabled={deletingVersion}
                >
                  Cancel
                </button>
                <button
                  style={styles.deleteVersionConfirmBtn}
                  disabled={deletingVersion}
                  onClick={() => handleDeleteVersion(deleteVersionTarget.id)}
                >
                  {deletingVersion ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document body with annotation highlights */}
        <div style={styles.docBodyWrapper}>
          <div
            style={styles.bodyContainer}
            onMouseUp={handleMouseUp}
          >
            <div
              ref={bodyRef}
              style={document.format === 'markdown' ? styles.bodyTextPre : styles.bodyText}
            >
              {(() => {
                // Phase 38j: Render citation URLs as clickable links in the document body
                const body = document.body;
                if (!body) return null;
                const citRegex = /((?:https?:\/\/[^\s/]+)?\/cite\/a\/\d+)/g;
                const parts = body.split(citRegex);
                if (parts.length <= 1) return body;
                return parts.map((part, idx) => {
                  const idMatch = part.match(/\/cite\/a\/(\d+)/);
                  if (idMatch) {
                    const annId = parseInt(idMatch[1], 10);
                    return (
                      <span
                        key={idx}
                        style={styles.citationBodyLink}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigateToCitation({ available: true, annotationId: annId });
                        }}
                        title={'Citation: annotation #' + annId}
                      >
                        {part}
                      </span>
                    );
                  }
                  return part;
                });
              })()}
            </div>
          </div>

          {/* Annotation sidebar — always visible */}
          <div style={styles.annotationSidebar}>
            <div style={styles.annotationSidebarHeader}>
              <span style={styles.annotationSidebarTitle}>
                Annotations{annotations.length > 0
                  ? attributeFilter !== 'all'
                    ? ` (${annotations.filter(a => a.attribute_name === attributeFilter).length}/${annotations.length})`
                    : ` (${annotations.length})`
                  : ''}
              </span>
              {!isGuest && (
                <button
                  onClick={() => {
                    setSelectionQuoteText(null);
                    setSelectionBtnPos(null);
                    setShowAnnotationPanel(true);
                  }}
                  style={styles.sidebarAnnotateBtn}
                  title="Annotate"
                >
                  Annotate
                </button>
              )}
            </div>

            {(() => {
              const source = annotationsWithPositions || annotations;
              const filteredAnnotations = attributeFilter === 'all'
                ? source
                : source.filter(a => a.attribute_name === attributeFilter);
              const sortedAnnotations = [...filteredAnnotations].sort((a, b) => {
                if (annotationSort === 'position') {
                  const posA = a._quotePosition ?? -1;
                  const posB = b._quotePosition ?? -1;
                  if (posA === -1 && posB === -1) return (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0);
                  if (posA === -1) return -1;
                  if (posB === -1) return 1;
                  if (posA !== posB) return posA - posB;
                  return (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0);
                }
                return (parseInt(b.vote_count) || 0) - (parseInt(a.vote_count) || 0);
              });
              return annotationsLoading ? (
              <div style={styles.annLoadingText}>Loading…</div>
            ) : annotations.length === 0 ? (
              <div style={styles.annEmptyText}>No annotations yet.</div>
            ) : filteredAnnotations.length === 0 ? (
              <div style={styles.annEmptyText}>No annotations match the selected filters.</div>
            ) : (
              <div style={styles.annotationList}>
                {sortedAnnotations.map(ann => {
                  const isSelected = selectedAnnotation?.id === ann.id;
                  const quoteNotFound = quoteNotFoundAnnId === ann.id;
                  return (
                    <div
                      key={ann.id}
                      style={{
                        ...styles.annListItem,
                        ...(isSelected ? styles.annListItemActive : {}),
                      }}
                      onClick={() => handleAnnotationClick(ann)}
                    >
                      {/* Header row: concept name + attribute + provenance badges */}
                      <div style={styles.annItemHeader}>
                        <span style={styles.annConceptName}>{ann.concept_name}</span>
                        {ann.attribute_name && (
                          <span style={styles.annAttributeBadge}>{ann.attribute_name}</span>
                        )}
                        {parseInt(ann.vote_count) > 0 && (
                          <span style={styles.annVoteCount}>▲{ann.vote_count}</span>
                        )}
                      </div>
                      {/* Provenance badges — context-dependent on active filter */}
                      {(ann.addedByAuthor || ann.votedByAuthor || ann.addedByCorpusMember || ann.votedByCorpusMember) && (
                        <div style={styles.provenanceBadgeRow}>
                          {ann.addedByAuthor && <span style={styles.provenanceBadge}>(author)</span>}
                          {ann.votedByAuthor && !ann.addedByAuthor && <span style={styles.provenanceBadge}>(author endorsed)</span>}
                          {ann.addedByCorpusMember && <span style={styles.provenanceBadge}>(corpus member)</span>}
                          {ann.votedByCorpusMember && !ann.addedByCorpusMember && <span style={styles.provenanceBadge}>(corpus member endorsed)</span>}
                        </div>
                      )}

                      {/* Quote */}
                      {ann.quote_text && (
                        <div
                          style={{
                            ...styles.annQuote,
                            ...(quoteNotFound ? styles.annQuoteNotFound : {}),
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (occurrencePicker?.sourceId === ann.id && occurrencePicker?.sourceType === 'annotation') {
                              setOccurrencePicker(null);
                            } else {
                              openOccurrencePicker(ann.quote_text, ann.id, 'annotation', ann.quote_occurrence);
                            }
                          }}
                          title={quoteNotFound ? 'Quote not found in document' : 'Click to navigate to this passage'}
                        >
                          "{ann.quote_text.length > 100
                            ? ann.quote_text.substring(0, 100) + '…'
                            : ann.quote_text}"
                        </div>
                      )}

                      {/* Occurrence picker for this annotation's quote */}
                      {occurrencePicker?.sourceId === ann.id && occurrencePicker?.sourceType === 'annotation' && (
                        <div style={styles.occurrencePickerPanel} onClick={e => e.stopPropagation()}>
                          <div style={styles.occurrencePickerHeader}>
                            <span>{occurrencePicker.items.length} occurrences — navigate to:</span>
                            <button onClick={() => setOccurrencePicker(null)} style={styles.occurrencePickerClose}>✕</button>
                          </div>
                          {occurrencePicker.items.map(item => (
                            <button
                              key={item.idx}
                              style={styles.occurrenceItemBtn}
                              onClick={() => { navigateToOccurrence(occurrencePicker.text, item.idx); setOccurrencePicker(null); }}
                            >
                              <span style={styles.occurrenceCtxText}>{item.before}</span>
                              <strong style={styles.occurrenceMatchBold}>{item.match}</strong>
                              <span style={styles.occurrenceCtxText}>{item.after}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Comment */}
                      {ann.comment && (
                        <div style={styles.annComment}>{ann.comment}</div>
                      )}

                      {/* Expanded detail when selected */}
                      {isSelected && (
                        <div
                          style={styles.annDetail}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Full path display */}
                          <div style={styles.annotationFullPath}>
                            {ann.resolvedPathNames && ann.resolvedPathNames.length > 0 && (
                              ann.resolvedPathNames.map((name, i) => {
                                const ancestorConceptId = ann.resolvedPathIds?.[i];
                                const matchingAnnotation = ancestorConceptId
                                  ? annotations.find(a => a.child_id === ancestorConceptId && a.id !== ann.id)
                                  : null;
                                return (
                                  <React.Fragment key={i}>
                                    {matchingAnnotation ? (
                                      <span
                                        style={styles.pathSegmentLinked}
                                        onClick={() => handleAnnotationClick(matchingAnnotation)}
                                        title={`${name} — also annotated in this document`}
                                      >{name}</span>
                                    ) : (
                                      <span style={styles.pathSegment}>{name}</span>
                                    )}
                                    <span style={styles.pathArrow}> → </span>
                                  </React.Fragment>
                                );
                              })
                            )}
                            <span style={styles.pathLeaf}>{ann.concept_name}</span>
                            {ann.attribute_name && (
                              <span style={styles.annotationAttributeBadge}>{ann.attribute_name}</span>
                            )}
                            {/* Descendant path extension */}
                            {(() => {
                              const currentChildId = ann.child_id;
                              const descendantAnnotations = annotations.filter(a => {
                                if (a.id === ann.id) return false;
                                const gp = a.graph_path || [];
                                return gp.includes(currentChildId);
                              });
                              if (descendantAnnotations.length === 0) return null;
                              return descendantAnnotations.map((descAnn, di) => {
                                const gp = descAnn.graph_path || [];
                                const gpIds = descAnn.resolvedPathIds || [];
                                const gpNames = descAnn.resolvedPathNames || [];
                                const currentIdx = gp.indexOf(currentChildId);
                                if (currentIdx === -1) return null;
                                const intermediateIds = gpIds.slice(currentIdx + 1);
                                const intermediateNames = gpNames.slice(currentIdx + 1);
                                return (
                                  <div key={`desc-${di}`} style={styles.descendantPathRow}>
                                    <span style={styles.pathArrow}> → </span>
                                    {intermediateIds.map((intId, ii) => {
                                      const intName = intermediateNames[ii] || `#${intId}`;
                                      const intAnnotation = annotations.find(a => a.child_id === intId && a.id !== ann.id);
                                      return (
                                        <React.Fragment key={ii}>
                                          {intAnnotation ? (
                                            <span
                                              style={styles.pathSegmentLinked}
                                              onClick={() => handleAnnotationClick(intAnnotation)}
                                            >{intName}</span>
                                          ) : (
                                            <span style={styles.pathSegmentDescendant}>{intName}</span>
                                          )}
                                          <span style={styles.pathArrow}> → </span>
                                        </React.Fragment>
                                      );
                                    })}
                                    <span
                                      style={styles.pathSegmentLinked}
                                      onClick={() => handleAnnotationClick(descAnn)}
                                    >{descAnn.concept_name}</span>
                                  </div>
                                );
                              });
                            })()}
                          </div>

                          <div style={styles.annotationCreator}>
                            by {ann.creator_username} · {new Date(ann.created_at).toLocaleDateString()}
                          </div>

                          {/* Phase 31d: Version navigation for this annotation */}
                          {versionChain.length > 1 && (() => {
                            const currentIdx = versionChain.findIndex(v => v.id === document.id);
                            if (currentIdx === -1) return null;
                            const prevVersion = currentIdx > 0 ? versionChain[currentIdx - 1] : null;
                            const nextVersion = currentIdx < versionChain.length - 1 ? versionChain[currentIdx + 1] : null;
                            const hasPrev = prevVersion && versionAnnMap.some(a =>
                              a.document_id === prevVersion.id && a.edge_id === ann.edge_id &&
                              ((a.quote_text === null && !ann.quote_text) || a.quote_text === ann.quote_text)
                            );
                            const hasNext = nextVersion && versionAnnMap.some(a =>
                              a.document_id === nextVersion.id && a.edge_id === ann.edge_id &&
                              ((a.quote_text === null && !ann.quote_text) || a.quote_text === ann.quote_text)
                            );
                            if (!hasPrev && !hasNext) return null;
                            return (
                              <div style={styles.annVersionNav}>
                                {hasPrev && (
                                  <button
                                    style={styles.annVersionBtn}
                                    onClick={() => {
                                      handleOpenVersion(prevVersion.id);
                                      // After navigation, try to scroll to the quote in the new version
                                      if (ann.quote_text) {
                                        setTimeout(() => navigateToOccurrence(ann.quote_text, ann.quote_occurrence || 1), 500);
                                      }
                                    }}
                                  >← v{prevVersion.version_number}</button>
                                )}
                                {hasNext && (
                                  <button
                                    style={styles.annVersionBtn}
                                    onClick={() => {
                                      handleOpenVersion(nextVersion.id);
                                      if (ann.quote_text) {
                                        setTimeout(() => navigateToOccurrence(ann.quote_text, ann.quote_occurrence || 1), 500);
                                      }
                                    }}
                                  >v{nextVersion.version_number} →</button>
                                )}
                              </div>
                            );
                          })()}

                          {/* Voting — Phase 26c-1: any logged-in user can vote on any annotation */}
                          {!isGuest && (
                            <div style={styles.annotationVoteRow}>
                              <button
                                onClick={() => {
                                  if (ann.user_voted) {
                                    handleAnnotationUnvote(ann.id);
                                  } else {
                                    handleAnnotationVote(ann.id);
                                  }
                                }}
                                style={{
                                  ...styles.annotationVoteBtn,
                                  ...(ann.user_voted ? styles.annotationVoteBtnActive : {}),
                                }}
                                title={ann.user_voted ? 'Remove your endorsement' : 'Endorse this annotation'}
                              >
                                {ann.user_voted ? '▲' : '△'} {parseInt(ann.vote_count) || 0}
                              </button>
                              <span style={styles.annotationVoteLabel}>
                                {parseInt(ann.vote_count) === 1 ? 'endorsement' : 'endorsements'}
                              </span>
                            </div>
                          )}
                          {isGuest && parseInt(ann.vote_count) > 0 && (
                            <div style={styles.annotationVoteRow}>
                              <span style={styles.annotationVoteCountReadonly}>
                                ▲ {ann.vote_count} {parseInt(ann.vote_count) === 1 ? 'endorsement' : 'endorsements'}
                              </span>
                            </div>
                          )}

                          {/* Phase 26c-2: Color set preference UI removed */}

                          {/* Phase 38j: Cite button */}
                          {!isGuest && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCiteAnnotation(ann.id); }}
                              style={styles.citeBtn}
                              title="Copy citation URL to clipboard"
                            >
                              {copiedAnnotationId === ann.id ? 'Copied!' : 'Cite'}
                            </button>
                          )}

                          {/* Navigate to concept */}
                          {onOpenConceptTab && (
                            <button
                              onClick={() => {
                                const gp = ann.graph_path || [];
                                onOpenConceptTab(ann.child_id, gp, ann.concept_name, ann.attribute_name);
                              }}
                              style={styles.navigateConceptBtn}
                            >Navigate to concept →</button>
                          )}

                          {/* Phase 31c: Messaging buttons */}
                          {!isGuest && (() => {
                            const status = annMsgStatus[ann.id];
                            if (!status) return null;

                            // Already a participant — show "View threads" only
                            if (status.is_participant) {
                              return (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Pass all equivalent annotation IDs for version-aware deep-linking
                                    if (onViewThreads) onViewThreads(ann.id, status.equivalent_annotation_ids);
                                  }}
                                  style={styles.msgActionBtn}
                                >View threads</button>
                              );
                            }

                            const isSoleAuthor = status.is_author && status.author_group_size === 1;
                            const showMsgAuthors = !isSoleAuthor;
                            // "Message annotator" only if: user is author AND annotator is NOT a coauthor
                            const annotatorIsCoauthor = authorData?.authors?.some(a => a.userId === ann.created_by);
                            const showMsgAnnotator = status.is_author && !annotatorIsCoauthor;

                            // Composing state for this annotation
                            const isComposing = annMsgComposing?.annotationId === ann.id;

                            if (isComposing) {
                              return (
                                <div style={styles.msgComposeBox} onClick={e => e.stopPropagation()}>
                                  <div style={styles.msgComposeLabel}>
                                    {annMsgComposing.threadType === 'to_authors'
                                      ? 'Message to author(s):'
                                      : 'Message to annotator:'}
                                  </div>
                                  <textarea
                                    style={styles.msgComposeInput}
                                    value={annMsgBody}
                                    onChange={(e) => setAnnMsgBody(e.target.value)}
                                    placeholder="Type your message..."
                                    rows={3}
                                    autoFocus
                                  />
                                  <div style={styles.msgComposeActions}>
                                    <button
                                      onClick={() => handleCreateThread(ann.id, annMsgComposing.threadType)}
                                      style={{
                                        ...styles.msgSendBtn,
                                        ...((!annMsgBody.trim() || annMsgSending) ? styles.msgSendBtnDisabled : {}),
                                      }}
                                      disabled={!annMsgBody.trim() || annMsgSending}
                                    >{annMsgSending ? 'Sending...' : 'Send'}</button>
                                    <button
                                      onClick={() => { setAnnMsgComposing(null); setAnnMsgBody(''); }}
                                      style={styles.msgCancelBtn}
                                    >Cancel</button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div style={styles.msgButtonRow}>
                                {showMsgAuthors && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAnnMsgComposing({ annotationId: ann.id, threadType: 'to_authors' });
                                      setAnnMsgBody('');
                                    }}
                                    style={styles.msgActionBtn}
                                  >Message author(s)</button>
                                )}
                                {showMsgAnnotator && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAnnMsgComposing({ annotationId: ann.id, threadType: 'to_annotator' });
                                      setAnnMsgBody('');
                                    }}
                                    style={styles.msgActionBtn}
                                  >Message annotator</button>
                                )}
                              </div>
                            );
                          })()}

                          {/* Phase 26c-1: Delete button removed — annotations are permanent */}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
            })()}

            {/* Phase 38j: Cited Annotations section */}
            {citations.length > 0 && (
              <div style={styles.citedSection}>
                <div style={styles.citedSectionHeader}>Cited Annotations</div>
                {citations.map(cit => (
                  <div key={cit.id} style={styles.citedCard}>
                    <div style={styles.citedCardHeader}>
                      <span style={styles.citedConceptName}>{cit.conceptName || 'Unknown concept'}</span>
                    </div>
                    {cit.quoteText && (
                      <div style={styles.citedQuote}>
                        "{cit.quoteText.length > 100 ? cit.quoteText.substring(0, 100) + '...' : cit.quoteText}"
                      </div>
                    )}
                    <div style={styles.citedSource}>
                      From: {cit.documentTitle || 'Unknown document'} · {cit.corpusName || 'Unknown corpus'}
                    </div>
                    {cit.available ? (
                      <button
                        onClick={() => handleNavigateToCitation(cit)}
                        style={styles.citedNavigateBtn}
                      >Navigate →</button>
                    ) : (
                      <span style={styles.citedUnavailable}>(no longer available)</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Concepts in this document */}
            {!conceptLinksLoading && conceptLinks.length > 0 && (() => {
              const seen = new Set();
              const unique = [];
              for (const cl of conceptLinks) {
                if (!seen.has(cl.conceptId)) {
                  seen.add(cl.conceptId);
                  unique.push({ conceptId: cl.conceptId, conceptName: cl.conceptName });
                }
              }
              return (
                <div style={styles.conceptPanelSection}>
                  <div style={styles.conceptPanelHeader}>Concepts in this document</div>
                  <div style={styles.conceptPanelList}>
                    {unique.map(concept => {
                      const navState = conceptNavState[concept.conceptId];
                      return (
                        <div key={concept.conceptId} style={styles.conceptPanelItem}>
                          <span
                            style={styles.conceptPanelName}
                            onClick={() => handleConceptLinkClick(concept.conceptId, concept.conceptName)}
                            title="Open Flip View for this concept"
                          >
                            {concept.conceptName}
                          </span>
                          <div style={styles.conceptNavControls}>
                            {navState && navState.total === 0 && (
                              <span style={styles.conceptNotFound}>not found</span>
                            )}
                            {navState && navState.total > 0 && navState.total > 1 && (
                              <button
                                style={styles.conceptNavStepBtn}
                                onClick={(e) => { e.stopPropagation(); navigateConcept(concept.conceptId, concept.conceptName, -1); }}
                                title="Previous occurrence"
                              >‹</button>
                            )}
                            {navState && navState.total > 0 && (
                              <span style={styles.conceptNavCount}>{navState.idx}/{navState.total}</span>
                            )}
                            {navState && navState.total > 0 && navState.total > 1 && (
                              <button
                                style={styles.conceptNavStepBtn}
                                onClick={(e) => { e.stopPropagation(); navigateConcept(concept.conceptId, concept.conceptName, 1); }}
                                title="Next occurrence"
                              >›</button>
                            )}
                            {(!navState || navState.total > 0) && (
                              <button
                                style={styles.conceptNavBtn}
                                onClick={(e) => { e.stopPropagation(); navigateConcept(concept.conceptId, concept.conceptName, 1); }}
                                title="Find in document"
                              >↓</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Floating selection button — appears near text selection */}
        {selectionBtnPos && !showAnnotationPanel && !isGuest && (
          <div
            style={{
              ...styles.floatingSelBtn,
              left: selectionBtnPos.x + 6,
              top: selectionBtnPos.y - 36,
            }}
          >
            <button
              onMouseDown={(e) => {
                e.preventDefault(); // prevent selection loss
                setShowAnnotationPanel(true);
              }}
              style={styles.floatingSelBtnInner}
              title="Annotate selection"
            >
              Annotate
            </button>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setSelectionQuoteText(null);
                setSelectionBtnPos(null);
                window.getSelection()?.removeAllRanges();
              }}
              style={styles.floatingSelCancelBtn}
            >✕</button>
          </div>
        )}

        {/* Annotation creation panel */}
        {showAnnotationPanel && (
          <div style={styles.annotationPanelWrapper}>
            <AnnotationPanel
              corpusId={corpusId}
              documentId={subView.documentId}
              documentBody={document?.body || ''}
              initialQuoteText={selectionQuoteText || ''}
              prefilledConcept={prefilledConcept}
              prefilledEdge={prefilledEdge}
              onAnnotationCreated={() => {
                setPrefilledConcept(null);
                setPrefilledEdge(null);
                handleAnnotationCreated();
              }}
              onClose={() => {
                setShowAnnotationPanel(false);
                setSelectionQuoteText(null);
                setSelectionBtnPos(null);
                setPrefilledConcept(null);
                setPrefilledEdge(null);
                window.getSelection()?.removeAllRanges();
              }}
            />
          </div>
        )}

      </div>
    );
  }

  // ─── Render: Document List Sub-View (Default) ─────

  return (
    <div style={styles.container}>
      <style>{`@keyframes orca-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Corpus info header */}
      <div style={styles.corpusInfo}>
        {editing ? (
          <div style={styles.editForm}>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={styles.editInput}
              maxLength={255}
              autoFocus
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              style={styles.editTextarea}
              rows={2}
            />
            <div style={styles.editActions}>
              <button onClick={handleSaveEdit} style={styles.saveButton}>Save</button>
              <button onClick={() => setEditing(false)} style={styles.cancelButton}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div style={styles.titleRow}>
              <h2 style={styles.corpusTitle}>{corpus.name}</h2>
              {(isAllowedUser || isCorpusOwner) && (
                <span style={styles.allowedBadge}>{isCorpusOwner ? 'Owner' : 'Member'}</span>
              )}
            </div>
            {corpus.description && (
              <p style={styles.corpusDescription}>{corpus.description}</p>
            )}
            <div style={styles.metaRow}>
              <span>Created by {corpus.owner_username}</span>
              <span style={styles.metaDot}>·</span>
              <span>{new Date(corpus.created_at).toLocaleDateString()}</span>
              <span style={styles.metaDot}>·</span>
              <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
              <span style={styles.metaDot}>·</span>
              <span>{corpus.subscriber_count || 0} subscriber{corpus.subscriber_count != 1 ? 's' : ''}</span>
            </div>
            <div style={styles.actionRow}>
              {isOwner && (
                <>
                  <button onClick={handleStartEdit} style={styles.editButton}>Edit</button>
                  <button onClick={handleDeleteCorpus} style={styles.deleteCorpusBtn}>Delete Corpus</button>
                </>
              )}
              {!isGuest && (
                <button onClick={handleToggleMembersPanel} style={styles.editButton}>
                  {showMembersPanel ? 'Hide Members' : 'Members'}
                </button>
              )}
              {!isGuest && onUnsubscribe && (
                <button
                  onClick={() => {
                    if (window.confirm(`Unsubscribe from "${corpus.name}"? This removes the corpus tab from your sidebar. You can resubscribe anytime.`)) {
                      onUnsubscribe(corpusId);
                    }
                  }}
                  style={styles.unsubButton}
                >Unsubscribe</button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Phase 26b: Members Panel */}
      {showMembersPanel && (
        <CorpusMembersPanel
          isOwner={isOwner}
          isAllowedUser={isAllowedUser}
          isGuest={isGuest}
          membersCount={membersCount}
          members={membersList}
          membersLoading={membersLoading}
          inviteTokens={inviteTokens}
          inviteTokensLoading={inviteTokensLoading}
          onGenerateInvite={handleMembersGenerateInvite}
          onDeleteInviteToken={handleMembersDeleteToken}
          onRemoveMember={handleMembersRemoveUser}
          onLeaveCorpus={handleMembersLeave}
          onTransferOwnership={handleTransferOwnership}
        />
      )}

      <CorpusUploadForm
        corpusId={corpusId}
        isGuest={isGuest}
        isOwner={isOwner}
        isAllowedUser={isAllowedUser}
        allTags={allTags}
        onUpload={handleUploadDocument}
        onSearchDocuments={handleSearchDocuments}
        onAddDocument={handleAddDocToCorpus}
        onComplete={handleUploadComplete}
      />

      <CorpusDocumentList
        documents={documents}
        corpusId={corpusId}
        currentUserId={user?.id}
        isGuest={isGuest}
        isOwner={isOwner}
        favorites={favoriteDocIds}
        allTags={allTags}
        onOpenDocument={handleOpenDocument}
        onRemoveDocument={handleDocListRemoveDocument}
        onDeleteDocument={handleDocListDeleteDocument}
        onToggleFavorite={handleDocListToggleFavorite}
        onAssignTag={handleDocListAssignTag}
        onRemoveTag={handleDocListRemoveTag}
      />
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
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  filterStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
    marginLeft: 'auto',
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
  corpusInfo: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '18px 22px',
    marginBottom: '20px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '4px',
  },
  corpusTitle: {
    margin: 0,
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  modeBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    padding: '2px 8px',
    border: '1px solid #ddd',
    borderRadius: '10px',
  },
  corpusDescription: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    margin: '6px 0',
    lineHeight: '1.4',
  },
  metaRow: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '8px',
  },
  metaDot: {
    margin: '0 6px',
  },
  actionRow: {
    marginTop: '12px',
    display: 'flex',
    gap: '8px',
  },
  editButton: {
    padding: '4px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  unsubButton: {
    padding: '4px 12px',
    border: '1px solid #e0c0c0',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  editInput: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
  },
  editTextarea: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    resize: 'vertical',
  },
  editActions: {
    display: 'flex',
    gap: '8px',
  },
  saveButton: {
    padding: '6px 14px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  cancelButton: {
    padding: '6px 14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  // Phase 22a: Drop zone (kept for version upload)
  dropZone: {
    border: '2px dashed #c8bfaf',
    borderRadius: '6px',
    padding: '28px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: '#fdfcf9',
    transition: 'border-color 0.15s, background-color 0.15s',
    userSelect: 'none',
  },
  dropZoneActive: {
    borderColor: '#8a7050',
    backgroundColor: '#f5f0e8',
  },
  dropZoneHint: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  dropZoneFormats: {
    display: 'block',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#bbb',
    marginTop: '4px',
    letterSpacing: '0.03em',
  },
  dropZoneFileName: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '600',
  },
  fileError: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    padding: '4px 0',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '4px',
  },
  checkboxLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.4',
  },
  // Phase 22a: Version upload panel
  versionUploadPanel: {
    backgroundColor: '#fdfcf9',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  versionUploadHeader: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#555',
  },
  versionUploadActions: {
    display: 'flex',
    gap: '8px',
  },
  dropZoneUploading: {
    borderColor: '#c8bfaf',
    backgroundColor: '#fdfcf9',
    cursor: 'default',
    opacity: 0.75,
  },
  dropZoneUploadingText: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  uploadSpinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid #d4c9b8',
    borderTopColor: '#8a7050',
    borderRadius: '50%',
    animation: 'orca-spin 0.75s linear infinite',
    flexShrink: 0,
  },
  submitButton: {
    padding: '8px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    alignSelf: 'flex-start',
  },
  // Document viewer styles
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
  corpusMembership: {
    marginTop: '8px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
  },
  corpusMemberLabel: {
    color: '#888',
  },
  corpusLink: {
    color: '#333',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
  },
  corpusLinkCurrent: {
    color: '#333',
    fontWeight: '600',
  },
  annotationCount: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    padding: '2px 8px',
    border: '1px solid #e0e0e0',
    borderRadius: '10px',
  },
  docBodyWrapper: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
  },
  bodyContainer: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '24px 28px',
    flex: 1,
    minWidth: 0,
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
  // Annotation highlight styles
  annotationHighlight: {
    backgroundColor: 'rgba(232, 217, 160, 0.35)',
    borderBottom: '2px solid rgba(138, 112, 32, 0.4)',
    cursor: 'pointer',
    borderRadius: '1px',
    transition: 'background-color 0.15s',
  },
  annotationHighlightActive: {
    backgroundColor: 'rgba(232, 217, 160, 0.6)',
    borderBottom: '2px solid rgba(138, 112, 32, 0.7)',
  },
  // Phase 7i: Concept link underline (subtle dotted underline, distinct from annotation highlights)
  conceptLinkUnderline: {
    borderBottom: '1px dotted rgba(100, 100, 100, 0.45)',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  // Phase 7i-4: Concept link preview panel (draft editing / upload)
  conceptLinkPreview: {
    marginTop: '12px',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  conceptLinkPreviewHeader: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    padding: '6px 12px',
    backgroundColor: '#fafaf8',
    borderBottom: '1px solid #e0e0e0',
  },
  conceptLinkPreviewBody: {
    padding: '12px 14px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: '1.6',
    color: '#333',
    maxHeight: '200px',
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  // Annotation detail side panel
  annotationDetail: {
    width: '240px',
    flexShrink: 0,
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '14px 16px',
    position: 'sticky',
    top: '20px',
  },
  annotationDetailHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  annotationDetailTitle: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#999',
    padding: '0 4px',
  },
  annotationDetailBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  annotationFullPath: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    wordBreak: 'break-word',
  },
  pathSegment: {
    color: '#888',
    fontStyle: 'normal',
  },
  // Phase 13: Ancestor path segment that is also an annotation — clickable
  pathSegmentLinked: {
    color: '#7a6520',
    fontStyle: 'normal',
    textDecoration: 'underline',
    textDecorationColor: 'rgba(138, 112, 32, 0.35)',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  // Phase 13-2: Descendant path extension row
  descendantPathRow: {
    display: 'inline',
  },
  // Phase 13-2: Intermediate descendant path segment (not itself an annotation)
  pathSegmentDescendant: {
    color: '#aaa',
    fontStyle: 'normal',
    fontSize: '13px',
  },
  pathArrow: {
    color: '#ccc',
  },
  pathLeaf: {
    color: '#333',
    fontWeight: '600',
  },
  annotationAttributeBadge: {
    display: 'inline-block',
    padding: '1px 7px',
    background: '#e8f4f8',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#555',
    marginLeft: '6px',
    verticalAlign: 'middle',
  },
  annotationCreator: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
  },
  annVersionNav: {
    display: 'flex',
    gap: '6px',
    marginTop: '4px',
  },
  annVersionBtn: {
    padding: '2px 8px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#888',
  },
  navigateConceptBtn: {
    marginTop: '10px',
    padding: '6px 12px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    backgroundColor: '#fafaf8',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    alignSelf: 'flex-start',
    transition: 'border-color 0.15s',
    width: '100%',
    textAlign: 'left',
  },
  // Annotation vote styles (Phase 7f)
  annotationVoteRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '10px',
  },
  annotationVoteBtn: {
    padding: '4px 12px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    transition: 'all 0.15s',
  },
  annotationVoteBtnActive: {
    backgroundColor: '#333',
    color: 'white',
    borderColor: '#333',
  },
  annotationVoteLabel: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  annotationVoteCountReadonly: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  annotationVoteBadge: {
    display: 'inline-block',
    marginLeft: '2px',
    padding: '0 4px',
    fontSize: '10px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#8a6d00',
    backgroundColor: 'rgba(200, 170, 50, 0.2)',
    borderRadius: '6px',
    lineHeight: '16px',
    verticalAlign: 'super',
  },
  layerToggle: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  layerToggleBtn: {
    padding: '3px 10px',
    border: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    borderRight: '1px solid #eee',
  },
  layerToggleBtnActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  sortLabel: {
    padding: '3px 8px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  annotationHighlightEditorial: {
    backgroundColor: 'rgba(90, 122, 90, 0.15)',
    borderBottom: '2px solid rgba(90, 122, 90, 0.4)',
  },
  allowedBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#5a7a5a',
    padding: '2px 8px',
    border: '1px solid #b0d0b0',
    borderRadius: '10px',
    backgroundColor: '#f0f8f0',
  },
  deleteCorpusBtn: {
    padding: '4px 12px',
    border: '1px solid #e0c0c0',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
  },
  // Floating selection button (small, appears near selection)
  floatingSelBtn: {
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    zIndex: 110,
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '14px',
    padding: '2px 6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  },
  floatingSelBtnInner: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    padding: '1px 3px',
    lineHeight: 1,
  },
  floatingSelCancelBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#aaa',
    padding: '1px 2px',
    lineHeight: 1,
  },
  // Annotation panel wrapper
  annotationPanelWrapper: {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100,
    width: '480px',
    maxWidth: '90vw',
  },
  // Duplicate detection styles
  duplicatePanel: {
    backgroundColor: '#fefcf3',
    border: '1px solid #e8d9a0',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '4px',
  },
  duplicateHeader: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#8a7020',
    marginBottom: '6px',
  },
  duplicateHint: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    margin: '0 0 12px 0',
    lineHeight: '1.4',
    fontStyle: 'normal',
  },
  duplicateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
  },
  duplicateCard: {
    backgroundColor: 'white',
    border: '1px solid #e8d9a0',
    borderRadius: '4px',
    padding: '10px 14px',
  },
  duplicateTitle: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  similarityBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    padding: '1px 6px',
    border: '1px solid #e8d9a0',
    borderRadius: '8px',
    fontWeight: '400',
  },
  duplicateMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '2px',
  },
  duplicateCorpuses: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    marginTop: '4px',
    fontStyle: 'normal',
  },
  duplicateActions: {
    display: 'flex',
    gap: '8px',
  },
  proceedButton: {
    padding: '6px 14px',
    border: '1px solid #8a7020',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
  },
  cancelDuplicateButton: {
    padding: '6px 14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  // Phase 21c: Version navigator styles
  versionNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 0 6px 0',
    marginBottom: '4px',
    borderBottom: '1px solid #eee',
  },
  versionNavArrow: {
    background: 'none',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#555',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  versionNavItem: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    padding: '2px 7px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  versionNavItemCurrent: {
    color: '#1a1a2e',
    background: '#f0f0f8',
    borderColor: '#aaaacc',
    cursor: 'default',
    fontWeight: '600',
  },
  // Phase 7h: Document versioning styles
  docTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
  },
  versionBadge: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    padding: '1px 7px',
    border: '1px solid #d0d0d0',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
  },
  versionBadgeSmall: {
    fontSize: '10px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    padding: '0px 5px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
  },
  draftBadge: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a6d00',
    padding: '1px 7px',
    border: '1px solid #e8d9a0',
    borderRadius: '8px',
    backgroundColor: '#fefcf3',
    whiteSpace: 'nowrap',
  },
  draftBadgeSmall: {
    fontSize: '10px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a6d00',
    padding: '0px 5px',
    border: '1px solid #e8d9a0',
    borderRadius: '6px',
    backgroundColor: '#fefcf3',
    marginLeft: '4px',
    whiteSpace: 'nowrap',
  },
  currentBadge: {
    fontSize: '10px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    padding: '0px 5px',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    backgroundColor: '#f0f0f0',
    marginLeft: '4px',
    whiteSpace: 'nowrap',
  },
  docCardDraft: {
    borderColor: '#e8d9a0',
    backgroundColor: '#fefcf3',
  },
  versionActionRow: {
    marginTop: '10px',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  versionButton: {
    padding: '4px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
  },
  finalizeButton: {
    padding: '4px 12px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  draftEditWrapper: {
    backgroundColor: '#fefcf3',
    border: '1px solid #e8d9a0',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '16px',
  },
  draftEditHeader: {
    marginBottom: '10px',
  },
  draftEditLabel: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#8a6d00',
  },
  draftEditHint: {
    display: 'block',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    fontStyle: 'normal',
    marginTop: '4px',
    lineHeight: '1.4',
  },
  draftTextarea: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #e8d9a0',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    resize: 'vertical',
    minHeight: '200px',
    lineHeight: '1.6',
    boxSizing: 'border-box',
    backgroundColor: 'white',
  },
  draftEditActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
  },
  versionHistoryPanel: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '16px',
  },
  versionHistoryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  versionHistoryTitle: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  versionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  versionCard: {
    padding: '8px 12px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  versionCardCurrent: {
    borderColor: '#333',
    backgroundColor: '#fafaf8',
    cursor: 'default',
  },
  versionCardTitle: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
  },
  versionCardMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '2px',
  },
  // Phase 38i: Version delete button and confirmation modal
  versionDeleteBtn: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#999',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 4px',
    fontWeight: 'normal',
  },
  deleteVersionOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  deleteVersionModal: {
    backgroundColor: '#fafaf8',
    border: '1px solid #d0d0d0',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '420px',
    width: '90%',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  deleteVersionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  deleteVersionTitle: {
    fontSize: '17px',
    fontWeight: '600',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  deleteVersionClose: {
    cursor: 'pointer',
    fontSize: '16px',
    color: '#999',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  deleteVersionBody: {
    marginBottom: '20px',
  },
  deleteVersionText: {
    fontSize: '14px',
    color: '#333',
    lineHeight: '1.5',
    margin: '0 0 8px 0',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  deleteVersionNote: {
    fontSize: '13px',
    color: '#8a7a5a',
    lineHeight: '1.4',
    margin: '0 0 6px 0',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  deleteVersionActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  },
  deleteVersionCancelBtn: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    padding: '6px 16px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    background: 'transparent',
    color: '#333',
    cursor: 'pointer',
  },
  deleteVersionConfirmBtn: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    padding: '6px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    background: '#333',
    color: '#fafaf8',
    cursor: 'pointer',
  },
  // Annotation sidebar
  annotationSidebar: {
    width: '260px',
    flexShrink: 0,
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    position: 'sticky',
    top: '20px',
    maxHeight: '80vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  annotationSidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: '1px solid #f0f0f0',
    position: 'sticky',
    top: 0,
    backgroundColor: 'white',
    zIndex: 1,
  },
  annotationSidebarTitle: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sidebarAnnotateBtn: {
    background: 'none',
    border: '1px solid #ccc',
    borderRadius: '10px',
    padding: '2px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    color: '#555',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  annLoadingText: {
    fontSize: '13px',
    color: '#999',
    fontStyle: 'normal',
    padding: '12px',
  },
  annEmptyText: {
    fontSize: '13px',
    color: '#bbb',
    fontStyle: 'normal',
    padding: '12px',
  },
  annotationList: {
    display: 'flex',
    flexDirection: 'column',
  },
  annListItem: {
    padding: '10px 12px',
    borderBottom: '1px solid #f0f0f0',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  annListItemActive: {
    backgroundColor: '#fafaf5',
  },
  annItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    flexWrap: 'wrap',
    marginBottom: '3px',
  },
  annConceptName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#333',
  },
  annAttributeBadge: {
    fontSize: '10px',
    color: '#777',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1px 5px',
  },
  provenanceBadgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '2px',
    marginBottom: '2px',
  },
  provenanceBadge: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    color: '#aaa',
  },
  annVoteCount: {
    fontSize: '11px',
    color: '#999',
    marginLeft: 'auto',
  },
  annQuote: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'normal',
    lineHeight: '1.4',
    marginBottom: '3px',
    cursor: 'pointer',
    borderLeft: '2px solid #e0d8c0',
    paddingLeft: '6px',
  },
  annQuoteNotFound: {
    color: '#bbb',
    cursor: 'default',
    borderLeft: '2px solid #e0e0e0',
    textDecoration: 'line-through',
  },
  annComment: {
    fontSize: '12px',
    color: '#777',
    lineHeight: '1.4',
    marginBottom: '3px',
  },
  annDetail: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #f0f0f0',
  },
  // Occurrence picker panel (inline in annotation/concept item)
  occurrencePickerPanel: {
    marginTop: '6px',
    border: '1px solid #e0d8c0',
    borderRadius: '4px',
    backgroundColor: '#fdfcf8',
    overflow: 'hidden',
  },
  occurrencePickerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 8px',
    borderBottom: '1px solid #e0d8c0',
    fontSize: '11px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  occurrencePickerClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#aaa',
    padding: '0 2px',
  },
  occurrenceItemBtn: {
    display: 'block',
    width: '100%',
    padding: '5px 8px',
    border: 'none',
    borderBottom: '1px solid #f0ece0',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: '1.4',
    wordBreak: 'break-word',
  },
  occurrenceCtxText: {
    color: '#aaa',
  },
  occurrenceMatchBold: {
    color: '#333',
    fontWeight: '600',
  },
  // Concept detection panel
  conceptPanelSection: {
    borderTop: '1px solid #eeebe3',
    marginTop: '4px',
    paddingTop: '4px',
  },
  conceptPanelHeader: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '6px 12px 4px',
  },
  conceptPanelList: {
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: '8px',
  },
  conceptPanelItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 12px',
    gap: '6px',
  },
  conceptPanelName: {
    fontSize: '12px',
    color: '#4a6fa8',
    cursor: 'pointer',
    flex: 1,
    lineHeight: '1.4',
  },
  conceptNavBtn: {
    background: 'none',
    border: '1px solid #d0d8e8',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#888',
    padding: '1px 5px',
    flexShrink: 0,
    lineHeight: '1.4',
  },
  conceptNavControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
  },
  conceptNavStepBtn: {
    background: 'none',
    border: '1px solid #d0d8e8',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#888',
    padding: '0 4px',
    lineHeight: '1.4',
  },
  conceptNavCount: {
    fontSize: '11px',
    color: '#888',
    padding: '0 2px',
    fontVariantNumeric: 'tabular-nums',
  },
  conceptNotFound: {
    fontSize: '11px',
    color: '#bbb',
    fontStyle: 'normal',
  },
  // Phase 26a: Co-author styles
  authorCountClickable: {
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textUnderlineOffset: '2px',
  },
  authorPanel: {
    backgroundColor: '#faf9f7',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '14px 18px',
    marginTop: '10px',
  },
  authorPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  authorPanelTitle: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  authorPanelClose: {
    cursor: 'pointer',
    fontSize: '18px',
    color: '#999',
    lineHeight: 1,
  },
  authorList: {
    marginBottom: '12px',
  },
  authorRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  authorName: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  uploaderLabel: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'normal',
  },
  authorRemoveBtn: {
    padding: '2px 8px',
    border: '1px solid #ddd',
    borderRadius: '3px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  coauthorWarning: {
    padding: '8px 10px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    backgroundColor: '#f5f4f0',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    marginBottom: '8px',
  },
  authorActions: {
    borderTop: '1px solid #e0e0e0',
    paddingTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  authorActionBtn: {
    padding: '5px 14px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    alignSelf: 'flex-start',
  },
  inviteLinkRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  inviteLinkInput: {
    flex: 1,
    padding: '4px 8px',
    border: '1px solid #ddd',
    borderRadius: '3px',
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#555',
    backgroundColor: 'white',
  },
  copyBtn: {
    padding: '4px 10px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  leaveBtn: {
    padding: '5px 14px',
    border: '1px solid #c44',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    alignSelf: 'flex-start',
  },
  // Phase 31c: Messaging button styles
  msgButtonRow: {
    display: 'flex',
    gap: '6px',
    marginTop: '8px',
  },
  msgActionBtn: {
    padding: '5px 10px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    backgroundColor: '#fafaf8',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  msgComposeBox: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  msgComposeLabel: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#888',
  },
  msgComposeInput: {
    padding: '6px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#333',
    resize: 'none',
    outline: 'none',
    backgroundColor: '#faf9f7',
  },
  msgComposeActions: {
    display: 'flex',
    gap: '6px',
  },
  msgSendBtn: {
    padding: '4px 12px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#333',
  },
  msgSendBtnDisabled: {
    borderColor: '#ccc',
    color: '#ccc',
    cursor: 'default',
  },
  msgCancelBtn: {
    padding: '4px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#888',
  },
  // Phase 38j: Citation styles
  citeBtn: {
    padding: '2px 8px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  citedSection: {
    marginTop: '16px',
    borderTop: '1px solid #ddd',
    paddingTop: '10px',
  },
  citedSectionHeader: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#555',
    marginBottom: '8px',
  },
  citedCard: {
    padding: '8px 12px',
    marginBottom: '6px',
    border: '1px solid #eee',
    borderRadius: '4px',
    backgroundColor: '#faf9f7',
  },
  citedCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  citedConceptName: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  citedQuote: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#555',
    marginTop: '4px',
  },
  citedSource: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#888',
    marginTop: '4px',
  },
  citedNavigateBtn: {
    padding: '2px 8px',
    border: '1px solid #ccc',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#555',
    marginTop: '6px',
  },
  citedUnavailable: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '12px',
    color: '#aaa',
    marginTop: '4px',
    display: 'inline-block',
  },
  citationBodyLink: {
    color: '#555',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

export default CorpusTabContent;
