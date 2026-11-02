import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Small set of accessible building blocks. Extend here rather than restyling per page. */

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const variants = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100",
  ghost: "text-slate-700 hover:bg-slate-100",
} as const;

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-slate-200 bg-white p-4 sm:p-6 ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  name,
  errors,
  hint,
  ...input
}: ComponentProps<"input"> & { label: string; name: string; errors?: string[]; hint?: string }) {
  const id = `f-${name}`;
  const describedBy = [errors?.length ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base aria-invalid:border-red-600"
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={`${id}-err`} className="text-sm text-red-700">
          {errors.join(". ")}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "warning"; children: ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    error: "border-red-200 bg-red-50 text-red-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}
