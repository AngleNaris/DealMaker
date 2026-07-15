import { invoke } from "@tauri-apps/api/core";

export type BackendResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function backend<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await invoke<BackendResult<T>>("backend_call", { action, payload });
  if (!res.ok) throw new Error(res.error || "后端调用失败");
  return res.data;
}

export function pickPath(kind: "file" | "dir" | "image" | "docx" = "file"): Promise<string | null> {
  return invoke<string | null>("pick_path", { kind });
}

export function loadSettings() {
  return backend<Record<string, string>>("load_settings");
}

export function saveSettings(settings: Record<string, string>) {
  return backend("save_settings", { settings });
}

export function listContacts() {
  return backend<{ names: string[]; contacts: Record<string, string>[] }>("list_contacts");
}

export function saveContact(data: Record<string, string>) {
  return backend<{ name: string; names: string[] }>("save_contact", { data });
}

export function deleteContact(name: string) {
  return backend<{ names: string[] }>("delete_contact", { name });
}

export function generateContract(params: {
  template: string;
  data: Record<string, string>;
  output_dir?: string;
  output_name?: string;
  pdf?: boolean;
}) {
  return backend<{
    path: string;
    docx?: string;
    pdf?: string;
    pdf_engine?: string;
  }>("generate", params);
}

export function exportPdf(params: {
  template: string;
  data: Record<string, string>;
  output_dir?: string;
  output_name?: string;
}) {
  return backend<{
    path: string;
    docx: string;
    pdf: string;
    pdf_engine: string;
  }>("export_pdf", params);
}

export function ping() {
  return backend<{
    project_root: string;
    officecli: string;
    pdf_engines?: { wps: boolean; word: boolean };
  }>("ping");
}
