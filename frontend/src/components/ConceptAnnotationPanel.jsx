import React, { useState, useEffect } from 'react';
import { conceptsAPI, votesAPI, corpusAPI, documentsAPI, combosAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import OrcidBadge from './OrcidBadge';

function relativeTime(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const ConceptAnnotationPanel = ({
  conceptId,
  conceptName,
  path,
  currentEdgeId,
  isGuest,
  viewMode,
  onOpenCorpusTab,
  onRequestLogin,
  onNavigateToSuperconcept,
  collapsible = false,
}) => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(collapsible);
  const [activeTab, setActiveTab] = useState('annotations');

  // Comment editing state (web links)
  const [editingLinkId, setEditingLinkId] = useState(null);
  const [editingComment, setEditingComment] = useState('');

  // Annotations state
  const [annotations, setAnnotations] = useState([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationSort, setAnnotationSort] = useState('votes');

  // Filter state
  const [myCorpusesOnly, setMyCorpusesOnly] = useState(false);
  const [userCorpuses, setUserCorpuses] = useState([]); // [{ id, name }]
  const [selectedCorpusId, setSelectedCorpusId] = useState(null); // null = all my corpuses
  const [allTags, setAllTags] = useState([]);
  const [selectedTagId, setSelectedTagId] = useState(null); // null = all tags

  // Web links state
  const [webLinks, setWebLinks] = useState([]);
  const [webLinksLoading, setWebLinksLoading] = useState(false);
  const [linkConceptNames, setLinkConceptNames] = useState({});
  const [showAddLinkForm, setShowAddLinkForm] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkComment, setNewLinkComment] = useState('');
  const [addLinkError, setAddLinkError] = useState(null);

  // Superconcepts state (Phase 47)
  const [superconcepts, setSuperconcepts] = useState([]);

  // In children view, scope annotations to the current edge only.
  const isChildrenView = viewMode === 'children';
  const edgeIdFilter = isChildrenView ? currentEdgeId : null;

  // Fetch user corpuses on mount (logged-in only)
  useEffect(() => {
    if (isGuest) return;
    corpusAPI.getMySubscriptions()
      .then(res => {
        const subs = (res.data.subscriptions || []).map(s => ({ id: s.corpus_id || s.id, name: s.corpus_name || s.name }));
        setUserCorpuses(subs);
      })
      .catch(() => setUserCorpuses([]));
  }, [isGuest]);

  // Fetch available tags on mount
  useEffect(() => {
    documentsAPI.listTags()
      .then(res => setAllTags(res.data.tags || []))
      .catch(() => setAllTags([]));
  }, []);

  // Compute corpusIds for the API call
  const getCorpusIdsFilter = () => {
    if (!myCorpusesOnly) return null;
    if (selectedCorpusId) return [selectedCorpusId];
    return userCorpuses.map(c => c.id);
  };

  // Load annotations
  useEffect(() => {
    if (!conceptId) return;
    let cancelled = false;
    setAnnotationsLoading(true);
    const corpusIds = getCorpusIdsFilter();
    conceptsAPI.getConceptAnnotations(conceptId, {
      sort: annotationSort,
      edgeId: edgeIdFilter,
      tagId: selectedTagId,
      corpusIds,
    })
      .then(res => {
        if (!cancelled) setAnnotations(res.data.annotations || []);
      })
      .catch(err => {
        console.error('Failed to load annotations:', err);
        if (!cancelled) setAnnotations([]);
      })
      .finally(() => { if (!cancelled) setAnnotationsLoading(false); });
    return () => { cancelled = true; };
  }, [conceptId, annotationSort, edgeIdFilter, selectedTagId, myCorpusesOnly, selectedCorpusId]);

  // Load web links — edge-specific in children view, cross-context in flip view
  useEffect(() => {
    if (!conceptId) return;
    let cancelled = false;
    setWebLinksLoading(true);

    if (isChildrenView && currentEdgeId) {
      // Children view: load only links for the current edge
      votesAPI.getWebLinks(currentEdgeId)
        .then(res => {
          if (cancelled) return;
          setLinkConceptNames({});
          const links = (res.data.webLinks || []).map(link => ({
            ...link,
            edgeId: currentEdgeId,
            parentId: null,
            parentName: null,
            graphPath: path || [],
            attributeName: null,
          }));
          links.sort((a, b) => b.voteCount - a.voteCount || new Date(b.createdAt) - new Date(a.createdAt));
          setWebLinks(links);
        })
        .catch(err => {
          console.error('Failed to load web links:', err);
          if (!cancelled) setWebLinks([]);
        })
        .finally(() => { if (!cancelled) setWebLinksLoading(false); });
    } else {
      // Flip view or no edge: load all links across all contexts
      const pathParam = (path || []).join(',');
      votesAPI.getAllWebLinksForConcept(conceptId, pathParam || undefined)
        .then(res => {
          if (cancelled) return;
          const flat = [];
          const groups = res.data.groups || [];
          const names = res.data.conceptNames || {};
          setLinkConceptNames(names);
          for (const group of groups) {
            for (const link of group.links) {
              flat.push({
                ...link,
                edgeId: group.edgeId,
                parentId: group.parentId,
                parentName: group.parentName,
                graphPath: group.graphPath,
                attributeName: group.attributeName,
              });
            }
          }
          flat.sort((a, b) => b.voteCount - a.voteCount || new Date(b.createdAt) - new Date(a.createdAt));
          setWebLinks(flat);
        })
        .catch(err => {
          console.error('Failed to load web links:', err);
          if (!cancelled) setWebLinks([]);
        })
        .finally(() => { if (!cancelled) setWebLinksLoading(false); });
    }
    return () => { cancelled = true; };
  }, [conceptId, currentEdgeId, isChildrenView, path?.join(',')]);

  // Load superconcepts for the current edge (children view only, Phase 47)
  useEffect(() => {
    if (!isChildrenView || !currentEdgeId) {
      setSuperconcepts([]);
      return;
    }
    let cancelled = false;
    combosAPI.getCombosByEdge(currentEdgeId)
      .then(res => {
        if (!cancelled) setSuperconcepts(res.data || []);
      })
      .catch(() => {
        if (!cancelled) setSuperconcepts([]);
      });
    return () => { cancelled = true; };
  }, [currentEdgeId, isChildrenView]);

  // Auto-fallback: if superconcepts tab is active but count drops to 0, switch back
  useEffect(() => {
    if (activeTab === 'superconcepts' && superconcepts.length === 0) {
      setActiveTab('annotations');
    }
  }, [superconcepts.length, activeTab]);

  const handleAnnotationCardClick = (a) => {
    if (isGuest) {
      if (onRequestLogin) onRequestLogin();
      return;
    }
    if (onOpenCorpusTab) {
      onOpenCorpusTab(a.corpusId, a.corpusName, a.documentId, a.annotationId);
    }
  };

  const handleToggleMyCorpuses = () => {
    setMyCorpusesOnly(prev => {
      if (prev) {
        // Turning off — clear corpus selection
        setSelectedCorpusId(null);
      }
      return !prev;
    });
  };

  const handleCorpusPillClick = (corpusId) => {
    setSelectedCorpusId(prev => prev === corpusId ? null : corpusId);
  };

  const handleTagClick = (tagId) => {
    setSelectedTagId(prev => prev === tagId ? null : tagId);
  };

  const renderContextPath = (ctx) => {
    const parts = [...(ctx.pathNames || [])];
    if (parts.length === 0 && ctx.parentName && ctx.parentName !== '(root)') {
      parts.push(ctx.parentName);
    }
    if (conceptName) {
      parts.push(conceptName);
    }
    if (parts.length === 0) return null;
    const display = parts.join(' \u2192 ');
    return (
      <div style={styles.contextLine}>
        {display}
        {ctx.attributeName && <span style={styles.attrBadge}>{ctx.attributeName}</span>}
      </div>
    );
  };

  const renderFilters = () => {
    const hasFilters = !isGuest || allTags.length > 0;
    if (!hasFilters) return null;

    return (
      <div style={styles.filterArea}>
        {/* My Corpuses toggle — logged-in only */}
        {!isGuest && userCorpuses.length > 0 && (
          <div style={styles.filterRow}>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={myCorpusesOnly}
                onChange={handleToggleMyCorpuses}
                style={styles.toggleCheckbox}
              />
              My Corpuses
            </label>
            {myCorpusesOnly && (
              <div style={styles.pillRow}>
                {userCorpuses.map(c => (
                  <span
                    key={c.id}
                    onClick={() => handleCorpusPillClick(c.id)}
                    style={{
                      ...styles.pill,
                      ...(selectedCorpusId === c.id ? styles.pillActive : {}),
                    }}
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Tag filter */}
        {allTags.length > 0 && (
          <div style={styles.pillRow}>
            <span
              onClick={() => setSelectedTagId(null)}
              style={{
                ...styles.tagPill,
                ...(!selectedTagId ? styles.tagPillActive : {}),
              }}
            >
              All
            </span>
            {allTags.map(t => (
              <span
                key={t.id}
                onClick={() => handleTagClick(t.id)}
                style={{
                  ...styles.tagPill,
                  ...(selectedTagId === t.id ? styles.tagPillActive : {}),
                }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderAnnotationsTab = () => {
    return (
      <>
        <div style={styles.sortBar}>
          <span
            onClick={() => setAnnotationSort('votes')}
            style={{ ...styles.sortOption, ...(annotationSort === 'votes' ? styles.sortOptionActive : {}) }}
          >Top</span>
          {user && (
            <>
              <span style={styles.sortSep}>{'\u00b7'}</span>
              <span
                onClick={() => setAnnotationSort('subscribed')}
                style={{ ...styles.sortOption, ...(annotationSort === 'subscribed' ? styles.sortOptionActive : {}) }}
              >Subscribed</span>
            </>
          )}
          <span style={styles.sortSep}>{'\u00b7'}</span>
          <span
            onClick={() => setAnnotationSort('newest')}
            style={{ ...styles.sortOption, ...(annotationSort === 'newest' ? styles.sortOptionActive : {}) }}
          >New</span>
        </div>

        {renderFilters()}

        {annotationsLoading ? (
          <p style={styles.placeholder}>Loading...</p>
        ) : annotations.length === 0 ? (
          <p style={styles.emptyState}>No annotations yet</p>
        ) : (
          annotations.map((a, idx) => (
            <div
              key={a.annotationId}
              style={idx > 0 ? styles.annotationCard : styles.annotationCardFirst}
              onClick={() => handleAnnotationCardClick(a)}
            >
              <div style={styles.docLine}>
                <span style={styles.docTitleLink}>
                  {a.documentTitle}
                </span>
                <span style={styles.corpusName}>({a.corpusName})</span>
                {a.tagName && <span style={styles.tagBadge}>{a.tagName}</span>}
              </div>
              {renderContextPath(a.context)}
              {a.quoteText && (
                <div style={styles.quoteBlock}>
                  &ldquo;{a.quoteText.length > 150 ? a.quoteText.slice(0, 150) + '...' : a.quoteText}&rdquo;
                </div>
              )}
              {a.comment && (
                <div style={styles.commentBlock}>{a.comment}</div>
              )}
              <div style={styles.bottomRow}>
                <span style={styles.voteCount}>
                  &uarr; {a.voteCount}
                  {a.citedByCount > 0 && (
                    <span style={styles.citedByInline}> &middot; Cited by {a.citedByCount}</span>
                  )}
                </span>
                <span style={styles.meta}>
                  {a.creatorUsername}<OrcidBadge orcidId={a.creatorOrcidId} /> &middot; {relativeTime(a.createdAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </>
    );
  };

  const handleToggleLinkVote = async (link) => {
    if (isGuest) {
      if (onRequestLogin) onRequestLogin();
      return;
    }
    const wasVoted = link.userVoted;
    const sortLinks = (arr) => [...arr].sort((a, b) => b.voteCount - a.voteCount || new Date(b.createdAt) - new Date(a.createdAt));
    // Optimistic update
    setWebLinks(links => sortLinks(links.map(l =>
      l.id === link.id
        ? { ...l, userVoted: !wasVoted, voteCount: wasVoted ? l.voteCount - 1 : l.voteCount + 1 }
        : l
    )));
    try {
      if (wasVoted) {
        await votesAPI.removeWebLinkVote(link.id);
      } else {
        await votesAPI.upvoteWebLink(link.id);
      }
    } catch (err) {
      console.error('Failed to toggle link vote:', err);
      // Revert
      setWebLinks(links => sortLinks(links.map(l =>
        l.id === link.id
          ? { ...l, userVoted: wasVoted, voteCount: wasVoted ? l.voteCount + 1 : l.voteCount - 1 }
          : l
      )));
    }
  };

  const handleStartEditComment = (link) => {
    setEditingLinkId(link.id);
    setEditingComment(link.comment || '');
  };

  const handleCancelEditComment = () => {
    setEditingLinkId(null);
    setEditingComment('');
  };

  const handleSaveComment = async (linkId) => {
    const prev = webLinks.find(l => l.id === linkId);
    // Optimistic update
    setWebLinks(links => links.map(l =>
      l.id === linkId
        ? { ...l, comment: editingComment.trim() || null, updatedAt: new Date().toISOString() }
        : l
    ));
    setEditingLinkId(null);
    setEditingComment('');
    try {
      await votesAPI.updateLinkComment(linkId, editingComment.trim() || null);
    } catch (err) {
      console.error('Failed to update comment:', err);
      // Revert on error
      if (prev) {
        setWebLinks(links => links.map(l =>
          l.id === linkId ? { ...l, comment: prev.comment, updatedAt: prev.updatedAt } : l
        ));
      }
    }
  };

  const handleRemoveLink = async (linkId) => {
    setWebLinks(links => links.filter(l => l.id !== linkId));
    try {
      await votesAPI.removeWebLink(linkId);
    } catch (err) {
      console.error('Failed to remove web link:', err);
      // Reload links on error to restore state
      setWebLinksLoading(true);
      if (isChildrenView && currentEdgeId) {
        votesAPI.getWebLinks(currentEdgeId).then(res => {
          setWebLinks((res.data.webLinks || []).map(link => ({
            ...link, edgeId: currentEdgeId, parentId: null, parentName: null,
            graphPath: path || [], attributeName: null,
          })));
        }).catch(() => {}).finally(() => setWebLinksLoading(false));
      } else {
        const pathParam = (path || []).join(',');
        votesAPI.getAllWebLinksForConcept(conceptId, pathParam || undefined).then(res => {
          const flat = [];
          for (const group of (res.data.groups || [])) {
            for (const link of group.links) {
              flat.push({ ...link, edgeId: group.edgeId, parentId: group.parentId, parentName: group.parentName, graphPath: group.graphPath, attributeName: group.attributeName });
            }
          }
          setWebLinks(flat);
        }).catch(() => {}).finally(() => setWebLinksLoading(false));
      }
    }
  };

  const wasEdited = (link) => {
    if (!link.updatedAt || !link.createdAt) return false;
    const created = new Date(link.createdAt).getTime();
    const updated = new Date(link.updatedAt).getTime();
    // Allow 2 seconds tolerance for DB default
    return Math.abs(updated - created) > 2000;
  };

  const handleAddLink = async () => {
    const trimmed = newLinkUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setAddLinkError('URL must start with http:// or https://');
      return;
    }
    setAddLinkError(null);
    try {
      const res = await votesAPI.addWebLink(currentEdgeId, trimmed, newLinkTitle.trim() || undefined, newLinkComment.trim() || undefined);
      const newLink = res.data.webLink;
      setWebLinks(prev => [{
        ...newLink,
        edgeId: newLink.edgeId,
        parentId: null,
        parentName: null,
        graphPath: path || [],
        attributeName: null,
        addedByUsername: user?.username,
      }, ...prev]);
      setNewLinkUrl('');
      setNewLinkTitle('');
      setNewLinkComment('');
      setShowAddLinkForm(false);
    } catch (err) {
      setAddLinkError(err.response?.data?.error || 'Failed to add link');
    }
  };

  const renderAddLinkForm = () => {
    if (!showAddLinkForm) return null;
    return (
      <div style={styles.addLinkForm}>
        <input
          type="text"
          value={newLinkUrl}
          onChange={e => { setNewLinkUrl(e.target.value); setAddLinkError(null); }}
          placeholder="https://..."
          style={styles.addLinkInput}
          autoFocus
        />
        <input
          type="text"
          value={newLinkTitle}
          onChange={e => setNewLinkTitle(e.target.value)}
          placeholder="Title (optional)"
          style={styles.addLinkInput}
        />
        <textarea
          value={newLinkComment}
          onChange={e => setNewLinkComment(e.target.value)}
          placeholder="Comment (optional)"
          style={styles.commentTextarea}
          rows={2}
        />
        {addLinkError && <div style={styles.addLinkError}>{addLinkError}</div>}
        <div style={styles.commentEditButtons}>
          <span onClick={handleAddLink} style={styles.commentSaveBtn}>Add</span>
          <span onClick={() => { setShowAddLinkForm(false); setAddLinkError(null); setNewLinkUrl(''); setNewLinkTitle(''); setNewLinkComment(''); }} style={styles.commentCancelBtn}>Cancel</span>
        </div>
      </div>
    );
  };

  const renderWebLinksTab = () => {
    const addButton = !isGuest && currentEdgeId && !showAddLinkForm ? (
      <div style={styles.addLinkRow}>
        <span
          onClick={() => setShowAddLinkForm(true)}
          style={styles.addLinkBtn}
        >+ Add Web Link</span>
      </div>
    ) : null;

    if (webLinksLoading) {
      return <>{addButton}{renderAddLinkForm()}<p style={styles.placeholder}>Loading...</p></>;
    }
    if (webLinks.length === 0) {
      return <>{addButton}{renderAddLinkForm()}<p style={styles.emptyState}>No web links yet</p></>;
    }

    return <>{addButton}{renderAddLinkForm()}{webLinks.map((link, idx) => {
      const pathNames = (link.graphPath || []).map(id => linkConceptNames[id] || `#${id}`);
      if (conceptName) pathNames.push(conceptName);
      const contextDisplay = pathNames.length > 0
        ? pathNames.join(' \u2192 ')
        : null;
      const isCreator = user && link.addedBy === user.id;
      const isEditing = editingLinkId === link.id;

      return (
        <div key={link.id} style={idx > 0 ? styles.annotationCard : styles.annotationCardFirst}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.linkTitle}
          >
            {link.title || link.url}
          </a>
          {link.title && (
            <div style={styles.linkUrl}>{link.url}</div>
          )}
          {contextDisplay && (
            <div style={styles.contextLine}>
              via {contextDisplay}
            </div>
          )}
          {/* Comment display */}
          {link.comment && !isEditing && (
            <div style={styles.linkCommentBlock}>
              <span style={styles.linkCommentText}>{link.comment}</span>
              <span style={styles.linkCommentMeta}>
                {link.addedByUsername}
                {wasEdited(link) && <span style={styles.editedTag}>(edited)</span>}
              </span>
            </div>
          )}
          {/* Inline edit form */}
          {isEditing && (
            <div style={styles.commentEditArea}>
              <textarea
                value={editingComment}
                onChange={e => setEditingComment(e.target.value)}
                style={styles.commentTextarea}
                rows={2}
                placeholder="Add a comment..."
                autoFocus
              />
              <div style={styles.commentEditButtons}>
                <span
                  onClick={() => handleSaveComment(link.id)}
                  style={styles.commentSaveBtn}
                >Save</span>
                <span
                  onClick={handleCancelEditComment}
                  style={styles.commentCancelBtn}
                >Cancel</span>
              </div>
            </div>
          )}
          <div style={styles.bottomRow}>
            <span
              onClick={(e) => { e.stopPropagation(); handleToggleLinkVote(link); }}
              style={{
                ...styles.voteCount,
                cursor: 'pointer',
                color: link.userVoted ? '#333' : '#888',
                fontWeight: link.userVoted ? '600' : 'normal',
              }}
              title={link.userVoted ? 'Remove vote' : 'Upvote'}
            >&uarr; {link.voteCount}</span>
            <span style={styles.meta}>
              {link.addedByUsername}
              {isCreator && !isEditing && (
                <span
                  onClick={(e) => { e.stopPropagation(); handleStartEditComment(link); }}
                  style={styles.editCommentBtn}
                >
                  {link.comment ? 'Edit' : 'Add comment'}
                </span>
              )}
              {isCreator && !isEditing && (
                <span
                  onClick={(e) => { e.stopPropagation(); handleRemoveLink(link.id); }}
                  style={{ ...styles.editCommentBtn, color: '#999' }}
                >
                  Remove
                </span>
              )}
            </span>
          </div>
        </div>
      );
    })}</>;
  };

  const renderSuperconceptsTab = () => {
    if (superconcepts.length === 0) {
      return <div style={{ color: '#999', fontSize: '14px', padding: '8px 0' }}>No superconcepts contain this edge.</div>;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {superconcepts.map(sc => {
          const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
          return (
            <div key={sc.id} style={styles.superconceptCard}>
              <span
                onClick={() => onNavigateToSuperconcept && onNavigateToSuperconcept(sc.id, sc.name)}
                style={styles.superconceptName}
              >
                {sc.name}
              </span>
              <div style={styles.superconceptOwner}>
                by {sc.created_by_username || '[deleted user]'}
                {sc.created_by_orcid_id && <OrcidBadge orcidId={sc.created_by_orcid_id} />}
              </div>
              {sc.description && (
                <div style={styles.superconceptDescription}>
                  {sc.description}
                </div>
              )}
              <div style={styles.superconceptStats}>
                {plural(sc.edge_count, 'edge')} {'\u00b7'} {plural(sc.annotation_count, 'annotation')} {'\u00b7'} {plural(sc.subscriber_count, 'subscriber')}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {collapsible && (
        <div
          style={styles.collapseHeader}
          onClick={() => setCollapsed(prev => !prev)}
        >
          <span>Annotations & Links {collapsed ? '\u25b8' : '\u25be'}</span>
        </div>
      )}
      {(!collapsible || !collapsed) && (
        <>
          <div style={styles.tabBar}>
            <span
              onClick={() => setActiveTab('annotations')}
              style={{
                ...styles.tab,
                ...(activeTab === 'annotations' ? styles.tabActive : {}),
              }}
            >
              Annotations
            </span>
            <span style={styles.tabSeparator}>|</span>
            <span
              onClick={() => setActiveTab('weblinks')}
              style={{
                ...styles.tab,
                ...(activeTab === 'weblinks' ? styles.tabActive : {}),
              }}
            >
              Web Links
            </span>
            {superconcepts.length > 0 && (
              <>
                <span style={styles.tabSeparator}>|</span>
                <span
                  onClick={() => setActiveTab('superconcepts')}
                  style={{
                    ...styles.tab,
                    ...(activeTab === 'superconcepts' ? styles.tabActive : {}),
                  }}
                >
                  Superconcepts ({superconcepts.length})
                </span>
              </>
            )}
          </div>
          <div style={styles.content}>
            {activeTab === 'annotations' && renderAnnotationsTab()}
            {activeTab === 'weblinks' && renderWebLinksTab()}
            {activeTab === 'superconcepts' && renderSuperconceptsTab()}
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  container: {
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#faf9f6',
    minHeight: '100%',
    padding: '0 14px',
  },
  collapseHeader: {
    padding: '10px 0',
    fontSize: '15px',
    color: '#555',
    cursor: 'pointer',
    userSelect: 'none',
    borderBottom: '1px solid #e0d9cf',
    marginBottom: '8px',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 0 8px 0',
    borderBottom: '1px solid #e0d9cf',
    marginBottom: '16px',
  },
  tab: {
    fontSize: '15px',
    color: '#888',
    cursor: 'pointer',
    paddingBottom: '4px',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s',
  },
  tabActive: {
    color: '#333',
    borderBottomColor: '#333',
  },
  tabSeparator: {
    color: '#ccc',
    fontSize: '14px',
  },
  content: {
    padding: '8px 0',
  },
  sortBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    fontSize: '13px',
  },
  sortOption: {
    color: '#999',
    cursor: 'pointer',
    paddingBottom: '2px',
    borderBottom: '1px solid transparent',
  },
  sortOptionActive: {
    color: '#333',
    borderBottomColor: '#333',
  },
  sortSep: {
    color: '#ccc',
  },
  // Filter area
  filterArea: {
    marginBottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  filterRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  toggleLabel: {
    fontSize: '13px',
    color: '#555',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  toggleCheckbox: {
    margin: 0,
    cursor: 'pointer',
  },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  pill: {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: '12px',
    color: '#555',
    backgroundColor: '#f5f0ea',
    border: '1px solid #e0d9cf',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  pillActive: {
    backgroundColor: '#e0d9cf',
    color: '#333',
    borderColor: '#c8bfb0',
  },
  tagPill: {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: '12px',
    color: '#777',
    backgroundColor: '#f0f5f0',
    border: '1px solid #d5e0d5',
    borderRadius: '10px',
    cursor: 'pointer',
    fontStyle: 'normal',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  tagPillActive: {
    backgroundColor: '#d5e0d5',
    color: '#333',
    borderColor: '#b5c8b5',
  },
  tagBadge: {
    display: 'inline-block',
    padding: '1px 6px',
    fontSize: '11px',
    color: '#777',
    backgroundColor: '#f0f5f0',
    border: '1px solid #d5e0d5',
    borderRadius: '3px',
    fontStyle: 'normal',
  },
  placeholder: {
    fontSize: '14px',
    color: '#999',
    fontStyle: 'normal',
    margin: 0,
  },
  emptyState: {
    fontSize: '14px',
    color: '#999',
    fontStyle: 'normal',
    textAlign: 'center',
    padding: '24px 0',
    margin: 0,
  },
  annotationCardFirst: {
    paddingBottom: '12px',
    cursor: 'pointer',
    borderRadius: '3px',
    transition: 'background-color 0.1s',
  },
  annotationCard: {
    paddingTop: '12px',
    paddingBottom: '12px',
    borderTop: '1px solid #ece6db',
    cursor: 'pointer',
    borderRadius: '3px',
    transition: 'background-color 0.1s',
  },
  docLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    marginBottom: '4px',
    flexWrap: 'wrap',
  },
  docTitleLink: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#333',
    textDecoration: 'underline',
  },
  corpusName: {
    fontSize: '13px',
    color: '#999',
  },
  contextLine: {
    fontSize: '12px',
    color: '#aaa',
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  attrBadge: {
    display: 'inline-block',
    padding: '1px 6px',
    background: '#f0ede8',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#666',
  },
  quoteBlock: {
    fontSize: '13px',
    fontStyle: 'normal',
    color: '#666',
    marginBottom: '4px',
    lineHeight: 1.4,
  },
  commentBlock: {
    fontSize: '13px',
    color: '#444',
    marginBottom: '4px',
    lineHeight: 1.4,
  },
  bottomRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '6px',
  },
  voteCount: {
    fontSize: '12px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  citedByInline: {
    fontSize: '12px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  meta: {
    fontSize: '12px',
    color: '#aaa',
  },
  linkTitle: {
    fontSize: '14px',
    color: '#333',
    textDecoration: 'underline',
    fontWeight: '500',
    display: 'block',
    marginBottom: '2px',
    wordBreak: 'break-word',
  },
  linkUrl: {
    fontSize: '12px',
    color: '#aaa',
    marginBottom: '4px',
    wordBreak: 'break-all',
  },
  linkCommentBlock: {
    fontSize: '12px',
    color: '#555',
    marginTop: '4px',
    marginBottom: '2px',
    lineHeight: 1.4,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  linkCommentText: {
    display: 'block',
    marginBottom: '2px',
  },
  linkCommentMeta: {
    fontSize: '11px',
    color: '#aaa',
  },
  editedTag: {
    marginLeft: '4px',
    fontSize: '11px',
    color: '#bbb',
  },
  editCommentBtn: {
    marginLeft: '8px',
    fontSize: '12px',
    color: '#999',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  commentEditArea: {
    marginTop: '6px',
    marginBottom: '4px',
  },
  commentTextarea: {
    width: '100%',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#333',
    backgroundColor: '#faf9f6',
    border: '1px solid #e0d9cf',
    borderRadius: '3px',
    padding: '6px 8px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
  },
  commentEditButtons: {
    display: 'flex',
    gap: '10px',
    marginTop: '4px',
  },
  commentSaveBtn: {
    fontSize: '12px',
    color: '#333',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #e0d9cf',
    padding: '2px 10px',
    borderRadius: '3px',
    backgroundColor: '#faf9f6',
  },
  commentCancelBtn: {
    fontSize: '12px',
    color: '#999',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  addLinkRow: {
    marginBottom: '10px',
  },
  addLinkBtn: {
    fontSize: '13px',
    color: '#999',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    textDecoration: 'underline',
  },
  addLinkForm: {
    marginBottom: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  addLinkInput: {
    width: '100%',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#333',
    backgroundColor: '#faf9f6',
    border: '1px solid #e0d9cf',
    borderRadius: '3px',
    padding: '6px 8px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  addLinkError: {
    fontSize: '12px',
    color: '#c44',
  },
  // Superconcepts tab styles (Phase 47)
  superconceptCard: {
    padding: '10px 12px',
    border: '1px solid #e0d9cf',
    borderRadius: '4px',
    backgroundColor: '#faf9f6',
  },
  superconceptName: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    textAlign: 'left',
    display: 'block',
    fontWeight: 'normal',
  },
  superconceptOwner: {
    fontSize: '13px',
    color: '#888',
    marginTop: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  superconceptDescription: {
    fontSize: '13px',
    color: '#666',
    marginTop: '4px',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  superconceptStats: {
    fontSize: '12px',
    color: '#999',
    marginTop: '4px',
  },
};

export default ConceptAnnotationPanel;
