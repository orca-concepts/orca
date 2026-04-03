import axios from 'axios';

const API_BASE_URL = '/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if it exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  getCurrentUser: () =>
    api.get('/auth/me'),

  // Password login (Phase 40b)
  login: (identifier, password) =>
    api.post('/auth/login', { identifier, password }),

  // Phone OTP for registration (Phase 40b)
  sendCode: (phoneNumber, intent) =>
    api.post('/auth/send-code', { phoneNumber, intent }),

  verifyRegister: (phoneNumber, code, username, email, password, ageVerified) =>
    api.post('/auth/verify-register', { phoneNumber, code, username, email, password, ageVerified }),

  // Forgot password (Phase 40b)
  forgotPasswordSendCode: (phoneNumber) =>
    api.post('/auth/forgot-password/send-code', { phoneNumber }),

  forgotPasswordReset: (phoneNumber, code, newPassword) =>
    api.post('/auth/forgot-password/reset', { phoneNumber, code, newPassword }),

  logoutEverywhere: () =>
    api.post('/auth/logout-everywhere'),

  deleteAccount: () =>
    api.post('/auth/delete-account'),

  // Phase 41a: ORCID OAuth
  getOrcidAuthorizeUrl: () =>
    api.get('/auth/orcid/authorize-url'),

  orcidCallback: (code) =>
    api.post('/auth/orcid/callback', { code }),

  disconnectOrcid: () =>
    api.post('/auth/orcid/disconnect'),

  devConnectOrcid: (orcidId) =>
    api.post('/auth/orcid/dev-connect', { orcidId }),
};

// Concepts endpoints
export const conceptsAPI = {
  getRootConcepts: (sort) =>
    api.get('/concepts/root', { params: { sort } }),
  
  getConceptWithChildren: (id, path, sort) =>
    api.get(`/concepts/${id}`, { params: { path, sort } }),
  
  getConceptParents: (id, originPath) =>
    api.get(`/concepts/${id}/parents`, { params: { originPath } }),
  
  getConceptNames: (ids) =>
    api.get('/concepts/names/batch', { params: { ids } }),
  
  searchConcepts: (query, parentId, path) =>
    api.get('/concepts/search', { params: { q: query, parentId, path } }),
  
  getAttributes: () =>
    api.get('/concepts/attributes'),
  
  getVoteSets: (id, path) =>
    api.get(`/concepts/${id}/votesets`, { params: { path } }),
  
  createRootConcept: (name, attributeId) =>
    api.post('/concepts/root', { name, attributeId }),
  
  createChildConcept: (name, parentId, path) =>
    api.post('/concepts/child', { name, parentId, path }),

  // Find concept names in document text (Phase 7i — live concept linking)
  findConceptsInText: (text) =>
    api.post('/concepts/find-in-text', { text }),

  // Get cached concept links for a finalized document (Phase 7i-5)
  getDocumentConceptLinks: (documentId) =>
    api.get(`/concepts/document-links/${documentId}`),

  // Phase 14a: Batch children for diff modal
  getBatchChildrenForDiff: (panes) =>
    api.post('/concepts/batch-children-for-diff', { panes }),

  // Phase 27b: Get all annotations for a concept across all contexts
  getConceptAnnotations: (conceptId, { sort, edgeId, tagId, corpusIds } = {}) =>
    api.get(`/concepts/${conceptId}/annotations`, {
      params: {
        ...(sort ? { sort } : {}),
        ...(edgeId ? { edgeId } : {}),
        ...(tagId ? { tagId } : {}),
        ...(corpusIds ? { corpusIds: corpusIds.join(',') } : {}),
      },
    }),
};

// Votes endpoints
export const votesAPI = {
  // Get user's saved edges (for Saved Page) — optionally filtered by tabId
  // LEGACY: still used by old saved tabs system during transition
  getUserSaves: (tabId) =>
    api.get('/votes/saved', { params: tabId ? { tabId } : {} }),

  // Get user's saves grouped by corpus (Phase 7c Saved Page Overhaul)
  getUserSavesByCorpus: () =>
    api.get('/votes/saved-by-corpus'),

  // Saved Tabs
  getUserTabs: () =>
    api.get('/votes/tabs'),

  createTab: (name) =>
    api.post('/votes/tabs/create', { name }),

  renameTab: (tabId, name) =>
    api.post('/votes/tabs/rename', { tabId, name }),

  deleteTab: (tabId) =>
    api.post('/votes/tabs/delete', { tabId }),

  // Graph Tabs (Phase 5c — persistent in-app navigation tabs)
  getGraphTabs: () =>
    api.get('/votes/graph-tabs'),

  createGraphTab: (tabType, conceptId, path, viewMode, label) =>
    api.post('/votes/graph-tabs/create', { tabType, conceptId, path, viewMode, label }),

  updateGraphTab: (tabId, updates) =>
    api.post('/votes/graph-tabs/update', { tabId, ...updates }),

  closeGraphTab: (tabId) =>
    api.post('/votes/graph-tabs/close', { tabId }),

  // Tab Groups (Phase 5d)
  getTabGroups: () =>
    api.get('/votes/tab-groups'),

  createTabGroup: (name) =>
    api.post('/votes/tab-groups/create', { name }),

  renameTabGroup: (groupId, name) =>
    api.post('/votes/tab-groups/rename', { groupId, name }),

  deleteTabGroup: (groupId) =>
    api.post('/votes/tab-groups/delete', { groupId }),

  toggleTabGroup: (groupId, isExpanded) =>
    api.post('/votes/tab-groups/toggle', { groupId, isExpanded }),

  addTabToGroup: (tabType, tabId, groupId) =>
    api.post('/votes/tab-groups/add-tab', { tabType, tabId, groupId }),

  removeTabFromGroup: (tabType, tabId) =>
    api.post('/votes/tab-groups/remove-tab', { tabType, tabId }),

  // Saved Tree Order (Phase 5e) — LEGACY, used by old saved tabs
  getTreeOrder: (tabId) =>
    api.get('/votes/tree-order', { params: { tabId } }),

  updateTreeOrder: (tabId, order) =>
    api.post('/votes/tree-order/update', { tabId, order }),

  // Saved Tree Order V2 (Phase 7c Overhaul — corpus-based)
  getTreeOrderV2: (corpusId) =>
    api.get('/votes/tree-order-v2', { params: corpusId ? { corpusId } : {} }),

  updateTreeOrderV2: (corpusId, order) =>
    api.post('/votes/tree-order-v2/update', { corpusId: corpusId || null, order }),

  // path is an array of concept IDs from root to the concept being saved
  // Tab picker removed — saves auto-grouped by corpus on Saved Page
  addVote: (edgeId, path) =>
    api.post('/votes/add', { edgeId, path: path || [] }),
  
  removeVote: (edgeId) =>
    api.post('/votes/remove', { edgeId }),

  // Remove a save from a specific tab only (keeps vote if linked to other tabs)
  removeVoteFromTab: (edgeId, tabId) =>
    api.post('/votes/remove-from-tab', { edgeId, tabId }),
  
  // Link votes (similarity votes — Flip View only)
  addLinkVote: (originEdgeId, similarEdgeId) =>
    api.post('/votes/link/add', { originEdgeId, similarEdgeId }),
  
  removeLinkVote: (originEdgeId, similarEdgeId) =>
    api.post('/votes/link/remove', { originEdgeId, similarEdgeId }),
  
  // Swap votes (replace votes)
  getSwapVotes: (edgeId) =>
    api.get(`/votes/swap/${edgeId}`),
  
  addSwapVote: (edgeId, replacementEdgeId) =>
    api.post('/votes/swap/add', { edgeId, replacementEdgeId }),
  
  removeSwapVote: (edgeId, replacementEdgeId) =>
    api.post('/votes/swap/remove', { edgeId, replacementEdgeId }),

  // Sidebar Items (Phase 19b)
  getSidebarItems: () =>
    api.get('/votes/sidebar-items'),

  reorderSidebarItems: (items) =>
    api.post('/votes/sidebar-items/reorder', { items }),

  // Web Links (Phase 6)
  getWebLinks: (edgeId) =>
    api.get(`/votes/web-links/${edgeId}`),

  getAllWebLinksForConcept: (conceptId, path) =>
    api.get(`/votes/web-links/all/${conceptId}`, { params: path ? { path } : {} }),

  addWebLink: (edgeId, url, title, comment) =>
    api.post('/votes/web-links/add', { edgeId, url, title: title || undefined, comment: comment || undefined }),

  removeWebLink: (linkId) =>
    api.post('/votes/web-links/remove', { linkId }),

  upvoteWebLink: (linkId) =>
    api.post('/votes/web-links/upvote', { linkId }),

  removeWebLinkVote: (linkId) =>
    api.post('/votes/web-links/unvote', { linkId }),

  updateLinkComment: (linkId, comment) =>
    api.put(`/votes/web-links/${linkId}/comment`, { comment }),

  // Graph Tab Placement in Corpus Tree (Phase 12c)
  getTabPlacements: () =>
    api.get('/votes/tab-placements'),

  placeTabInCorpus: (graphTabId, corpusId) =>
    api.post('/votes/tab-placements/place', { graphTabId, corpusId }),

  removeTabFromCorpus: (graphTabId) =>
    api.post('/votes/tab-placements/remove', { graphTabId }),

};

// Corpus endpoints (Phase 7a)
export const corpusAPI = {
  // List all corpuses (browsable)
  listAll: () =>
    api.get('/corpuses/'),

  // List current user's own corpuses
  listMine: () =>
    api.get('/corpuses/mine'),

  // Get single corpus with document list
  getCorpus: (corpusId) =>
    api.get(`/corpuses/${corpusId}`),

  // Create a new corpus (optional parentCorpusId for nesting)
  create: (name, description, annotationMode, parentCorpusId) =>
    api.post('/corpuses/create', { name, description: description || undefined, annotationMode: annotationMode || undefined, parentCorpusId: parentCorpusId || undefined }),

  // Update corpus (owner only)
  update: (corpusId, updates) =>
    api.post(`/corpuses/${corpusId}/update`, updates),

  // Delete corpus (owner only)
  deleteCorpus: (corpusId) =>
    api.post(`/corpuses/${corpusId}/delete`),

  // Check for duplicate documents before uploading (Phase 7b)
  checkDuplicates: (body) =>
    api.post('/corpuses/check-duplicates', { body }),
  checkDuplicatesFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/corpuses/check-duplicates', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Search documents by title (Phase 7e — for "Add existing document" flow)
  searchDocuments: (query, excludeCorpusId) =>
    api.get('/corpuses/documents/search', { params: { q: query, excludeCorpusId } }),

  // Upload a new document into a corpus (multipart/form-data)
  uploadDocument: (corpusId, file, title, tags, copyrightConfirmed) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    if (tags && tags.length > 0) formData.append('tags', JSON.stringify(tags));
    if (copyrightConfirmed) formData.append('copyrightConfirmed', 'true');
    return api.post(`/corpuses/${corpusId}/documents/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Add an existing document to a corpus (owner only)
  addDocument: (corpusId, documentId) =>
    api.post(`/corpuses/${corpusId}/documents/add`, { documentId }),

  // Remove a document from a corpus (owner only)
  removeDocument: (corpusId, documentId) =>
    api.post(`/corpuses/${corpusId}/documents/remove`, { documentId }),

  // Subscriptions (Phase 7c)
  getMySubscriptions: () =>
    api.get('/corpuses/subscriptions'),

  subscribe: (corpusId) =>
    api.post('/corpuses/subscribe', { corpusId }),

  unsubscribe: (corpusId) =>
    api.post('/corpuses/unsubscribe', { corpusId }),

  // Annotations (Phase 7d)
  createAnnotation: (corpusId, documentId, edgeId, quoteText, comment, quoteOccurrence) =>
    api.post('/corpuses/annotations/create', { corpusId, documentId, edgeId, quoteText: quoteText || null, comment: comment || null, quoteOccurrence: quoteOccurrence || null }),

  getDocumentAnnotations: (corpusId, documentId, filter, sort) =>
    api.get(`/corpuses/${corpusId}/documents/${documentId}/annotations`, { params: { ...(filter ? { filter } : {}), ...(sort ? { sort } : {}) } }),

  getAnnotationsForEdge: (edgeId) =>
    api.get(`/corpuses/annotations/edge/${edgeId}`),

  // Annotation votes (Phase 7f)
  voteOnAnnotation: (annotationId) =>
    api.post('/corpuses/annotations/vote', { annotationId }),

  unvoteAnnotation: (annotationId) =>
    api.post('/corpuses/annotations/unvote', { annotationId }),

  // Phase 26c-2: Color set preference API methods removed

  // Phase 7g: Allowed Users & Invite Tokens
  generateInviteToken: (corpusId, maxUses, expiresInDays) =>
    api.post('/corpuses/invite/generate', { corpusId, maxUses: maxUses || undefined, expiresInDays: expiresInDays || undefined }),

  acceptInvite: (token) =>
    api.post('/corpuses/invite/accept', { token }),

  deleteInviteToken: (tokenId) =>
    api.post('/corpuses/invite/delete', { tokenId }),

  listAllowedUsers: (corpusId) =>
    api.get(`/corpuses/${corpusId}/allowed-users`),

  removeAllowedUser: (corpusId, targetUserId) =>
    api.post('/corpuses/allowed-users/remove', { corpusId, targetUserId }),

  inviteUserToCorpus: (corpusId, userId) =>
    api.post(`/corpuses/${corpusId}/invite-user`, { userId }),

  leaveCorpus: (corpusId) =>
    api.post('/corpuses/allowed-users/leave', { corpusId }),

  getInviteTokens: (corpusId) =>
    api.get(`/corpuses/${corpusId}/invite-tokens`),

  checkAllowedStatus: (corpusId) =>
    api.get(`/corpuses/${corpusId}/allowed-status`),

  // Phase 7h: Document Versioning — multipart/form-data
  createVersion: (corpusId, sourceDocumentId, file, copyrightConfirmed) => {
    const formData = new FormData();
    formData.append('corpusId', corpusId);
    formData.append('sourceDocumentId', sourceDocumentId);
    formData.append('file', file);
    if (copyrightConfirmed) formData.append('copyrightConfirmed', 'true');
    return api.post('/corpuses/versions/create', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getVersionHistory: (documentId) =>
    api.get(`/corpuses/versions/${documentId}/history`),

  // Document Favorites (Phase 7c Overhaul — per-corpus favoriting)
  toggleDocumentFavorite: (corpusId, documentId) =>
    api.post('/corpuses/documents/favorite/toggle', { corpusId, documentId }),

  getDocumentFavorites: (corpusId) =>
    api.get(`/corpuses/${corpusId}/document-favorites`),

  // Phase 9b: Orphan rescue
  getOrphanedDocuments: () =>
    api.get('/corpuses/orphaned-documents'),

  rescueDocument: (documentId, corpusId) =>
    api.post('/corpuses/rescue-document', { documentId, corpusId }),

  dismissOrphan: (documentId) =>
    api.post('/corpuses/dismiss-orphan', { documentId }),

  // Phase 26a: Document Co-Authors
  generateDocumentInviteToken: (documentId) =>
    api.post(`/corpuses/documents/${documentId}/invite/generate`),

  acceptDocumentInvite: (token) =>
    api.post('/corpuses/documents/invite/accept', { token }),

  getDocumentAuthors: (documentId) =>
    api.get(`/corpuses/documents/${documentId}/authors`),

  removeDocumentAuthor: (documentId, userId) =>
    api.post(`/corpuses/documents/${documentId}/authors/remove`, { userId }),

  leaveDocumentAuthorship: (documentId) =>
    api.post(`/corpuses/documents/${documentId}/authors/leave`),

  // Phase 42b: Direct invite coauthor by userId
  inviteAuthorToDocument: (documentId, userId) =>
    api.post(`/corpuses/documents/${documentId}/invite-author`, { userId }),

  // Phase 35b: Corpus ownership transfer
  transferOwnership: (corpusId, newOwnerId) =>
    api.post(`/corpuses/${corpusId}/transfer-ownership`, { newOwnerId }),

  // Phase 38h: Get annotations for a specific concept on a document in a corpus
  getAnnotationsForConceptOnDocument: (corpusId, documentId, conceptId) =>
    api.get(`/corpuses/${corpusId}/documents/${documentId}/annotations-for-concept/${conceptId}`),
};

// Document endpoints (Phase 7a, extended Phase 17a)
export const documentsAPI = {
  // Get a single document with full body text + corpus list
  getDocument: (documentId) =>
    api.get(`/documents/${documentId}`),

  // Phase 17a: Document Tags
  listTags: () =>
    api.get('/documents/tags'),

  createTag: (name) =>
    api.post('/documents/tags/create', { name }),

  assignTag: (documentId, tagId) =>
    api.post('/documents/tags/assign', { documentId, tagId }),

  removeTag: (documentId, tagId) =>
    api.post('/documents/tags/remove', { documentId, tagId }),

  getDocumentTags: (documentId) =>
    api.get(`/documents/${documentId}/tags`),

  // Phase 21c: Get lightweight version chain for consolidation + navigator (guest OK)
  getVersionChain: (documentId) =>
    api.get(`/documents/${documentId}/version-chain`),

  // Phase 31d: Get annotation fingerprints across version chain (guest OK)
  getVersionAnnotationMap: (documentId) =>
    api.get(`/documents/${documentId}/version-annotation-map`),

  // Phase 35a: Delete a single document version (uploader only)
  deleteDocument: (documentId) =>
    api.post(`/documents/${documentId}/delete`),

  // Phase 38j: Get citations for a document (guest OK)
  getCitations: (documentId) =>
    api.get(`/documents/${documentId}/citations`),

  // Phase 41c: Document external links (multiple per document)
  getExternalLinks: (documentId) =>
    api.get(`/documents/${documentId}/external-links`),

  addExternalLink: (documentId, url) =>
    api.post(`/documents/${documentId}/external-links/add`, { url }),

  removeExternalLink: (documentId, linkId) =>
    api.post(`/documents/${documentId}/external-links/${linkId}/remove`),
};

// Phase 38j: Citation resolution
export const citationsAPI = {
  resolveCitation: (annotationId) =>
    api.get(`/citations/resolve/${annotationId}`),
};

// Moderation endpoints (Phase 16a)
export const moderationAPI = {
  // Flag an edge as spam/vandalism (hides after 10 flags)
  flagEdge: (edgeId, reason = 'spam') =>
    api.post('/moderation/flag', { edgeId, reason }),

  // Remove the current user's flag from an edge
  unflagEdge: (edgeId) =>
    api.post('/moderation/unflag', { edgeId }),

  // Get hidden children for a parent in context
  getHiddenChildren: (parentId, path = []) =>
    api.get(`/moderation/hidden/${parentId}`, { params: { path: path.join(',') } }),

  // Vote to hide or show a hidden concept
  voteModerationHide: (edgeId, voteType) =>
    api.post('/moderation/vote', { edgeId, voteType }),

  // Remove a moderation vote
  removeModerationVote: (edgeId) =>
    api.post('/moderation/vote/remove', { edgeId }),

  // Add a moderation comment
  addModerationComment: (edgeId, body) =>
    api.post('/moderation/comment', { edgeId, body }),

  // Get moderation comments for an edge
  getModerationComments: (edgeId) =>
    api.get(`/moderation/comments/${edgeId}`),

  // Admin: unhide an edge
  unhideEdge: (edgeId) =>
    api.post('/moderation/unhide', { edgeId }),
};

// Phase 30g: Informational page comments
export const pagesAPI = {
  getComments: (slug) =>
    api.get(`/pages/${slug}/comments`),

  addComment: (slug, body, parentCommentId) =>
    api.post(`/pages/${slug}/comments`, { body, ...(parentCommentId ? { parentCommentId } : {}) }),

  toggleCommentVote: (commentId) =>
    api.post(`/pages/comments/${commentId}/vote`),
};

// Phase 31a: Annotation Messaging
export const messagesAPI = {
  createThread: (annotationId, threadType, body) =>
    api.post('/messages/threads/create', { annotation_id: annotationId, thread_type: threadType, body }),

  getThreads: (section) =>
    api.get('/messages/threads', { params: section ? { section } : {} }),

  getThread: (threadId) =>
    api.get(`/messages/threads/${threadId}`),

  replyToThread: (threadId, body) =>
    api.post(`/messages/threads/${threadId}/reply`, { body }),

  getMessages: (threadId, before, limit) =>
    api.get(`/messages/threads/${threadId}/messages`, { params: { ...(before ? { before } : {}), ...(limit ? { limit } : {}) } }),

  getUnreadCount: () =>
    api.get('/messages/unread-count'),

  getAnnotationStatus: (annotationId) =>
    api.get(`/messages/annotations/${annotationId}/status`),
};

// Phase 39a: Combos
export const combosAPI = {
  listCombos: (search, sort) =>
    api.get('/combos', { params: { search, sort } }),

  getCombo: (id) =>
    api.get(`/combos/${id}`),

  getComboAnnotations: (id, sort, edgeIds) =>
    api.get(`/combos/${id}/annotations`, { params: { sort, edgeIds } }),

  createCombo: (name, description) =>
    api.post('/combos/create', { name, description }),

  getMyCombos: () =>
    api.get('/combos/mine'),

  getSubscriptions: () =>
    api.get('/combos/subscriptions'),

  subscribe: (comboId) =>
    api.post('/combos/subscribe', { comboId }),

  unsubscribe: (comboId) =>
    api.post('/combos/unsubscribe', { comboId }),

  addEdge: (comboId, edgeId) =>
    api.post(`/combos/${comboId}/edges/add`, { edgeId }),

  removeEdge: (comboId, edgeId) =>
    api.post(`/combos/${comboId}/edges/remove`, { edgeId }),

  voteAnnotation: (comboId, annotationId) =>
    api.post(`/combos/${comboId}/annotations/vote`, { annotationId }),

  unvoteAnnotation: (comboId, annotationId) =>
    api.post(`/combos/${comboId}/annotations/unvote`, { annotationId }),
};

// Phase 41a: Users endpoints
export const usersAPI = {
  getUserProfile: (userId) =>
    api.get(`/users/${userId}/profile`),
  searchUsers: (query) =>
    api.get(`/users/search?q=${encodeURIComponent(query)}`),
};

export default api;
