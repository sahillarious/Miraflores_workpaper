import { z } from 'zod';
import { REPORT_STATUSES } from './types';

// The report the model must submit through the submit_report tool. Validated
// with zod on the server; the same shape is sent as the tool's JSON schema
// (strict) so the model is constrained before validation.

const Id = z.string().min(2).max(200);

export const ReportSchema = z.object({
  case_id: z.string().min(1),
  summary: z.string().min(20).max(1500),
  status: z.enum(REPORT_STATUSES),
  facts: z.array(z.object({
    statement: z.string().min(5).max(600),
    evidence_ids: z.array(Id).min(1).max(12),
    quantities: z.array(z.object({ label: z.string().min(1).max(120), value: z.number(), evidence_id: Id })).max(8),
  })).max(12),
  hypotheses: z.array(z.object({
    statement: z.string().min(5).max(600),
    evidence_ids: z.array(Id).max(12),
    confidence: z.enum(['low', 'medium', 'high']),
    how_to_test: z.string().min(5).max(400),
  })).max(8),
  missing_information: z.array(z.object({
    item: z.string().min(3).max(300),
    why_needed: z.string().min(3).max(400),
    possible_source: z.string().min(2).max(300),
  })).max(10),
  recommended_next_steps: z.array(z.object({
    action: z.string().min(5).max(400),
    rationale: z.string().min(5).max(500),
  })).min(1).max(6),
  client_question_draft: z.string().min(10).max(1200).nullable(),
  resolution_criteria: z.string().min(10).max(800),
  requires_human_review: z.literal(true),
});

const str = { type: 'string' };
const ids = { type: 'array', items: str };

/** JSON schema for the submit_report tool (strict mode: every property required, no extras). */
export const reportJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['case_id', 'summary', 'status', 'facts', 'hypotheses', 'missing_information', 'recommended_next_steps', 'client_question_draft', 'resolution_criteria', 'requires_human_review'],
  properties: {
    case_id: str,
    summary: { type: 'string', description: 'Two to five sentences: what is being investigated and what the retrieved records establish. Observed differences are not errors unless the records show why.' },
    status: { type: 'string', enum: [...REPORT_STATUSES] },
    facts: {
      type: 'array',
      description: 'Only statements the retrieved records directly show. Each cites the ids it relies on.',
      items: {
        type: 'object', additionalProperties: false, required: ['statement', 'evidence_ids', 'quantities'],
        properties: {
          statement: str,
          evidence_ids: ids,
          quantities: {
            type: 'array',
            description: 'Every amount stated in the fact, with the single record (or calc id) it comes from.',
            items: { type: 'object', additionalProperties: false, required: ['label', 'value', 'evidence_id'], properties: { label: str, value: { type: 'number' }, evidence_id: str } },
          },
        },
      },
    },
    hypotheses: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['statement', 'evidence_ids', 'confidence', 'how_to_test'],
        properties: { statement: str, evidence_ids: ids, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, how_to_test: str },
      },
    },
    missing_information: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['item', 'why_needed', 'possible_source'], properties: { item: str, why_needed: str, possible_source: str } },
    },
    recommended_next_steps: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['action', 'rationale'], properties: { action: str, rationale: str } },
    },
    client_question_draft: { type: ['string', 'null'], description: 'A plain-language question for the client, or null when the client cannot resolve this. Never sent automatically.' },
    resolution_criteria: { type: 'string', description: 'What evidence or decision would justify closing the case, or why it must stay open.' },
    requires_human_review: { type: 'boolean', description: 'Always true: a reviewer must decide.' },
  },
} as const;
