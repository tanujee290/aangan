import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, File, FileImage, FileSpreadsheet, FileText, FolderOpen, Trash2, Upload } from "lucide-react";
import { useData, useCanWrite } from "../state/data";
import { useNotify } from "../state/notify";
import { supabase, errorMessage, STORAGE_BUCKET } from "../lib/supabase";
import { dateLabel } from "../lib/format";
import { fileSize, safeFileName } from "../lib/export";
import { DOC_KINDS, type DocKind, type DocumentRow } from "../lib/types";
import { Empty, Field, NeedsSchema, SheetIf } from "../components/ui";

const MAX_BYTES = 15 * 1024 * 1024;
const KIND_LABEL = Object.fromEntries(DOC_KINDS.map((k) => [k.value, k.label])) as Record<DocKind, string>;

export function DocIcon({ mime, size = 18 }: { mime: string | null; size?: number }) {
  const m = mime ?? "";
  if (m.startsWith("image/")) return <FileImage size={size} />;
  if (m.includes("pdf") || m.startsWith("text/")) return <FileText size={size} />;
  if (m.includes("sheet") || m.includes("csv") || m.includes("excel")) return <FileSpreadsheet size={size} />;
  return <File size={size} />;
}

/** Opens a private file through a short-lived signed URL. */
export async function openDocument(path: string, notify: (m: string) => void) {
  // Open the tab synchronously so pop-up blockers allow it, then point it at the signed URL.
  const win = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 300);
  if (error || !data) {
    win?.close();
    return notify(errorMessage(error));
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

export default function DocumentsPage() {
  const d = useData();
  const canWrite = useCanWrite();
  const notify = useNotify();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<DocKind | "all">("all");
  const [upload, setUpload] = useState(false);

  const propName = (id: string | null) => (id ? d.properties.find((p) => p.id === id)?.name : undefined);
  const tenantName = (id: string | null) => (id ? d.tenants.find((t) => t.id === id)?.name : undefined);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return d.documents.filter((doc) => {
      if (kind !== "all" && doc.kind !== kind) return false;
      if (!needle) return true;
      return [doc.name, propName(doc.property_id), tenantName(doc.tenant_id), KIND_LABEL[doc.kind]]
        .some((s) => s?.toLowerCase().includes(needle));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.documents, d.properties, d.tenants, q, kind]);

  if (!d.v2) {
    return <div className="page"><div className="page-head"><h1 className="display">Documents</h1></div><NeedsSchema feature="The document vault" /></div>;
  }

  const totalSize = d.documents.reduce((s, doc) => s + (doc.size ?? 0), 0);

  async function remove(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.name}"? The file is removed permanently.`)) return;
    const { error: sErr } = await supabase.storage.from(STORAGE_BUCKET).remove([doc.path]);
    if (sErr) return notify(errorMessage(sErr));
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) return notify(errorMessage(error));
    await d.refresh();
    notify("Document deleted");
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">Documents</h1>
          <p className="page-sub small">Leases, ID proofs, inspection reports and bills, stored privately. Links to open a file expire after five minutes.</p>
        </div>
        {canWrite && <button className="btn primary small" onClick={() => setUpload(true)}><Upload size={14} /> Upload</button>}
      </div>

      <div className="tiles three">
        <div className="tile"><span className="eyebrow">Files</span><span className="mono big">{d.documents.length}</span></div>
        <div className="tile"><span className="eyebrow">Leases</span><span className="mono big">{d.documents.filter((x) => x.kind === "lease").length}</span></div>
        <div className="tile"><span className="eyebrow">Storage used</span><span className="mono big">{fileSize(totalSize) || "0 B"}</span></div>
      </div>

      <div className="card">
        <input className="search" placeholder="Search by name, property or tenant" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips doc-filter">
          <button className={`chip ${kind === "all" ? "on" : ""}`} onClick={() => setKind("all")}>All</button>
          {DOC_KINDS.map((k) => (
            <button key={k.value} className={`chip ${kind === k.value ? "on" : ""}`} onClick={() => setKind(k.value)}>{k.label}</button>
          ))}
        </div>
        {d.documents.length === 0 ? (
          <Empty icon={<FolderOpen />} title="No documents yet">
            <p>Keep signed leases, ID proofs and inspection photos next to the tenancy they belong to.</p>
            {canWrite && <button className="btn primary" onClick={() => setUpload(true)}><Upload size={16} /> Upload a file</button>}
          </Empty>
        ) : list.length === 0 ? (
          <p className="muted small" style={{ padding: "16px 8px" }}>Nothing matches that search.</p>
        ) : (
          <ul className="list">
            {list.map((doc) => (
              <li key={doc.id} className="list-row">
                <span className={`doc-icon kind-${doc.kind}`}><DocIcon mime={doc.mime} /></span>
                <div className="grow">
                  <button className="link doc-name" onClick={() => openDocument(doc.path, notify)}>{doc.name}</button>
                  <small className="muted">
                    {KIND_LABEL[doc.kind]}
                    {doc.property_id && <> · <Link to={`/app/properties/${doc.property_id}`}>{propName(doc.property_id) ?? "Property"}</Link></>}
                    {doc.tenant_id && <> · <Link to={`/app/tenants/${doc.tenant_id}`}>{tenantName(doc.tenant_id) ?? "Tenant"}</Link></>}
                    {" · "}{fileSize(doc.size)} · {dateLabel(doc.created_at, { day: "numeric", month: "short", year: "numeric" })}
                  </small>
                </div>
                <button className="icon-btn" aria-label={`Open ${doc.name}`} onClick={() => openDocument(doc.path, notify)}><ExternalLink size={15} /></button>
                {canWrite && <button className="icon-btn" aria-label={`Delete ${doc.name}`} onClick={() => remove(doc)}><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SheetIf open={upload} title="Upload a document" onClose={() => setUpload(false)}>
        <UploadForm onDone={() => setUpload(false)} />
      </SheetIf>
    </div>
  );
}

export function UploadForm({ onDone, propertyId, tenantId }: { onDone: () => void; propertyId?: string; tenantId?: string }) {
  const d = useData();
  const notify = useNotify();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DocKind>("lease");
  const [property, setProperty] = useState(propertyId ?? "");
  const [tenant, setTenant] = useState(tenantId ?? "");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("That file is over 15 MB. Please compress it or upload a smaller copy.");
    setFile(f);
    setName(f.name);
    if (f.type.startsWith("image/") && kind === "lease") setKind("photo");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !d.workspace) return;
    setBusy(true);
    setError(null);
    const path = `${d.workspace.id}/docs/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    try {
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from("documents").insert({
        name: name.trim() || file.name, kind, path, size: file.size, mime: file.type || null,
        property_id: property || null, tenant_id: tenant || null,
      });
      if (rowErr) {
        await supabase.storage.from(STORAGE_BUCKET).remove([path]);
        throw rowErr;
      }
      await d.refresh();
      notify("Document uploaded");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className={`dropzone ${over ? "over" : ""}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {file ? <DocIcon mime={file.type} size={26} /> : <Upload size={26} />}
        <strong>{file ? file.name : "Drop a file here, or tap to choose"}</strong>
        <span className="small">{file ? fileSize(file.size) : "PDF, images or office files · up to 15 MB"}</span>
        <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {file && <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
      <Field label="Kind">
        <div className="chips">
          {DOC_KINDS.map((k) => (
            <button type="button" key={k.value} className={`chip ${kind === k.value ? "on" : ""}`} onClick={() => setKind(k.value)}>{k.label}</button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Property">
          <select value={property} onChange={(e) => setProperty(e.target.value)}>
            <option value="">None</option>
            {d.properties.filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Tenant">
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            <option value="">None</option>
            {d.tenants.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary block" disabled={busy || !file}>{busy ? "Uploading…" : "Upload"}</button>
    </form>
  );
}
