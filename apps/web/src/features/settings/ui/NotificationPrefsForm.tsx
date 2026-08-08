import {
  STALL_AFTER_DAYS,
  type NotificationPref,
  type UpdateNotificationPrefsInput,
} from "@mindforge/core";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, CardSection, Field, Row, Select, Stack, Text } from "../../../shared/ui/index.js";
import { hourLabel, weekdayLabels } from "../model/labels.js";
import { SettingSwitch } from "./SettingSwitch.js";
import "./settings.css";

interface NotificationPrefsFormProps {
  readonly prefs: readonly NotificationPref[];
  readonly onSave: (body: UpdateNotificationPrefsInput) => void;
  readonly pending: boolean;
}

interface PrefsFormValues {
  weeklyReviewEnabled: boolean;
  weeklyReviewWeekday: string;
  weeklyReviewHour: string;
  stallEnabled: boolean;
  stallAfterDays: number;
}

const HOURS = Array.from({ length: 24 }, (_unused, hour) => hour);

/**
 * When the two nudges fire, and whether they fire at all (FR-N4).
 *
 * **The copy has to earn the word "quiet".** FR-N4 says notifications must be configurable and quiet
 * by default, and read as off-until-enabled the feature ships dead — nobody switches on
 * notifications they have never seen. So both kinds are on, and "quiet" is a statement about
 * *delivery*: a marker and a line inside the app, no push, no sound, nothing that can interrupt a
 * focus session. A screen that offered a schedule without saying that would imply a channel this
 * product does not have, and the first missed reminder would read as a bug.
 *
 * The schedule stays editable when a kind is switched off. Greying it out would hide the answer to
 * "when *would* this arrive?", which is the thing you are deciding about.
 */
export function NotificationPrefsForm({ prefs, onSave, pending }: NotificationPrefsFormProps) {
  const { t, i18n } = useTranslation("settings");
  const { t: common } = useTranslation("common");

  // Predicates spelled out rather than left to inference: `NotificationPref` is a discriminated
  // union, and without them `pref.config` is the union of both shapes and neither field exists on it.
  const weekly = prefs.find(
    (pref): pref is Extract<NotificationPref, { kind: "weekly_review" }> =>
      pref.kind === "weekly_review",
  );
  const stall = prefs.find(
    (pref): pref is Extract<NotificationPref, { kind: "stall" }> => pref.kind === "stall",
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PrefsFormValues>({
    values: {
      weeklyReviewEnabled: weekly?.enabled ?? true,
      weeklyReviewWeekday: String(weekly?.config.weekday ?? 0),
      weeklyReviewHour: String(weekly?.config.hour ?? 18),
      stallEnabled: stall?.enabled ?? true,
      stallAfterDays: stall?.config.afterDays ?? STALL_AFTER_DAYS,
    },
    resetOptions: { keepDirtyValues: true },
  });

  const weekdays = weekdayLabels(i18n.language);

  return (
    <form
      onSubmit={(event) =>
        void handleSubmit((values) => {
          onSave({
            prefs: [
              {
                kind: "weekly_review",
                enabled: values.weeklyReviewEnabled,
                config: {
                  weekday: Number(values.weeklyReviewWeekday),
                  hour: Number(values.weeklyReviewHour),
                },
              },
              {
                kind: "stall",
                enabled: values.stallEnabled,
                config: { afterDays: Number(values.stallAfterDays) },
              },
            ],
          });
        })(event)
      }
      noValidate
    >
      <Stack>
        {/* Not a footnote. It is the difference between a schedule and a promise of push
            notifications, and the person reading it has no other way to tell which this is. */}
        <Text tone="muted">{t("nudges.quiet")}</Text>

        <CardSection label={t("nudges.weeklyReview.label")}>
          <Stack gap="tight">
            <SettingSwitch
              label={t("nudges.weeklyReview.enabled")}
              {...register("weeklyReviewEnabled")}
            />
            <Text tone="hint">{t("nudges.weeklyReview.hint")}</Text>
            <div className="mf-schedule">
              <Select
                label={t("nudges.weeklyReview.weekday")}
                options={weekdays.map((label, index) => ({ value: String(index), label }))}
                {...register("weeklyReviewWeekday")}
              />
              <Select
                label={t("nudges.weeklyReview.hour")}
                options={HOURS.map((hour) => ({
                  value: String(hour),
                  label: hourLabel(i18n.language, hour),
                }))}
                {...register("weeklyReviewHour")}
              />
            </div>
          </Stack>
        </CardSection>

        <CardSection label={t("nudges.stall.label")}>
          <Stack gap="tight">
            <SettingSwitch label={t("nudges.stall.enabled")} {...register("stallEnabled")} />
            <Field
              label={t("nudges.stall.afterDays")}
              hint={t("nudges.stall.hint")}
              width="short"
              type="number"
              inputMode="numeric"
              min={3}
              max={90}
              error={errors.stallAfterDays ? t("nudges.stall.range") : undefined}
              // `validate` rather than `min`/`max`: an emptied number field parses to NaN, which is
              // neither below 3 nor above 90, so the range rules alone would let it submit.
              {...register("stallAfterDays", {
                valueAsNumber: true,
                validate: (value) => Number.isInteger(value) && value >= 3 && value <= 90,
              })}
            />
          </Stack>
        </CardSection>

        <Row>
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? t("nudges.saving") : common("action.save")}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}
