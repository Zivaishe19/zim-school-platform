import type { Metadata } from "next";
import Link from "next/link";
import { getStudent } from "@/modules/students/service";
import { PageHeader, Card } from "@/ui/primitives";
import { ActionForm, Flash, Grid, Input, SubmitButton, TextArea, today } from "@/ui/kit";
import { explain } from "../../_actions/academic";
import { guard, load, str } from "../../_lib";

export const metadata: Metadata = { title: "Explain an absence" };

export default async function ExplainPage(props: PageProps<"/s/[schoolSlug]/attendance/explain">) {
  const { ctx, sp, base, slug } = await load(props);
  const s = await getStudent(ctx, str(sp.studentId)).catch(() => null);
  guard(s);
  const d = str(sp.date) || today();
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/attendance`} className="text-brand-700 underline">← Attendance</Link></p>
      <PageHeader title={`Explain an absence: ${s.firstName}`} description="The class teacher reviews it. If approved, the absence is recorded as an approved absence." />
      <Flash sp={sp} />
      <Card className="max-w-xl">
        <ActionForm action={explain.bind(null, slug)} back={`${base}/attendance`}>
          <input type="hidden" name="studentId" value={s.id} />
          <Grid><Input label="From" name="dateFrom" type="date" defaultValue={d} required /><Input label="To" name="dateTo" type="date" defaultValue={d} required /></Grid>
          <TextArea label="Reason" name="reason" required maxLength={1000} />
          <div><SubmitButton>Send explanation</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
