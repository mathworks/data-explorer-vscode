// Copyright 2026 The MathWorks, Inc.
//
// What a webview test sees at the start of the next task after it delivers a message: the tool
// behind the "lands in the task that delivers it" pins (answersLandInTheirTask.test.ts,
// firstPaintEditingState.test.ts).
import { expect } from 'vitest';

/**
 * What `read` sees at the start of the next task after `act`: after every microtask `act` queued,
 * and before any task it queued. It is read twice, in a timer and in an immediate, both set BEFORE
 * `act`. happy-dom runs an animation frame as an immediate, and Node may run an immediate before
 * or after a timer, depending on the phase its loop is in. So the timer's read is ahead of any
 * timer `act` sets, and the immediate's ahead of any frame. The two have to agree.
 */
export function nextTask<T>(act: () => void, read: () => T): Promise<T> {
  const timer = new Promise<T>((resolve) => setTimeout(() => resolve(read()), 0));
  const immediate = new Promise<T>((resolve) => setImmediate(() => resolve(read())));
  act();
  return Promise.all([timer, immediate]).then(([inTimer, inImmediate]) => {
    expect(inImmediate, 'the same before a frame as before a timer').toEqual(inTimer);
    return inTimer;
  });
}
