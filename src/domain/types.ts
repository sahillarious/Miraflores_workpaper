// Raw packet shapes. Only the fields the workpaper relies on are typed; the
// raw objects are kept intact so nothing from the packet is lost or rewritten.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface PacketPage { page: number; printed_content: string }

export interface PacketDocument {
  id: string;
  title: string;
  document_type: string;
  issuer: string;
  belongs_to: string;
  tax_year: number;
  received_at: string;
  uploaded_by: 'client' | 'firm';
  file_name: string;
  page_count: number;
  pages: PacketPage[];
  marked_corrected?: boolean;
  extraction: { status: 'extracted' | 'partial' | 'not_extracted'; values: number; reason?: string | null };
}

export interface ExtractedValue {
  id: string;
  document_id: string;
  page: number;
  field: string;
  label: string;
  value: string | number | boolean | null;
  value_type: string;
  text_as_read: string;
  position: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface ReturnLine {
  key: string;
  jurisdiction: 'federal' | 'california';
  form: string;
  line: string;
  label: string;
  value: number | string | null;
  rule: string;
  inputs: string[];
  sources: string[];
  note?: string;
}

export interface Diagnostic { code: string; severity: 'info' | 'warning'; message: string; refs: string[] }

export interface Summary {
  federal: { agi: number; taxable_income: number; total_tax: number; payments: number; balance_due: number; penalty: number };
  california: { total_agi: number; ca_agi: number; total_tax: number; payments: number; balance_due: number; penalty: number };
}

export interface TaxRate { federal_per_dollar: number; california_per_dollar: number }

export interface ReturnVersion {
  version: string;
  computed_at: string;
  trigger: string;
  documents_used: string[];
  documents_superseded: string[];
  summary: Summary;
  tax_effect_rates: Record<string, TaxRate>;
  carryovers_out: any;
  assets: any[];
  diagnostics: Diagnostic[];
  changes_from_previous: { key: string; change: 'added' | 'changed' | 'removed'; old?: any; new?: any }[];
  lines: ReturnLine[];
}

export interface QA { id: string; question: string; answer: string; answered_by: string; answered_at: string }
export interface Message { id: string; sent_at: string; from: string; to: string; text: string }
export interface CallNote { id: string; date: string; participants: string[]; notes: string[] }
export interface Staff { id: string; name: string; role: string; credential: string | null; sensitive_data_clearance: boolean; active_from: string; note?: string }
export interface TimelineEvent { id: string; at: string; event: string; actor: string | null; detail: string | null; refs: string[] }

export interface Packet {
  packet: { name: string; version: string; generated: string; client_id: string };
  readme: any;
  household: any;
  documents: PacketDocument[];
  extracted_values: ExtractedValue[];
  client: { questionnaire: QA[]; messages: Message[]; call_notes: CallNote[] };
  firm: any;
  prior_years: any;
  tax_agency_records: any;
  timeline: TimelineEvent[];
  engine_reference: { parameters: any; rules: Record<string, string> };
  return_versions: ReturnVersion[];
  what_if: any;
  planning_reference_2026: any;
  post_filing_rates: any;
  fx_rates: any;
}
