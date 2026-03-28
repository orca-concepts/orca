import React from 'react';

// Curated named color palette — visually distinct, works on off-white background
// These are the ONLY colors in the UI besides black/white per design philosophy
const VOTE_SET_COLORS = [
  { name: 'Indigo', hex: '#4B0082' },
  { name: 'Teal', hex: '#008080' },
  { name: 'Crimson', hex: '#DC143C' },
  { name: 'Goldenrod', hex: '#DAA520' },
  { name: 'Forest', hex: '#228B22' },
  { name: 'Coral', hex: '#FF6F61' },
  { name: 'Slate', hex: '#6A5ACD' },
  { name: 'Sienna', hex: '#A0522D' },
  { name: 'Plum', hex: '#8E4585' },
  { name: 'Steel', hex: '#4682B4' },
  { name: 'Olive', hex: '#6B8E23' },
  { name: 'Rose', hex: '#C08081' },
];

export const getSetColor = (setIndex) => {
  const base = VOTE_SET_COLORS[setIndex % VOTE_SET_COLORS.length];
  const cycle = Math.floor(setIndex / VOTE_SET_COLORS.length);
  if (cycle === 0) return base;
  // Append A, B, C… suffix to disambiguate wrapped colors
  const suffix = String.fromCharCode(64 + cycle); // 1→A, 2→B, …
  return { ...base, name: `${base.name}${suffix}` };
};

const VoteSetBar = ({
  voteSets,
  activeSetIndices,
  onSetClick,
  tieredView,
  onTieredToggle,
  userSetIndex,
}) => {
  if (!voteSets || voteSets.length === 0) {
    return null;
  }

  const hasActiveFilters = activeSetIndices.length > 0;

  // Count total active filters for tiered toggle logic
  const totalActiveFilterCount = activeSetIndices.length;

  return (
    <div style={styles.container}>
      <div style={styles.label}>Vote patterns:</div>

      <div style={styles.barLayout}>
        {/* Individual swatch row */}
        <div style={styles.swatchRow}>
          {voteSets.map((set) => {
            const color = getSetColor(set.setIndex);
            const isActive = activeSetIndices.includes(set.setIndex);
            const isUserSet = set.setIndex === userSetIndex;

            return (
              <div key={set.setIndex} style={styles.swatchWrapper}>
                <button
                  style={{
                    ...styles.swatch,
                    backgroundColor: color.hex,
                    opacity: hasActiveFilters && !isActive ? 0.35 : 1,
                    outline: isActive ? `2px solid ${color.hex}` : 'none',
                    outlineOffset: '2px',
                    border: isUserSet ? '2px solid #333' : 'none',
                  }}
                  onClick={() => onSetClick(set.setIndex)}
                  title={isUserSet
                    ? `${color.name} — Your vote set · ${set.userCount} users voted for the same ${set.edgeIds.length} children`
                    : `${color.name} — ${set.userCount} users voted for the same ${set.edgeIds.length} children`}
                >
                  <span style={styles.swatchCount}>{set.userCount}</span>
                </button>
              </div>
            );
          })}

          {/* Tiered toggle and clear button */}
          {hasActiveFilters && (
            <>
              {totalActiveFilterCount >= 2 && (
                <button
                  style={{
                    ...styles.tieredButton,
                    ...(tieredView ? styles.tieredButtonActive : {}),
                  }}
                  onClick={onTieredToggle}
                  title={tieredView ? 'Switch to flat view' : 'Switch to tiered view'}
                >
                  ☰
                </button>
              )}
              <button
                style={styles.clearButton}
                onClick={() => onSetClick(null)}
                title="Clear filter"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  label: {
    fontSize: '13px',
    color: '#888',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontStyle: 'normal',
    paddingTop: '4px',
  },
  barLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  swatchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  swatchWrapper: {
    position: 'relative',
  },
  swatch: {
    width: '32px',
    height: '22px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.2s, outline 0.2s',
    padding: 0,
  },
  swatchCount: {
    color: 'white',
    fontSize: '11px',
    fontWeight: '600',
    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
  },
  tieredButton: {
    width: '24px',
    height: '22px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#888',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'all 0.2s',
  },
  tieredButtonActive: {
    backgroundColor: '#333',
    color: 'white',
    borderColor: '#333',
  },
  clearButton: {
    width: '24px',
    height: '22px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#888',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
};

export default VoteSetBar;
