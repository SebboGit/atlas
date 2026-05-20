// Client-safe barrel: types only. Repo and actions live at their own
// paths so they aren't pulled into client bundles.
export type { Document, DocumentWithLinks, LinkedDocument } from './repo';
