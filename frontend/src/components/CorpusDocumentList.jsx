import React, { useState } from 'react';

function CorpusDocumentList({
  documents,
  corpusId,
  currentUserId,
  isGuest,
  isOwner,
  favorites,
  allTags,
  onOpenDocument,
  onRemoveDocument,
  onDeleteDocument,
  onToggleFavorite,
  onAssignTag,
  onRemoveTag,
}) {
  const [myDocsCollapsed, setMyDocsCollapsed] = useState(false);
  const [myDocSearch, setMyDocSearch] = useState('');
  const [allDocSearch, setAllDocSearch] = useState('');
  const [tagFilter, setTagFilter] = useState(null);
  const [docTagMenuId, setDocTagMenuId] = useState(null);
  const [docTagMenuSection, setDocTagMenuSection] = useState(null); // 'my' or 'all'
  const [docTagInput, setDocTagInput] = useState('');
  const [deleteDocTarget, setDeleteDocTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const groupDocsByLineage = (docs) => {
    if (!docs || docs.length === 0) return [];
    const docById = {};
    docs.forEach(d => { docById[d.id] = d; });
    const getRootId = (doc) => {
      if (doc.root_document_id) return doc.root_document_id;
      let current = doc;
      const visited = new Set();
      while (current.source_document_id && docById[current.source_document_id] && !visited.has(current.id)) {
        visited.add(current.id);
        current = docById[current.source_document_id];
      }
      return current.id;
    };
    const groups = {};
    docs.forEach(doc => {
      const rootId = getRootId(doc);
      if (!groups[rootId]) groups[rootId] = [];
      groups[rootId].push(doc);
    });
    return Object.values(groups).map(group => {
      const latest = group.reduce((best, doc) =>
        doc.version_number > best.version_number ? doc : best, group[0]);
      return {
        ...latest,
        _chainLength: group.length,
        _chainUploaders: new Set(group.map(d => d.uploaded_by)),
      };
    });
  };

  const getTagSuggestions = (input, excludeIds) => {
    if (!input.trim()) return [];
    const lower = input.trim().toLowerCase();
    return allTags
      .filter(t => !excludeIds.includes(t.id))
      .filter(t => t.name.toLowerCase().includes(lower))
      .slice(0, 10);
  };

  const grouped = groupDocsByLineage(documents);

  // Collect all unique tags from documents for the filter bar
  const allDocTags = [];
  const seenTagIds = new Set();
  (documents || []).forEach(doc => {
    if (doc.tags) {
      doc.tags.forEach(tag => {
        if (!seenTagIds.has(tag.id)) {
          seenTagIds.add(tag.id);
          allDocTags.push(tag);
        }
      });
    }
  });

  // My docs
  const myDocs = isGuest ? [] : grouped
    .filter(doc => doc._chainUploaders.has(currentUserId))
    .filter(doc => !tagFilter || (doc.tags && doc.tags.some(t => t.id === tagFilter)));
  const filteredMyDocs = myDocSearch.trim()
    ? myDocs.filter(doc => doc.title.toLowerCase().includes(myDocSearch.trim().toLowerCase()))
    : myDocs;

  // All docs
  const allDocsGrouped = grouped
    .filter(doc => !tagFilter || (doc.tags && doc.tags.some(t => t.id === tagFilter)));
  const filteredAllDocs = allDocSearch.trim()
    ? allDocsGrouped.filter(doc => doc.title.toLowerCase().includes(allDocSearch.trim().toLowerCase()))
    : allDocsGrouped;
  // Sort favorites first
  const sortedAllDocs = [...filteredAllDocs].sort((a, b) => {
    const aFav = favorites.has(a.id) ? 1 : 0;
    const bFav = favorites.has(b.id) ? 1 : 0;
    return bFav - aFav;
  });

  const renderTagMenu = (doc, section) => {
    if (docTagMenuId !== doc.id || docTagMenuSection !== section) return null;
    const existingTagIds = (doc.tags || []).map(t => t.id);
    const suggestions = getTagSuggestions(docTagInput, existingTagIds);
    return (
      <div style={styles.docTagMenu}>
        <input
          type="text"
          placeholder="Search tags..."
          value={docTagInput}
          onChange={e => setDocTagInput(e.target.value)}
          style={styles.docTagMenuInput}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
        <div style={styles.docTagMenuSuggestions}>
          {suggestions.map(tag => (
            <div
              key={tag.id}
              style={styles.tagSuggestionItem}
              onClick={async (e) => {
                e.stopPropagation();
                await onAssignTag(doc.id, tag);
                setDocTagMenuId(null);
                setDocTagMenuSection(null);
                setDocTagInput('');
              }}
              onMouseOver={e => { e.currentTarget.style.backgroundColor = '#f5f5f5'; }}
              onMouseOut={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span>{tag.name}</span>
              <span style={{ fontSize: '11px', color: '#aaa' }}>{tag.usage_count}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDocCard = (doc, isMyDocsSection) => {
    const isFav = favorites.has(doc.id);
    const isUploader = doc.uploaded_by === currentUserId;
    const canRemoveTag = isMyDocsSection || isUploader;
    const canAddTag = isMyDocsSection || isUploader;
    const hasTags = doc.tags && doc.tags.length > 0;

    return (
      <div key={doc.id} style={styles.docCard}>
        {!isGuest && (
          <button
            style={{
              ...styles.favoriteButton,
              ...(isFav ? styles.favoriteButtonActive : {}),
            }}
            onClick={() => onToggleFavorite(doc.id)}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFav ? '\u2605' : '\u2606'}
          </button>
        )}
        <div style={styles.docClickArea} onClick={() => onOpenDocument(doc.id)}>
          <div style={styles.docTitleRow}>
            <span style={styles.docTitleText}>{doc.title}</span>
            {doc.version_number > 1 && (
              <span style={styles.versionBadgeSmall}>v{doc.version_number}</span>
            )}
          </div>
          <div style={styles.docMeta}>
            {doc.format && <span>{doc.format}</span>}
            {doc.format && <span style={styles.metaDot}>&middot;</span>}
            <span>uploaded by {doc.uploader_username}</span>
            <span style={styles.metaDot}>&middot;</span>
            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
          </div>
          {hasTags && (
            <div style={styles.docTagRow}>
              {doc.tags.map(tag => (
                <span key={tag.id} style={styles.docTagPill}>
                  {tag.name}
                  {canRemoveTag && (
                    <span
                      style={styles.docTagRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveTag(doc.id, tag.id);
                      }}
                    >
                      &#10005;
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={styles.docCardActions}>
          {canAddTag && (
            <button
              style={styles.addTagButton}
              title={hasTags ? 'Change tag' : 'Add tag'}
              onClick={(e) => {
                e.stopPropagation();
                if (docTagMenuId === doc.id && docTagMenuSection === (isMyDocsSection ? 'my' : 'all')) {
                  setDocTagMenuId(null);
                  setDocTagMenuSection(null);
                  setDocTagInput('');
                } else {
                  setDocTagMenuId(doc.id);
                  setDocTagMenuSection(isMyDocsSection ? 'my' : 'all');
                  setDocTagInput('');
                }
              }}
              onMouseOver={e => { e.currentTarget.style.opacity = 1; }}
              onMouseOut={e => { e.currentTarget.style.opacity = 0.6; }}
            >
              {hasTags ? 'Change tag' : 'Add tag'}
            </button>
          )}
          {isUploader && (
            <button
              style={styles.deleteDocButton}
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDocTarget({
                  id: doc.id,
                  title: doc.title,
                  hasVersionChain: doc._chainLength > 1,
                });
              }}
            >
              Delete
            </button>
          )}
          {isOwner && (
            <button
              style={styles.removeDocButton}
              title="Remove from corpus"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDocument(doc.id, doc.title);
              }}
            >
              &#10005;
            </button>
          )}
        </div>
        {renderTagMenu(doc, isMyDocsSection ? 'my' : 'all')}
      </div>
    );
  };

  return (
    <div>
      {/* Tag filter bar */}
      {allDocTags.length > 0 && (
        <div style={styles.tagFilterBar}>
          <span style={styles.tagFilterLabel}>Filter by tag:</span>
          {allDocTags.map(tag => (
            <span
              key={tag.id}
              style={{
                ...styles.tagFilterPill,
                ...(tagFilter === tag.id ? styles.tagFilterPillActive : {}),
              }}
              onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
            >
              {tag.name}
            </span>
          ))}
          {tagFilter && (
            <span style={styles.tagFilterClear} onClick={() => setTagFilter(null)}>
              Clear
            </span>
          )}
        </div>
      )}

      {/* My Documents section */}
      {!isGuest && (
        <div style={styles.myDocsSection}>
          <div
            style={styles.myDocsSectionHeader}
            onClick={() => setMyDocsCollapsed(!myDocsCollapsed)}
          >
            <div style={styles.myDocsSectionHeaderLeft}>
              <span>My Documents</span>
              <div style={styles.docSearchWrapper} onClick={e => e.stopPropagation()}>
                <input
                  type="text"
                  placeholder="Search..."
                  value={myDocSearch}
                  onChange={e => setMyDocSearch(e.target.value)}
                  style={styles.docSearchInput}
                />
                {myDocSearch && (
                  <button
                    style={styles.docSearchClear}
                    onClick={() => setMyDocSearch('')}
                  >
                    &#10005;
                  </button>
                )}
              </div>
            </div>
            <span style={styles.myDocsToggle}>{myDocsCollapsed ? '\u25B8' : '\u25BE'}</span>
          </div>
          {!myDocsCollapsed && (
            <div>
              {myDocs.length === 0 ? (
                <div style={styles.myDocsEmpty}>
                  You haven't uploaded any documents to this corpus.
                </div>
              ) : filteredMyDocs.length === 0 ? (
                <div style={styles.myDocsEmpty}>
                  No matching documents found.
                </div>
              ) : (
                <div style={styles.docList}>
                  {filteredMyDocs.map(doc => renderDocCard(doc, true))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* All Documents section */}
      <div style={styles.docSection}>
        <div style={styles.allDocsSectionHeader}>
          <span>All Documents</span>
          <div style={styles.docSearchWrapper}>
            <input
              type="text"
              placeholder="Search..."
              value={allDocSearch}
              onChange={e => setAllDocSearch(e.target.value)}
              style={styles.docSearchInput}
            />
            {allDocSearch && (
              <button
                style={styles.docSearchClear}
                onClick={() => setAllDocSearch('')}
              >
                &#10005;
              </button>
            )}
          </div>
        </div>
        {allDocsGrouped.length === 0 && !allDocSearch.trim() ? (
          <div style={styles.emptyState}>
            No documents in this corpus yet.
          </div>
        ) : sortedAllDocs.length === 0 ? (
          <div style={styles.emptyState}>
            No matching documents found.
          </div>
        ) : (
          <div style={styles.docList}>
            {sortedAllDocs.map(doc => renderDocCard(doc, false))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteDocTarget && (
        <div style={styles.deleteModalOverlay} onClick={() => { if (!deleting) setDeleteDocTarget(null); }}>
          <div style={styles.deleteModal} onClick={e => e.stopPropagation()}>
            <div style={styles.deleteModalHeader}>
              <span style={styles.deleteModalTitle}>Delete Document</span>
              <span
                style={styles.deleteModalClose}
                onClick={() => { if (!deleting) setDeleteDocTarget(null); }}
              >
                &#10005;
              </span>
            </div>
            <div style={styles.deleteModalBody}>
              <p style={styles.deleteModalText}>
                This will permanently delete this version of the document. All annotations, messages, and votes on this version will be lost. This cannot be undone.
              </p>
              {deleteDocTarget.hasVersionChain && (
                <p style={styles.deleteModalNote}>
                  Other versions of this document will not be affected.
                </p>
              )}
            </div>
            <div style={styles.deleteModalActions}>
              <button
                style={styles.deleteModalCancelBtn}
                onClick={() => { if (!deleting) setDeleteDocTarget(null); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                style={styles.deleteModalDeleteBtn}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDeleteDocument(deleteDocTarget.id);
                    setDeleteDocTarget(null);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  docSection: {
    marginTop: '4px',
  },
  docHeading: {
    margin: '0 0 12px 0',
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  emptyState: {
    textAlign: 'center',
    padding: '30px',
    fontSize: '14px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
  },
  myDocsSection: {
    marginBottom: '20px',
  },
  myDocsSectionHeader: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    fontSize: '15px',
    color: '#8a7a5a',
    paddingBottom: '8px',
    marginBottom: '10px',
    borderBottom: '1px solid #e8e0d0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  myDocsSectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  myDocsToggle: {
    fontSize: '12px',
    color: '#b0a090',
  },
  allDocsSectionHeader: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    fontSize: '15px',
    color: '#8a7a5a',
    paddingBottom: '8px',
    marginBottom: '10px',
    borderBottom: '1px solid #e8e0d0',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  docSearchWrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
  },
  docSearchInput: {
    padding: '3px 22px 3px 8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: "'EB Garamond', serif",
    backgroundColor: '#faf9f6',
    outline: 'none',
    width: '150px',
  },
  docSearchClear: {
    position: 'absolute',
    right: '4px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#999',
    padding: '0 2px',
    fontFamily: "'EB Garamond', serif",
    lineHeight: 1,
  },
  myDocsEmpty: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    fontSize: '13px',
    color: '#bbb',
    padding: '6px 0',
  },
  docList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  docCard: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    position: 'relative',
  },
  docClickArea: {
    cursor: 'pointer',
    flex: 1,
  },
  docTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
  },
  docTitleText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginBottom: '2px',
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
  docMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  metaDot: {
    margin: '0 6px',
  },
  favoriteButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: '#ccc',
    padding: '2px 6px',
    marginRight: '8px',
    flexShrink: 0,
    transition: 'color 0.15s',
    lineHeight: 1,
  },
  favoriteButtonActive: {
    color: '#b08030',
  },
  docCardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flexShrink: 0,
  },
  addTagButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    opacity: 0.6,
    transition: 'opacity 0.15s',
  },
  removeDocButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#ccc',
    padding: '4px 8px',
    marginLeft: '8px',
    borderRadius: '4px',
  },
  deleteDocButton: {
    background: 'none',
    border: '1px solid #ddd',
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    padding: '2px 8px',
    borderRadius: '4px',
    marginLeft: '4px',
  },
  docTagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: '4px',
  },
  docTagPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    padding: '1px 7px',
    backgroundColor: '#f0f4ff',
    color: '#4a6fa5',
    borderRadius: '10px',
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  docTagRemove: {
    cursor: 'pointer',
    fontSize: '9px',
    color: '#4a6fa5',
    opacity: 0.5,
    marginLeft: '1px',
  },
  docTagMenu: {
    position: 'absolute',
    right: '16px',
    top: '100%',
    marginTop: '2px',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '6px',
    zIndex: 20,
    width: '200px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  },
  docTagMenuInput: {
    width: '100%',
    padding: '4px 8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    boxSizing: 'border-box',
  },
  docTagMenuSuggestions: {
    marginTop: '4px',
    maxHeight: '120px',
    overflowY: 'auto',
  },
  tagSuggestionItem: {
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #f0f0f0',
  },
  tagFilterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '12px',
    padding: '8px 10px',
    backgroundColor: '#fafafa',
    borderRadius: '6px',
    border: '1px solid #eee',
  },
  tagFilterLabel: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    marginRight: '4px',
  },
  tagFilterPill: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    backgroundColor: '#e8e8e8',
    cursor: 'pointer',
    transition: 'all 0.15s',
    border: '1px solid transparent',
  },
  tagFilterPillActive: {
    backgroundColor: '#e8f0fe',
    color: '#1a56db',
    border: '1px solid #bbd0f7',
  },
  tagFilterClear: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    cursor: 'pointer',
    marginLeft: '4px',
    textDecoration: 'underline',
  },
  deleteModalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  deleteModal: {
    backgroundColor: '#faf9f6',
    borderRadius: '8px',
    width: '440px',
    maxWidth: '90vw',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    border: '1px solid #e0e0e0',
    display: 'flex',
    flexDirection: 'column',
  },
  deleteModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px 12px',
    borderBottom: '1px solid #e0e0e0',
  },
  deleteModalTitle: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '18px',
    fontWeight: 600,
    color: '#222',
  },
  deleteModalClose: {
    cursor: 'pointer',
    fontSize: '20px',
    color: '#888',
    lineHeight: 1,
  },
  deleteModalBody: {
    padding: '16px 20px',
  },
  deleteModalText: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#333',
    lineHeight: 1.5,
    margin: 0,
  },
  deleteModalNote: {
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '13px',
    color: '#666',
    lineHeight: 1.4,
    marginTop: '10px',
    marginBottom: 0,
  },
  deleteModalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 20px 16px',
    borderTop: '1px solid #e0e0e0',
  },
  deleteModalCancelBtn: {
    padding: '6px 16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#555',
  },
  deleteModalDeleteBtn: {
    padding: '6px 16px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '14px',
    color: '#333',
  },
};

export default CorpusDocumentList;
