import React, { useState } from 'react';

const OrcidBadge = ({ orcidId }) => {
  const [hovered, setHovered] = useState(false);

  if (!orcidId) return null;

  return (
    <a
      href={`https://orcid.org/${orcidId}`}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-block',
        fontSize: '10px',
        fontWeight: '700',
        fontFamily: 'sans-serif',
        padding: '1px 3px',
        borderRadius: '2px',
        marginLeft: '4px',
        verticalAlign: 'middle',
        textDecoration: 'none',
        lineHeight: '1.2',
        border: '1px solid #a6ce39',
        backgroundColor: hovered ? '#a6ce39' : 'transparent',
        color: hovered ? '#fff' : '#a6ce39',
        cursor: 'pointer',
        transition: 'background-color 0.15s, color 0.15s',
      }}
      title={`ORCID ${orcidId}`}
    >
      iD
    </a>
  );
};

export default OrcidBadge;
