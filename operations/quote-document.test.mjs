import test from 'node:test';
import assert from 'node:assert/strict';
import {renderQuotationDocument, quotationEmail} from './quote-document.mjs';
const quote={quote_number:'FFQ-TEST',subtotal_pence:10000,tax_pence:2000,total_pence:12000,scope:'Install <media> wall',valid_until:'2026-11-01'};
const customer={customer_name:'Test <Customer>',email:'test@example.com',reference:'FF-TEST',postcode:'RG1'};
test('quotation is printable and escapes customer supplied HTML',()=>{const html=renderQuotationDocument({quote,customer});assert.match(html,/£120\.00/);assert.match(html,/&lt;media&gt;/);assert.match(html,/Test &lt;Customer&gt;/);assert.doesNotMatch(html,/<media>/);});
test('customer email is a draft, not an automatic send',()=>{const link=quotationEmail(quote,customer);assert.match(link,/^mailto:/);assert.match(decodeURIComponent(link),/attach the PDF saved/);assert.equal(quotationEmail(quote,{email:'invalid'}),null);});
test('itemised quotation shows every line, the discount and VAT, and marks drafts',()=>{
  const itemised={...quote,status:'sent',version:2,line_items:[{description:'MDF',quantity:'12',unit:'sheet',unit_price_pence:3850,line_total_pence:46200},{description:'Labour',quantity:'3.5',unit:'day',unit_price_pence:24000,line_total_pence:84000}],items_subtotal_pence:130200,discount_type:'percent',discount_basis_points:1000,discount_pence:13020,subtotal_pence:117180,tax_rate_basis_points:2000,tax_pence:23436,total_pence:140616,exclusions:'Plastering of adjoining walls',terms:'50% deposit on acceptance'};
  const html=renderQuotationDocument({quote:itemised,customer,settings:{legal_name:'Form & Frame Ltd',contact_email:'hello@example.com',vat_number:'GB000'},responseUrl:'https://form-and-frame.vercel.app/quote-response.html?token=abc'});
  for(const text of [/MDF/,/3\.5/,/£240\.00/,/£840\.00/,/Items subtotal/,/Discount \(10%\)/,/−£130\.20/,/Subtotal after discount/,/VAT at 20%/,/£1,406\.16/,/Plastering of adjoining walls/,/50% deposit/,/token=abc/,/version 2/]) assert.match(html,text);
  assert.doesNotMatch(html,/DRAFT · NOT SENT/);
  assert.match(renderQuotationDocument({quote:{...itemised,status:'draft'},customer}),/DRAFT · NOT SENT/);
  assert.match(renderQuotationDocument({quote:itemised,customer}),/Company details not yet configured/,'missing company details are shown as missing, not invented');
});
