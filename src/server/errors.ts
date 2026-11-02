/** A business-rule failure whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
