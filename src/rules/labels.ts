/**
 * myTax labels the tool fills, in the order myTax shows them. The ATO changes
 * myTax questions most years, so this list is reviewed every July.
 */

export type LabelCode =
  | '10L'
  | '11S' | '11T' | '11U'
  | '13U' | '13C' | '13Q'
  | '18G' | '18H' | '18A' | '18V'
  | '20E' | '20M' | '20O'
  | '24Y';

export interface LabelDef {
  code: LabelCode;
  section: string;
  /** The wording the user will see in myTax (approximate). */
  title: string;
  /** Whole dollars (cents dropped) or dollars and cents, as myTax expects. */
  format: 'dollars' | 'cents' | 'yesno';
}

export const LABELS: LabelDef[] = [
  { code: '10L', section: 'Interest', title: 'Gross interest', format: 'cents' },
  { code: '11S', section: 'Dividends', title: 'Unfranked amount', format: 'cents' },
  { code: '11T', section: 'Dividends', title: 'Franked amount', format: 'cents' },
  { code: '11U', section: 'Dividends', title: 'Franking credit', format: 'cents' },
  { code: '13U', section: 'Partnerships and trusts', title: 'Share of net income from trusts (non-primary production)', format: 'dollars' },
  { code: '13C', section: 'Partnerships and trusts', title: 'Franked distributions from trusts', format: 'dollars' },
  { code: '13Q', section: 'Partnerships and trusts', title: 'Share of franking credits from franked distributions', format: 'cents' },
  { code: '18G', section: 'Capital gains', title: 'Did you have a capital gains tax event during the year?', format: 'yesno' },
  { code: '18H', section: 'Capital gains', title: 'Total current year capital gains', format: 'dollars' },
  { code: '18A', section: 'Capital gains', title: 'Net capital gain', format: 'dollars' },
  { code: '18V', section: 'Capital gains', title: 'Net capital losses carried forward to later income years', format: 'dollars' },
  { code: '20E', section: 'Foreign source income', title: 'Assessable foreign source income', format: 'dollars' },
  { code: '20M', section: 'Foreign source income', title: 'Other net foreign source income', format: 'dollars' },
  { code: '20O', section: 'Foreign source income', title: 'Foreign income tax offset', format: 'cents' },
  { code: '24Y', section: 'Other income', title: 'Other income (net CFD profit)', format: 'cents' },
];

export function labelDef(code: string): LabelDef | undefined {
  return LABELS.find((l) => l.code === code);
}
