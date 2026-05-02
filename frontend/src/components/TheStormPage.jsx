import React from 'react';

const TheStormPage = () => {
  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>The Storm</h1>
      <p style={styles.body}>
        In her book How Emotions Are Made, Lisa Feldman Barrett describes our cognition as a ‘storm of predictions’, a vast and complex predictive model continuously built from conceptual hierarchies that ‘cascade’ from the abstract to the concrete in the unending task of predicting and constructing our experience. 

      </p>
      <p style={styles.body}>
        One can see these cascades as a unit of cognition, perhaps even of consciousness. They are building blocks, flexible and extensible enough to construct the complexity of our experience and by extension all the creations of our species; in a sense, they are our greatest tool. Their mechanism is category: the more abstract parent is a group which contains in some way the more concrete children, and so on all the way down the hierarchy. 

      </p>
      <p style={styles.body}>
        In the storm, these cascades are lightning that strikes from the abstract clouds to the concrete ground. Neatly and carefully packed ontologies are an underuse of our greatest tool and inhibit its ability to generate creation and understanding. Instead, we need a shared sixth sense for category. We need a looking glass that allows us to perceive the storm without distilling it. We need to see it for the chaotic mess that it is. 

      </p>
      <p style={styles.body}>
        <strong>orca</strong> is a system of categories: concept graphs in the domains of values, actions, tools, and questions related to research. You construct and maintain these graphs and use intricate means to connect them. The only rule is that the parent is more abstract than the child. Any concept can become an annotation on an uploaded research document, such that exploring the graphs exposes you to research material, unbounded by discipline or any category other than the one on which you are precisely focused. 

      </p>
      <p style={styles.body}>
        There is no algorithm, just the votes of other users; follow these traces of quality and see the ingredients of creative research through the lens of its fundamental categories. Use orca to find creativity in the maintenance of categories, which is the maintenance of abstraction and of thought; lean into the storm and embrace its chaos. 

      </p>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '760px',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: 1.6,
  },
  heading: {
    fontSize: '28px',
    fontWeight: 'normal',
    marginBottom: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  body: {
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default TheStormPage;
