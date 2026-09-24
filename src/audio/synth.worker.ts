/**
 * Off-main-thread sound synthesis. Receives a list of jobs ({ id, variant }),
 * renders each with the pure recipes and posts the samples back one by one
 * (transferring the buffer), so the game never hitches while sounds build.
 */
import { renderSound } from './recipes';
import type { SoundId } from './SoundSynth';

interface Job {
  id: SoundId;
  variant: number;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ jobs: Job[] }>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  for (const job of e.data.jobs) {
    try {
      const data = renderSound(job.id, job.variant);
      ctx.postMessage({ id: job.id, variant: job.variant, data }, [data.buffer]);
    } catch (err) {
      ctx.postMessage({ id: job.id, variant: job.variant, error: String(err) });
    }
  }
  ctx.postMessage({ done: true });
};
