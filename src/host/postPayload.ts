// Copyright 2026 The MathWorks, Inc.
//
// Posting a payload to a table webview so that a payload which cannot be posted is
// REPORTED instead of swallowed.
//
// `vscode.Webview.postMessage` is an `async` method, and it serializes the message
// with `JSON.stringify` inside itself. Both halves matter together: the serialize
// can fail (a payload over V8's maximum string length throws `RangeError: Invalid
// string length`), and because the method is async that failure comes back as a
// rejected promise rather than a throw. Every provider here posts without awaiting —
// a repaint is fire-and-forget by nature — so the rejection had no handler, VS Code
// logged it to the extension host output nobody has open, and the view sat on its
// loading spinner for ever waiting for the message that had already failed.
//
// The spinner is the part that makes this worth its own module. A table's wait ends
// on `setRows` or on `error` and on nothing else, so a post that fails silently is
// not a degraded view, it is a permanently hung one. `error` is the message the
// webview already knows how to end the wait with (see table-main.ts), so the whole
// fix is to send it on the path that used to send nothing.
//
// Structurally typed rather than taking a `vscode.Webview`, so the rule is testable
// without a live vscode — same split as parseWarnings.ts and rowCap.ts.

/** The one method of a webview this needs. */
export interface PostTarget {
  postMessage(message: unknown): Thenable<boolean>;
}

/**
 * Post a payload; on failure, post the error banner instead.
 *
 * Returns whether the payload itself went out, for a caller that has follow-up work
 * only a delivered payload makes sense of (a selection to drain, a grid to reopen).
 *
 * `what` names the file, because the sentence the user reads has to say which tab
 * failed — the view it appears in may not be the one they were last looking at.
 *
 * A failure to deliver the FALLBACK is swallowed: it means the webview is gone (a
 * closed tab, a disposed panel), there is nothing left to tell, and an unhandled
 * rejection thrown from the handler of an unhandled rejection is how a reported bug
 * becomes two.
 */
export async function postOrReport(webview: PostTarget, payload: unknown, what: string): Promise<boolean> {
  try {
    await webview.postMessage(payload);
    return true;
  } catch (err) {
    try {
      await webview.postMessage({
        type: 'error',
        message: `Failed to show ${what}: ${(err as Error)?.message ?? String(err)}`,
      });
    } catch {
      // The webview is gone; nothing to report to.
    }
    return false;
  }
}
