import React, { useState, useRef } from 'react';

const styles = {
  uploadSection: {
    marginBottom: '20px',
  },
  uploadButtonRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  uploadToggle: {
    padding: '8px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  uploadForm: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
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
  dropZoneChooseLink: {
    color: '#5a4a2a',
    textDecoration: 'underline',
    textDecorationColor: 'rgba(90,74,42,0.35)',
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
  uploadFormUploading: {
    opacity: 0.75,
    pointerEvents: 'none',
  },
  fileError: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    padding: '4px 0',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
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
  tagPickerSection: {
    marginBottom: '8px',
  },
  tagPickerLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginBottom: '4px',
    display: 'block',
  },
  selectedTagsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginBottom: '4px',
    marginTop: '4px',
  },
  tagPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    backgroundColor: '#e8f0fe',
    color: '#1a56db',
    borderRadius: '12px',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  tagPillRemove: {
    cursor: 'pointer',
    fontSize: '10px',
    color: '#1a56db',
    opacity: 0.6,
    marginLeft: '2px',
  },
  tagInputRow: {
    display: 'flex',
    gap: '6px',
    marginTop: '4px',
  },
  tagInput: {
    flex: 1,
    padding: '4px 8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    outline: 'none',
  },
  tagSuggestions: {
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: 'white',
    marginTop: '2px',
    maxHeight: '160px',
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
  tagSuggestionCount: {
    fontSize: '11px',
    color: '#999',
    marginLeft: '8px',
  },
  addExistingToggle: {
    padding: '8px 16px',
    border: '1px solid #555',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#555',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  addExistingForm: {
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  addSearchRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  searchButton: {
    padding: '10px 16px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
  },
  addResultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  addResultCard: {
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  addResultInfo: {
    flex: 1,
    minWidth: 0,
  },
  addResultTitle: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  addResultMeta: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    marginTop: '2px',
  },
  metaDot: {
    margin: '0 6px',
  },
  addResultCorpuses: {
    fontSize: '11px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#8a7020',
    marginTop: '3px',
    fontStyle: 'normal',
  },
  addDocButton: {
    padding: '5px 14px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  noResults: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    fontStyle: 'normal',
    padding: '8px 0',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  checkboxLabel: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.4',
  },
};

function CorpusUploadForm({
  corpusId,
  isGuest,
  isOwner,
  isAllowedUser,
  allTags,
  onUpload,
  onSearchDocuments,
  onAddDocument,
  onComplete,
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [uploadFileError, setUploadFileError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadTags, setUploadTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [copyrightConfirmed, setCopyrightConfirmed] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingDocId, setAddingDocId] = useState(null);

  const fileInputRef = useRef(null);

  if (isGuest || (!isOwner && !isAllowedUser)) return null;

  const validateFileExtension = (file) => {
    const validExtensions = ['.txt', '.md', '.pdf', '.docx'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return validExtensions.includes(ext);
  };

  const handleFileSelect = (file) => {
    if (!validateFileExtension(file)) {
      setUploadFileError('Unsupported file type. Please upload .txt, .md, .pdf, or .docx files.');
      setUploadFile(null);
      return;
    }
    setUploadFileError('');
    setUploadFile(file);
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
    setUploadTitle(nameWithoutExt);
  };

  const doFileUpload = async () => {
    setUploading(true);
    try {
      await onUpload(corpusId, uploadFile, uploadTitle.trim(), uploadTags.length > 0 ? uploadTags : undefined, copyrightConfirmed);
      setUploadFile(null);
      setUploadTitle('');
      setUploadTags([]);
      setTagInput('');
      setUploadFileError('');
      setCopyrightConfirmed(false);
      setShowUpload(false);
      onComplete();
    } catch (err) {
      // error handling left to parent
    } finally {
      setUploading(false);
    }
  };

  const getTagSuggestions = (input, excludeIds) => {
    if (!input.trim()) return [];
    const lower = input.toLowerCase();
    return (allTags || [])
      .filter(t => !excludeIds.includes(t.id) && t.name.toLowerCase().includes(lower))
      .slice(0, 10);
  };

  const handleAddUploadTag = (tag) => {
    setUploadTags([tag.id]);
    setTagInput('');
  };

  const handleRemoveUploadTag = (tagId) => {
    setUploadTags(uploadTags.filter(id => id !== tagId));
  };

  const handleAddSearch = async () => {
    if (!addSearchQuery.trim()) return;
    setAddSearching(true);
    try {
      const res = await onSearchDocuments(addSearchQuery.trim(), corpusId);
      setAddSearchResults(res.data?.documents || []);
    } catch (err) {
      setAddSearchResults([]);
    } finally {
      setAddSearching(false);
    }
  };

  const handleAddDocumentToCorpus = async (docId) => {
    setAddingDocId(docId);
    try {
      await onAddDocument(corpusId, docId);
      setAddSearchResults(addSearchResults.filter(doc => doc.id !== docId));
      onComplete();
    } catch (err) {
      // error handling left to parent
    } finally {
      setAddingDocId(null);
    }
  };

  const tagSuggestions = getTagSuggestions(tagInput, uploadTags);

  return (
    <div style={styles.uploadSection}>
      <style>{`@keyframes orca-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={styles.uploadButtonRow}>
        <button
          style={styles.uploadToggle}
          onClick={() => { setShowUpload(!showUpload); setShowAddExisting(false); }}
        >
          {showUpload ? 'Cancel upload' : '+ Upload Document'}
        </button>
        {(isOwner || isAllowedUser) && (
          <button
            style={styles.addExistingToggle}
            onClick={() => { setShowAddExisting(!showAddExisting); setShowUpload(false); }}
          >
            {showAddExisting ? 'Cancel' : '+ Add Existing Document'}
          </button>
        )}
      </div>

      {showUpload && (
        <div style={{ ...styles.uploadForm, ...(uploading ? styles.uploadFormUploading : {}) }}>
          <div
            style={{
              ...styles.dropZone,
              ...(uploadDragOver ? styles.dropZoneActive : {}),
              ...(uploading ? styles.dropZoneUploading : {}),
            }}
            onClick={() => { if (!uploading) fileInputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true); }}
            onDragLeave={() => setUploadDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setUploadDragOver(false);
              if (!uploading && e.dataTransfer.files.length > 0) {
                handleFileSelect(e.dataTransfer.files[0]);
              }
            }}
          >
            {uploading ? (
              <span style={styles.dropZoneUploadingText}>
                <span style={styles.uploadSpinner}></span>
                Uploading...
              </span>
            ) : uploadFile ? (
              <span style={styles.dropZoneFileName}>{uploadFile.name}</span>
            ) : (
              <span style={styles.dropZoneHint}>
                <span>Drag and drop a file here, or <span style={styles.dropZoneChooseLink}>choose a file</span></span>
                <span style={styles.dropZoneFormats}>.txt, .md, .pdf, .docx</span>
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
            }}
          />
          {uploadFileError && (
            <div style={styles.fileError}>{uploadFileError}</div>
          )}
          <input
            type="text"
            placeholder="Document title"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            maxLength={255}
            style={styles.input}
          />
          <div style={styles.tagPickerSection}>
            <span style={styles.tagPickerLabel}>Tag (optional):</span>
            {uploadTags.length > 0 && (
              <div style={styles.selectedTagsRow}>
                {uploadTags.map(tagId => {
                  const tag = (allTags || []).find(t => t.id === tagId);
                  return tag ? (
                    <span key={tag.id} style={styles.tagPill}>
                      {tag.name}
                      <span
                        style={styles.tagPillRemove}
                        onClick={() => handleRemoveUploadTag(tag.id)}
                      >
                        ✕
                      </span>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            <div style={styles.tagInputRow}>
              <input
                type="text"
                placeholder="Search tags..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                style={styles.tagInput}
              />
            </div>
            {tagSuggestions.length > 0 && (
              <div style={styles.tagSuggestions}>
                {tagSuggestions.map(tag => (
                  <div
                    key={tag.id}
                    style={styles.tagSuggestionItem}
                    onClick={() => handleAddUploadTag(tag)}
                  >
                    <span>{tag.name}</span>
                    <span style={styles.tagSuggestionCount}>{tag.usage_count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={copyrightConfirmed}
              onChange={(e) => setCopyrightConfirmed(e.target.checked)}
              disabled={uploading}
            />
            <span style={styles.checkboxLabel}>I confirm I have the right to upload this content (I own it or it is in the public domain)</span>
          </label>
          <button
            style={{
              ...styles.submitButton,
              ...(!uploadFile || !uploadTitle.trim() || !copyrightConfirmed || uploading ? { opacity: 0.5, cursor: 'default' } : {}),
            }}
            disabled={!uploadFile || !uploadTitle.trim() || !copyrightConfirmed || uploading}
            onClick={doFileUpload}
          >
            Upload
          </button>
        </div>
      )}

      {showAddExisting && (
        <div style={styles.addExistingForm}>
          <div style={styles.addSearchRow}>
            <input
              type="text"
              placeholder="Search documents by title..."
              value={addSearchQuery}
              onChange={(e) => setAddSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddSearch(); }}
              style={{ ...styles.input, flex: 1 }}
            />
            <button
              style={styles.searchButton}
              onClick={handleAddSearch}
              disabled={addSearching}
            >
              {addSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {addSearchResults.length > 0 && (
            <div style={styles.addResultsList}>
              {addSearchResults.map(doc => (
                <div key={doc.id} style={styles.addResultCard}>
                  <div style={styles.addResultInfo}>
                    <div style={styles.addResultTitle}>{doc.title}</div>
                    <div style={styles.addResultMeta}>
                      {doc.uploaded_by_username && (
                        <span>{doc.uploaded_by_username}</span>
                      )}
                      {doc.uploaded_by_username && doc.created_at && (
                        <span style={styles.metaDot}>·</span>
                      )}
                      {doc.created_at && (
                        <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    {doc.corpus_names && doc.corpus_names.length > 0 && (
                      <div style={styles.addResultCorpuses}>
                        In: {doc.corpus_names.join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    style={{
                      ...styles.addDocButton,
                      ...(addingDocId === doc.id ? { opacity: 0.5, cursor: 'default' } : {}),
                    }}
                    disabled={addingDocId === doc.id}
                    onClick={() => handleAddDocumentToCorpus(doc.id)}
                  >
                    {addingDocId === doc.id ? 'Adding...' : '+ Add'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {addSearchResults.length === 0 && addSearchQuery && !addSearching && (
            <div style={styles.noResults}>No documents found.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default CorpusUploadForm;
