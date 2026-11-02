"use client";
import { Button } from "./primitives";

/** Browser print (choose "Save as PDF" to get a PDF). */
export function PrintButton() {
  return <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>;
}
