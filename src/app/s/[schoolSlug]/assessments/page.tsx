import type { Metadata } from "next";
import Link from "next/link";
import { currentYear, listGroups } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { Flash, Table } from "@/ui/kit";
import { guard, load } from "../_lib";

export const metadata: Metadata = { title: "Assessments" };

export default async function AssessmentsPage(props: PageProps<"/s/[schoolSlug]/assessments">) {
  const { ctx, sp, base } = await load(props);
  guard(can(ctx, "assessments.manage_own") || can(ctx, "marks.approve"));
  const yr = await currentYear(ctx);
  const all = can(ctx, "marks.approve") || can(ctx, "settings.manage");
  const groups = await listGroups(ctx, { yearId: yr?.id, teacherPersonId: all ? undefined : (ctx.personId ?? "none") });
  return (
    <>
      <PageHeader title="Assessments and coursework" description={all ? "All teaching groups. Approve and publish marks from each assessment." : "Your teaching groups."} />
      <Flash sp={sp} />
      <Table caption="Teaching groups" rows={groups} rowKey={(g) => g.id} empty="No teaching groups assigned to you this year." columns={[
        { header: "Group", cell: (g) => <Link className="font-medium text-brand-700 underline" href={`${base}/assessments/group/${g.id}`}>{g.name}</Link> },
        { header: "Subject", cell: (g) => `${g.subjectName} (${g.examBoard.toUpperCase()})` },
        { header: "Teacher", cell: (g) => (g.teacherFirst ? `${g.teacherFirst} ${g.teacherLast}` : "—"), hideOnMobile: true },
        { header: "Students", cell: (g) => g.size },
      ]} />
    </>
  );
}
