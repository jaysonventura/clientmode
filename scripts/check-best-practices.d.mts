export interface Snapshot { headings: string[]; levels: number[]; sha256: string }
export interface Drift { changed: boolean; added: string[]; removed: string[] }
export const SOURCE: string;
export function snapshot(markdown: string): Snapshot;
export function compare(before: Snapshot, after: Snapshot): Drift;
export function practices(recorded: Pick<Snapshot, 'headings' | 'levels'>): string[];
export function uncovered(recorded: Pick<Snapshot, 'headings' | 'levels'>, table: string): string[];
