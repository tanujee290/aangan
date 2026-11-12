/** Constant-time check of `Authorization: Bearer <secret>`. Always false when no secret is configured. */
export function cronAuthorized(req: Request, secret: string | undefined) {
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
