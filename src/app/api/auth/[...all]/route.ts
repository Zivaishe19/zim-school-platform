import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Built per call (cached inside getAuth) so `next build` never needs runtime secrets.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
