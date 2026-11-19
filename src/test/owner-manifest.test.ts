import { expect, it } from 'vitest';
import { OWNER_IMPORT_ORDER, parseOwnerCsv } from '../../scripts/lib/owner-manifest';
it('processes tickers in the owner requested order', () => expect(OWNER_IMPORT_ORDER).toEqual(['SPCX','ZM','OWL','EFC','WDC','CME','EVER','SOFI']));
it('reads quoted commas without changing manifest values', () => expect(parseOwnerCsv('file,sha256,title\na.pdf,abc,"Release, Q1"\n')).toEqual([{file:'a.pdf',sha256:'abc',title:'Release, Q1'}]));