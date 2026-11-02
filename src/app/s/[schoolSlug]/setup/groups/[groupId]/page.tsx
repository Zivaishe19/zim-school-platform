import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, notInArray } from "drizzle-orm";
import { listStaff } from "@/modules/people/service";
import { groupMembers } from "@/modules/setup/service";
import { enrolment, groupMember, schoolClass, student, teachingGroup } from "@/server/db/school/schema";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Details, Flash, Grid, Section, Select, SubmitButton } from "@/ui/kit";
import { setGroupMembers, updateGroup } from "../../../_actions/setup";
import { guard, load } from "../../../_lib";

export const metadata: Metadata = { title: "Teaching group" };

export default async function GroupPage(props: PageProps<"/s/[schoolSlug]/setup/groups/[groupId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  guard(can(ctx, "settings.manage"));
  const [g] = await ctx.db.select().from(teachingGroup).where(eq(teachingGroup.id, params.groupId));
  guard(g);
  const members = await groupMembers(ctx, g.id);
  const inGroup = ctx.db.select({ id: groupMember.studentId }).from(groupMember).where(eq(groupMember.teachingGroupId, g.id));
  // Candidates: students enrolled this year (optionally same form), not already in the group.
  const candidates = await ctx.db
    .select({ id: student.id, first: student.firstName, last: student.lastName, adm: student.admissionNumber, cls: schoolClass.name })
    .from(enrolment)
    .innerJoin(student, eq(student.id, enrolment.studentId))
    .innerJoin(schoolClass, eq(schoolClass.id, enrolment.classId))
    .where(and(eq(enrolment.academicYearId, g.academicYearId), eq(enrolment.status, "active"), g.formId ? eq(schoolClass.formId, g.formId) : undefined, notInArray(student.id, inGroup)))
    .orderBy(schoolClass.name, student.lastName)
    .limit(800);
  const staff = await listStaff(ctx);
  const here = `${base}/setup/groups/${g.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/setup?tab=groups`} className="text-brand-700 underline">← Teaching groups</Link></p>
      <PageHeader title={g.name} description={`${members.length} students`} />
      <Flash sp={sp} />
      <Details summary="Teacher">
        <ActionForm action={updateGroup.bind(null, slug)} back={here}>
          <input type="hidden" name="groupId" value={g.id} />
          <Grid><Select label="Teacher" name="teacherPersonId" defaultValue={g.teacherPersonId ?? ""} placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} /></Grid>
          <div><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      </Details>
      <ActionForm action={setGroupMembers.bind(null, slug)} back={here}>
        <input type="hidden" name="groupId" value={g.id} />
        <Section title="Members (tick to remove)">
          <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white p-2">
            {members.map((m) => <label key={m.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="remove" value={m.id} className="size-5" />{m.lastName}, {m.firstName}</label>)}
            {!members.length ? <p className="text-sm text-slate-500">No members yet.</p> : null}
          </div>
        </Section>
        <Section title="Add students (individual subject selection)">
          <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white p-2">
            {candidates.map((m) => <label key={m.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="add" value={m.id} className="size-5" />{m.last}, {m.first} <span className="text-slate-500">{m.cls}</span></label>)}
            {!candidates.length ? <p className="text-sm text-slate-500">No other enrolled students for this form.</p> : null}
          </div>
        </Section>
        <div><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
