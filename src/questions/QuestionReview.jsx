import { CheckCircle2, Lightbulb, UserCheck, XCircle } from 'lucide-react';

import { EmptyState } from '../components/ui';
import { Flowchart } from './Flowchart';
import { CodeSnippet } from './PythonRunner';

function ChoiceReview({ item, revealed }) {
  const selected = item.selectedOptionIds ?? [];
  const correct = item.correctOptionIds ?? [];
  const plain = item.format === 'true_false' || item.format === 'yes_no';
  return (
    <ul className="review-options">
      {(item.options ?? []).map((option) => {
        const chosen = selected.includes(option.id);
        const right = revealed && correct.includes(option.id);
        return (
          <li key={option.id} className={`${chosen ? 'is-chosen' : ''} ${right ? 'is-right' : ''} ${revealed && chosen && !right ? 'is-wrong' : ''}`}>
            <span className="option-letter">{plain ? option.text[0] : option.id}</span>
            <span className="grow">{option.text}</span>
            {chosen ? <span className="badge">Your answer</span> : null}
            {right ? <span className="badge badge-success">Correct</span> : null}
          </li>
        );
      })}
      {!selected.length ? <li className="muted">No answer chosen.</li> : null}
    </ul>
  );
}

function OrderReview({ item, revealed }) {
  const textById = new Map((item.items ?? []).map((entry) => [entry.id, entry.text]));
  const list = (ids) => (
    <ol className="review-steps">
      {ids.map((id, index) => (
        <li key={`${id}-${index}`}>{textById.get(id)}</li>
      ))}
    </ol>
  );
  return (
    <div className={revealed ? 'review-columns' : ''}>
      <div>
        <span className="review-label">Your order</span>
        {item.selectedOrder?.length ? list(item.selectedOrder) : <p className="muted">No answer.</p>}
      </div>
      {revealed ? (
        <div>
          <span className="review-label">Correct order</span>
          {list(item.correctOrder ?? [])}
        </div>
      ) : null}
    </div>
  );
}

function FlowchartReview({ item, revealed }) {
  const chosen = item.selectedSlotTexts ?? [];
  return (
    <Flowchart
      nodes={item.flowchart?.nodes ?? []}
      renderBlank={(node) => {
        const mine = chosen[node.slot] ?? '';
        const right = revealed && mine === node.text;
        return (
          <span className={`fc-answer ${revealed ? (right ? 'is-right' : 'is-wrong') : ''}`}>
            <span>{mine || '(left empty)'}</span>
            {revealed && !right ? <small>Correct: {node.text}</small> : null}
          </span>
        );
      }}
    />
  );
}

function CodeReview({ item, revealed }) {
  const checks = item.checks;
  return (
    <div className="stack" style={{ '--stack-gap': '0.5rem' }}>
      <span className="review-label">Your program</span>
      {item.studentCode?.trim() ? <CodeSnippet code={item.studentCode} sampleInput={item.codeSampleInput} /> : <p className="muted">No program written.</p>}
      {revealed ? (
        <p className="small muted">
          {checks ? `Automatic checks passed: ${checks.passed} of ${checks.total}.` : 'The automatic checks did not run for this program.'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Review of answered questions. Items come from the server; when corrections are not released
 * yet (`item.isCorrect === null`) only the student's own answers are shown.
 * `renderActions(item)` lets the admin add controls (mark overrides) to each question.
 */
export function QuestionReviewList({ items, renderActions }) {
  if (!items?.length) {
    return <EmptyState title="No review available">This attempt has no answers to review.</EmptyState>;
  }

  return (
    <ol className="review-list">
      {items.map((item) => {
        const revealed = item.isCorrect === true || item.isCorrect === false;
        const type = item.type ?? 'single';
        return (
          <li key={item.questionId ?? item.index} className={`review-card ${revealed ? (item.isCorrect ? 'is-correct' : 'is-wrong') : ''}`}>
            <div className="review-head">
              <span className="q-index">{item.index}</span>
              <span className="review-kind">{item.typeLabel ?? 'Question'}</span>
              <span className="grow" />
              {item.manualGrade !== null && item.manualGrade !== undefined ? (
                <span className="badge badge-gold">
                  <UserCheck aria-hidden="true" /> Marked by teacher
                </span>
              ) : null}
              {revealed ? (
                item.isCorrect ? (
                  <span className="badge badge-success">
                    <CheckCircle2 aria-hidden="true" /> Correct
                  </span>
                ) : (
                  <span className="badge badge-danger">
                    <XCircle aria-hidden="true" /> Incorrect
                  </span>
                )
              ) : null}
            </div>
            <p className="q-text">{item.text}</p>
            {item.code && type !== 'code' ? <CodeSnippet code={item.code} language={item.codeLanguage} sampleInput={item.codeSampleInput} runnable={false} /> : null}
            {type === 'order' ? (
              <OrderReview item={item} revealed={revealed} />
            ) : type === 'flowchart' ? (
              <FlowchartReview item={item} revealed={revealed} />
            ) : type === 'code' ? (
              <CodeReview item={item} revealed={revealed} />
            ) : (
              <ChoiceReview item={item} revealed={revealed} />
            )}
            {revealed && item.explanation ? (
              <p className="review-why">
                <Lightbulb aria-hidden="true" />
                <span>{item.explanation}</span>
              </p>
            ) : null}
            {renderActions ? <div className="review-actions">{renderActions(item)}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}
