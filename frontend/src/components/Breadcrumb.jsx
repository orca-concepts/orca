import React, { useState, useEffect } from 'react';
import { conceptsAPI } from '../services/api';

const Breadcrumb = ({ path, currentConcept, currentAttribute, onBreadcrumbClick }) => {
  const [conceptNames, setConceptNames] = useState({});
  
  useEffect(() => {
    // Fetch names for all concepts in path (except the current one)
    const fetchNames = async () => {
      if (path.length <= 1) return; // Only current concept, no need to fetch
      
      const idsToFetch = path.slice(0, -1); // Exclude current concept
      if (idsToFetch.length === 0) return;
      
      try {
        const response = await conceptsAPI.getConceptNames(idsToFetch.join(','));
        const nameMap = {};
        response.data.concepts.forEach(c => {
          nameMap[c.id] = c.name;
        });
        setConceptNames(nameMap);
      } catch (error) {
        console.error('Failed to fetch concept names:', error);
      }
    };
    
    fetchNames();
  }, [path]);
  
  const truncateName = (name, maxLength = 20) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength) + '...';
  };
  
  return (
    <div style={styles.breadcrumb}>
      <span 
        style={styles.crumb}
        onClick={() => onBreadcrumbClick(0)}
      >
        Root
      </span>
      
      {path.slice(0, -1).map((conceptId, index) => {
        const fullName = conceptNames[conceptId] || `Concept ${conceptId}`;
        const displayName = truncateName(fullName);
        
        return (
          <React.Fragment key={conceptId}>
            <span style={styles.separator}>/</span>
            <span 
              style={styles.crumb}
              onClick={() => onBreadcrumbClick(index + 1)}
              title={fullName}
            >
              {displayName}
            </span>
          </React.Fragment>
        );
      })}
      
      {currentConcept && (
        <>
          <span style={styles.separator}>/</span>
          <span
            style={styles.currentCrumb}
            title={currentConcept.name}
          >
            {truncateName(currentConcept.name)}
          </span>
        </>
      )}
    </div>
  );
};

const styles = {
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    flexWrap: 'wrap',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  crumb: {
    color: '#333',
    cursor: 'pointer',
    textDecoration: 'underline',
    position: 'relative',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  currentCrumb: {
    color: '#333',
    fontWeight: '500',
    position: 'relative',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  separator: {
    color: '#999',
  },
  attributeTag: {
    color: '#888',
    fontWeight: '400',
    fontSize: '13px',
  },
};

export default Breadcrumb;
