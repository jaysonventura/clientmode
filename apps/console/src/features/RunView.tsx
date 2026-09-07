import React from 'react';

/** One client-visible line. Model text arrives as data and is rendered as text: React escapes
 * it, and nothing here uses dangerouslySetInnerHTML. */
export type ConsoleEvent = { sequence: number; kind: string; client_text: string | null; payload: Record<string, unknown> };

export type RunViewProps = {
  status: string;
  events: ConsoleEvent[];
  question: { question_id: string; prompt: string; recommendation: string | null; state_version: number } | null;
  busy: boolean;
  onAnswer: (text: string) => void;
  onMessage: (text: string) => void;
  onCancel: () => void;
};

export function RunView(props: RunViewProps): React.ReactElement {
  const [answer, setAnswer] = React.useState('');
  const [message, setMessage] = React.useState('');
  const visible = props.events.filter(event => event.client_text !== null);

  return (
    <main>
      <h1>Your project</h1>
      <p className="muted" data-testid="status" role="status">{props.status}</p>

      {props.question !== null && (
        <section className="card question" aria-labelledby="question-heading">
          <h2 id="question-heading">One question</h2>
          <p data-testid="question-prompt">{props.question.prompt}</p>
          {props.question.recommendation !== null && (
            <p className="muted">Suggestion: {props.question.recommendation}</p>
          )}
          <label htmlFor="answer-input">Your answer</label>
          <textarea id="answer-input" data-testid="answer-input" value={answer}
            onChange={event => setAnswer(event.target.value)} />
          <button type="button" data-testid="send-answer" onClick={() => { props.onAnswer(answer); setAnswer(''); }}>
            Send answer
          </button>
        </section>
      )}

      <section aria-labelledby="messages-heading">
        <h2 id="messages-heading">Updates</h2>
        {visible.length === 0
          ? <p className="muted" data-testid="no-updates">Nothing needs you right now.</p>
          : (
            <ul className="messages" data-testid="messages">
              {visible.map(event => (
                <li key={event.sequence} data-kind={event.kind}>{event.client_text}</li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="say-heading">
        <h2 id="say-heading">Tell us anything</h2>
        <label htmlFor="message-input">New instruction or feedback</label>
        <textarea id="message-input" data-testid="message-input" value={message}
          onChange={event => setMessage(event.target.value)} />
        <button type="button" data-testid="send-message" onClick={() => { props.onMessage(message); setMessage(''); }}>
          Send
        </button>
        <button type="button" className="secondary" data-testid="cancel" onClick={props.onCancel}>
          Cancel this work
        </button>
        {props.busy && <p className="muted" data-testid="busy">Work is running. You can still type and cancel.</p>}
      </section>

      <details className="drawer">
        <summary data-testid="drawer-toggle">Engineering detail</summary>
        <pre data-testid="drawer">{props.events.map(event => `${event.sequence} ${event.kind}`).join('\n')}</pre>
      </details>
    </main>
  );
}
