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

/** 启动一次加载 settings + contacts + projects，减少进程冷启动 */
export function bootstrap() {
  return backend<{
    settings: Record<string, string>;
    contacts: { names: string[]; contacts: Record<string, string>[] };
    projects: ProjectSummary[];
  }>("bootstrap");
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

export type ProjectSummary = {
  id: string;
  key: string;
  contract_no: string;
  project_name: string;
  party_b: string;
  updated_at: string;
  label: string;
};

export type ProjectSnapshot = {
  id: string;
  key: string;
  contract_no: string;
  project_name: string;
  party_b?: string;
  form: Record<string, string>;
  ratio?: number;
  quote?: unknown;
  template_path?: string;
  output_dir?: string;
  output_name?: string;
  updated_at?: string;
  created_at?: string;
};

export function listProjects() {
  return backend<{ projects: ProjectSummary[] }>("list_projects");
}

export function getProject(id: string) {
  return backend<ProjectSnapshot>("get_project", { id });
}

export function saveProject(snapshot: {
  contract_no: string;
  project_name: string;
  form: Record<string, string>;
  ratio?: number;
  quote?: unknown;
  template_path?: string;
  output_dir?: string;
  output_name?: string;
}) {
  return backend<{
    action: "created" | "updated";
    project: ProjectSnapshot;
    projects: ProjectSummary[];
  }>("save_project", snapshot);
}

export function deleteProject(id: string) {
  return backend<{ projects: ProjectSummary[] }>("delete_project", { id });
}

/** 用本机 Chrome/Edge 渲染 HTML 导出 PNG（清晰度接近浏览器截图） */
export async function exportQuoteHtmlPng(params: {
  html: string;
  filename?: string;
}): Promise<{ path: string; size: number; engine?: string }> {
  return invoke<{ path: string; size: number; engine?: string }>("export_quote_html_png", {
    html: params.html,
    filename: params.filename ?? null,
  });
}

/** 备用：base64 直写 PNG */
export async function saveQuoteImage(params: {
  base64: string;
  filename?: string;
}): Promise<{ path: string; size: number }> {
  return invoke<{ path: string; size: number }>("save_quote_image_file", {
    filename: params.filename ?? null,
    base64Data: params.base64,
  });
}
