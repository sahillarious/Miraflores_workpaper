import type { CaseDef } from '../domain/cases';
import { plainSummary } from '../domain/plain';

// Short, general definitions for the help panel. A term is shown for a case
// only when its pattern appears in that case's own text. Entries marked
// `check` are ones a tax professional should confirm before relying on them.

export interface GlossaryTerm { id: string; term: string; definition: string; match: RegExp; check?: boolean }

export const GLOSSARY: GlossaryTerm[] = [
  { id: 'ssn', term: 'SSN / TIN', definition: 'A Social Security number (SSN) is a 9-digit US taxpayer number. TIN (taxpayer identification number) is the general term; an SSN is one kind.', match: /\bSSN\b|\bTIN\b|Social Security/i },
  { id: 'efile', term: 'E-file rejection', definition: 'The tax agency refuses an electronically filed return before processing it, for example when a name and number do not match its records. The return must be corrected and sent again.', match: /e-file/i },
  { id: 'basis', term: 'Basis (cost basis)', definition: 'What was paid for an asset, adjusted for certain events. The gain or loss on a sale is the sale price minus the basis.', match: /\bbasis\b|zero cost|\bcost\b/i },
  { id: 'noncovered', term: 'Noncovered security', definition: 'A security for which the broker does not have to report cost basis to the IRS, so the 1099-B may show no basis.', match: /noncovered/i },
  { id: 'rsu', term: 'RSU', definition: 'Restricted stock unit: shares an employer grants that become yours when they vest. Their value at vesting is taxed as wages.', match: /\bRSU\b/ },
  { id: '1099b', term: 'Form 1099-B', definition: 'A broker’s statement of sales of stocks and other securities, with the proceeds and often the cost basis.', match: /1099-B|broker/i },
  { id: '8949', term: 'Form 8949', definition: 'The form that lists each sale of a capital asset; its totals flow to Schedule D.', match: /8949/ },
  { id: 'w2', term: 'Form W-2', definition: 'An employer’s yearly statement of wages paid and taxes withheld.', match: /W-2\b|wages/i },
  { id: '1099k', term: 'Form 1099-K', definition: 'A statement from a card processor or payment app of payments received for goods or services.', match: /1099-K/ },
  { id: 'backup', term: 'Backup withholding', definition: 'Tax a payer must withhold (24%) from certain payments when the payee’s taxpayer number is missing or wrong.', match: /backup withholding/i },
  { id: 'estimates', term: 'Estimated tax payments', definition: 'Payments made during the year toward that year’s tax, usually for income with no withholding.', match: /estimated (tax )?payment/i },
  { id: 'transcript', term: 'IRS account transcript', definition: 'The IRS’s record of the payments and actions on a taxpayer’s account for one year.', match: /transcript|IRS record/i },
  { id: 'ftb', term: 'FTB', definition: 'The California Franchise Tax Board, the state’s income tax agency.', match: /\bFTB\b|Franchise Tax|state's account/i },
  { id: 'agi', term: 'AGI', definition: 'Adjusted gross income: total income minus certain adjustments. Many limits and phase-outs are based on it.', match: /\bAGI\b|income is too high/i },
  { id: 'depreciation', term: 'Depreciation', definition: 'Spreading the cost of a long-lived asset, such as a building improvement, over several years instead of deducting it all at once.', match: /depreciat|improvement/i },
  { id: 'k1', term: 'Schedule K-1', definition: 'A statement from a partnership, S corporation or trust showing each owner’s share of its income, deductions and credits.', match: /K-1/ },
  { id: 'scorp', term: 'S corporation', definition: 'A corporation whose income and losses pass through to its shareholders’ personal returns.', match: /S corporation/i },
  { id: 'amt', term: 'AMT', definition: 'Alternative minimum tax: a second tax calculation with fewer deductions; the taxpayer pays whichever is higher.', match: /\bAMT\b|alternative minimum/i },
  { id: 'iso', term: 'Incentive stock option (ISO)', definition: 'An employee stock option with special tax treatment; exercising it can create income for the alternative minimum tax.', match: /incentive stock option|\bISO\b|stock option/i },
  { id: 'fbar', term: 'FBAR', definition: 'FinCEN Form 114: a report of foreign financial accounts, required when their combined value is over 10,000 dollars at any time in the year. It is filed separately from the tax return.', match: /FBAR|FinCEN/i },
  { id: '1098c', term: 'Form 1098-C', definition: 'A charity’s statement for a donated car, boat or plane, including what the charity sold it for.', match: /1098-C|donated car|car donation/i },
  { id: '1098', term: 'Form 1098', definition: 'A lender’s statement of the mortgage interest paid during the year (and often property tax paid from escrow).', match: /Form 1098\b(?!-)|mortgage interest/i },
  { id: 'itemized', term: 'Itemized deductions', definition: 'Specific deductions such as mortgage interest, taxes and gifts, listed on Schedule A instead of taking the standard deduction.', match: /itemi[sz]ed|Schedule A|property tax|charitab/i },
  { id: 'schc', term: 'Schedule C', definition: 'The form that reports profit or loss from a business run by one person.', match: /Schedule C|\bSchC\b|business income|business miles/i },
  { id: 'sehi', term: 'Self-employed health insurance deduction', definition: 'A deduction for health insurance a self-employed person pays. It is not allowed for months the person could join a subsidized employer plan, including a spouse’s.', match: /self-employed health/i },
  { id: '540nr', term: 'Form 540NR', definition: 'California’s income tax return for nonresidents and part-year residents.', match: /540NR|part-year|moved to Texas/i },
  { id: 'ca-source', term: 'California-source income', definition: 'Income California can tax even from someone who no longer lives there, such as pay for work done in California.', match: /California-source|California income/i },
  { id: '8867', term: 'Form 8867', definition: 'A paid preparer’s due-diligence checklist for certain credits, kept with the return.', match: /8867|due.diligence/i },
  { id: 'ira-basis', term: 'IRA basis', definition: 'Money in a traditional IRA that was already taxed (nondeductible contributions). It is not taxed again when converted or withdrawn; it is tracked on Form 8606.', match: /\bIRA\b/ },
  { id: 'fx', term: 'Exchange rate for foreign income', definition: 'Foreign income must be reported in dollars; a yearly average rate for the tax year is commonly used for income received through the year.', match: /exchange rate|average rate|Swedish|\bSEK\b/i, check: true },
  { id: '1099nec', term: 'Form 1099-NEC', definition: 'A form a business files to report payments to an independent contractor above a set threshold.', match: /1099-NEC/ },
  { id: '1099da', term: 'Form 1099-DA', definition: 'A broker’s statement of sales of digital assets such as cryptocurrency.', match: /1099-DA|digital-asset|digital asset|bitcoin|crypto/i },
  { id: 'mileage', term: 'Business mileage', definition: 'Miles driven for business. The deduction is usually the miles times the IRS standard mileage rate.', match: /mileage|business miles/i },
  { id: 'proration', term: 'Property tax proration', definition: 'Splitting a year’s property tax between seller and buyer according to the days each owned the home, usually settled at closing.', match: /property tax|seller's share|closing credit/i },
  { id: 'dependent', term: 'Dependent', definition: 'A person, often a child, the taxpayer can claim on the return, which can qualify the taxpayer for certain credits.', match: /\bdependents?\b/i },
  { id: 'letter566', term: 'Letter 566', definition: 'An IRS letter that opens an examination by mail and asks for documents.', match: /Letter 566|examination letter/i, check: true },
  { id: '3520', term: 'Form 3520', definition: 'The form used to report large gifts or inheritances from foreign persons, and dealings with foreign trusts.', match: /3520|foreign inheritance/i },
  { id: 'engine', term: 'Tax software (the engine)', definition: 'The program that computed this return. Its figures are snapshots; this workpaper checks them against the source documents.', match: /tax software|\bengine\b/i },
];

/** Glossary terms whose pattern appears in this case's own text, most specific first, at most `max`. */
export function termsFor(def: CaseDef, max = 8): GlossaryTerm[] {
  const headline = `${def.title} ${plainSummary(def)}`;
  const rest = [def.why, def.matters, ...def.facts.map((f) => f.text), ...def.openQuestions].join(' ');
  const hits = GLOSSARY.filter((g) => g.match.test(headline) || g.match.test(rest));
  const inHeadline = hits.filter((g) => g.match.test(headline));
  return [...inHeadline, ...hits.filter((g) => !inHeadline.includes(g))].slice(0, max);
}
