import {
  createHintClient,
  ModelCallError,
  requestHint,
  type HintCall,
  type HintClient,
  type HintRequestInput,
} from "@mindforge/llm";
import { Inject, Injectable } from "@nestjs/common";

import { HintServiceBusy, HintsUnavailable } from "../domain/errors.js";
import type { HintGenerator } from "../domain/hint-generator.port.js";

export const HINT_API_KEY = Symbol("HintApiKey");

/**
 * Hints from the Messages API.
 *
 * The key is passed in explicitly rather than left to the SDK's credential chain.
 * The chain would also find an `ant auth login` profile or an `ANTHROPIC_AUTH_TOKEN`
 * on a developer's machine, and a hint billed to whichever of those happened to be
 * lying around is the `TEACH_AUTH` trap from CLAUDE.md in a new place. No key is a
 * clear refusal (`HintsUnavailable`), not a call that might work.
 */
@Injectable()
export class AnthropicHintGenerator implements HintGenerator {
  private readonly client: HintClient | null;

  constructor(@Inject(HINT_API_KEY) apiKey: string | null) {
    this.client = apiKey === null ? null : createHintClient(apiKey);
  }

  async generate(input: HintRequestInput): Promise<HintCall> {
    if (this.client === null) throw new HintsUnavailable();

    try {
      return await requestHint(this.client, input);
    } catch (error) {
      // A failed call bills nothing, so there is no `llm_calls` row to write — only
      // a reason to give. "Not set up" and "try again" ask different things of the
      // learner, and a generic 500 would ask neither.
      if (error instanceof ModelCallError) {
        throw error.reason === "configuration"
          ? new HintsUnavailable(error)
          : new HintServiceBusy(error);
      }
      throw error;
    }
  }
}
