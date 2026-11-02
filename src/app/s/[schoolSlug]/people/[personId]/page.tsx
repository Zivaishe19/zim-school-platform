import type { Metadata } from "next";
import Link from "next/link";
import { listPeople } from "@/modules/people/service";
import { can } from "@/server/tenancy/context";
import { ROLE_KEYS, ROLE_LABELS } from "@/server/rbac/roles";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Checkbox, Flash, Input, Section, SubmitButton } from "@/ui/kit";
import { resetPassword, revoke, setRoles } from "../../_actions/people";
import { guard, load } from "../../_lib";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage(props: PageProps<"/s/[schoolSlug]/people/[personId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  guard(can(ctx, "users.manage"));
  const p = (await listPeople(ctx)).find((x) => x.id === params.personId);
  guard(p);
  const here = `${base}/people/${p.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/people`} className="text-brand-700 underline">← People</Link></p>
      <PageHeader title={`${p.firstName} ${p.lastName}`} description={p.login ? `Signs in as ${p.login}` : "No login"} />
      <Flash sp={sp} />
      <Section title="Roles at this school">
        <Card>
          <ActionForm action={setRoles.bind(null, slug)} back={here}>
            <input type="hidden" name="personId" value={p.id} />
            <div className="flex flex-wrap gap-x-4">{ROLE_KEYS.map((r) => <Checkbox key={r} label={ROLE_LABELS[r]} name="roles" value={r} defaultChecked={p.roles.includes(r)} />)}</div>
            <div><SubmitButton>Save roles</SubmitButton></div>
          </ActionForm>
        </Card>
      </Section>
      {p.login ? (
        <Section title="Reset password">
          <Card>
            <p className="mb-3 text-sm text-slate-600">You set a temporary password; you never see their old one. They are signed out everywhere and must choose a new password. Accounts also used at another school must be reset by platform support.</p>
            <ActionForm action={resetPassword.bind(null, slug)} back={here}>
              <input type="hidden" name="personId" value={p.id} />
              <Input label="Temporary password" name="password" type="text" autoComplete="off" minLength={10} required />
              <div><SubmitButton confirm="Reset this person's password?">Reset password</SubmitButton></div>
            </ActionForm>
          </Card>
        </Section>
      ) : null}
      {p.login ? (
        <Section title="Remove access">
          <ActionForm action={revoke.bind(null, slug)} back={`${base}/people`}>
            <input type="hidden" name="personId" value={p.id} />
            <p className="text-sm text-slate-600">Stops this login from opening this school. Their records stay.</p>
            <div><SubmitButton variant="secondary" confirm="Remove this person's access to the school?">Remove access</SubmitButton></div>
          </ActionForm>
        </Section>
      ) : null}
    </>
  );
}
