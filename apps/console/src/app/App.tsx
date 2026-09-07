import React from 'react';
import { createRoot } from 'react-dom/client';
import { RunView, type ConsoleEvent } from '../features/RunView.js';
import '../styles/tokens.css';

type Boot = { run_id: string; bootstrap_secret: string; status: string };

/** The console talks to the controller on its own origin, with the CSRF token from the
 * session exchange. It never renders model text as markup. */
function App({ boot }: { boot: Boot }): React.ReactElement {
  const [events, setEvents] = React.useState<ConsoleEvent[]>([]);
  const [question, setQuestion] = React.useState<RunQuestion | null>(null);
  const [status, setStatus] = React.useState(boot.status);
  const [busy, setBusy] = React.useState(true);
  const [csrf, setCsrf] = React.useState('');

  // The console exchanges the one-time bootstrap secret for a short-lived local session; the
  // CSRF token it gets back is what every later mutation carries.
  React.useEffect(() => {
    void (async () => {
      const response = await fetch('/v1/session', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrap_secret: boot.bootstrap_secret, actor_id: 'owner' }),
      });
      if (response.ok) setCsrf(((await response.json()) as { csrf_token: string }).csrf_token);
    })();
  }, [boot.bootstrap_secret]);

  const refresh = React.useCallback(async () => {
    const stream = await fetch(`/v1/runs/${boot.run_id}/events?after=0`, { credentials: 'same-origin' });
    const text = await stream.text();
    const parsed = text.split('\n\n').filter(block => block.includes('data: '))
      .map(block => JSON.parse(block.slice(block.indexOf('data: ') + 6)) as ConsoleEvent);
    setEvents(parsed);
    const questions = await fetch(`/v1/runs/${boot.run_id}/questions`, { credentials: 'same-origin' });
    if (questions.ok) {
      const body = await questions.json() as { questions: RunQuestion[] };
      setQuestion(body.questions[0] ?? null);
    }
    const latest = parsed.filter(event => event.kind === 'readiness_changed').pop();
    if (latest !== undefined) setStatus(String(latest.payload['to'] ?? boot.status));
  }, [boot.run_id, boot.status]);

  // Nothing is fetched until the session exists: a request sent before the cookie arrives
  // is refused, and an empty first render would look like a quiet console rather than a
  // failed one.
  React.useEffect(() => { if (csrf !== '') void refresh(); }, [csrf, refresh]);

  const post = async (path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> =>
    fetch(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, ...extra },
      body: JSON.stringify(body),
    });

  return (
    <RunView
      status={status}
      events={events}
      question={question}
      busy={busy}
      onAnswer={text => {
        void (async () => {
          if (question === null) return;
          await post(`/v1/questions/${question.question_id}/answer`, { message: text },
            { 'idempotency-key': `answer-${question.question_id}`, 'if-match': String(question.state_version) });
          await refresh();
        })();
      }}
      onMessage={text => {
        void (async () => {
          await post(`/v1/runs/${boot.run_id}/messages`, { message: text },
            { 'idempotency-key': `message-${Date.now()}`, 'if-match': '1' });
          await refresh();
        })();
      }}
      onCancel={() => {
        void (async () => {
          const response = await post(`/v1/runs/${boot.run_id}/cancel`, {}, { 'idempotency-key': `cancel-${Date.now()}` });
          if (response.ok) {
            setBusy(false);
            setStatus('CANCELLED');
          }
        })();
      }}
    />
  );
}

type RunQuestion = { question_id: string; prompt: string; recommendation: string | null; state_version: number };

const element = document.getElementById('root');
const boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{}') as Boot;
if (element !== null) createRoot(element).render(<App boot={boot} />);
