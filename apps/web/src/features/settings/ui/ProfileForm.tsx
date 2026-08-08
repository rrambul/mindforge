import {
  SUPPORTED_LOCALES,
  type Locale,
  type UpdateProfileInput,
  type WeekStart,
} from "@mindforge/core";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, CardSection, Row, Select, Stack, Text } from "../../../shared/ui/index.js";
import type { Profile } from "../api/use-profile.js";
import { isKnownTimeZone } from "../model/timezones.js";
import { TimezonePicker } from "./TimezonePicker.js";

interface ProfileFormProps {
  readonly profile: Profile;
  readonly onSave: (patch: UpdateProfileInput) => void;
  readonly pending: boolean;
}

interface ProfileFormValues {
  locale: Locale;
  contentLanguage: Locale;
  timezone: string;
  /** A `<select>` value is a string; converted back to 0 | 1 on submit. */
  weekStartsOn: "0" | "1";
}

/**
 * The three axes §5.2 insists are separate, plus the one that decides what a week is.
 *
 * **Content language is its own field, not a checkbox saying "same as interface".** A Brazilian
 * engineer learning distributed systems very reasonably wants a pt-BR interface and English lessons,
 * because the source material and the vocabulary are English — and a control that treats that as the
 * exception makes the product worse for the person it was built for.
 *
 * **The form sends only what moved.** There is no PUT on `/me` for the same reason: a settings form
 * that posts the whole object silently reverts anything a second tab changed while it was open.
 *
 * The draft lives in react-hook-form rather than `useState` — the cache stays the source of truth
 * (§2.2), and `values` re-seeds the fields if the profile changes underneath while nothing is dirty.
 */
export function ProfileForm({ profile, onSave, pending }: ProfileFormProps) {
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");

  const { register, handleSubmit, watch, setValue } = useForm<ProfileFormValues>({
    values: {
      locale: profile.locale,
      contentLanguage: profile.contentLanguage,
      timezone: profile.timezone,
      weekStartsOn: profile.weekStartsOn === 0 ? "0" : "1",
    },
    // Whatever is half-typed survives a refetch; everything untouched follows the server.
    resetOptions: { keepDirtyValues: true },
  });

  const values = watch();
  const patch = changedFields(profile, values);
  const nothingToSave = Object.keys(patch).length === 0;
  const timezoneValid = isKnownTimeZone(values.timezone);

  const localeOptions = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: t(`locales.${locale}`),
  }));

  return (
    <form
      onSubmit={(event) =>
        void handleSubmit(() => {
          if (nothingToSave || !timezoneValid) return;
          onSave(patch);
        })(event)
      }
      noValidate
    >
      <Stack>
        <CardSection label={t("profile.language")}>
          <Stack gap="tight">
            <Select label={t("profile.locale")} options={localeOptions} {...register("locale")} />
            <Select
              label={t("profile.contentLanguage")}
              hint={t("profile.contentLanguageHint")}
              options={localeOptions}
              {...register("contentLanguage")}
            />
          </Stack>
        </CardSection>

        <CardSection label={t("profile.calendar")}>
          <Stack gap="tight">
            <TimezonePicker
              value={values.timezone}
              onChange={(timezone) => {
                setValue("timezone", timezone, { shouldDirty: true });
              }}
            />
            <Select
              label={t("profile.weekStart")}
              hint={t("profile.weekStartHint")}
              options={[
                { value: "0", label: t("profile.sunday") },
                { value: "1", label: t("profile.monday") },
              ]}
              {...register("weekStartsOn")}
            />
          </Stack>
        </CardSection>

        {/* Said before the save, not after: changing either of these moves every day boundary and
            week bucket already on screen, and that is a surprise worth warning about rather than
            explaining afterwards. */}
        {patch.timezone !== undefined || patch.weekStartsOn !== undefined ? (
          <Text tone="muted">{t("profile.rebuckets")}</Text>
        ) : null}

        <Row>
          <Button
            variant="primary"
            type="submit"
            disabled={pending || nothingToSave || !timezoneValid}
          >
            {pending ? t("profile.saving") : common("action.save")}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}

/**
 * Only the fields that differ from the stored row.
 *
 * Spread-or-nothing rather than `undefined`, because `exactOptionalPropertyTypes` makes "absent" and
 * "present but undefined" different types — and the API reads absent as unchanged.
 */
function changedFields(profile: Profile, values: ProfileFormValues): UpdateProfileInput {
  const weekStartsOn: WeekStart = values.weekStartsOn === "0" ? 0 : 1;

  return {
    ...(values.locale === profile.locale ? {} : { locale: values.locale }),
    ...(values.contentLanguage === profile.contentLanguage
      ? {}
      : { contentLanguage: values.contentLanguage }),
    ...(values.timezone === profile.timezone ? {} : { timezone: values.timezone }),
    ...(weekStartsOn === profile.weekStartsOn ? {} : { weekStartsOn }),
  };
}
