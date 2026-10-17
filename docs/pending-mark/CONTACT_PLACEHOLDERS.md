# Contact details — prepared, NOT published

Nothing below may be filled in by anyone except from information supplied by Mark. The public page currently shows no phone number or email (enquiry form only). `scripts/public-site.test.mjs` fails if a `tel:`/`mailto:` recipient, phone number, or JSON-LD `telephone`/`email`/`sameAs` appears, so adding real values requires updating that test in the same PR (deliberately).

| Field | Value | Where it will go when confirmed |
|---|---|---|
| Business phone | to be supplied by Mark | footer `tel:` link; JSON-LD `telephone` |
| Business email | to be supplied by Mark | footer `mailto:` link; recipient of the "Open email app with this brief" link (currently `mailto:?subject=…`, no recipient); JSON-LD `email` |
| Street address to publish | **currently published, unverified:** "Unit 4, Buckingham Ave, Slough SL1" (footer + JSON-LD, present since the initial source). Mark to confirm or remove | footer, JSON-LD `address` |
| Opening hours / response time | to be supplied by Mark | contact section copy (the "within one working day" promise was removed) |
| Whether surveys are free | to be supplied by Mark | "free" was removed from meta description and contact copy |
| Company name / number / VAT | to be supplied by Mark | footer; business_settings table (staff app) |
| Canonical domain | to be supplied by Mark | `<link rel=canonical>`, JSON-LD `url`, `sitemap.xml`, `robots.txt` (currently form-and-frame.vercel.app) |
| Social profiles / reviews (real, with permission) | to be supplied by Mark | JSON-LD `sameAs`; never testimonials without source + consent |
| og:image | to be supplied by Mark (a photo Form & Frame owns) | `<meta property="og:image">` (removed: it pointed at an unvalidated Burnham photo) |

Snippets to use once values exist (do not add earlier):
```html
<span><a href="tel:+PHONE">PHONE</a></span>
<span><a href="mailto:EMAIL">EMAIL</a></span>
```
```json
"telephone": "PHONE", "email": "EMAIL"
```
