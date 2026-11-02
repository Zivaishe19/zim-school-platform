import { signOutAction } from "@/app/actions/sign-out";
import { Button } from "./primitives";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost">
        Sign out
      </Button>
    </form>
  );
}
