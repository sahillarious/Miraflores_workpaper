// Shapes shared by the copilot server, the browser and tests. Type-only: the
// browser bundle never imports the SDK or the zod schema.

export const REPORT_STATUSES = [
  'confirmed_discrepancy',
  'likely_issue',
  'unresolved_discrepancy',
  'judgment_required',
  'insufficient_evidence',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  confirmed_discrepancy: 'Confirmed discrepancy (evidence supports it)',
  likely_issue: 'Likely issue — needs verification',
  unresolved_discrepancy: 'Unresolved discrepancy',
  judgment_required: 'Reviewer judgment required',
  insufficient_evidence: 'Insufficient evidence',
};

export interface Quantity { label: string; value: number; evidence_id: string }
export interface Fact { statement: string; evidence_ids: string[]; quantities: Quantity[] }
export interface Hypothesis { statement: string; evidence_ids: string[]; confidence: 'low' | 'medium' | 'high'; how_to_test: string }
export interface MissingInfo { item: string; why_needed: string; possible_source: string }
export interface NextStep { action: string; rationale: string }

export interface InvestigationReport {
  case_id: string;
  summary: string;
  status: ReportStatus;
  facts: Fact[];
  hypotheses: Hypothesis[];
  missing_information: MissingInfo[];
  recommended_next_steps: NextStep[];
  client_question_draft: string | null;
  resolution_criteria: string;
  requires_human_review: true;
}

export interface TraceStep {
  index: number;
  kind: 'model' | 'tool';
  name: string;
  input?: unknown;
  ok: boolean;
  summary: string;
  ms: number;
}

export interface Issue { kind: 'schema' | 'citation' | 'number' | 'status' | 'case'; message: string; where?: string }

export interface Validation {
  passed: boolean;
  issues: Issue[];
  citedIds: string[];
  existingCited: number;
  retrievedCited: number;
  quantitiesChecked: number;
  quantitiesVerified: number;
  textNumbersChecked: number;
  textNumbersFound: number;
}

export type RunOutcome = 'validated' | 'unverified' | 'incomplete' | 'error' | 'unconfigured';

export interface InvestigationRun {
  runId: string;
  caseId: string;
  outcome: RunOutcome;
  model: string | null;
  startedAt: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  modelTurns: number;
  toolCalls: number;
  schemaFailures: number;
  trace: TraceStep[];
  retrievedIds: string[];
  report: InvestigationReport | null;
  validation: Validation | null;
  error?: { kind: string; message: string };
}

export interface CopilotStatus {
  configured: boolean; provider: string; model: string | null; maxModelTurns: number; maxToolCalls: number; reason?: string;
  /** Every investigate request must carry the shared demo access code (x-access-code header). */
  accessCodeRequired?: boolean;
  dailyCap?: number;
  usedToday?: number;
  /** Cache key per case id (see server/cacheKey.ts); present when the copilot is configured. */
  cacheKeys?: Record<string, string>;
}

/** What POST /api/copilot/investigate returns: the run plus the key it may be cached under. */
export type InvestigateResponse = InvestigationRun & { cacheKey: string };
