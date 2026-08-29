// Tiny store coordinating the global BugReportButton modal with
// callers from elsewhere in the app (notably +error.svelte's
// "report this error" link and any future "report" entry points
// from inside features). Using a writable so callers can request
// the modal open WITH a prefilled errorId, instead of having to
// reach into a component ref.

import { writable } from "svelte/store";

export type BugReportRequest = {
  open: boolean;
  errorId?: string;
  // Optional starter text for the title field, e.g. an error
  // message that prompted the report.
  prefillTitle?: string;
};

export const bugReportRequest = writable<BugReportRequest>({ open: false });

export function openBugReport(opts: { errorId?: string; prefillTitle?: string } = {}) {
  bugReportRequest.set({ open: true, errorId: opts.errorId, prefillTitle: opts.prefillTitle });
}

export function closeBugReport() {
  bugReportRequest.set({ open: false });
}
