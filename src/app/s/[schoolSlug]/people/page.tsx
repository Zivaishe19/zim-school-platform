import type { Metadata } from "next";
import Link from "next/link";
import { listPeople } from "@/modules/people/service";
import { can } from "@/server/tenancy/context";
import { ROLE_KEYS, ROLE_LABELS } from "@/server/rbac/roles";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Checkbox, Details, Flash, Grid, Input, Select, SubmitButton, Table } from "@/ui/kit";
import { addPerson } from "../_actions/people";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage(props: PageProps<"/s/[schoolSlug]/people">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "users.manage"));
  const role = str(sp.role);
  const rows = await listPeople(ctx, { role: role || undefined, q: str(sp.q) || undefined });
  return (
    <>
      <PageHeader title="People and accounts" description="Staff, parents and students who can sign in to this school." />
      <Flash sp={sp} />
      <Details summary="Add a person (staff, parent or student)">
        <ActionForm action={addPerson.bind(null, slug)} back={`${base}/people`}>
          <Grid>
            <Input label="First name" name="firstName" required />
            <Input label="Last name" name="lastName" required />
            <Input label="Email" name="email" type="email" hint="If this email already has an account (e.g. at another school), it is linked: their password is not changed." />
            <Input label="Username (for people without email)" name="username" />
            <Input label="Temporary password" name="password" type="text" autoComplete="off" hint="10+ characters; they must change it at first sign-in." />
            <Input label="Employee number (staff)" name="employeeNumber" />
            <Input label="Job title (staff)" name="jobTitle" />
            <Input label="Phone" name="phone" />
          </Grid>
          <fieldset className="flex flex-wrap gap-x-4"><legend className="mb-1 text-sm font-medium">Roles</legend>{ROLE_KEYS.map((r) => <Checkbox key={r} label={ROLE_LABELS[r]} name="roles" value={r} />)}</fieldset>
          <div><SubmitButton>Add person</SubmitButton></div>
        </ActionForm>
      </Details>
      <form className="mb-4 flex flex-wrap items-end gap-2" action={`${base}/people`}>
        <Input label="Search name" name="q" defaultValue={str(sp.q)} />
        <Select label="Role" name="role" defaultValue={role} placeholder="All roles" options={ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Filter</button>
      </form>
      <Table caption="People" rows={rows} rowKey={(r) => r.id} columns={[
        { header: "Name", cell: (p) => <Link className="font-medium text-brand-700 underline" href={`${base}/people/${p.id}`}>{p.lastName}, {p.firstName}</Link> },
        { header: "Roles", cell: (p) => p.roles.map((r) => ROLE_LABELS[r]).join(", ") || "—" },
        { header: "Sign-in", cell: (p) => p.login ?? <span className="text-slate-500">no login</span>, hideOnMobile: true },
      ]} />
    </>
  );
}
