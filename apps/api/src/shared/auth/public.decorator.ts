import { SetMetadata, type CustomDecorator } from "@nestjs/common";

export const IS_PUBLIC = "mindforge:public";

/**
 * The escape hatch for the globally-applied auth guard (TECH-DESIGN.md §4).
 *
 * Global-with-an-opt-out rather than per-controller-opt-in, on purpose: the
 * failure mode of forgetting the decorator is then an endpoint that is
 * unreachable, which you notice immediately, instead of an endpoint that is
 * unprotected, which you notice never.
 */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC, true);
}
