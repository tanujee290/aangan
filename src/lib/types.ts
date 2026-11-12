export type PropertyType = "Apartment" | "Villa" | "House" | "Commercial" | "PG/Hostel" | "Other";
export const PROPERTY_TYPES: PropertyType[] = ["Apartment", "Villa", "House", "Commercial", "PG/Hostel", "Other"];

export type Method = "upi" | "bank" | "cash" | "cheque" | "card" | "other";
export const METHODS: { value: Method; label: string }[] = [
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
export type TaskStatus = "open" | "in_progress" | "done";

export const EXPENSE_CATEGORIES = [
  "Repairs", "Maintenance", "Utilities", "Property tax", "Insurance", "Society charges", "Cleaning", "Brokerage", "Other",
];

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  currency: string;
  locale: string;
  upi_id: string | null;
  invoice_prefix: string;
  receipt_seq: number;
  created_at: string;
}

export interface Property {
  id: string;
  workspace_id: string;
  name: string;
  type: PropertyType;
  address: string | null;
  created_at: string;
  archived_at: string | null;
  cover_path?: string | null;
}

export interface Unit {
  id: string;
  property_id: string;
  label: string;
  pass_colour: string | null;
  archived_at: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  phone_whatsapp: string | null;
  email: string | null;
  upi_id: string | null;
  created_at: string;
  archived_at: string | null;
  portal_token?: string | null;
}

export interface Lease {
  id: string;
  unit_id: string;
  tenant_id: string;
  rent: string;
  deposit: string;
  due_day: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
}

export interface Payment {
  id: string;
  lease_id: string;
  receipt_no: string;
  verify_token: string;
  amount: string;
  period: string;
  method: Method;
  reference: string | null;
  note: string | null;
  paid_at: string;
}

export interface Task {
  id: string;
  property_id: string | null;
  title: string;
  priority: Priority;
  status: TaskStatus;
  vendor: string | null;
  created_at: string;
  tenant_id?: string | null;
  details?: string | null;
  source?: "landlord" | "tenant";
}

export interface Expense {
  id: string;
  property_id: string | null;
  category: string;
  amount: string;
  spent_on: string;
  note: string | null;
}

export type Role = "owner" | "manager" | "viewer";

export interface WorkspaceV2 extends Workspace {
  invoice_seq?: number;
  remind_before_days?: number;
  grace_days?: number;
  late_fee_type?: "none" | "flat" | "percent";
  late_fee_value?: string;
}

export interface Invoice {
  id: string;
  lease_id: string;
  invoice_no: string;
  period: string;
  due_date: string;
  rent: string;
  utilities: string;
  late_fee: string;
  other: string;
  carried_forward: string;
  total: string;
  status: "open" | "void";
  note: string | null;
  created_at: string;
}

export interface MeterReading {
  id: string;
  unit_id: string;
  kind: "electric" | "water";
  period: string;
  previous: string;
  current: string;
  rate: string;
  amount: string;
}

export type DepositType = "received" | "deduction" | "refund";
export interface DepositTxn {
  id: string;
  lease_id: string;
  type: DepositType;
  amount: string;
  txn_date: string;
  note: string | null;
}

export type DocKind = "lease" | "id" | "inspection" | "invoice" | "photo" | "other";
export const DOC_KINDS: { value: DocKind; label: string }[] = [
  { value: "lease", label: "Lease" },
  { value: "id", label: "ID proof" },
  { value: "inspection", label: "Inspection" },
  { value: "invoice", label: "Bill / invoice" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];
export interface DocumentRow {
  id: string;
  property_id: string | null;
  tenant_id: string | null;
  kind: DocKind;
  name: string;
  path: string;
  size: number | null;
  mime: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  lease_id: string;
  period: string;
  kind: "upcoming" | "due" | "overdue";
  for_date: string;
  amount: string;
  status: "pending" | "sent" | "skipped";
}

export interface AuditEvent {
  id: number;
  actor_email: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  summary: string | null;
  at: string;
}

export interface Member {
  workspace_id: string;
  user_id: string;
  email: string | null;
  role: "manager" | "viewer";
  created_at: string;
}

export interface Invite {
  id: string;
  email: string | null;
  role: "manager" | "viewer";
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface BankLine {
  id: string;
  statement: string;
  txn_date: string;
  description: string;
  reference: string | null;
  /** Credits are positive, debits negative. */
  amount: string;
  fingerprint: string;
  status: "unmatched" | "matched" | "ignored";
  payment_id: string | null;
  expense_id: string | null;
  matched_by: "auto" | "manual" | "ai" | null;
  matched_at: string | null;
  created_at: string;
}
