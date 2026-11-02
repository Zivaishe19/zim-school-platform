import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Alert } from "./primitives";
import { SubmitButton } from "./submit-button";

export { SubmitButton };

/** ?ok= / ?error= messages set by schoolAction(). */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  if (!ok && !error) return null;
  return <div className="mb-4">{error ? <Alert tone="error">{error}</Alert> : <Alert tone="info">{ok}</Alert>}</div>;
}

/** A server-action form that returns the user to `back` (a path in the same school). */
export function ActionForm({
  action,
  back,
  children,
  className = "flex flex-col gap-4",
  upload = false,
}: {
  action: (fd: FormData) => Promise<void>;
  back: string;
  children: ReactNode;
  className?: string;
  upload?: boolean;
}) {
  return (
    <form action={action} className={className} {...(upload ? { encType: "multipart/form-data" } : {})}>
      <input type="hidden" name="_back" value={back} />
      {children}
    </form>
  );
}

const control = "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base";

export function Select({
  label,
  name,
  options,
  placeholder,
  ...rest
}: ComponentProps<"select"> & { label: string; name: string; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select id={id} name={name} className={control} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextArea({ label, name, ...rest }: ComponentProps<"textarea"> & { label: string; name: string }) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea id={id} name={name} rows={4} className={`${control} py-2`} {...rest} />
    </div>
  );
}

export function Input({ label, name, hint, ...rest }: ComponentProps<"input"> & { label: string; name: string; hint?: string }) {
  const id = `f-${name}${rest.type === "radio" ? `-${String(rest.value)}` : ""}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input id={id} name={name} className={control} {...rest} />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, name, ...rest }: ComponentProps<"input"> & { label: string; name: string }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name={name} className="size-5" {...rest} />
      {label}
    </label>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={`grid gap-4 ${c}`}>{children}</div>;
}

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string; hideOnMobile?: boolean };

export function Table<T>({ rows, columns, empty = "Nothing here yet.", caption, rowKey }: { rows: T[]; columns: Column<T>[]; empty?: string; caption: string; rowKey: (r: T) => string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-3 py-2 font-medium ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-slate-100 align-top last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={`px-3 py-2 ${c.className ?? ""} ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};
const statusTone: Record<string, keyof typeof badgeTones> = {
  present: "green", approved: "green", verified: "green", published: "green", accepted: "green", active: "green", open: "green", available: "green", returned: "green", marked: "blue", submitted: "blue",
  late: "amber", pending: "amber", under_review: "amber", info_required: "amber", info_requested: "amber", early_departure: "amber", draft: "slate", reported: "amber", on_loan: "amber", planned: "slate",
  absent: "red", rejected: "red", missing: "red", lost: "red", damaged: "red", dismissed: "slate", closed: "slate", approved_absence: "blue", overdue: "red",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  const t = tone ?? statusTone[String(children)] ?? "slate";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${badgeTones[t]}`}>{String(children).replaceAll("_", " ")}</span>;
}

export function Tabs({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Section" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? "page" : undefined}
          className={`border-b-2 px-3 py-2 text-sm whitespace-nowrap ${i.href === current ? "border-brand-600 font-semibold text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Details({ summary, children, open = false }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="mb-4 rounded-lg border border-slate-200 bg-white p-4" open={open}>
      <summary className="cursor-pointer text-sm font-semibold text-brand-800">{summary}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export function money(cents: number, currency: string): string {
  const v = (cents / 100).toLocaleString("en-ZW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${v}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 10);
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Date N days before today (YYYY-MM-DD). */
export function daysAgo(n: number): string {
  return new Date(new Date().getTime() - n * 86_400_000).toISOString().slice(0, 10);
}
