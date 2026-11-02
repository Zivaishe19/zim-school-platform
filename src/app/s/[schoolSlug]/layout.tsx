import Link from "next/link";
import { redirect } from "next/navigation";
import { unreadCount } from "@/modules/comms/service";
import { platformDb } from "@/server/db/platform/client";
import { user } from "@/server/db/platform/schema";
import { eq } from "drizzle-orm";
import { SchoolUnavailableError } from "@/server/tenancy/client-cache";
import { can, type SchoolContext } from "@/server/tenancy/context";
import { requireSchoolContext } from "@/server/tenancy/require-context";
import { PRIVILEGED_ROLES, ROLE_LABELS } from "@/server/rbac/roles";
import { SignOutButton } from "@/ui/sign-out-button";

export default async function SchoolLayout({ children, params }: LayoutProps<"/s/[schoolSlug]">) {
  const { schoolSlug } = await params;
  let ctx: SchoolContext;
  try {
    ctx = await requireSchoolContext(schoolSlug);
  } catch (e) {
    if (e instanceof SchoolUnavailableError) return <Maintenance />;
    throw e; // redirect()/notFound() and real errors
  }

  // Account rules apply in every school: forced password change, MFA for privileged roles.
  const [u] = await platformDb().select({ must: user.mustChangePassword, mfa: user.twoFactorEnabled }).from(user).where(eq(user.id, ctx.user.id));
  if (u?.must) redirect("/account?required=password");
  const mfaRequired = process.env.REQUIRE_MFA_FOR_PRIVILEGED !== "false";
  if (mfaRequired && !u?.mfa && ctx.roles.some((r) => PRIVILEGED_ROLES.includes(r))) redirect("/account?required=mfa");

  const base = `/s/${ctx.school.slug}`;
  const unread = await unreadCount(ctx);
  const roleText = ctx.roles.length ? ctx.roles.map((r) => ROLE_LABELS[r]).join(", ") : "No role assigned";
  const has = (...p: Parameters<typeof can>[1][]) => p.some((x) => can(ctx, x));

  const nav: [string, string, boolean][] = [
    ["", "Dashboard", true],
    ["/students", "Students", has("students.view_all", "students.view_taught", "students.view_linked", "students.view_self")],
    ["/attendance", "Attendance", has("attendance.take", "attendance.view_all", "absence.review", "portal.guardian")],
    ["/assessments", "Assessments", has("assessments.manage_own", "marks.approve")],
    ["/learning", "My learning", has("portal.student")],
    ["/reports", "Reports", has("reports.prepare", "reports.approve", "reports.view_all", "portal.guardian", "portal.student")],
    ["/timetable", "Timetable", true],
    ["/messages", "Messages", has("messages.staff", "portal.guardian")],
    ["/announcements", "Announcements", true],
    ["/events", "Events", true],
    ["/activities", "Clubs & sports", true],
    ["/fees", "Fees", has("fees.manage", "fees.view_all", "portal.guardian")],
    ["/library", "Library", has("library.manage")],
    ["/discipline", "Discipline", has("discipline.report", "discipline.decide", "discipline.view_all")],
    ["/duties", "Class duties", has("duties.manage")],
    ["/staff", "Staff", has("staff_attendance.view", "leave.request", "leave.review", "teacher_performance.view")],
    ["/admissions", "Admissions", has("admissions.manage")],
    ["/people", "People", has("users.manage")],
    ["/setup", "Setup", has("settings.manage", "progression.manage")],
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <Link href={base} className="block truncate font-semibold">
              {ctx.school.name}
            </Link>
            <p className="truncate text-xs text-slate-600">
              {ctx.user.name} · {roleText}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`${base}/notifications`} className="rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              Notifications{unread ? <span className="ml-1 rounded-full bg-brand-600 px-2 py-0.5 text-xs text-white">{unread}</span> : null}
            </Link>
            <Link href="/account" className="rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              My account
            </Link>
            <Link href="/schools" className="hidden rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 sm:inline">
              Switch school
            </Link>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="School" className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {nav
            .filter(([, , show]) => show)
            .map(([path, label]) => (
              <Link key={path} href={`${base}${path}`} className="rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-slate-700 hover:bg-slate-100">
                {label}
              </Link>
            ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

function Maintenance() {
  return (
    <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">This school is being updated</h1>
      <p className="mt-2 text-sm text-slate-600">Its records are temporarily unavailable while maintenance finishes. Please try again in a few minutes.</p>
      <p className="mt-6">
        <Link href="/schools" className="text-sm text-brand-700 underline">
          Back to your schools
        </Link>
      </p>
    </main>
  );
}
