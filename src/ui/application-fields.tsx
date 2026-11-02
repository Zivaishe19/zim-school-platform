import { ActionForm, Grid, Input, Select, SubmitButton } from "./kit";

/** Shared by the staff walk-in form and the public online application. */
export function ApplicationFields({ action, back }: { action: (fd: FormData) => Promise<void>; back: string }) {
  return (
    <ActionForm action={action} back={back}>
      <Grid>
        <Select label="Entry point" name="entryType" options={[{ value: "form1", label: "Form 1" }, { value: "form4", label: "Form 4" }, { value: "lower6", label: "Lower Six" }, { value: "transfer", label: "Mid-year transfer" }]} />
        <Select label="For transfers: form" name="applyingForLevel" placeholder="—" options={[1, 2, 3, 4, 5, 6].map((l) => ({ value: String(l), label: l <= 4 ? `Form ${l}` : l === 5 ? "Lower Six" : "Upper Six" }))} />
        <Input label="Learner's first name" name="firstName" required />
        <Input label="Learner's last name" name="lastName" required />
        <Input label="Date of birth" name="dateOfBirth" type="date" />
        <Select label="Gender" name="gender" options={[{ value: "", label: "—" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
        <Input label="Previous school" name="previousSchool" />
        <Input label="Parent/guardian name" name="guardianName" required />
        <Input label="Parent/guardian phone" name="guardianPhone" type="tel" required />
        <Input label="Parent/guardian email" name="guardianEmail" type="email" />
      </Grid>
      <div><SubmitButton>Submit application</SubmitButton></div>
    </ActionForm>
  );
}
