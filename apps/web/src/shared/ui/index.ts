/**
 * The design system's public surface.
 *
 * A barrel so features import from `shared/ui` rather than reaching for individual files — which
 * means adding a component is a decision made here, and a feature cannot quietly depend on an
 * internal piece that was never meant to be shared.
 *
 * Anything used by exactly one feature does not belong in this list; it lives in that feature's
 * `ui/` (§2.2 rule 7). `RunningSession`, `FrictionChips`, and `MissionCard` are all correctly
 * outside it.
 */
export { Button, ButtonLink } from "./Button.js";
export { Callout } from "./Callout.js";
export { Card } from "./Card.js";
export { ChoiceGroup, type Choice } from "./ChoiceGroup.js";
export { Field, TextareaField } from "./Field.js";
export { Heading } from "./Heading.js";
export { Row } from "./Row.js";
export { Select, type SelectOption } from "./Select.js";
export { Spread } from "./Spread.js";
export { Stack } from "./Stack.js";
export { StatusChip } from "./StatusChip.js";
export { Figure, Label, Text } from "./Text.js";
export { VisuallyHidden } from "./VisuallyHidden.js";
