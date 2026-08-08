import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { now } from "../../../shared/lib/clock.js";
import { Button, Field, Text } from "../../../shared/ui/index.js";
import { zoneTimeLabel } from "../model/labels.js";
import { browserTimeZone, isKnownTimeZone, supportedTimeZones } from "../model/timezones.js";

interface TimezonePickerProps {
  readonly value: string;
  readonly onChange: (timezone: string) => void;
}

/**
 * The setting M2 could not run without (FR-L5).
 *
 * `profiles` was read-only over the API until this screen existed, so every account sat at `UTC` and
 * "the nightly rollup runs per user timezone" was a sentence about a column nobody could set. Every
 * day boundary, week bucket and grid column downstream of here was quietly a UTC one.
 *
 * **A text input with a `datalist`, not a `<select>`.** `Intl.supportedValuesOf` returns around 418
 * zones; a native select of that length is a scroll on desktop and a wheel with no type-ahead on a
 * phone, which is the platform advantage `Select` exists to keep. Typing "sao" narrows it to one.
 *
 * **It says what time it is there.** `America/Sao_Paulo` is a string; "14:32 GMT-3" is the thing
 * being chosen, and it is how you notice you picked the wrong one before every rollup does.
 */
export function TimezonePicker({ value, onChange }: TimezonePickerProps) {
  const { t, i18n } = useTranslation("settings");
  const listId = useId();

  // Recomputed only when the current value changes, because it is the one input to the list: the
  // profile's own zone is kept in it even if this engine has since renamed it, so nobody finds their
  // current setting missing from the values it may be set to.
  const zones = useMemo(() => supportedTimeZones(value), [value]);

  const known = isKnownTimeZone(value);
  const localTime = known ? zoneTimeLabel(i18n.language, value, now()) : null;

  return (
    <>
      <Field
        label={t("timezone.label")}
        hint={t("timezone.hint")}
        list={listId}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        // Validated against Intl rather than a list in the repo, exactly as the API validates it — so
        // this is a faster answer than the round trip, never a different one.
        error={value !== "" && !known ? t("timezone.unknown") : undefined}
        action={
          <Button
            onClick={() => {
              onChange(browserTimeZone());
            }}
          >
            {t("timezone.detect")}
          </Button>
        }
      />
      <datalist id={listId}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {localTime === null ? null : (
        <Text tone="hint">{t("timezone.nowThere", { time: localTime })}</Text>
      )}
    </>
  );
}
