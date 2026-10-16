"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import { Callout } from "@/components/ui/surfaces";
import { useI18n } from "@/lib/i18n/client";
import { signInAction } from "@/server/actions/auth";
import type { ActionResult } from "@/server/actions/result";

function SubmitButton() {
  const { pending } = useFormStatus();
  const { t } = useI18n();
  return (
    <Button type="submit" className="w-full" size="lg" loading={pending}>
      {pending ? t("auth.signingIn") : t("auth.signIn")}
    </Button>
  );
}

export function SignInForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    signInAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.replace("/");
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state && !state.ok ? <Callout tone="danger">{state.error}</Callout> : null}

      <Field label={t("auth.username")} htmlFor="username" required>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={64}
          autoFocus
        />
      </Field>

      <Field label={t("auth.password")} htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
