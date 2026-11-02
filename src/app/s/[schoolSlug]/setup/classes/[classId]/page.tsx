import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, notInArray } from "drizzle-orm";
import { listStaff } from "@/modules/people/service";
import { classMembers, listClasses, listRooms } from "@/modules/setup/service";
import { enrolment, schoolClass, student } from "@/server/db/school/schema";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Details, Flash, Grid, Section, Select, SubmitButton, Table } from "@/ui/kit";
import { enrol, updateClass } from "../../../_actions/setup";
import { guard, load } from "../../../_lib";

export const metadata: Metadata = { title: "Class" };

export default async function ClassPage(props: PageProps<"/s/[schoolSlug]/setup/classes/[classId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  guard(can(ctx, "settings.manage"));
  const [c] = await ctx.db.select().from(schoolClass).where(eq(schoolClass.id, params.classId));
  guard(c);
  const info = (await listClasses(ctx, c.academicYearId)).find((x) => x.id === c.id)!;
  const members = await classMembers(ctx, c.id);
  // Students without a placement this year.
  const placed = ctx.db.select({ id: enrolment.studentId }).from(enrolment).where(eq(enrolment.academicYearId, c.academicYearId));
  const unplaced = await ctx.db.select().from(student).where(and(notInArray(student.id, placed), notInArray(student.status, ["graduated", "withdrawn", "transferred_out"]))).orderBy(student.lastName).limit(500);
  const [rooms, staff] = await Promise.all([listRooms(ctx), listStaff(ctx)]);
  const here = `${base}/setup/classes/${c.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/setup?tab=classes`} className="text-brand-700 underline">← Classes</Link></p>
      <PageHeader title={c.name} description={`${info.formName} · ${members.length} students`} />
      <Flash sp={sp} />
      <Details summary="Class teacher and room">
        <ActionForm action={updateClass.bind(null, slug)} back={here}>
          <input type="hidden" name="classId" value={c.id} />
          <Grid>
            <Select label="Class teacher" name="classTeacherPersonId" defaultValue={c.classTeacherPersonId ?? ""} placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
            <Select label="Home room" name="roomId" defaultValue={c.roomId ?? ""} placeholder="—" options={rooms.map((r) => ({ value: r.id, label: r.name }))} />
          </Grid>
          <div><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      </Details>
      <Section title="Students in this class">
        <Table caption="Class members" rows={members} rowKey={(m) => m.id} columns={[
          { header: "Name", cell: (m) => <Link className="text-brand-700 underline" href={`${base}/students/${m.id}`}>{m.lastName}, {m.firstName}</Link> },
          { header: "Admission no.", cell: (m) => m.admissionNumber },
        ]} />
      </Section>
      <Details summary={`Place students in this class (${unplaced.length} not yet placed this year)`}>
        <ActionForm action={enrol.bind(null, slug)} back={here}>
          <input type="hidden" name="classId" value={c.id} />
          <div className="max-h-96 overflow-y-auto rounded border border-slate-200 p-2">
            {unplaced.map((s) => <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="studentIds" value={s.id} className="size-5" />{s.lastName}, {s.firstName} <span className="text-slate-500">{s.admissionNumber}</span></label>)}
            {!unplaced.length ? <p className="text-sm text-slate-500">Everyone is placed.</p> : null}
          </div>
          <div><SubmitButton>Place selected students</SubmitButton></div>
        </ActionForm>
      </Details>
    </>
  );
}
