import test from 'node:test';
import assert from 'node:assert/strict';
import {renderQuotationDocument, quotationEmail} from './quote-document.mjs';
const quote={quote_number:'FFQ-TEST',subtotal_pence:10000,tax_pence:2000,total_pence:12000,scope:'Install <media> wall',valid_until:'2026-11-01'};
const customer={customer_name:'Test <Customer>',email:'test@example.com',reference:'FF-TEST',postcode:'RG1'};
test('quotation is printable and escapes customer supplied HTML',()=>{const html=renderQuotationDocument({quote,customer});assert.match(html,/£120\.00/);assert.match(html,/&lt;media&gt;/);assert.match(html,/Test &lt;Customer&gt;/);assert.doesNotMatch(html,/<media>/);});
test('customer email is a draft, not an automatic send',()=>{const link=quotationEmail(quote,customer);assert.match(link,/^mailto:/);assert.match(decodeURIComponent(link),/attach the PDF saved/);assert.equal(quotationEmail(quote,{email:'invalid'}),null);});
