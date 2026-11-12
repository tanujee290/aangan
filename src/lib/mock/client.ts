// A drop-in stand-in for the supabase-js client, used when no Supabase project is connected.
// It speaks the same API the app uses (from/select/insert/update/delete/upsert with filters,
// rpc, auth and storage) and runs every request against the in-browser mock database, so the
// whole product — accounts, roles, receipts, reminders, invoices, documents — works end to end.
import type { Session, User } from "@supabase/supabase-js";
import { getDB, files, onExternalChange, save, type MockMail, type MockUser, type Row, type TableName } from "./store";
import { isOnline } from "../network";
import { MockError, allowed, context, deleteRows, insertRows, transaction, updateRows, uuid } from "./engine";
import { RPC } from "./rpc";

type Result<T = unknown> = { data: T; error: ReturnType<MockError["toJSON"]> | null; count: number | null; status: number; statusText: string };
type Filter = (r: Row) => boolean;

/** A short pause so loading and busy states look as they would over the network. */
const latency = () => new Promise((r) => setTimeout(r, 8 + Math.random() * 22));
const ok = <T,>(data: T, status = 200): Result<T> => ({ data, error: null, count: Array.isArray(data) ? data.length : null, status, statusText: "OK" });
/** What supabase-js reports when fetch() can't reach the server. */
const networkError = () => new MockError("TypeError: Failed to fetch", "");
/** Throws like a dropped connection while the device (or the simulated outage) is offline. */
function reachable() {
  if (!isOnline()) throw networkError();
}
const fail = (e: unknown): Result<null> => {
  const err = e instanceof MockError ? e : new MockError(e instanceof Error ? e.message : String(e), "XX000");
  return { data: null, error: err.toJSON(), count: null, status: 400, statusText: "Bad Request" };
};

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  const na = Number(a), nb = Number(b);
  if (a !== "" && b !== "" && a !== null && b !== null && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== "boolean") return na - nb;
  return String(a).localeCompare(String(b));
}

function pick(row: Row, columns: string) {
  const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0 || cols.includes("*")) return { ...row };
  return Object.fromEntries(cols.map((c) => [c, row[c] ?? null]));
}

/* -------------------------------------------------------------- query builder */

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private max: number | null = null;
  private returning: string | null = "*";
  private mode: "many" | "single" | "maybe" = "many";
  private payload: Row | Row[] | null = null;
  private upsertOpts = { onConflict: ["id"], ignoreDuplicates: false };
  private run: Promise<Result> | null = null;

  constructor(private table: TableName, private client: MockClient) {}

  select(columns = "*") {
    this.returning = columns;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert"; this.payload = values; this.returning = null;
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert"; this.payload = values; this.returning = null;
    this.upsertOpts = { onConflict: (opts.onConflict ?? "id").split(",").map((s) => s.trim()), ignoreDuplicates: !!opts.ignoreDuplicates };
    return this;
  }
  update(values: Row) {
    this.op = "update"; this.payload = values; this.returning = null;
    return this;
  }
  delete() {
    this.op = "delete"; this.returning = null;
    return this;
  }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] != null && String(r[col]) === String(v)); return this; }
  neq(col: string, v: unknown) { this.filters.push((r) => r[col] != null && String(r[col]) !== String(v)); return this; }
  is(col: string, v: null | boolean) { this.filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return this; }
  in(col: string, vs: unknown[]) { const set = new Set(vs.map(String)); this.filters.push((r) => set.has(String(r[col]))); return this; }
  gt(col: string, v: unknown) { this.filters.push((r) => r[col] != null && compare(r[col], v) > 0); return this; }
  gte(col: string, v: unknown) { this.filters.push((r) => r[col] != null && compare(r[col], v) >= 0); return this; }
  lt(col: string, v: unknown) { this.filters.push((r) => r[col] != null && compare(r[col], v) < 0); return this; }
  lte(col: string, v: unknown) { this.filters.push((r) => r[col] != null && compare(r[col], v) <= 0); return this; }
  match(q: Row) { for (const [k, v] of Object.entries(q)) this.eq(k, v); return this; }
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const asc = opts.ascending ?? true;
    this.orders.push({ col, asc, nullsFirst: opts.nullsFirst ?? !asc });
    return this;
  }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  throwOnError() { return this; }

  then<A = Result, B = never>(onOk?: ((v: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null) {
    this.run ??= this.execute();
    return this.run.then(onOk, onErr);
  }

  private async execute(): Promise<Result> {
    await latency();
    try {
      reachable();
      const c = context(this.client.currentUserId());
      const all = getDB().tables[this.table];
      if (!all) throw new MockError(`relation "public.${this.table}" does not exist`, "42P01");
      const matches = () => all.filter((r) => this.filters.every((f) => f(r)));
      let rows: Row[];
      if (this.op === "select") {
        rows = matches().filter((r) => allowed(this.table, "select", r, c));
      } else {
        const input = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
        rows = transaction(() => {
          if (this.op === "insert") return insertRows(this.table, input, c);
          if (this.op === "upsert") return insertRows(this.table, input, c, { upsert: this.upsertOpts });
          // Like PostgREST, update and delete only touch rows the caller can see.
          const visible = matches().filter((r) => allowed(this.table, "select", r, c));
          return this.op === "update" ? updateRows(this.table, visible, this.payload as Row, c) : deleteRows(this.table, visible, c);
        });
        if (this.returning === null) return ok(null, this.op === "insert" || this.op === "upsert" ? 201 : 204);
      }
      if (this.orders.length) {
        rows = rows.slice().sort((a, b) => {
          for (const o of this.orders) {
            const av = a[o.col], bv = b[o.col];
            if (av == null || bv == null) {
              if (av == null && bv == null) continue;
              return (av == null) === o.nullsFirst ? -1 : 1;
            }
            const d = compare(av, bv);
            if (d !== 0) return o.asc ? d : -d;
          }
          return 0;
        });
      }
      if (this.max !== null) rows = rows.slice(0, this.max);
      const out = rows.map((r) => pick(structuredClone(r), this.returning ?? "*"));
      if (this.mode === "many") return ok(out);
      if (out.length > 1 || (out.length === 0 && this.mode === "single")) {
        throw new MockError("JSON object requested, multiple (or no) rows returned", "PGRST116");
      }
      return ok(out[0] ?? null);
    } catch (e) {
      return fail(e);
    }
  }
}

/* --------------------------------------------------------------------- auth */

type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type Listener = (event: AuthEvent, session: Session | null) => void;

function toUser(u: MockUser): User {
  const providers = u.providers?.length ? u.providers : ["email"];
  return {
    id: u.id, email: u.email, aud: "authenticated", role: "authenticated", created_at: u.created_at,
    app_metadata: { provider: providers[0], providers }, user_metadata: u.name ? { full_name: u.name, name: u.name } : {},
  } as User;
}

function toSession(u: MockUser): Session {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `mock.${u.id}`, refresh_token: `mock-refresh.${u.id}`, token_type: "bearer",
    expires_in: 3600, expires_at: expires, user: toUser(u),
  };
}

const authError = (message: string, code: string, status = 400) => ({ message, code, status, name: "AuthApiError" });
const cleanEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const offlineAuth = () => ({ data: { user: null, session: null }, error: { message: "Failed to fetch", status: 0, name: "AuthRetryableFetchError" } });
/** Like GoTrue's email rate limit: one sign-in link per address per minute. */
const OTP_COOLDOWN_S = 60;
const LINK_TTL_MS = 60 * 60 * 1000;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only same-origin redirects are allowed, as with Supabase's redirect allow list. */
function safeRedirect(to: unknown, fallback = "/app") {
  try {
    const u = new URL(String(to ?? fallback), window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

function addProvider(u: MockUser, provider: string) {
  const list = u.providers?.length ? u.providers : u.password ? ["email"] : [];
  if (!list.includes(provider)) list.push(provider);
  u.providers = list;
}

class MockAuth {
  private listeners = new Set<Listener>();

  constructor() {
    // Another tab signed in or out: follow it, as supabase-js does.
    onExternalChange((before) => {
      if (before.session !== getDB().session) this.emit(getDB().session ? "SIGNED_IN" : "SIGNED_OUT");
    });
  }

  private user(): MockUser | undefined {
    const id = getDB().session;
    return id ? getDB().users.find((u) => u.id === id) : undefined;
  }
  private session() {
    const u = this.user();
    return u ? toSession(u) : null;
  }
  private emit(event: AuthEvent) {
    const s = this.session();
    for (const l of this.listeners) l(event, s);
  }
  private setSession(id: string | null) {
    getDB().session = id;
    save();
    this.emit(id ? "SIGNED_IN" : "SIGNED_OUT");
  }

  async getSession() {
    return { data: { session: this.session() }, error: null };
  }
  async getUser() {
    const u = this.user();
    return u ? { data: { user: toUser(u) }, error: null } : { data: { user: null }, error: authError("Auth session missing!", "session_not_found", 401) };
  }
  onAuthStateChange(cb: Listener) {
    this.listeners.add(cb);
    queueMicrotask(() => cb("INITIAL_SESSION", this.session()));
    return { data: { subscription: { id: uuid(), callback: cb, unsubscribe: () => this.listeners.delete(cb) } } };
  }
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    await latency();
    if (!isOnline()) return offlineAuth();
    const u = getDB().users.find((x) => x.email === cleanEmail(email));
    if (!u || !u.password || u.password !== password) {
      return { data: { user: null, session: null }, error: authError("Invalid login credentials", "invalid_credentials") };
    }
    this.setSession(u.id);
    return { data: { user: toUser(u), session: toSession(u) }, error: null };
  }
  async signUp({ email, password }: { email: string; password: string; options?: unknown }) {
    await latency();
    if (!isOnline()) return offlineAuth();
    const addr = cleanEmail(email);
    if (!EMAIL.test(addr)) return { data: { user: null, session: null }, error: authError("Please enter a valid email address.", "validation_failed") };
    if (String(password ?? "").length < 8) return { data: { user: null, session: null }, error: authError("Password should be at least 8 characters.", "weak_password", 422) };
    const db = getDB();
    const existing = db.users.find((x) => x.email === addr);
    if (existing?.password) return { data: { user: null, session: null }, error: authError("User already registered", "user_already_exists", 422) };
    const u: MockUser = existing ?? { id: uuid(), email: addr, password, created_at: new Date().toISOString() };
    u.password = password;
    addProvider(u, "email");
    if (!existing) db.users.push(u);
    this.setSession(u.id);
    return { data: { user: toUser(u), session: toSession(u) }, error: null };
  }
  /**
   * Magic links: instead of emailing, the mock files the message in its inbox (/mock/inbox).
   * Opening the link calls verifyOtp() on /auth/confirm, exactly as a custom Supabase email template would.
   */
  async signInWithOtp({ email, options }: { email: string; options?: { emailRedirectTo?: string; shouldCreateUser?: boolean } }) {
    await latency();
    if (!isOnline()) return offlineAuth();
    const addr = cleanEmail(email);
    if (!EMAIL.test(addr)) return { data: { user: null, session: null }, error: authError("Please enter a valid email address.", "validation_failed") };
    const db = getDB();
    const mail = (db.mail ??= []);
    const last = mail.find((m) => m.to === addr);
    const wait = last ? OTP_COOLDOWN_S - Math.floor((Date.now() - Date.parse(last.sent_at)) / 1000) : 0;
    if (wait > 0) {
      return { data: { user: null, session: null }, error: authError(`For security purposes, you can only request this after ${wait} seconds.`, "over_email_send_rate_limit", 429) };
    }
    let u = db.users.find((x) => x.email === addr);
    if (!u) {
      if (options?.shouldCreateUser === false) return { data: { user: null, session: null }, error: authError("Signups not allowed for otp", "otp_disabled", 422) };
      u = { id: uuid(), email: addr, password: null, created_at: new Date().toISOString(), providers: ["email"] };
      db.users.push(u);
    }
    const token = randomToken();
    const next = safeRedirect(options?.emailRedirectTo);
    const link = `${window.location.origin}/auth/confirm?token_hash=${token}&type=magiclink&next=${encodeURIComponent(next)}`;
    const now = new Date();
    const msg: MockMail = {
      id: uuid(), to: addr, subject: "Your Aangan sign-in link", type: "magiclink", token, link,
      body: "Tap the button below to sign in to Aangan. The link works once and expires in an hour. If you didn't ask for it, you can ignore this email.",
      sent_at: now.toISOString(), expires_at: new Date(now.getTime() + LINK_TTL_MS).toISOString(), used_at: null,
    };
    db.mail = [msg, ...mail].slice(0, 50);
    save();
    return { data: { user: null, session: null }, error: null };
  }

  async verifyOtp({ token_hash }: { token_hash?: string; type?: string; email?: string; token?: string }) {
    await latency();
    if (!isOnline()) return offlineAuth();
    const db = getDB();
    const msg = (db.mail ?? []).find((m) => m.token === token_hash);
    const invalid = () => ({ data: { user: null, session: null }, error: authError("Email link is invalid or has expired", "otp_expired", 403) });
    if (!msg || msg.used_at || Date.parse(msg.expires_at) < Date.now()) return invalid();
    const u = db.users.find((x) => x.email === msg.to);
    if (!u) return invalid();
    msg.used_at = new Date().toISOString();
    addProvider(u, "email");
    this.setSession(u.id);
    return { data: { user: toUser(u), session: toSession(u) }, error: null };
  }

  /** Google sign-in goes to a mock consent screen (/mock/oauth/google), then back to `redirectTo`. */
  async signInWithOAuth({ provider, options }: { provider: string; options?: { redirectTo?: string; skipBrowserRedirect?: boolean } }) {
    if (provider !== "google") {
      return { data: { provider, url: null }, error: authError(`Unsupported provider: provider ${provider} is not enabled`, "provider_disabled") };
    }
    if (!isOnline()) return { data: { provider, url: null }, error: offlineAuth().error };
    const url = `${window.location.origin}/mock/oauth/google?redirect_to=${encodeURIComponent(safeRedirect(options?.redirectTo))}`;
    if (!options?.skipBrowserRedirect) window.location.assign(url);
    return { data: { provider, url }, error: null };
  }

  /** Mock-only: the consent screen picked an account. Creates or links it, then signs in. */
  completeOAuth(provider: string, email: string, name: string | null) {
    const addr = cleanEmail(email);
    if (!EMAIL.test(addr)) throw new Error("Please enter a valid email address.");
    const db = getDB();
    let u = db.users.find((x) => x.email === addr);
    if (!u) {
      u = { id: uuid(), email: addr, password: null, created_at: new Date().toISOString(), providers: [] };
      db.users.push(u);
    }
    addProvider(u, provider);
    if (name?.trim()) u.name = name.trim();
    this.setSession(u.id);
  }

  async signOut() {
    await latency();
    this.setSession(null);
    return { error: null };
  }
}

/* ------------------------------------------------------------------ storage */

class Bucket {
  constructor(private bucket: string, private client: MockClient) {}

  private guard(path: string, write: boolean) {
    reachable();
    const c = context(this.client.currentUserId());
    if (!c.uid || !c.ws || path.split("/")[0] !== c.ws) throw new MockError("new row violates row-level security policy", "403");
    if (write && !(c.role === "owner" || c.role === "manager")) throw new MockError("Your role can view files but not change them", "403");
  }
  private key(path: string) {
    return `${this.bucket}/${path}`;
  }

  async upload(path: string, file: Blob, opts: { contentType?: string; upsert?: boolean } = {}) {
    await latency();
    try {
      this.guard(path, true);
      if (!opts.upsert && (await files.get(this.key(path)))) throw new MockError("The resource already exists", "409");
      const blob = opts.contentType && file.type !== opts.contentType ? new Blob([file], { type: opts.contentType }) : file;
      await files.put(this.key(path), blob);
      return { data: { path, id: uuid(), fullPath: this.key(path) }, error: null };
    } catch (e) {
      return { data: null, error: fail(e).error };
    }
  }

  async createSignedUrl(path: string, _expiresIn: number) {
    await latency();
    try {
      this.guard(path, false);
      let blob = await files.get(this.key(path));
      if (!blob) {
        // Sample documents have no real file behind them; show a clear placeholder instead.
        const doc = getDB().tables.documents.find((d) => d.path === path);
        if (!doc) throw new MockError("Object not found", "404");
        blob = new Blob([
          `${doc.name}\n\nThis is a sample document in the Aangan preview.\nUpload your own file from Documents to store and open it here.\n`,
        ], { type: "text/plain" });
      }
      return { data: { signedUrl: URL.createObjectURL(blob) }, error: null };
    } catch (e) {
      return { data: null, error: fail(e).error };
    }
  }

  async remove(paths: string[]) {
    await latency();
    try {
      for (const p of paths) this.guard(p, true);
      for (const p of paths) await files.remove(this.key(p));
      return { data: paths.map((name) => ({ name })), error: null };
    } catch (e) {
      return { data: null, error: fail(e).error };
    }
  }
}

/* ------------------------------------------------------------------- client */

export class MockClient {
  readonly auth: MockAuth;
  readonly storage = { from: (bucket: string) => new Bucket(bucket, this) };
  constructor() {
    this.auth = new MockAuth();
  }

  currentUserId() {
    return getDB().session;
  }

  from(table: string) {
    return new Query(table as TableName, this);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    await latency();
    const def = RPC[name];
    if (!def) return fail(new MockError(`Could not find the function public.${name}`, "PGRST202"));
    if (!isOnline()) return fail(networkError());
    const c = context(this.currentUserId());
    if (!def.anon && !c.uid) return fail(new MockError(`permission denied for function ${name}`, "42501"));
    try {
      const data = def.writes ? transaction(() => def.fn(args, c)) : def.fn(args, c);
      return ok(structuredClone(data ?? null));
    } catch (e) {
      return fail(e);
    }
  }
}

let current: MockClient | null = null;

export function createMockClient() {
  current = new MockClient();
  return current;
}

/* ------------------------------------------------- mock-only helpers for pages */

/** The mock consent screen calls this when an account is chosen. */
export function completeMockOAuth(provider: string, email: string, name: string | null) {
  if (!current) throw new Error("The mock backend isn't active.");
  current.auth.completeOAuth(provider, email, name);
}

/** Emails in the mock inbox, newest first. */
export function mockMail(): MockMail[] {
  return structuredClone(getDB().mail ?? []);
}

/** Accounts on the mock backend, for the consent screen's account chooser. */
export function mockAccounts() {
  return getDB().users.map((u) => ({ email: u.email, name: u.name ?? null, google: !!u.providers?.includes("google") }));
}
