import { twMerge } from "tailwind-merge";

export type ClassName =
  | string
  | false
  | null
  | undefined
  | Record<string, boolean | null | undefined>;

export function cn(...values: ClassName[]): string {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (typeof value === "string") {
      classes.push(value);
      continue;
    }
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) {
        classes.push(key);
      }
    }
  }
  return twMerge(classes.join(" "));
}
