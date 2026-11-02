import type { Metadata } from "next";
import Link from "next/link";
import { myNotifications } from "@/modules/comms/service";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Flash, fmtDateTime, SubmitButton } from "@/ui/kit";
import { readAll } from "../_actions/comms";
import { load } from "../_lib";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage(props: PageProps<"/s/[schoolSlug]/notifications">) {
  const { ctx, sp, base, slug } = await load(props);
  const items = await myNotifications(ctx, 100);
  return (
    <>
      <PageHeader title="Notifications" actions={<ActionForm action={readAll.bind(null, slug)} back={`${base}/notifications`} className="inline"><SubmitButton variant="secondary">Mark all read</SubmitButton></ActionForm>} />
      <Flash sp={sp} />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((n) => (
          <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-brand-50"}`}>
            <p className="font-medium">{n.link && n.link.startsWith(base) ? <Link className="underline" href={n.link}>{n.title}</Link> : n.title}</p>
            {n.body ? <p className="text-sm text-slate-700">{n.body}</p> : null}
            <p className="text-xs text-slate-500">{fmtDateTime(n.createdAt)} · {n.source}</p>
          </li>
        ))}
        {!items.length ? <li className="px-4 py-6 text-center text-sm text-slate-500">No notifications.</li> : null}
      </ul>
    </>
  );
}
