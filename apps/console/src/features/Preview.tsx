import React from 'react';

/** The preview card. It shows the five statuses as separate facts and refuses to render a
 * preview link for a candidate that has not passed protected verification.
 */
export type PreviewState =
  | { bound: true; preview_url: string; candidate_id: string; evidence_id: string; scope: string[]; unverified: string[] }
  | { bound: false; reasons: string[] };

export type PreviewProps = {
  preview: PreviewState;
  /** Written by the client, or not at all. */
  satisfaction: 'not_recorded' | 'needs_changes' | 'accepted';
  onFeedback: (message: string, satisfaction: 'needs_changes' | 'accepted') => void;
};

export function Preview(props: PreviewProps): React.ReactElement {
  const [message, setMessage] = React.useState('');

  if (!props.preview.bound) {
    return (
      <section className="card blocker" aria-labelledby="preview-heading">
        <h2 id="preview-heading">Nothing to preview yet</h2>
        <p data-testid="preview-blocked">
          There is no verified build to show. {props.preview.reasons.join('; ')}
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="preview-heading">
      <h2 id="preview-heading">Have a look</h2>
      <p>
        <a data-testid="preview-link" href={props.preview.preview_url} target="_blank" rel="noreferrer noopener">
          Open the preview
        </a>
      </p>
      <p className="muted" data-testid="preview-scope">
        Checked on this build: {props.preview.scope.join(', ')}.
      </p>
      {props.preview.unverified.length > 0 && (
        <p className="muted" data-testid="preview-unverified">
          Not checked yet: {props.preview.unverified.join('; ')}. The rest is unaffected.
        </p>
      )}
      <p className="muted" data-testid="satisfaction">
        {props.satisfaction === 'not_recorded'
          ? 'You have not said what you think of this yet.'
          : `You said: ${props.satisfaction.replace('_', ' ')}.`}
      </p>

      <label htmlFor="feedback-input">What do you think?</label>
      <textarea id="feedback-input" data-testid="feedback-input" value={message}
        onChange={event => setMessage(event.target.value)} />
      <button type="button" data-testid="feedback-changes" onClick={() => { props.onFeedback(message, 'needs_changes'); setMessage(''); }}>
        Send changes
      </button>
      <button type="button" className="secondary" data-testid="feedback-accept" onClick={() => { props.onFeedback(message, 'accepted'); setMessage(''); }}>
        This is good
      </button>
    </section>
  );
}
