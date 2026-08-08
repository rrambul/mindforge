import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../../shared/api/supabase.js";
import { Button, Callout, Field, Heading, Row, Stack } from "../../../shared/ui/index.js";
import { useSignUp } from "../api/use-sign-up.js";

type Mode = "signIn" | "signUp";

/**
 * The front door. Email and password against Supabase Auth (FR-A1); the API never
 * issues tokens.
 *
 * Not react-hook-form: two fields with no cross-field rules and no schema shared with
 * a server DTO. The form machinery earns its place on the mission editor and the
 * session debrief, not here.
 *
 * Supabase's own error text is not rendered. It is English, it leaks whether an
 * account exists ("Invalid login credentials" vs "Email not confirmed"), and it is not
 * ours to translate — so both failures collapse to one catalogued message.
 */
export function SignInForm() {
  const { t } = useTranslation("auth");
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  // Signing up is not just an auth call: it is also the one moment the browser's locale, zone and
  // week start can be written to the profile, which is why it has a hook and signing in does not.
  const signUp = useSignUp();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFailed(false);
    setPending(true);

    const { error } =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await signUp(email, password);

    setPending(false);
    // No success branch: onAuthStateChange fires and the router re-renders. Setting
    // state here would fight it.
    if (error) setFailed(true);
  }

  const other: Mode = mode === "signIn" ? "signUp" : "signIn";

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Stack>
        <Heading level={1}>{t(`${mode}.heading`)}</Heading>

        {failed ? (
          <Callout tone="danger" live>
            {t(`${mode}.failed`)}
          </Callout>
        ) : null}

        <Field
          label={t("signIn.email")}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label={t("signIn.password")}
          type="password"
          name="password"
          // Tells a password manager which of the two this is, so it offers to save on
          // sign-up and to fill on sign-in.
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Row>
          <Button variant="primary" type="submit" disabled={pending}>
            {t(`${mode}.submit`)}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setMode(other);
              setFailed(false);
            }}
          >
            {t(`${mode}.switchTo${other === "signUp" ? "SignUp" : "SignIn"}`)}
          </Button>
        </Row>
      </Stack>
    </form>
  );
}
