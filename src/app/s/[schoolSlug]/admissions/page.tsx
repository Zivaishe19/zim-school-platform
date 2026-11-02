import type { Metadata } from "next";
import Link from "next/link";
import { listApplications } from "@/modules/admissions/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { Badge, Details, Flash, fmtDate, Table, Tabs } from "@/ui/kit";
import { ApplicationFields } from "@/ui/application-fields";
import { walkIn } from "../_actions/admissions";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Admissions" };
const STATUSES = ["submitted", "under_review", "info_required", "accepted", "rejected"];

export default async function AdmissionsPage(props: PageProps<"/s/[schoolSlug]/admissions">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "admissions.manage"));
  const status = str(sp.status, "submitted");
  const rows = await listApplications(ctx, status === "all" ? undefined : status);
  return (
    <>
      <PageHeader title="Admissions" description={`Online form for parents: ${base.replace("/s/", "/apply/")}`} />
      <Flash sp={sp} />
      <Tabs current={`${base}/admissions?status=${status}`} items={[...STATUSES, "all"].map((s) => ({ href: `${base}/admissions?status=${s}`, label: s.replace("_", " ") }))} />
      <Table caption="Applications" rows={rows} rowKey={(r) => r.id} columns={[
        { header: "Reference", cell: (a) => <Link className="font-medium text-brand-700 underline" href={`${base}/admissions/${a.id}`}>{a.reference}</Link> },
        { header: "Applicant", cell: (a) => `${a.lastName}, ${a.firstName}` },
        { header: "Entry", cell: (a) => `${a.entryType.replace("form", "Form ").replace("lower6", "Lower Six").replace("transfer", "Transfer")}` },
        { header: "Source", cell: (a) => a.source.replace("_", " "), hideOnMobile: true },
        { header: "Received", cell: (a) => fmtDate(a.createdAt), hideOnMobile: true },
        { header: "Status", cell: (a) => <Badge>{a.status}</Badge> },
      ]} />
      <Details summary="Record a walk-in application">
        <ApplicationFields action={walkIn.bind(null, slug)} back={`${base}/admissions`} />
      </Details>
    </>
  );
}
