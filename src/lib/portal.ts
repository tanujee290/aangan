// The tenant portal's view of a workspace, as returned by the tenant_portal() RPC.

export interface PortalLease {
  id: string; property: string; unit: string; pass_colour: string | null; rent: string; deposit: string;
  due_day: number; start_date: string; end_date: string | null; status: "active" | "ended";
}
export interface PortalInvoice {
  invoice_no: string; lease_id: string; period: string; due_date: string; rent: string; utilities: string;
  late_fee: string; other: string; carried_forward: string; total: string;
}
export interface PortalPayment { receipt_no: string; amount: string; period: string; method: string; paid_at: string; verify_token: string; lease_id: string }
export interface PortalRequest { title: string; details: string | null; status: "open" | "in_progress" | "done"; created_at: string }
export interface PortalView {
  tenant: { name: string };
  landlord: { name: string; upi_id: string | null; currency: string; locale: string };
  leases: PortalLease[];
  invoices: PortalInvoice[];
  payments: PortalPayment[];
  requests: PortalRequest[];
}

export const portalUrl = (token: string) => `${window.location.origin}/t/${token}`;
