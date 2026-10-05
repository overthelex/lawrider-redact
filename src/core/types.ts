/** Kinds of data the extension masks. The placeholder shown to the model is `[KIND_n]`. */
export type Kind =
  | 'PERSON' | 'COMPANY' | 'ORG' | 'LOCATION' | 'ADDRESS' | 'POSTCODE'
  | 'EMAIL' | 'PHONE' | 'NINO' | 'SORT_CODE' | 'ACCOUNT' | 'IBAN' | 'COMPANY_NO' | 'TERM';

export interface Span {
  start: number;
  end: number; // exclusive
  kind: Kind;
  text: string;
  source: 'rule' | 'ner' | 'list';
  score?: number;
}
