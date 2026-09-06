# Form & Frame Operations Hub

## What Anthony receives

Anthony signs into the private `/operations/` link with a magic-link email. The hub is separate from the customer website but reads the same live data.

- New website forms and Project Assistant hand-offs create one lead record.
- Each record contains customer contact details, the complete configured specification, guide price, preferred date and uploaded room images.
- A real-time notification appears in the hub; the Edge Function can also send an email notification to Anthony.
- Customers only request a slot. Anthony confirms, moves or declines it; confirmed work automatically appears as a booked block.

## Recommended stack

| Layer | Service | Reason |
|---|---|---|
| Database, auth, uploads, real-time | Supabase | One secure service for the public site and private hub. |
| Branded transactional email | Resend | Sends the HTML pro forma and Anthony’s enquiry notification. |
| Push notifications | OneSignal or Firebase Cloud Messaging | Optional browser push after Anthony grants permission. |
| Public website | GitHub Pages initially, Vercel recommended | The public proposal can stay static; API calls go to Supabase Edge Functions. |

## Activation order

1. Create a Supabase project and run `supabase/migrations/20260906110000_operations_hub.sql` in the SQL Editor.
2. Create Anthony's Auth user, then insert their user id into `profiles` with role `owner`.
3. Deploy `submit-enquiry` and set `RESEND_API_KEY`, `NOTIFICATION_EMAIL` and `NOTIFICATION_FROM` only in Supabase secrets.
4. Add the public Supabase values to `operations/config.js` (never add service-role credentials to GitHub).
5. Connect the public enquiry form and Project Assistant to the Edge Function.
6. Publish the Operations Hub behind Supabase magic-link authentication.

## Security rules

- Customer uploads stay in the private `project-uploads` bucket.
- The public site talks only to the Edge Function; it never receives a service-role key.
- Only profiles with `owner` or `staff` role can read leads, calendar blocks and uploads.
- The system records every outbound email or push event in `notification_events`.

