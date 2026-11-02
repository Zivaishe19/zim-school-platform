import type { Metadata } from "next";
import { teacherIndicators } from "@/modules/staff/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { Table, Tabs } from "@/ui/kit";
import { guard, load } from "../../_lib";
import { staffTabs } from "../tabs";

export const metadata: Metadata = { title: "Teacher indicators" };

export default async function PerformancePage(props: PageProps<"/s/[schoolSlug]/staff/performance">) {
  const { ctx, base } = await load(props);
  guard(can(ctx, "teacher_performance.view"));
  const rows = await teacherIndicators(ctx, 30);
  return (
    <>
      <PageHeader title="Staff" />
      <Tabs items={staffTabs(base, (p) => can(ctx, p))} current={`${base}/staff/performance`} />
      <Card className="mb-4 text-sm text-slate-700">
        <p className="mb-1 font-semibold">How to read these (last 30 days)</p>
        <p>Descriptive indicators of workload and record-keeping, not a score. They are not based on student marks, and should be discussed with the teacher before drawing conclusions. Groups/students = current teaching load. Registers = lesson registers taken. Marking completion = share of marks entered (a score or &ldquo;missing&rdquo;) for assessments set in the period. Late/absent = staff register entries.</p>
      </Card>
      <Table caption="Teacher indicators" rows={rows} rowKey={(r) => r.personId} empty="No teachers yet." columns={[
        { header: "Teacher", cell: (r) => r.name }, { header: "Groups", cell: (r) => r.groups }, { header: "Students", cell: (r) => r.students },
        { header: "Registers taken", cell: (r) => r.registersTaken }, { header: "Assessments set", cell: (r) => r.assessmentsSet },
        { header: "Marking completion", cell: (r) => (r.markingCompletion === null ? "—" : `${r.markingCompletion}%`) },
        { header: "Days late / absent", cell: (r) => `${r.daysLate} / ${r.daysAbsent} (of ${r.daysRecorded} recorded)` },
      ]} />
    </>
  );
}
