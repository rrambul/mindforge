import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, NetworkError } from "../../../shared/api/problem.js";
import { Button, Callout, Card, Heading, Row, Stack, Text } from "../../../shared/ui/index.js";
import { useChangelog, type Release } from "../api/use-changelog.js";
import { useNotificationPrefs, useSaveNotificationPrefs } from "../api/use-notification-prefs.js";
import {
  useMarkChangelogSeen,
  useProfile,
  useUpdateProfile,
  type Profile,
} from "../api/use-profile.js";
import { unseenCount } from "../model/version.js";
import { ChangelogPanel } from "../ui/ChangelogPanel.js";
import { NotificationPrefsForm } from "../ui/NotificationPrefsForm.js";
import { ProfileForm } from "../ui/ProfileForm.js";
import { ThemeControl } from "../ui/ThemeControl.js";

export interface SettingsRouteProps {
  /**
   * The nudges you have right now, supplied by the app layer.
   *
   * A render prop because they belong to `features/notifications` and this feature may not import it
   * (§2.2 rule 6). They are here rather than only behind the bar's marker because this is the screen
   * that decides when they arrive, and a schedule you cannot see the output of is a setting you
   * cannot judge.
   */
  readonly renderNudges?: () => ReactNode;
  /**
   * What the agent has concluded about the learner (§7.6).
   *
   * A render prop for the same reason the nudges are: it belongs to
   * `features/memory` and this feature may not import another (§2.2 rule 6).
   */
  readonly renderMemory?: () => ReactNode;
}

/**
 * Settings (FR-L3, FR-L5, FR-N4, §14.1).
 *
 * Four blocks, in the order they matter: the settings that change what every other screen *means*,
 * then appearance, then when the app is allowed to speak, then what changed since you last looked.
 */
export function SettingsRoute({ renderNudges, renderMemory }: SettingsRouteProps) {
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");

  const profile = useProfile();
  const update = useUpdateProfile();
  const prefs = useNotificationPrefs();
  const savePrefs = useSaveNotificationPrefs();
  const changelog = useChangelog();
  const markSeen = useMarkChangelogSeen();

  useDismissUnseenOnOpen(changelog.data, profile.data, markSeen.mutate);

  return (
    <Stack gap="loose">
      <Heading level={1}>{t("heading")}</Heading>

      {profile.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}

      {profile.isError ? (
        <Callout tone="danger" live>
          <Text>{describe(profile.error, common)}</Text>
          <Row>
            <Button onClick={() => void profile.refetch()}>{common("action.retry")}</Button>
          </Row>
        </Callout>
      ) : null}

      {profile.isSuccess ? (
        <Card as="section" label={t("profile.heading")}>
          <Stack>
            <Heading level={2}>{t("profile.heading")}</Heading>
            {update.error ? (
              <Callout tone="danger" live>
                {describe(update.error, common)}
              </Callout>
            ) : null}
            {/* Mounted only once the profile has loaded. The fields are seeded from it, and an
                already-mounted input does not pick up a default that arrives later — the form would
                sit on UTC and English and then save them back. */}
            <ProfileForm
              profile={profile.data}
              onSave={(patch) => update.mutate(patch)}
              pending={update.isPending}
            />
          </Stack>
        </Card>
      ) : null}

      <Card as="section" label={t("theme.heading")}>
        <Stack>
          <Heading level={2}>{t("theme.heading")}</Heading>
          <ThemeControl />
        </Stack>
      </Card>

      <Card as="section" label={t("nudges.heading")}>
        <Stack>
          <Heading level={2}>{t("nudges.heading")}</Heading>
          {savePrefs.error ? (
            <Callout tone="danger" live>
              {describe(savePrefs.error, common)}
            </Callout>
          ) : null}
          {prefs.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}
          {prefs.isError ? (
            <Callout tone="danger" live>
              {describe(prefs.error, common)}
            </Callout>
          ) : null}
          {prefs.isSuccess ? (
            <NotificationPrefsForm
              prefs={prefs.data.prefs}
              onSave={(body) => savePrefs.mutate(body)}
              pending={savePrefs.isPending}
            />
          ) : null}
          {renderNudges?.()}
        </Stack>
      </Card>

      {renderMemory?.()}

      <Card as="section" label={t("changelog.heading")}>
        <Stack>
          <Heading level={2}>{t("changelog.heading")}</Heading>
          {changelog.isPending ? <Text tone="muted">{common("state.loading")}</Text> : null}
          {/* Stated, not silent. A build that failed to write the artifact would otherwise look like
              a product that has never shipped anything. */}
          {changelog.isError ? <Text tone="muted">{t("changelog.failed")}</Text> : null}
          {changelog.isSuccess ? <ChangelogPanel releases={changelog.data} /> : null}
        </Stack>
      </Card>
    </Stack>
  );
}

/**
 * "Dismissed by opening it" (§14.1) — the dot clears because you arrived, not because you clicked.
 *
 * Fires once per newest-version, guarded by a ref rather than by the mutation's own state: the
 * response updates the cached profile, so the next run finds nothing unseen and stops — but React
 * mounts effects twice in development, and the guard is what keeps that from being two POSTs.
 */
function useDismissUnseenOnOpen(
  releases: readonly Release[] | undefined,
  profile: Profile | undefined,
  markSeen: (input: { version: string }) => void,
): void {
  const newest = releases?.[0]?.version ?? null;
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (newest === null || profile === undefined) return;
    if (marked.current === newest) return;
    if (unseenCount([newest], profile.changelogSeenVersion) === 0) return;

    marked.current = newest;
    markSeen({ version: newest });
  }, [newest, profile, markSeen]);
}

function describe(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
