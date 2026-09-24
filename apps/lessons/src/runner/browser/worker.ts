/**
 * The worker entry: one run, then the client throws the worker away.
 *
 * Everything the learner or the agent wrote executes here and nowhere else. The
 * client builds this worker from a Blob URL for every run and `terminate()`s it
 * when the answer arrives or the clock runs out, so no state — a patched
 * prototype, a leaked timer — survives from one run into the next.
 */
import { runHarness, type HarnessInput } from "../harness.js";

declare const self: {
  onmessage: ((event: { readonly data: HarnessInput }) => void) | null;
  postMessage(message: unknown): void;
};

self.onmessage = (event) => {
  void runHarness(event.data).then((output) => self.postMessage(output));
};
