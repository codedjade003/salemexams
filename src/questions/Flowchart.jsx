import { Fragment } from 'react';

const SHAPE_NAMES = {
  terminal: 'Start or stop (oval)',
  io: 'Input or output (parallelogram)',
  process: 'Process (rectangle)',
  decision: 'Decision (diamond)',
};

function FlowNode({ node, renderBlank }) {
  return (
    <div className={`fc-node fc-${node.shape} ${node.blank ? 'is-blank' : ''}`} title={SHAPE_NAMES[node.shape]}>
      <div className="fc-content">{node.blank ? renderBlank(node) : node.text}</div>
    </div>
  );
}

function Branch({ label, nodes, renderBlank }) {
  return (
    <div className="fc-branch">
      <span className="fc-branch-label">{label}</span>
      <span className="fc-arrow" aria-hidden="true" />
      {nodes.map((node, index) => (
        <Fragment key={node.id ?? index}>
          {index > 0 ? <span className="fc-arrow" aria-hidden="true" /> : null}
          <FlowNode node={node} renderBlank={renderBlank} />
        </Fragment>
      ))}
      {!nodes.length ? <span className="fc-empty">(nothing)</span> : null}
      <span className="fc-tail" aria-hidden="true" />
    </div>
  );
}

/**
 * Draws a flowchart from `nodes`: a top-to-bottom chain where a decision splits into a Yes and a
 * No branch that join again. `renderBlank(node)` supplies the content of blank shapes (a dropdown
 * while answering, the chosen text when reviewing).
 */
export function Flowchart({ nodes, renderBlank }) {
  return (
    <div className="fc" role="group" aria-label="Flowchart">
      {(nodes ?? []).map((node, index) => (
        <Fragment key={node.id ?? index}>
          {index > 0 ? <span className="fc-arrow" aria-hidden="true" /> : null}
          <FlowNode node={node} renderBlank={renderBlank} />
          {node.shape === 'decision' ? (
            <>
              <span className="fc-stem" aria-hidden="true" />
              <div className="fc-branches">
                <Branch label="Yes" nodes={node.yes ?? []} renderBlank={renderBlank} />
                <Branch label="No" nodes={node.no ?? []} renderBlank={renderBlank} />
              </div>
            </>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
