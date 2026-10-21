import type { ReportStatus } from '../src/copilot/types';

// Evaluation set: real packet cases with expectations written from the packet
// itself (see PRODUCT_WRITEUP.md for the underlying facts). Groups are "any of":
// a group is satisfied if at least one listed id (or prefix ending in *) was
// retrieved / one keyword appears.

export interface EvalCase {
  caseId: string;
  label: string;
  kind: 'grounded' | 'abstain' | 'duplicate' | 'negative';
  expectRetrieved: string[][];
  acceptableStatus: ReportStatus[];
  expectQuantities?: number[]; // must appear as a verified quantity in some fact
  mustMention?: string[][]; // in summary, facts, hypotheses, missing information
  nextStepMentions?: string[][]; // keyword proxy for next-step relevance
  expectMissingInfo?: boolean;
  expectClientQuestion?: boolean;
  forbidFactQuantity?: { value: number; unlessCites: string }; // abstention: must not state this as a fact
}

const ALL_BUT_CONFIRMED: ReportStatus[] = ['likely_issue', 'unresolved_discrepancy', 'judgment_required', 'insufficient_evidence'];

export const EVAL_CASES: EvalCase[] = [
  {
    caseId: 'ENG-BROKER_SUMMARY_DETAIL_MISMATCH', label: 'A. Meridian $250 proceeds mismatch', kind: 'grounded',
    expectRetrieved: [['ev-0703'], ['doc:D31#page32']],
    acceptableStatus: ['confirmed_discrepancy', 'likely_issue', 'unresolved_discrepancy', 'judgment_required'],
    expectQuantities: [250],
    mustMention: [['page 32', 'M18', 'Ironwood']],
    nextStepMentions: [['8949', 'page 32', 'M18', 'lot']],
  },
  {
    caseId: 'WP-RSU-BASIS', label: 'B. RSU zero basis vs supplemental statement', kind: 'grounded',
    expectRetrieved: [['ev-0066'], ['ev-0068'], ['ev-0070']],
    acceptableStatus: ['confirmed_discrepancy', 'likely_issue', 'unresolved_discrepancy', 'judgment_required'],
    expectQuantities: [19100, 9420],
    mustMention: [['W-2', 'wage', 'box 14'], ['twice', 'double', 'already taxed', 'already included', 'already reported']],
    nextStepMentions: [['basis', 'supplement', 'D11']],
  },
  {
    caseId: 'ENG-QUESTIONNAIRE_SALES_CONFLICT', label: 'C. Questionnaire denies sales vs brokerage/crypto activity', kind: 'grounded',
    expectRetrieved: [['qa-14'], ['qa-15']],
    acceptableStatus: ['confirmed_discrepancy', 'likely_issue', 'unresolved_discrepancy', 'judgment_required'],
    mustMention: [['1099-B', 'brokerage', 'Brightpath', 'Northlake', 'Meridian'], ['1099-DA', 'Coinhaven', 'crypto', 'digital']],
    expectClientQuestion: true,
    nextStepMentions: [['client', 'clarif', 'confirm', 'ask']],
  },
  {
    caseId: 'WP-DUP-W2', label: 'Duplicate W-2 image (D09/D10)', kind: 'duplicate',
    expectRetrieved: [['D10', 'doc:D10#page1', 'ev-0052', 'ev-0049', 'ev-0050'], ['msg-02']],
    acceptableStatus: ALL_BUT_CONFIRMED,
    mustMention: [['once', 'not double', 'single', 'only D09', 'only one']],
    nextStepMentions: [['duplicate', 'disposition', 'primary', 'once']],
  },
  {
    caseId: 'ENG-DIGITAL_ASSET_BASIS_MISSING', label: 'Crypto C6 basis: client claim only (insufficient evidence)', kind: 'abstain',
    expectRetrieved: [['msg-07'], ['ev-0919', 'doc:D35#page1']],
    acceptableStatus: ['insufficient_evidence', 'unresolved_discrepancy', 'judgment_required', 'likely_issue'],
    mustMention: [['bank statement', 'statement']],
    expectMissingInfo: true,
    forbidFactQuantity: { value: 3050, unlessCites: 'msg-07' },
    nextStepMentions: [['bank', 'statement', 'wallet', 'record']],
  },
  {
    caseId: 'ENG-LOW_CONFIDENCE_READ', label: 'St. Brigid handwritten amount (insufficient evidence)', kind: 'abstain',
    expectRetrieved: [['ev-1049', 'doc:D64#page1'], ['msg-08']],
    acceptableStatus: ['insufficient_evidence', 'unresolved_discrepancy', 'judgment_required', 'likely_issue'],
    mustMention: [['ambiguous', '1 or 7', 'confidence', '0.41']],
    expectMissingInfo: true,
    nextStepMentions: [['bank', 'check', 'acknowledg', 'receipt']],
  },
  {
    caseId: 'WP-CA-WAGES', label: 'California wage sourcing (judgment)', kind: 'grounded',
    expectRetrieved: [['ev-0047'], ['ev-1081', 'doc:D73#page1']],
    acceptableStatus: ['judgment_required', 'unresolved_discrepancy', 'likely_issue', 'insufficient_evidence'],
    expectMissingInfo: true,
    mustMention: [['work location', 'workday', 'work days', 'worked', 'remote']],
    nextStepMentions: [['work', 'W-2c', 'corrected', 'location', 'days']],
  },
  {
    caseId: 'WP-EST-FED', label: 'Federal estimated payments vs IRS transcript', kind: 'grounded',
    expectRetrieved: [['agency:/irs_account_transcript_2025*'], ['qa-41', 'F1040.26']],
    acceptableStatus: ['confirmed_discrepancy', 'likely_issue'],
    expectQuantities: [1000],
    mustMention: [['transcript']],
    nextStepMentions: [['transcript', '3,000', '3000', '12,000', 'IRS']],
  },
  {
    caseId: 'ENG-AOTC_PHASED_OUT', label: 'Informational diagnostic (must not claim an error)', kind: 'negative',
    expectRetrieved: [['F8863.7']],
    acceptableStatus: ALL_BUT_CONFIRMED,
  },
];
