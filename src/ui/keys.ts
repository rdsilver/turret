/**
 * Keyboard helpers.
 *
 * Phaser 4's KeyboardPlugin re-dispatches the whole per-frame key queue on
 * every DOM key event (the queue is only cleared at POST_STEP, and only the
 * immediately preceding event is de-duplicated). With three or more key events
 * in one frame, an earlier keydown reaches 'keydown' listeners again with
 * `repeat === false`. Wrap any listener whose action is not idempotent
 * (confirm-twice buttons, toggles, skip-then-continue) with `onceEach`.
 */

/**
 * Returns a listener that calls `fn` at most once per KeyboardEvent object.
 * Each wrapper has its own memory, so several listeners can each see the same
 * event once.
 */
export function onceEach<E extends KeyboardEvent>(fn: (e: E) => void): (e: E) => void {
  const seen = new WeakSet<KeyboardEvent>();
  return (e: E): void => {
    if (seen.has(e)) return;
    seen.add(e);
    fn(e);
  };
}
