import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { conceptsAPI } from '../services/api';

const SearchField = ({ parentId, path, viewMode, onConceptAdded, isRootPage, graphTabId, onNavigate, isGuest = false }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [exactMatch, setExactMatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addingName, setAddingName] = useState(null);

  // Attribute picker state
  const [attributes, setAttributes] = useState([]);
  const [showAttributePicker, setShowAttributePicker] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { type: 'child' | 'root', name: string }
  const [exactMatchRootAttributes, setExactMatchRootAttributes] = useState([]);

  const navigate = useNavigate();
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const debounceTimer = useRef(null);

  // Load available attributes on mount
  useEffect(() => {
    conceptsAPI.getAttributes()
      .then(response => {
        setAttributes(response.data.attributes);
      })
      .catch(err => {
        console.error('Failed to load attributes:', err);
      });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
        setShowAttributePicker(false);
        setPendingAction(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  const doSearch = useCallback(async (searchTerm) => {
    if (!searchTerm || searchTerm.trim().length === 0) {
      setResults([]);
      setExactMatch(false);
      setShowDropdown(false);
      return;
    }

    try {
      setLoading(true);
      const response = await conceptsAPI.searchConcepts(
        searchTerm,
        parentId || undefined,
        parentId ? (path || '') : undefined
      );
      setResults(response.data.results);
      setExactMatch(response.data.exactMatch);
      setExactMatchRootAttributes(response.data.exactMatchRootAttributes || []);
      setShowDropdown(true);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [parentId, path]);

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);

    // Reset attribute picker when typing
    setShowAttributePicker(false);
    setPendingAction(null);

    // Debounce search by 300ms
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  };

  const handleResultClick = (concept) => {
    if (graphTabId && onNavigate) {
      // Tab mode: navigate current tab to decontextualized flip view
      onNavigate(graphTabId, {
        tabType: 'concept',
        conceptId: concept.id,
        path: [],
        viewMode: 'flip',
        label: concept.name,
      });
    } else {
      // Standalone mode: URL navigation
      navigate(`/concept/${concept.id}?view=flip`);
    }
    setQuery('');
    setShowDropdown(false);
    setShowAttributePicker(false);
    setPendingAction(null);
  };

  // Step 1a: Add as child — no attribute picker needed; backend derives attribute from graph root
  const handleAddAsChildClick = async (name) => {
    if (!parentId) return;
    try {
      setAddingName(name);
      const pathString = path || '';
      await conceptsAPI.createChildConcept(name, parentId, pathString);
      setQuery('');
      setShowDropdown(false);
      setShowAttributePicker(false);
      setPendingAction(null);
      if (onConceptAdded) onConceptAdded();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create concept');
    } finally {
      setAddingName(null);
    }
  };

  // Step 1b: Create as root -> show attribute picker, or auto-assign if only one available attribute
  const handleCreateRootClick = (name) => {
    // Filter out attributes that already have root edges for this concept
    const availableAttrs = attributes.filter(a => !exactMatchRootAttributes.includes(a.name));
    if (availableAttrs.length === 1) {
      // Single available attribute: skip picker, auto-assign
      handleAttributeSelect(availableAttrs[0].id, { type: 'root', name });
      return;
    }
    setPendingAction({ type: 'root', name });
    setShowAttributePicker(true);
  };

  // Step 2: user picks an attribute -> create root concept (child creation skips this step)
  const handleAttributeSelect = async (attributeId, actionOverride) => {
    const action = actionOverride || pendingAction;
    if (!action) return;

    const { type, name } = action;
    if (type !== 'root') return;

    try {
      setAddingName(name);
      await conceptsAPI.createRootConcept(name, attributeId);

      setQuery('');
      setShowDropdown(false);
      setShowAttributePicker(false);
      setPendingAction(null);
      if (onConceptAdded) onConceptAdded();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create concept');
    } finally {
      setAddingName(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setShowAttributePicker(false);
      setPendingAction(null);
      inputRef.current?.blur();
    }
  };

  const trimmedQuery = query.trim();

  // "Add as child" logic: on a concept page, in children view, and typed text isn't already a child
  // Guests cannot add concepts
  const canAddChild = !isGuest && parentId && viewMode === 'children';
  const queryIsChild = results.some(
    r => r.name.toLowerCase() === trimmedQuery.toLowerCase() && r.isChild
  );
  const showAddChildOption = canAddChild && trimmedQuery.length > 0 && !queryIsChild;

  // "Create as root" logic: on root page. Allow if concept doesn't exist, or if it exists
  // but doesn't have root edges for all enabled attributes (user can add with a different attribute).
  // Hide only if concept already has root edges for every enabled attribute.
  // Guests cannot create concepts
  const exactMatchIsFullyRooted = exactMatch && attributes.length > 0 &&
    attributes.every(a => exactMatchRootAttributes.includes(a.name));
  const showCreateRootOption = !isGuest && isRootPage && trimmedQuery.length > 0 && !exactMatchIsFullyRooted;

  const showAddOption = showAddChildOption || showCreateRootOption;

  return (
    <div style={styles.wrapper}>
      {/* Dropdown appears above the input */}
      {showDropdown && (results.length > 0 || showAddOption) && (
        <div ref={dropdownRef} style={styles.dropdown}>
          
          {/* Attribute picker - shown when user has clicked add/create */}
          {showAttributePicker && pendingAction && (
            <div style={styles.attributePickerSection}>
              <div style={styles.attributePickerLabel}>
                Select attribute for "{pendingAction.name}":
              </div>
              <div style={styles.attributeButtons}>
                {attributes.filter(a => !exactMatchRootAttributes.includes(a.name)).map(attr => (
                  <button
                    key={attr.id}
                    style={styles.attributeButton}
                    onClick={() => handleAttributeSelect(attr.id)}
                    disabled={addingName !== null}
                  >
                    {attr.name}
                  </button>
                ))}
              </div>
              {addingName && (
                <div style={styles.addingText}>Creating...</div>
              )}
            </div>
          )}

          {/* Add as child option (only when attribute picker is NOT showing) */}
          {!showAttributePicker && showAddChildOption && (
            addingName === trimmedQuery ? (
              <div style={{ ...styles.addOption, color: '#999', fontStyle: 'normal' }}>
                <span style={styles.addIcon}>...</span>
                <span>Creating...</span>
              </div>
            ) : (
              <div
                style={styles.addOption}
                onClick={() => handleAddAsChildClick(trimmedQuery)}
              >
                <span style={styles.addIcon}>+</span>
                <span>Add "<strong>{trimmedQuery}</strong>" as child</span>
              </div>
            )
          )}

          {/* Create as root concept option (only when attribute picker is NOT showing) */}
          {!showAttributePicker && showCreateRootOption && (
            <div
              style={styles.addOption}
              onClick={() => handleCreateRootClick(trimmedQuery)}
            >
              <span style={styles.addIcon}>+</span>
              <span>{exactMatch ? 'Add' : 'Create'} "<strong>{trimmedQuery}</strong>" as root concept</span>
            </div>
          )}

          {/* Divider between add option and search results */}
          {(showAddOption || showAttributePicker) && results.length > 0 && (
            <div style={styles.divider} />
          )}

          {/* Search results */}
          {results.map((result, idx) => {
            // Determine if this result has context (saved tabs or corpus annotations)
            const hasContext = (result.savedTabs && result.savedTabs.length > 0) ||
                              (result.corpusAnnotations && result.corpusAnnotations.length > 0);
            const prevResult = idx > 0 ? results[idx - 1] : null;
            const prevHasContext = prevResult && (
              (prevResult.savedTabs && prevResult.savedTabs.length > 0) ||
              (prevResult.corpusAnnotations && prevResult.corpusAnnotations.length > 0)
            );

            // Show "In your saves / corpuses" header before first contextual result
            const isFirstContextResult = idx === 0 && hasContext;
            // Show divider between contextual and non-contextual results
            const isFirstNonContextAfterContext = prevHasContext && !hasContext;

            return (
              <React.Fragment key={result.id}>
                {isFirstContextResult && (
                  <div style={styles.savedSectionHeader}>In your saves / corpuses</div>
                )}
                {isFirstNonContextAfterContext && (
                  <div style={styles.divider} />
                )}
                <div
                  style={{
                    ...styles.resultItem,
                    ...(result.isChild ? styles.resultItemChild : {}),
                  }}
                  onClick={() => handleResultClick(result)}
                >
                  <div style={styles.resultName}>
                    {result.name}
                    {result.matchType === 'similar' && (
                      <span style={styles.similarBadge}>similar</span>
                    )}
                  </div>
                  <div style={styles.resultBadges}>
                    {result.savedTabs && result.savedTabs.length > 0 && (
                      <span style={styles.savedTabBadge}>
                        {result.savedTabs.map(t => t.tabName).join(', ')}
                      </span>
                    )}
                    {result.corpusAnnotations && result.corpusAnnotations.length > 0 && (
                      <span style={styles.corpusBadge}>
                        {result.corpusAnnotations.map(c => c.corpusName).join(', ')}
                      </span>
                    )}
                    {result.isChild && result.childAttributes && result.childAttributes.length > 0 && (
                      <span style={styles.childBadge}>
                        child: {result.childAttributes.map(a => typeof a === 'string' ? a : a.attribute_name).join(', ')}
                      </span>
                    )}
                    {result.isChild && (!result.childAttributes || result.childAttributes.length === 0) && (
                      <span style={styles.childBadge}>child</span>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Loading indicator in dropdown position */}
      {showDropdown && loading && results.length === 0 && (
        <div ref={dropdownRef} style={styles.dropdown}>
          <div style={styles.loadingItem}>Searching...</div>
        </div>
      )}

      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => { if (results.length > 0 || (showAddOption && trimmedQuery)) setShowDropdown(true); }}
        onKeyDown={handleKeyDown}
        placeholder="Add / Search..."
        maxLength={255}
        style={styles.input}
      />
    </div>
  );
};

const styles = {
  wrapper: {
    position: 'fixed',
    bottom: '30px',
    right: '30px',
    width: '320px',
    zIndex: 1000,
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '8px',
    backgroundColor: 'white',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    outline: 'none',
    boxSizing: 'border-box',
    color: '#333',
  },
  dropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: '4px',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
    maxHeight: '380px',
    overflowY: 'auto',
  },
  attributePickerSection: {
    padding: '12px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  attributePickerLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginBottom: '8px',
  },
  attributeButtons: {
    display: 'flex',
    gap: '8px',
  },
  attributeButton: {
    padding: '6px 14px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#faf9f7',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#333',
    transition: 'background-color 0.15s, border-color 0.15s',
  },
  resultItem: {
    padding: '10px 16px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.1s',
  },
  resultItemChild: {
    backgroundColor: '#fafafa',
  },
  resultName: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  resultBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  similarBadge: {
    fontSize: '11px',
    color: '#999',
    fontStyle: 'normal',
  },
  childBadge: {
    fontSize: '11px',
    color: '#888',
    backgroundColor: '#f0f0f0',
    padding: '2px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
  },
  savedTabBadge: {
    fontSize: '11px',
    color: '#555',
    backgroundColor: '#e8f0e8',
    padding: '2px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    fontStyle: 'normal',
  },
  corpusBadge: {
    fontSize: '11px',
    color: '#555',
    backgroundColor: '#e8e8f0',
    padding: '2px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    fontStyle: 'normal',
  },
  savedSectionHeader: {
    fontSize: '11px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    padding: '6px 16px 2px 16px',
    borderBottom: '1px solid #f0f0f0',
  },
  addOption: {
    padding: '10px 16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background-color 0.1s',
  },
  addIcon: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
  },
  addingText: {
    color: '#999',
    fontStyle: 'normal',
    fontSize: '13px',
    marginTop: '6px',
  },
  divider: {
    height: '1px',
    backgroundColor: '#e0e0e0',
    margin: '0',
  },
  loadingItem: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#999',
    fontStyle: 'normal',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

// Add hover effects via injected stylesheet
const addHoverEffect = () => {
  const style = document.createElement('style');
  style.textContent = `
    .search-result-item:hover {
      background-color: #f5f5f5 !important;
    }
    .search-add-option:hover {
      background-color: #f5f5f5 !important;
    }
  `;
  if (!document.querySelector('[data-search-styles]')) {
    style.setAttribute('data-search-styles', 'true');
    document.head.appendChild(style);
  }
};

// Call once on module load
addHoverEffect();

export default SearchField;
