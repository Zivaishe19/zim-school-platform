export function staffTabs(base: string, ctxCan: (p: "staff_attendance.view" | "leave.request" | "leave.review" | "teacher_performance.view") => boolean) {
  return [
    { href: `${base}/staff`, label: ctxCan("staff_attendance.view") ? "Staff register" : "My attendance" },
    ...(ctxCan("leave.request") || ctxCan("leave.review") ? [{ href: `${base}/staff/leave`, label: "Leave" }] : []),
    ...(ctxCan("teacher_performance.view") ? [{ href: `${base}/staff/performance`, label: "Teacher indicators" }] : []),
  ];
}
