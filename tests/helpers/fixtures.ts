import { readFileSync } from "node:fs";
import path from "node:path";

export type Fixtures = {
  schools: { A: string; B: string; slugA: string; slugB: string; dbA: string; dbB: string };
  users: Record<"headA" | "adminA" | "adminB" | "both" | "teacherA" | "teacherA2" | "accountsA" | "librarianA" | "parentA" | "studentUserA" | "operator", string>;
  structure: { yearId: string; termId: string; classId: string; groupId: string; teacherAPerson: string };
  students: { A: string[]; B: string[]; parentChildren: string[]; studentSelf: string };
  password: string;
};

export const fx: Fixtures = JSON.parse(readFileSync(path.join(process.cwd(), "tests", ".fixtures.json"), "utf8"));

export const asUser = (id: string) => ({ id, name: "test user" });
