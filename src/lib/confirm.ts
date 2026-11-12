/** Splits a one-line confirmation ("Delete this task? It can't be undone.") into an iOS alert's title, body and button. */
export type AlertSpec = { title: string; message: string; confirmLabel: string; destructive: boolean };

const VERBS: [RegExp, string, boolean][] = [
  [/^delete\b/i, "Delete", true],
  [/^remove\b/i, "Remove", true],
  [/^archive\b/i, "Archive", true],
  [/^void\b/i, "Void", true],
  [/^leave\b/i, "Leave", true],
  [/^revoke\b/i, "Revoke", true],
  [/^discard\b/i, "Discard", true],
  [/^reset\b/i, "Reset", true],
  [/^switch off\b/i, "Switch off", true],
  [/^create\b/i, "Create", false],
];

export function parseConfirm(text: string, opts: Partial<AlertSpec> = {}): AlertSpec {
  const t = text.trim();
  // The title is the question itself; anything after it becomes the smaller body text.
  const q = t.indexOf("? ");
  const title = q >= 0 ? t.slice(0, q + 1) : t;
  const message = q >= 0 ? t.slice(q + 2).trim() : "";
  const verb = VERBS.find(([re]) => re.test(t));
  return {
    title: opts.title ?? title,
    message: opts.message ?? message,
    confirmLabel: opts.confirmLabel ?? verb?.[1] ?? "OK",
    destructive: opts.destructive ?? verb?.[2] ?? false,
  };
}
