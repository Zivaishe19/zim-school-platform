"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./primitives";

/** Disables itself while the form is submitting (prevents double submissions on slow links). */
export function SubmitButton({ children, variant = "primary", confirm }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost"; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      onClick={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
    >
      {pending ? "Saving…" : children}
    </Button>
  );
}
