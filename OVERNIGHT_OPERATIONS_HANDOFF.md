# Form & Frame Operations — Working Handoff

Status: local work in progress. This is not a production release or a claim that every workflow is complete.

## Completed and checked

- The public Staff Access link now points to the connected Operations app at `https://form-and-frame.vercel.app/operations/`. GitHub Pages does not carry the private generated Operations configuration, so a relative link there opened an unconnected copy.
- The live Operations sign-in screen was checked anonymously at 390 px mobile width and desktop width. The sign-in screen appeared, the private desk stayed hidden, and neither viewport had horizontal overflow. This did not sign in as Anthony.
- The Operations enquiry list now loads every page of enquiries and validates the record count instead of silently stopping at 60.
- The selected enquiry desk now has direct email and phone actions and an edit form for customer contact details, postcode, dimensions and brief. Saving uses the authenticated Supabase client and reports that the record was updated; actual customer contact remains a deliberate action by Anthony.
- Existing quote, work order, appointment, invoice, payment, calendar and enquiry status workflows remain in the desk. A quote/invoice status of `sent` records that the user marked it sent; it does not email the customer. Invoice PDFs are printed or saved manually.
- `TZ=Europe/London node --test`: 133 tests passed.
- JavaScript syntax checks, inline-script parsing and `git diff --check` passed. A temporary public build passed the public-boundary check.

## Still needs a real release or business setup

- The Staff Access link change and enquiry desk improvements are local only. Publish them only after Mark approves this exact release.
- Anthony's email delivery and first sign-in have not been verified. The sign-in link requires working outbound email for the Supabase project.
- The website assistant is currently rule-based. Its guide-price answer reads the live configurator's computed range, but its language responses are fixed patterns; there is no connected language-model provider. A server-side provider choice and private API credential are required to make responses generative. Never put that credential in browser code.
- Customer email delivery, Stripe payment collection, the company domain, business email, and real push notification receipt still require setup and end-to-end acceptance checks.
- No new live financial or booking records were created in this work. Do not test invoice sending or Stripe by creating real transactions.

## Next acceptance checks

1. Confirm the company email, domain, and chosen language-model provider; store provider credentials as server secrets only.
2. Approve and publish the reviewed Staff Access and Operations changes, then verify the live build SHA and both public website routes.
3. Have Anthony follow the secure email sign-in link and confirm that his owner role opens the Operations desk.
4. With approved fictional fixtures, check enquiry creation, status changes, customer-detail edits, quote draft/revision/acceptance, calendar booking and blocking, invoice PDF/payment recording, and mobile refresh behavior. Do not mark quote or invoice as sent unless a real external send has happened.
5. Add real mail delivery and Stripe only after the company details, payment terms and provider setup are ready; test their sandbox or controlled test mode before live collection.
