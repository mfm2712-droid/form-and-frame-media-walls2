# Form & Frame repository instructions

This repository is for **Form & Frame** only. Keep all application UI, project documents and developer-facing handoffs in English. Never mix in Lumi or another product's files, data, Supabase project, credentials or design.

## Product and data rules

- The staff Operations app is mobile-first. Its public static shell may load without a session; all business records must remain protected by Supabase Auth and row-level security.
- Keep website guide prices, formal quotations, sent invoices and received payments as separate facts. Never invent customer records, job costs, tax rates or profit margins. Demo data must be clearly labelled fictional and must never appear as live data.
- A requested visit window is not a booking. Only a saved, conflict-checked appointment reserves calendar time.
- Keep the Form & Frame Supabase project reference pinned to `otqzhocismdjbvvsjnpe`. Do not access or modify the Lumi project.
- Browser code may use only the public anon key and public VAPID key. Never place service-role keys, database passwords, email credentials, VAPID private keys or push dispatch tokens in client code, logs or Git.

## Changes and verification

- Do not push, merge, publish, deploy, run live migrations or write test data to remote services unless Mark explicitly authorizes that exact action.
- Do not change the customer-facing configurator or its approved design while doing Operations work unless the task asks for it.
- Avoid editing files under the ignored `planning/` directory as a substitute for changes to the real app.
- Run `TZ=Europe/London node --test`, parse the JavaScript changed, and run `git diff --check`. For the public build boundary, use a temporary directory if the checkout does not permit writing `dist/`.
- Report which files changed, which checks passed, and any backend or deployment state that remains unverified. Do not describe local code or a prototype as live.

## Current assigned task

Read `OPENCODE_NEXT_TASK.md` and complete that bounded task. Work only in the current Form & Frame repository.
