"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/ui/primitives";
import type { CreateStudentState } from "./actions";

export function NewStudentForm({
  action,
}: {
  action: (prev: CreateStudentState, formData: FormData) => Promise<CreateStudentState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.fieldErrors ?? {};
  return (
    <Card className="max-w-lg">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {state.formError ? <Alert tone="error">{state.formError}</Alert> : null}
        <Field label="Admission number" name="admissionNumber" required errors={e.admissionNumber} hint="For example KH/2026/0123" />
        <Field label="First name" name="firstName" required autoComplete="off" errors={e.firstName} />
        <Field label="Last name" name="lastName" required autoComplete="off" errors={e.lastName} />
        <Field label="Date of birth (optional)" name="dateOfBirth" type="date" errors={e.dateOfBirth} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save student"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
