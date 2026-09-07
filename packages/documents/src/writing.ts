/** Technical writing that is checked against the running thing.
 *
 * Documentation is written from the implementation's observed behaviour, not from what it was
 * meant to do. A claimed working example is executed against the target version in a
 * disposable environment, and the version is recorded with the result. A snippet that does not
 * run is a documentation defect, and correcting the document from the observation is the fix.
 */
export type SnippetExecution = {
  snippet_id: string;
  request: string;
  target_version: string | null;
  status: number | null;
  body: unknown;
  executed: boolean;
  matches_documentation: boolean;
  detail: string;
};

export type DocumentationDefect = {
  snippet_id: string;
  documented: string;
  observed: string;
  correction: string;
};

/** Runs a documented example against the live service and compares it with what the
 * documentation claims. Nothing here trusts the document. */
export async function executeSnippet(input: {
  snippet_id: string; base_url: string; path_and_query: string;
  expected_status: number; expected_body_contains?: string;
}): Promise<SnippetExecution> {
  try {
    const response = await fetch(`${input.base_url}${input.path_and_query}`);
    const body: unknown = await response.json();
    const target_version = response.headers.get('x-service-version');
    const serialised = JSON.stringify(body);
    const matches = response.status === input.expected_status &&
      (input.expected_body_contains === undefined || serialised.includes(input.expected_body_contains));
    return {
      snippet_id: input.snippet_id, request: input.path_and_query, target_version,
      status: response.status, body, executed: true, matches_documentation: matches,
      detail: matches ? 'the documented example behaves as documented' : `observed ${String(response.status)} ${serialised.slice(0, 120)}`,
    };
  } catch (error) {
    return {
      snippet_id: input.snippet_id, request: input.path_and_query, target_version: null,
      status: null, body: null, executed: false, matches_documentation: false,
      detail: `EXECUTION_FAILED:${String((error as Error).message).slice(0, 120)}`,
    };
  }
}

/** Rewrites the documented parameter from what the implementation actually accepted. */
export function correctDocumentation(input: {
  documentation: string; defects: readonly DocumentationDefect[];
}): { text: string; applied: DocumentationDefect[] } {
  let text = input.documentation;
  const applied: DocumentationDefect[] = [];
  for (const defect of input.defects) {
    if (!text.includes(defect.documented)) continue;
    text = text.split(defect.documented).join(defect.observed);
    applied.push(defect);
  }
  return { text, applied };
}
