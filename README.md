# SplitNest

Modern roommate utility bill splitting SaaS MVP.

## Stack

- Next.js 15
- Tailwind CSS
- shadcn-style UI components
- Supabase Auth, Postgres, Storage
- Stripe-ready config
- OpenAI vision bill extraction pipeline
- PDF text parsing fallback

## Run

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add Supabase/OpenAI/Stripe keys.

## Database

Run `supabase/schema.sql` in Supabase SQL editor. It creates:

- households
- household members and invite codes
- bills and uploaded proof path
- utility bill type, service address, OCR confidence, manual review state
- equal/weighted bill splits
- payment accounts
- reminder rules
- bill proof storage bucket
- RLS policies

Without env values, app shows demo data so UI can be reviewed immediately.

## Bill Extraction

`POST /api/ocr` accepts PDF/image uploads and returns editable bill fields:

- utility provider
- bill type: electric, water, garbage, internet
- total amount
- due date
- billing period
- service address
- confidence score and validation issues

If confidence is low, UI asks user to confirm fields manually before saving.

## Payment Requests

`/payments` shows generated roommate payment requests with:

- utility name
- total bill
- roommate share
- due date
- uploaded proof link
- Venmo, Cash App, PayPal, or Zelle instructions
- pending, paid, overdue status
- automatic reminder events
- payment history

`POST /api/payment-requests` creates payment request payloads from bill + roommate shares and returns payment URLs/instructions plus reminder schedule.
