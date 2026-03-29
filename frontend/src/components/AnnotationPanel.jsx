import React, { useState, useEffect, useRef } from 'react';
import { conceptsAPI, corpusAPI } from '../services/api';

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
 * AnnotationPanel — single-view annotation creation form.
 *
 * All fields (quote, comment, concept, context) are visible on one panel.
 * "Create Annotation" button is grayed out until a concept+context is selected.
 */
const AnnotationPanel = ({ corpusId, documentId, documentBody, initialQuoteText, onAnnotationCreated, onClose }) => {
  const [quoteText, setQuoteText] = useState(initialQuoteText || '');
  const [comment, setComment] = useState('');
  const [quoteOccurrenceItems, setQuoteOccurrenceItems] = useState([]);
  const [selectedQuoteOccurrence, setSelectedQuoteOccurrence] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [parentContexts, setParentContexts] = useState([]);
  const [loadingContexts, setLoadingContexts] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const searchInputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (searchInputRef.current) searchInputRef.current.focus();
  }, []);

  // Check how many times the quoted text appears in the document body
  useEffect(() => {
    const trimmed = quoteText.trim();
    if (!trimmed || !documentBody) {
      setQuoteOccurrenceItems([]);
      setSelectedQuoteOccurrence(null);
      return;
    }
    const items = buildOccurrenceItems(trimmed, documentBody);
    setQuoteOccurrenceItems(items);
    setSelectedQuoteOccurrence(items.length === 1 ? 1 : null);
  }, [quoteText, documentBody]);

  // Debounced concept search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await conceptsAPI.searchConcepts(query.trim());
        setSearchResults(res.data.results || []);
      } catch (err) {
        console.error('Annotation search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // When concept selected, load parent contexts
  const handleSelectConcept = async (concept) => {
    try {
      setSelectedConcept(concept);
      setSelectedEdge(null);
      setLoadingContexts(true);
      setQuery('');
      setSearchResults([]);
      setError(null);

      const res = await conceptsAPI.getConceptParents(concept.id);
      const parents = res.data.parents || [];

      let rootEdge = null;
      try {
        const rootRes = await conceptsAPI.getRootConcepts();
        const rootConcepts = rootRes.data.concepts || rootRes.data || [];
        const rootMatch = rootConcepts.find(rc => rc.id === concept.id || rc.concept_id === concept.id);
        if (rootMatch) {
          const rootEdgeId = rootMatch.edge_id || rootMatch.edgeId;
          const rootAttrName = rootMatch.attribute_name || rootMatch.attributeName;
          const rootVoteCount = rootMatch.vote_count || rootMatch.voteCount || 0;
          if (rootEdgeId) {
            rootEdge = {
              edge_id: rootEdgeId,
              name: null,
              graph_path: [],
              attribute_name: rootAttrName,
              vote_count: rootVoteCount,
              isRoot: true,
            };
          }
        }
      } catch (err) {
        console.warn('Root edge check failed:', err);
      }

      const allContexts = rootEdge ? [rootEdge, ...parents] : parents;

      const allPathIds = new Set();
      for (const ctx of allContexts) {
        for (const pid of (ctx.graph_path || [])) allPathIds.add(pid);
        if (ctx.id) allPathIds.add(ctx.id);
      }

      let nameMap = {};
      if (allPathIds.size > 0) {
        try {
          const namesRes = await conceptsAPI.getConceptNames(Array.from(allPathIds).join(','));
          for (const c of (namesRes.data.concepts || [])) nameMap[c.id] = c.name;
        } catch (err) {
          console.warn('Failed to resolve path names:', err);
        }
      }

      const enriched = allContexts.map(ctx => {
        const gp = ctx.graph_path || [];
        const ancestorNames = gp.map(pid => nameMap[pid] || `#${pid}`);
        const parentName = ctx.name || (ctx.id ? (nameMap[ctx.id] || `#${ctx.id}`) : null);
        return { ...ctx, resolvedPathNames: [...ancestorNames], parentDisplayName: parentName };
      });

      setParentContexts(enriched);

      // Auto-select if only one context
      if (enriched.length === 1) {
        setSelectedEdge(enriched[0]);
      }
    } catch (err) {
      console.error('Failed to load concept contexts:', err);
      setError('Failed to load concept contexts');
    } finally {
      setLoadingContexts(false);
    }
  };

  const handleClearConcept = () => {
    setSelectedConcept(null);
    setSelectedEdge(null);
    setParentContexts([]);
    setError(null);
  };

  const handleConfirmCreate = async () => {
    if (!selectedEdge) return;
    try {
      setCreating(true);
      setError(null);
      const trimmedQuote = quoteText.trim();
      if (trimmedQuote && quoteOccurrenceItems.length > 1 && !selectedQuoteOccurrence) {
        setError('This text appears multiple times — please select which occurrence to link to.');
        setCreating(false);
        return;
      }
      const occurrence = trimmedQuote
        ? (quoteOccurrenceItems.length >= 1 ? selectedQuoteOccurrence || 1 : null)
        : null;
      await corpusAPI.createAnnotation(
        corpusId,
        documentId,
        selectedEdge.edge_id,
        trimmedQuote || null,
        comment.trim() || null,
        occurrence
      );
      onAnnotationCreated();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to create annotation';
      setError(msg);
      setCreating(false);
    }
  };

  const canCreate = !!selectedEdge && !creating;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Annotate</span>
        <button onClick={onClose} style={styles.closeBtn}>✕</button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.formSection}>
        {/* Quote field */}
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>
            Quote <span style={styles.fieldOptional}>(optional)</span>
          </label>
          <textarea
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            placeholder="Paste or type a passage from the document…"
            style={styles.textarea}
            rows={3}
          />
          {quoteText.trim() && documentBody && (() => {
            if (quoteOccurrenceItems.length === 0) {
              return (
                <div style={styles.quoteNote}>
                  Text not found in document — will be saved as context only.
                </div>
              );
            }
            if (quoteOccurrenceItems.length > 1) {
              return (
                <div style={styles.occurrenceSection}>
                  <div style={styles.occurrenceWarning}>
                    This text appears {quoteOccurrenceItems.length} times — select which occurrence:
                  </div>
                  <div style={styles.occurrenceList}>
                    {quoteOccurrenceItems.map(item => (
                      <button
                        key={item.idx}
                        type="button"
                        style={{
                          ...styles.occurrenceItem,
                          ...(selectedQuoteOccurrence === item.idx ? styles.occurrenceItemSelected : {}),
                        }}
                        onClick={() => setSelectedQuoteOccurrence(item.idx)}
                      >
                        <span style={styles.occurrenceCtxText}>{item.before}</span>
                        <strong style={styles.occurrenceMatchText}>{item.match}</strong>
                        <span style={styles.occurrenceCtxText}>{item.after}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          })()}
        </div>

        {/* Comment field */}
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>
            Comment <span style={styles.fieldOptional}>(optional)</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note about this annotation…"
            style={styles.textarea}
            rows={2}
          />
        </div>

        {/* Concept field */}
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Concept</label>
          {selectedConcept ? (
            <div style={styles.selectedConceptRow}>
              <span style={styles.selectedConceptName}>{selectedConcept.name}</span>
              <button onClick={handleClearConcept} style={styles.changBtn}>change</button>
            </div>
          ) : (
            <>
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search concepts…"
                style={styles.searchInput}
                maxLength={255}
              />
              {searching && <div style={styles.hint}>Searching…</div>}
              {!searching && searchResults.length === 0 && query.trim().length > 0 && (
                <div style={styles.hint}>No concepts found for "{query.trim()}"</div>
              )}
              {searchResults.length > 0 && (
                <div style={styles.resultsList}>
                  {searchResults.map((result, i) => (
                    <div
                      key={`${result.id}-${i}`}
                      style={styles.resultItem}
                      onClick={() => handleSelectConcept(result)}
                    >
                      <span style={styles.resultName}>{result.name}</span>
                      {result.similarity_badge && (
                        <span style={styles.similarBadge}>similar</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Context picker — shown inline after concept is selected */}
        {selectedConcept && (
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Context</label>
            {loadingContexts ? (
              <div style={styles.hint}>Loading contexts…</div>
            ) : parentContexts.length === 0 ? (
              <div style={styles.hint}>
                This concept has no edges. It may need to be added to a graph first.
              </div>
            ) : (
              <div style={styles.contextList}>
                {parentContexts.map((ctx, idx) => {
                  const edgeId = ctx.edge_id;
                  const attrName = ctx.attribute_name;
                  const voteCount = parseInt(ctx.vote_count) || 0;
                  const fullChain = ctx.resolvedPathNames || [];
                  const isRoot = ctx.isRoot;
                  return (
                    <button
                      key={edgeId || idx}
                      style={{
                        ...styles.contextItem,
                        ...(selectedEdge?.edge_id === edgeId ? styles.contextItemSelected : {}),
                      }}
                      onClick={() => { setSelectedEdge(ctx); setError(null); }}
                    >
                      <div style={styles.contextPath}>
                        {fullChain.length > 0 && (
                          <span style={styles.contextAncestors}>
                            {fullChain.join(' → ')} →{' '}
                          </span>
                        )}
                        <span style={styles.contextChild}>
                          {selectedConcept.name}
                          {attrName && (
                            <span style={{ fontSize: '12px', color: '#888', marginLeft: '5px', fontWeight: '400' }}>
                              ({attrName})
                            </span>
                          )}
                        </span>
                        {isRoot && <span style={styles.rootBadge}>root</span>}
                      </div>
                      <div style={styles.contextMeta}>▲ {voteCount} votes</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Action buttons — always visible */}
        <div style={styles.actionButtons}>
          <button
            onClick={handleConfirmCreate}
            disabled={!canCreate}
            style={{
              ...styles.createButton,
              opacity: canCreate ? 1 : 0.4,
              cursor: canCreate ? 'pointer' : 'default',
            }}
          >
            {creating ? 'Creating...' : 'Create Annotation'}
          </button>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  panel: {
    backgroundColor: 'white',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    padding: '14px 16px',
    maxWidth: '480px',
    width: '100%',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  headerTitle: {
    flex: 1,
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#999',
    padding: '0 4px',
  },
  error: {
    fontSize: '13px',
    color: '#c44',
    marginBottom: '8px',
  },
  formSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  fieldLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  fieldOptional: {
    fontWeight: '400',
    color: '#999',
    textTransform: 'none',
    letterSpacing: 0,
  },
  textarea: {
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: '1.5',
    resize: 'vertical',
    outline: 'none',
    color: '#333',
  },
  searchInput: {
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  hint: {
    fontSize: '13px',
    color: '#999',
    fontStyle: 'normal',
    padding: '4px 0',
  },
  selectedConceptRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#fafaf8',
  },
  selectedConceptName: {
    flex: 1,
    fontSize: '14px',
    color: '#333',
    fontWeight: '600',
  },
  changBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#888',
    padding: '0',
    fontFamily: '"EB Garamond", Georgia, serif',
    textDecoration: 'underline',
  },
  resultsList: {
    maxHeight: '180px',
    overflowY: 'auto',
    border: '1px solid #eee',
    borderRadius: '4px',
    marginTop: '2px',
  },
  resultItem: {
    padding: '7px 10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid #f5f5f5',
  },
  resultName: {
    fontSize: '14px',
    color: '#333',
  },
  similarBadge: {
    fontSize: '10px',
    color: '#888',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1px 6px',
  },
  contextList: {
    maxHeight: '200px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  contextItem: {
    padding: '10px 12px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    backgroundColor: '#fafaf8',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: '"EB Garamond", Georgia, serif',
    transition: 'border-color 0.15s',
  },
  contextItemSelected: {
    border: '1px solid #333',
    backgroundColor: '#f0ede8',
  },
  contextPath: {
    fontSize: '13px',
    color: '#333',
    lineHeight: '1.5',
    wordBreak: 'break-word',
  },
  contextAncestors: {
    color: '#888',
    fontStyle: 'normal',
  },
  contextChild: {
    color: '#333',
    fontWeight: '600',
  },
  contextMeta: {
    fontSize: '12px',
    color: '#999',
    marginTop: '3px',
  },
  rootBadge: {
    fontSize: '10px',
    color: '#888',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1px 6px',
    marginLeft: '6px',
    fontStyle: 'normal',
    fontWeight: '400',
  },
  quoteNote: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'normal',
    marginTop: '4px',
  },
  occurrenceSection: {
    marginTop: '6px',
  },
  occurrenceWarning: {
    fontSize: '12px',
    color: '#a07020',
    marginBottom: '5px',
  },
  occurrenceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    maxHeight: '160px',
    overflowY: 'auto',
  },
  occurrenceItem: {
    padding: '5px 8px',
    border: '1px solid #e0d8c0',
    borderRadius: '4px',
    backgroundColor: '#fdfcf8',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: '1.4',
    wordBreak: 'break-word',
  },
  occurrenceItemSelected: {
    border: '1px solid #a07020',
    backgroundColor: '#fdf5e0',
  },
  occurrenceCtxText: {
    color: '#999',
  },
  occurrenceMatchText: {
    color: '#333',
    fontWeight: '600',
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginTop: '4px',
  },
  createButton: {
    padding: '8px 18px',
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #333',
    borderRadius: '3px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
  },
  cancelButton: {
    padding: '8px 14px',
    backgroundColor: 'transparent',
    color: '#666',
    border: '1px solid #ccc',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default AnnotationPanel;
