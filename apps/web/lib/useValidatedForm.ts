"use client";

import { useState } from "react";
import type { Errors } from "./validation";

/**
 * Shared form state for the auth pages.
 *
 * The rule about *when* to show an error is the whole point of this hook.
 * Validating a field on blur even though the user never typed in it means
 * focusing a field and leaving scolds you for it — and on a form with an
 * autofocused first field, simply clicking a link elsewhere on the page makes
 * an error appear. That error inserts a line of text, everything below it
 * moves, and the click lands somewhere else. So: a field reports an error
 * once it is *dirty* (the user changed it) and then blurred, or once the form
 * has been submitted.
 */
export function useValidatedForm<T extends string>(
  initial: Record<T, string>,
  validate: (values: Record<T, string>) => Errors<T>,
) {
  const [values, setValues] = useState<Record<T, string>>(initial);
  const [dirty, setDirty] = useState<Partial<Record<T, boolean>>>({});
  const [blurred, setBlurred] = useState<Partial<Record<T, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const errors = validate(values);

  const set = (field: T) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setDirty((d) => ({ ...d, [field]: true }));
  };

  const blur = (field: T) => () => setBlurred((b) => ({ ...b, [field]: true }));

  const errorFor = (field: T): string | undefined =>
    submitted || (dirty[field] && blurred[field]) ? errors[field] : undefined;

  /** Returns true when the form is clean enough to submit. */
  const submit = (): boolean => {
    setSubmitted(true);
    return Object.values(errors).every((error) => !error);
  };

  return { values, set, blur, errorFor, submit };
}
