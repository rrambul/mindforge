import { useTranslation } from "react-i18next";
import { Button, Callout, Row, Text } from "../../../shared/ui/index.js";
import { stepNumber, type FirstRunState } from "../lib/first-run-state.js";

interface FirstRunBannerProps {
  readonly state: FirstRunState;
  readonly onStart: () => void;
  readonly onDismiss: () => void;
}

/**
 * The offer, and the way back in (§5.3).
 *
 * A banner rather than a modal on first load. A tour that blocks the app is a tour people click past to
 * see what they signed up for, and then never find again — which is how the guided first mission ends
 * up being the thing nobody completes.
 *
 * "Not now" means it permanently. A banner that reappears every session is a banner people learn to
 * ignore, and it would be sitting above the one screen the product needs them to use daily.
 */
export function FirstRunBanner({ state, onStart, onDismiss }: FirstRunBannerProps) {
  const { t } = useTranslation("firstRun");
  const resuming = state.missionId !== undefined;

  return (
    <Callout tone="neutral">
      <Text>
        {resuming ? t("banner.resume", { step: stepNumber(state.step) }) : t("banner.start")}
      </Text>
      <Row>
        <Button variant="primary" onClick={onStart}>
          {resuming ? t("banner.resumeAction") : t("banner.action")}
        </Button>
        <Button variant="quiet" onClick={onDismiss}>
          {t("banner.dismiss")}
        </Button>
      </Row>
    </Callout>
  );
}
