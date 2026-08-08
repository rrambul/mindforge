import { useId, type InputHTMLAttributes } from "react";
import "./settings.css";

type SettingSwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "id" | "type"
> & {
  readonly label: string;
};

/**
 * An on/off setting.
 *
 * Not `Field`, which is built around a full-width `.mf-field__control` — a 44px-tall, 100%-wide
 * checkbox reads as a broken text box. Not `ChoiceGroup` either: two chips reading "On" and "Off"
 * take a whole row to say what a tick says, and they are the vocabulary the debrief and the friction
 * taxonomy use for *answers*, not for switches.
 *
 * A native checkbox inside its own `<label>`, so the row is the target and the accessible name comes
 * from the markup rather than from an `aria-label` somebody has to remember to write.
 */
export function SettingSwitch({ label, ...rest }: SettingSwitchProps) {
  const id = useId();

  return (
    <label className="mf-switch" htmlFor={id}>
      <input id={id} type="checkbox" className="mf-switch__box" {...rest} />
      <span className="mf-switch__label">{label}</span>
    </label>
  );
}
