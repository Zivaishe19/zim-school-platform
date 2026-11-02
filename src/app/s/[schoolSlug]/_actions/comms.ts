"use server";
import { schoolAction } from "@/server/actions";
import * as comms from "@/modules/comms/service";

export async function announce(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => `Announcement sent to ${await comms.sendAnnouncement(c, v)} people.`); }
export async function readAll(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c) => { await comms.markAllRead(c); return "All notifications marked as read."; }); }
export async function startThread(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { const id = await comms.startThread(c, v); return { ok: "Message sent.", to: `/s/${c.school.slug}/messages/${id}` }; }); }
export async function reply(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.reply(c, String(v.threadId), String(v.body ?? "")); return "Reply sent."; }); }
export async function closeThread(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.closeThread(c, String(v.threadId)); return "Conversation closed."; }); }
export async function createEvent(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.createEvent(c, v); return "Event created."; }); }
export async function deleteEvent(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.deleteEvent(c, String(v.eventId)); return "Event removed."; }); }
export async function createActivity(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.createActivity(c, v); return "Activity created."; }); }
export async function addMember(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.addActivityMember(c, v); return "Member added."; }); }
export async function removeMember(slug: string, fd: FormData) { return schoolAction(slug, fd, async (c, v) => { await comms.removeActivityMember(c, String(v.activityId), String(v.studentId)); return "Member removed (history kept)."; }); }
