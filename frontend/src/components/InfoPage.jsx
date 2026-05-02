import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { pagesAPI } from '../services/api';

const PAGE_TITLES = {
  'using-orca': 'Using orca',
};

// ── Carousel data (using-orca only) ──────────────────────────
const MESSAGE_SLIDES = [
  { image: '/images/using-orca/message1.png' },
  { image: '/images/using-orca/message2.png' },
  { image: '/images/using-orca/message3.png' },
  { image: '/images/using-orca/message4.png' },
];

const MESSAGES_CAPTION = 'Send and receive messages attached to specific annotations, organized by document, annotation, and sender/recipient.';

const MESSAGES_LIGHTBOX = MESSAGE_SLIDES.map((s, i) => ({
  image: s.image,
  caption: `Messages (${i + 1} of ${MESSAGE_SLIDES.length}): ${MESSAGES_CAPTION}`,
}));

const MessagesCarousel = ({ onImageClick }) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = MESSAGE_SLIDES[slideIndex];

  return (
    <div>
      <img
        src={slide.image}
        alt={`Messages screenshot ${slideIndex + 1}`}
        style={{ ...carouselStyles.image, cursor: 'pointer' }}
        onClick={() => onImageClick({ slides: MESSAGES_LIGHTBOX, index: slideIndex })}
      />
      <div style={carouselStyles.controls}>
        <button
          style={{
            ...carouselStyles.arrowButton,
            opacity: slideIndex === 0 ? 0.3 : 1,
          }}
          onClick={() => setSlideIndex(i => Math.max(0, i - 1))}
          disabled={slideIndex === 0}
        >
          {'\u2190'}
        </button>
        <span style={carouselStyles.indicator}>
          {slideIndex + 1} of {MESSAGE_SLIDES.length}
        </span>
        <button
          style={{
            ...carouselStyles.arrowButton,
            opacity: slideIndex === MESSAGE_SLIDES.length - 1 ? 0.3 : 1,
          }}
          onClick={() => setSlideIndex(i => Math.min(MESSAGE_SLIDES.length - 1, i + 1))}
          disabled={slideIndex === MESSAGE_SLIDES.length - 1}
        >
          {'\u2192'}
        </button>
      </div>
    </div>
  );
};

const carouselStyles = {
  wrapper: {
    marginTop: '36px',
    borderTop: '1px solid #e8e6e2',
    paddingTop: '28px',
  },
  stepTitle: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginBottom: '12px',
  },
  image: {
    maxWidth: '100%',
    border: '1px solid #e0e0e0',
    display: 'block',
    marginBottom: '12px',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginTop: '4px',
  },
  arrowButton: {
    background: 'none',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    padding: '4px 12px',
    lineHeight: 1,
  },
  indicator: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
  },
};

// ── Use case data ────────────────────────────────────────────
const USE_CASES = [
  {
    label: 'Use Case: Research.',
    text: ' Researchers can develop value hierarchy graphs (as well as those for actions, tools, and research questions) to navigate research documents of different kinds and message document authors.',
  },
  {
    label: 'Use Case: Product Development.',
    text: ' Developers can publish documents related to the functionality of their products and users can apply value, tool, and action hierarchy graphs to help others best utilize tools and signal evolving demand for product capabilities. Orca itself is a platform for researchers, so please respect that audience and only include research-related tools here.',
  },
  {
    label: 'Use Case: Education.',
    text: ' Students and educators can create hierarchy graphs and apply them to material for self-directed exploration of core concepts.',
  },
];

// ── Using Orca content (left column) ─────────────────────────
const UsingOrcaContent = ({ onImageClick }) => {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isNarrow = windowWidth < 768;

  const gridStyle = {
    display: isNarrow ? 'block' : 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '28px',
    marginTop: '28px',
  };

  const cellStyle = {
    marginBottom: isNarrow ? '28px' : 0,
  };

  return (
    <div>
      <p style={usingOrcaStyles.intro}>
        Using orca is building shared value hierarchies, ontologies of the principles that matter most in research,
        and using them as annotations to navigate between research documents. You can also message document authors about a specific annotation/document, cite annotations from other documents,
        and link the text-only documents in orca to where they are hosted elsewhere.
      </p>

      <p style={usingOrcaStyles.useCase}>
        Orca is open source (<a
          href="https://github.com/orca-concepts/orca"
          target="_blank"
          rel="noopener noreferrer"
          style={usingOrcaStyles.subtleLink}
        >https://github.com/orca-concepts/orca</a>). Educators and organizations can run their own instance for a controlled environment.
      </p>

      {/* Video 1 — link-out to YouTube */}
      <div style={{ margin: '32px 0' }}>
        <a
          href="https://www.youtube.com/watch?v=lkjSEi64DFs"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            backgroundImage: 'url(https://img.youtube.com/vi/lkjSEi64DFs/maxresdefault.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: '#000',
            border: '1px solid #ccc',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
          aria-label="Watch video 1 on YouTube (opens in a new tab)"
        >
          {/* Play triangle overlay */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 0,
              height: 0,
              borderTop: '14px solid transparent',
              borderBottom: '14px solid transparent',
              borderLeft: '22px solid #fff',
              marginLeft: '6px',
            }} />
          </div>
        </a>
        {/* PHASE 56C-CAPTION: Miles will revise this caption text */}
        <p style={{
          fontFamily: "'EB Garamond', Georgia, serif",
          fontSize: '0.95rem',
          fontStyle: 'normal',
          color: '#555',
          marginTop: '8px',
          textAlign: 'center',
        }}>
          This video shows the navigation between documents via concept graphs.
        </p>
      </div>

      {/* Video 2 — link-out to YouTube */}
      <div style={{ margin: '32px 0' }}>
        <a
          href="https://www.youtube.com/watch?v=o9JuDZjSiGw"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            backgroundImage: 'url(https://img.youtube.com/vi/o9JuDZjSiGw/maxresdefault.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: '#000',
            border: '1px solid #ccc',
            textDecoration: 'none',
            cursor: 'pointer',
          }}
          aria-label="Watch video 2 on YouTube (opens in a new tab)"
        >
          {/* Play triangle overlay */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 0,
              height: 0,
              borderTop: '14px solid transparent',
              borderBottom: '14px solid transparent',
              borderLeft: '22px solid #fff',
              marginLeft: '6px',
            }} />
          </div>
        </a>
        {/* PHASE 56C-CAPTION: Miles will revise this caption text */}
        <p style={{
          fontFamily: "'EB Garamond', Georgia, serif",
          fontSize: '0.95rem',
          fontStyle: 'normal',
          color: '#555',
          marginTop: '8px',
          textAlign: 'center',
        }}>
          This video shows using Flip View to compare a single concept and its children across different parent contexts.
        </p>
      </div>

      <div style={usingOrcaStyles.heroTitle}>
        Build collaborative value ontologies, then use them to annotate research documents
      </div>
      <div style={usingOrcaStyles.heroRow}>
        <div style={usingOrcaStyles.heroCell}>
          <img
            src="/images/using-orca/children_view.png"
            alt="Children view showing a value hierarchy"
            style={usingOrcaStyles.heroImage}
            onClick={() => onImageClick({
              slides: [{ image: '/images/using-orca/children_view.png', caption: 'Build collaborative value ontologies to organize the principles central to research.' }],
              index: 0,
            })}
          />
        </div>
        <div style={usingOrcaStyles.heroCell}>
          <img
            src="/images/using-orca/highlighted_annotation_in_doc.png"
            alt="Annotation highlighted in a research document"
            style={usingOrcaStyles.heroImage}
            onClick={() => onImageClick({
              slides: [{ image: '/images/using-orca/highlighted_annotation_in_doc.png', caption: 'Annotate research documents with concepts from your ontologies to navigate between documents through shared meaning.' }],
              index: 0,
            })}
          />
        </div>
      </div>

      <div style={gridStyle}>
        <div style={cellStyle}>
          <div style={usingOrcaStyles.sectionTitle}>Flip View</div>
          <img
            src="/images/using-orca/flip-view.png"
            alt="Flip View showing alternative parents"
            style={{ ...usingOrcaStyles.screenshot, cursor: 'pointer' }}
            onClick={() => onImageClick({
              slides: [{ image: '/images/using-orca/flip-view.png', caption: '\u201CFlip View\u201D shows you the alternative parents a given concept has; the concept might have different child paths to explore for different parent contexts.' }],
              index: 0,
            })}
          />
          <p style={usingOrcaStyles.caption}>
            "Flip View" shows you the alternative parents a given concept has; the concept might have
            different child paths to explore for different parent contexts.
          </p>
        </div>

        <div style={cellStyle}>
          <div style={usingOrcaStyles.sectionTitle}>Messages</div>
          <MessagesCarousel onImageClick={onImageClick} />
          <p style={usingOrcaStyles.caption}>
            Send and receive messages attached to specific annotations, organized by document,
            annotation, and sender/recipient.
          </p>
        </div>

        <div style={cellStyle}>
          <div style={usingOrcaStyles.sectionTitle}>Tunneling</div>
          <img
            src="/images/using-orca/tunnel_view.png"
            alt="Tunnel view showing pinned concepts across graphs"
            style={{ ...usingOrcaStyles.screenshot, cursor: 'pointer' }}
            onClick={() => onImageClick({
              slides: [{ image: '/images/using-orca/tunnel_view.png', caption: 'Pin concepts from different types of graphs for quick navigation to relevant areas.' }],
              index: 0,
            })}
          />
          <p style={usingOrcaStyles.caption}>
            Pin concepts from different types of graphs for quick navigation to relevant areas.
          </p>
        </div>

        <div style={cellStyle}>
          <div style={usingOrcaStyles.sectionTitle}>Superconcepts</div>
          <img
            src="/images/using-orca/superconcept.png"
            alt="Superconcept page showing a curated reading list"
            style={{ ...usingOrcaStyles.screenshot, cursor: 'pointer' }}
            onClick={() => onImageClick({
              slides: [{ image: '/images/using-orca/superconcept.png', caption: 'Create superconcepts to build reading lists based on certain annotations.' }],
              index: 0,
            })}
          />
          <p style={usingOrcaStyles.caption}>
            Create superconcepts to build reading lists based on certain annotations.
          </p>
        </div>
      </div>

      {USE_CASES.map((uc, i) => (
        <p key={i} style={usingOrcaStyles.useCase}>
          <span style={{ fontWeight: 'bold' }}>{uc.label}</span>{uc.text}
        </p>
      ))}
    </div>
  );
};

const usingOrcaStyles = {
  intro: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    margin: '0 0 24px 0',
  },
  useCase: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    margin: '0 0 0.75em 0',
  },
  subtleLink: {
    color: '#333',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
    textUnderlineOffset: '2px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  sectionTitle: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginBottom: '10px',
  },
  heroTitle: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginTop: '28px',
    marginBottom: '10px',
  },
  heroRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '28px',
    width: '100%',
  },
  heroCell: {
    flex: '1 1 0',
    minWidth: 0,
  },
  heroImage: {
    width: '100%',
    height: 'auto',
    display: 'block',
    border: '1px solid #e0e0e0',
    cursor: 'pointer',
  },
  screenshot: {
    maxWidth: '100%',
    border: '1px solid #e0e0e0',
    display: 'block',
    marginBottom: '10px',
  },
  caption: {
    fontSize: '0.85em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    lineHeight: '1.6',
    margin: '0 0 28px 0',
  },
};

// ── Main InfoPage component ──────────────────────────────────
const InfoPage = ({ slug, onRequestLogin }) => {
  const { user, isGuest } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Lightbox state: { slides: [{ image, caption }], index: number } | null
  const [lightbox, setLightbox] = useState(null);

  const title = PAGE_TITLES[slug] || slug;
  const isUsingOrca = slug === 'using-orca';
  const isTwoCol = isUsingOrca;
  const commentsHeading = isUsingOrca ? 'Report Bugs / Request Enhancements' : 'Community Comments';

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await pagesAPI.getComments(slug);
      setComments(res.data.comments || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleAddComment = async () => {
    if (!commentBody.trim() || submitting) return;
    try {
      setSubmitting(true);
      const res = await pagesAPI.addComment(slug, commentBody.trim());
      setComments(prev => [res.data.comment, ...prev]);
      setCommentBody('');
    } catch (err) {
      console.error('Failed to add comment:', err);
      alert(err.response?.data?.error || 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddReply = async (parentCommentId) => {
    if (!replyBody.trim() || replySubmitting) return;
    try {
      setReplySubmitting(true);
      const res = await pagesAPI.addComment(slug, replyBody.trim(), parentCommentId);
      setComments(prev => prev.map(c => {
        if (c.id !== parentCommentId) return c;
        return { ...c, replies: [...(c.replies || []), res.data.comment] };
      }));
      setReplyBody('');
      setReplyingTo(null);
    } catch (err) {
      console.error('Failed to add reply:', err);
      alert(err.response?.data?.error || 'Failed to add reply');
    } finally {
      setReplySubmitting(false);
    }
  };

  // Toggle vote — searches both top-level and nested replies
  const toggleVoteInList = (list, commentId) => list.map(c => {
    if (c.id === commentId) {
      const newVoted = !c.userVoted;
      return { ...c, userVoted: newVoted, voteCount: c.voteCount + (newVoted ? 1 : -1) };
    }
    if (c.replies && c.replies.length > 0) {
      return { ...c, replies: toggleVoteInList(c.replies, commentId) };
    }
    return c;
  });

  const handleToggleVote = async (commentId) => {
    setComments(prev => toggleVoteInList(prev, commentId));

    try {
      await pagesAPI.toggleCommentVote(commentId);
    } catch (err) {
      console.error('Failed to toggle vote:', err);
      // Revert
      setComments(prev => toggleVoteInList(prev, commentId));
    }
  };

  const formatRelativeTime = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffMonths / 12)}y ago`;
  };

  const renderComment = (comment, isReply = false) => (
    <div key={comment.id} style={isReply ? styles.reply : styles.comment}>
      <div style={styles.commentVoteCol}>
        {!isGuest ? (
          <button
            style={{
              ...styles.voteButton,
              color: comment.userVoted ? '#333' : '#ccc',
            }}
            onClick={() => handleToggleVote(comment.id)}
            title={comment.userVoted ? 'Remove vote' : 'Vote'}
          >
            {comment.userVoted ? '\u25B2' : '\u25B3'}
          </button>
        ) : (
          <span style={styles.voteIcon}>{'\u25B3'}</span>
        )}
        <span style={styles.voteCount}>{comment.voteCount}</span>
      </div>
      <div style={styles.commentBody}>
        <div style={styles.commentMeta}>
          <span style={styles.commentUsername}>{comment.username}</span>
          <span style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</span>
        </div>
        <p style={styles.commentText}>{comment.body}</p>
        {!isGuest && !isReply && (
          <button
            style={styles.replyLink}
            onClick={() => {
              setReplyingTo(replyingTo === comment.id ? null : comment.id);
              setReplyBody('');
            }}
          >
            {replyingTo === comment.id ? 'Cancel' : 'Reply'}
          </button>
        )}
      </div>
    </div>
  );

  const renderCommentsSection = () => (
    <div style={isTwoCol ? styles.commentsSectionTwoCol : styles.commentsSection}>
      <h2 style={styles.commentsHeading}>{commentsHeading}</h2>

      {isGuest && (
        <p style={styles.loginNote}>Log in to add comments and vote.</p>
      )}

      {!isGuest && (
        <div style={styles.addComment}>
          <textarea
            style={styles.textarea}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            placeholder="Add a comment..."
            maxLength={2000}
            rows={3}
          />
          <button
            style={{
              ...styles.addButton,
              opacity: submitting || !commentBody.trim() ? 0.5 : 1,
            }}
            onClick={handleAddComment}
            disabled={submitting || !commentBody.trim()}
          >
            {submitting ? 'Adding...' : 'Add Comment'}
          </button>
        </div>
      )}

      {loading ? (
        <p style={styles.loadingText}>Loading comments...</p>
      ) : comments.length === 0 ? (
        <p style={styles.emptyText}>No comments yet.</p>
      ) : (
        <div style={styles.commentList}>
          {comments.map(comment => (
            <div key={comment.id}>
              {renderComment(comment)}

              {/* Inline reply form */}
              {replyingTo === comment.id && (
                <div style={styles.replyForm}>
                  <textarea
                    style={styles.replyTextarea}
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder="Write a reply..."
                    maxLength={2000}
                    rows={2}
                    autoFocus
                  />
                  <div style={styles.replyFormButtons}>
                    <button
                      style={{
                        ...styles.replySubmitButton,
                        opacity: replySubmitting || !replyBody.trim() ? 0.5 : 1,
                      }}
                      onClick={() => handleAddReply(comment.id)}
                      disabled={replySubmitting || !replyBody.trim()}
                    >
                      {replySubmitting ? 'Replying...' : 'Reply'}
                    </button>
                    <button
                      style={styles.replyCancelButton}
                      onClick={() => { setReplyingTo(null); setReplyBody(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div style={styles.repliesContainer}>
                  {comment.replies.map(reply => renderComment(reply, true))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Two-column layout for using-orca ────
  if (isTwoCol) {
    return (
      <div style={styles.container}>
        <div style={styles.twoColWrapper}>
          <div style={styles.leftCol}>
            <h1 style={styles.pageTitle}>{title}</h1>
            {isUsingOrca && <UsingOrcaContent onImageClick={setLightbox} />}
          </div>
          <div style={styles.rightCol}>
            {renderCommentsSection()}
          </div>
        </div>

        {lightbox && (() => {
          const slide = lightbox.slides[lightbox.index];
          const hasMultiple = lightbox.slides.length > 1;
          const canPrev = lightbox.index > 0;
          const canNext = lightbox.index < lightbox.slides.length - 1;
          return (
            <div style={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
              <div style={styles.lightboxContent} onClick={e => e.stopPropagation()}>
                <img
                  src={slide.image}
                  alt="Expanded view"
                  style={styles.lightboxImage}
                />
                {slide.caption && (
                  <p style={styles.lightboxCaption}>{slide.caption}</p>
                )}
                {hasMultiple && (
                  <div style={styles.lightboxControls}>
                    <button
                      style={{ ...styles.lightboxArrow, opacity: canPrev ? 1 : 0.3 }}
                      onClick={() => canPrev && setLightbox(prev => ({ ...prev, index: prev.index - 1 }))}
                      disabled={!canPrev}
                    >{'\u2190'}</button>
                    <span style={styles.lightboxIndicator}>
                      {lightbox.index + 1} of {lightbox.slides.length}
                    </span>
                    <button
                      style={{ ...styles.lightboxArrow, opacity: canNext ? 1 : 0.3 }}
                      onClick={() => canNext && setLightbox(prev => ({ ...prev, index: prev.index + 1 }))}
                      disabled={!canNext}
                    >{'\u2192'}</button>
                  </div>
                )}
                <button
                  style={styles.lightboxClose}
                  onClick={() => setLightbox(null)}
                >{'\u00D7'}</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ── Single-column layout (fallback) ───────
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.pageTitle}>{title}</h1>
        <p style={styles.placeholder}>This page is under construction. Content coming soon.</p>

        <div style={styles.commentsSection}>
          <h2 style={styles.commentsHeading}>{commentsHeading}</h2>

          {isGuest && (
            <p style={styles.loginNote}>Log in to add comments and vote.</p>
          )}

          {!isGuest && (
            <div style={styles.addComment}>
              <textarea
                style={styles.textarea}
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                maxLength={2000}
                rows={3}
              />
              <button
                style={{
                  ...styles.addButton,
                  opacity: submitting || !commentBody.trim() ? 0.5 : 1,
                }}
                onClick={handleAddComment}
                disabled={submitting || !commentBody.trim()}
              >
                {submitting ? 'Adding...' : 'Add Comment'}
              </button>
            </div>
          )}

          {loading ? (
            <p style={styles.loadingText}>Loading comments...</p>
          ) : comments.length === 0 ? (
            <p style={styles.emptyText}>No comments yet.</p>
          ) : (
            <div style={styles.commentList}>
              {comments.map(comment => (
                <div key={comment.id}>
                  {renderComment(comment)}

                  {/* Inline reply form */}
                  {replyingTo === comment.id && (
                    <div style={styles.replyForm}>
                      <textarea
                        style={styles.replyTextarea}
                        value={replyBody}
                        onChange={e => setReplyBody(e.target.value)}
                        placeholder="Write a reply..."
                        maxLength={2000}
                        rows={2}
                        autoFocus
                      />
                      <div style={styles.replyFormButtons}>
                        <button
                          style={{
                            ...styles.replySubmitButton,
                            opacity: replySubmitting || !replyBody.trim() ? 0.5 : 1,
                          }}
                          onClick={() => handleAddReply(comment.id)}
                          disabled={replySubmitting || !replyBody.trim()}
                        >
                          {replySubmitting ? 'Replying...' : 'Reply'}
                        </button>
                        <button
                          style={styles.replyCancelButton}
                          onClick={() => { setReplyingTo(null); setReplyBody(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Replies */}
                  {comment.replies && comment.replies.length > 0 && (
                    <div style={styles.repliesContainer}>
                      {comment.replies.map(reply => renderComment(reply, true))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    height: '100%',
    overflowY: 'auto',
    backgroundColor: '#faf9f7',
  },
  // ── Single-column (fallback) ───────────────
  content: {
    maxWidth: '680px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  // ── Two-column (using-orca) ────────────────────────────
  twoColWrapper: {
    display: 'flex',
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '40px 12px',
    gap: '32px',
    alignItems: 'flex-start',
  },
  leftCol: {
    flex: '1 1 0',
    minWidth: 0,
  },
  rightCol: {
    width: '340px',
    flexShrink: 0,
    position: 'sticky',
    top: '20px',
    alignSelf: 'flex-start',
  },
  // ── Lightbox ────────────────────────────────────────────
  lightboxOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    cursor: 'pointer',
  },
  lightboxContent: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '90vw',
    maxHeight: '90vh',
    cursor: 'default',
  },
  lightboxImage: {
    maxWidth: '90vw',
    maxHeight: '70vh',
    border: '1px solid #e0e0e0',
    display: 'block',
  },
  lightboxCaption: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#ddd',
    lineHeight: '1.5',
    marginTop: '12px',
    maxWidth: '700px',
    textAlign: 'center',
  },
  lightboxControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginTop: '12px',
  },
  lightboxArrow: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#ddd',
    padding: '4px 12px',
    lineHeight: 1,
  },
  lightboxIndicator: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
  },
  lightboxClose: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    background: 'none',
    border: 'none',
    color: '#ddd',
    fontSize: '28px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: '4px 8px',
  },
  // ── Shared styles ──────────────────────────────────────
  pageTitle: {
    fontSize: '28px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
  },
  placeholder: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    lineHeight: '1.6',
    margin: '0 0 40px 0',
  },
  commentsSection: {
    borderTop: '1px solid #e8e6e2',
    paddingTop: '24px',
  },
  commentsSectionTwoCol: {
    paddingTop: '0',
  },
  commentsHeading: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
  },
  loginNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    margin: '0 0 16px 0',
  },
  addComment: {
    marginBottom: '24px',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: 'white',
    color: '#333',
  },
  addButton: {
    marginTop: '8px',
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  loadingText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  emptyText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  commentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  comment: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    backgroundColor: 'white',
    border: '1px solid #eee',
    borderRadius: '4px',
  },
  commentVoteCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '28px',
    flexShrink: 0,
  },
  voteButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px',
    lineHeight: 1,
  },
  voteIcon: {
    fontSize: '14px',
    color: '#ccc',
    lineHeight: 1,
  },
  voteCount: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginTop: '2px',
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  commentUsername: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  commentTime: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  commentText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#444',
    lineHeight: '1.5',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  replyLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    padding: '4px 0 0 0',
  },
  replyForm: {
    marginTop: '8px',
    marginLeft: '40px',
  },
  replyTextarea: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: 'white',
    color: '#333',
  },
  replyFormButtons: {
    display: 'flex',
    gap: '8px',
    marginTop: '6px',
  },
  replySubmitButton: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  replyCancelButton: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#999',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  repliesContainer: {
    marginTop: '8px',
    marginLeft: '40px',
    borderLeft: '2px solid #eee',
    paddingLeft: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  reply: {
    display: 'flex',
    gap: '10px',
    padding: '8px',
  },
};

export default InfoPage;
