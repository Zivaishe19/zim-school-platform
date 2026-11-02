import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ATTENDANCE_STATUSES, getRegister } from "@/modules/attendance/service";
import { ForbiddenError } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Flash, SubmitButton } from "@/ui/kit";
import { saveRegister } from "../../_actions/academic";
import { load, str } from "../../_lib";

export const metadata: Metadata = { title: "Register" };
const LABEL: Record<string, string> = { present: "P", absent: "A", late: "L", early_departure: "E", approved_absence: "AA" };

export default async function RegisterPage(props: PageProps<"/s/[schoolSlug]/attendance/register">) {
  const { ctx, sp, base, slug } = await load(props);
  const [kind, targetId] = str(sp.target).split(":");
  let reg;
  try {
    reg = await getRegister(ctx, { kind: kind ?? "", targetId: targetId ?? "", date: str(sp.date), period: str(sp.period) });
  } catch (e) {
    if (e instanceof ForbiddenError || (e instanceof Error && e.name === "ZodError")) notFound();
    throw e;
  }
  const here = `${base}/attendance/register?${new URLSearchParams({ target: str(sp.target), date: reg.date, period: reg.period ?? "" })}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/attendance`} className="text-brand-700 underline">← Attendance</Link></p>
      <PageHeader title={`${reg.kind === "daily" ? "Daily register" : `Lesson register · ${reg.period}`}`} description={`${reg.date} · ${reg.rows.length} students · ${reg.taken ? "already taken (saving corrects it)" : "not yet taken"}`} />
      <Flash sp={sp} />
      <p className="mb-3 text-sm text-slate-600">Everyone starts as Present. P present · A absent · L late · E early departure · AA approved absence. Guardians are notified of new daily absences.</p>
      <ActionForm action={saveRegister.bind(null, slug)} back={here}>
        <input type="hidden" name="kind" value={reg.kind} /><input type="hidden" name="targetId" value={targetId} /><input type="hidden" name="date" value={reg.date} />
        {reg.period ? <input type="hidden" name="period" value={reg.period} /> : null}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {reg.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-40 font-medium">{r.lastName}, {r.firstName}</span>
              <fieldset className="flex gap-1">
                <legend className="sr-only">Status for {r.firstName} {r.lastName}</legend>
                {ATTENDANCE_STATUSES.map((s) => (
                  <label key={s} className="relative">
                    <input type="radio" name={`status_${r.id}`} value={s} defaultChecked={r.status === s} className="peer sr-only" />
                    <span title={s.replace("_", " ")} className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded border border-slate-300 text-sm peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:text-white peer-focus-visible:outline-2">{LABEL[s]}</span>
                  </label>
                ))}
              </fieldset>
              <input name={`note_${r.id}`} defaultValue={r.note} placeholder="note" aria-label={`Note for ${r.firstName}`} className="min-h-10 w-full rounded border border-slate-200 px-2 text-sm sm:w-48" />
            </li>
          ))}
          {!reg.rows.length ? <li className="px-3 py-6 text-center text-slate-500">No students in this class or group.</li> : null}
        </ul>
        <div><SubmitButton>Save register</SubmitButton></div>
      </ActionForm>
    </>
  );
}
