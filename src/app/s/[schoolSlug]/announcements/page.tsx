import type { Metadata } from "next";
import { myAnnouncements } from "@/modules/comms/service";
import { currentYear, listClasses, listForms, listGroups } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Details, Flash, fmtDateTime, Input, SubmitButton, TextArea } from "@/ui/kit";
import { AudienceFields } from "@/ui/audience-fields";
import { announce } from "../_actions/comms";
import { load } from "../_lib";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage(props: PageProps<"/s/[schoolSlug]/announcements">) {
  const { ctx, sp, base, slug } = await load(props);
  const items = await myAnnouncements(ctx, 100);
  const full = can(ctx, "announcements.send");
  const own = can(ctx, "announcements.send_own");
  const yr = await currentYear(ctx);
  const [forms, classes, groups] = full || own ? await Promise.all([listForms(ctx), listClasses(ctx, yr?.id), listGroups(ctx, { yearId: yr?.id, teacherPersonId: full ? undefined : (ctx.personId ?? "none") })]) : [[], [], []];
  const myClasses = full ? classes : classes.filter((c) => c.classTeacherPersonId === ctx.personId);
  return (
    <>
      <PageHeader title="Announcements" />
      <Flash sp={sp} />
      {full || own ? (
        <Details summary="Send an announcement">
          <ActionForm action={announce.bind(null, slug)} back={`${base}/announcements`}>
            <Input label="Title" name="title" required maxLength={160} />
            <TextArea label="Message" name="body" required maxLength={5000} />
            <AudienceFields kinds={full ? ["everyone", "staff", "parents", "students", "form", "class", "group"] : ["class", "group"]} forms={forms.map((f) => ({ id: f.id, name: f.name }))} classes={myClasses.map((c) => ({ id: c.id, name: c.name }))} groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
            <p className="text-xs text-slate-500">Class, form and group announcements reach the students and their parents. Delivered in the app only (no SMS); no sounds or phone alerts.</p>
            <div><SubmitButton>Send</SubmitButton></div>
          </ActionForm>
        </Details>
      ) : null}
      <ul className="flex flex-col gap-3">
        {items.map((a) => (
          <li key={a.a.id}><Card><h2 className="font-semibold">{a.a.title}</h2><p className="text-xs text-slate-500">{a.first ? `${a.first} ${a.last} · ` : ""}{fmtDateTime(a.a.createdAt)}</p><p className="mt-2 text-sm whitespace-pre-line">{a.a.body}</p></Card></li>
        ))}
        {!items.length ? <li className="text-sm text-slate-500">No announcements.</li> : null}
      </ul>
    </>
  );
}
