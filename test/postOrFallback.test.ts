// Copyright 2026 The MathWorks, Inc.
//
// The read-only table's way out when a payload of every name is too large to post
// (host: postPayload.ts, used by BinaryEditorProvider).
//
// The plan now delivers every top-level name (everyNameDelivered.test.ts), so a payload is
// bounded by the file and no longer by the 100,000-row cap. That cap was what kept a payload
// under V8's maximum string length, the point where `postMessage`'s `JSON.stringify` rejects.
// A JSON dictionary near the reader's 512 MB limit would be about a million rows of about
// 500 bytes each, which is over it. Without a fallback that file would show "Failed to show"
// where it used to show 100,000 rows. So the provider offers a smaller payload: the first
// 100,000 rows with the cap's banner, posted only when the whole one is refused.
//
// Through a fake webview, because the decision is this function's. The provider's use of it
// is driven through the real provider in the integration suite (everyNameDelivered.test.ts).
import { describe, expect, it, vi } from 'vitest';
import * as postPayload from '../src/host/postPayload.js';

const whole = { type: 'setRows', rows: ['a', 'b', 'c'] };
const capped = { type: 'setRows', rows: ['a'], warnings: { headline: 'first 1 of 3', details: [] } };

describe('postOrFallback', () => {
  it('posts the payload once, and never builds the fallback, when it goes out', async () => {
    const postMessage = vi.fn().mockResolvedValue(true);
    const fallback = vi.fn(() => capped);
    await expect(postPayload.postOrFallback({ postMessage }, whole, fallback, 'big.sldd')).resolves.toBe(true);
    expect(postMessage.mock.calls.map((c) => c[0])).toEqual([whole]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('posts the fallback when the payload is refused, and counts that as delivered', async () => {
    // The rejection is the one `postMessage` gives a payload over V8's string limit.
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockResolvedValue(true);
    await expect(postPayload.postOrFallback({ postMessage }, whole, () => capped, 'big.sldd')).resolves.toBe(true);
    expect(postMessage.mock.calls.map((c) => c[0])).toEqual([whole, capped]);
  });

  it('reports when the fallback is refused too, so the view does not hang', async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockResolvedValue(true);
    await expect(postPayload.postOrFallback({ postMessage }, whole, () => capped, 'big.sldd')).resolves.toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls[2][0]).toEqual({
      type: 'error',
      message: 'Failed to show big.sldd: Invalid string length',
    });
  });

  it('reports straight away when there is nothing smaller to offer', async () => {
    // A payload already under the cap has no smaller version; posting it again would fail
    // the same way.
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockResolvedValue(true);
    await expect(postPayload.postOrFallback({ postMessage }, whole, () => undefined, 'big.sldd')).resolves.toBe(false);
    expect(postMessage.mock.calls.map((c) => c[0].type)).toEqual(['setRows', 'error']);
  });

  it('reports the first failure when building the fallback throws', async () => {
    // Still a post, so the view's wait ends: an exception here would be the spinner again.
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new RangeError('Invalid string length'))
      .mockResolvedValue(true);
    const fallback = () => {
      throw new Error('no rows');
    };
    await expect(postPayload.postOrFallback({ postMessage }, whole, fallback, 'big.sldd')).resolves.toBe(false);
    expect(postMessage.mock.calls[1][0]).toEqual({
      type: 'error',
      message: 'Failed to show big.sldd: Invalid string length',
    });
  });
});
