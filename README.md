# Hostel Manager

A simple, private rent manager for a single hostel owner in Chennai. **One file, no login, no internet, no subscription.** It runs in the phone browser and can be installed to the home screen like a normal app.

Designed for:
- Sathvika MV Ladies Hostel
- Sathvika MV Men's Hostel

## Open it

Host the folder anywhere static (or run `npm run serve` and open `http://<your-ip>:8080`). On the phone:

- **iPhone / iPad** — Safari → Share → **Add to Home Screen**
- **Android** — Chrome → ⋮ → **Install app** / **Add to Home screen**

After the first visit it works offline. All data is stored on the phone in `localStorage`; nothing is uploaded anywhere.

The app opens straight to your data — no account, no password. If you want privacy, Settings → **Set a PIN** adds a **4-digit PIN**; after that it is asked each time the app opens (and again if you leave it for more than two minutes), so someone who borrows your phone cannot read your residents' details.

## First 5 minutes

1. Tap the **gear** on Home → set your name, the **rent due day** (default 5th) and your **UPI ID**. Tap **Save settings**. Add a **PIN** there too if you want the app locked.
2. **Rooms** → add each room: number, floor, sharing type, beds, rent per bed, AC / Non-AC. Beds (Bed 1, Bed 2…) are created automatically.
3. **Residents** → **Add resident** in three short steps: details → room & bed → rent & deposit. The first month can be pro-rated or charged full.
4. **Payments** → tap a row to record money received (cash / UPI / bank transfer). Part payments keep a balance and can have several receipts. After saving you can send a short **WhatsApp receipt** with the amount, month, balance and date.
5. **Reports** → pick a month and download **CSV** or use **Print / PDF**.

Want to look around first? Home → **Try demo** loads 33 realistic residents, rooms, rent history and expenses. Settings → **Clear all data** removes it.

## What it does

- **Home** — rent collected / pending / expenses / profit for the month, a collection progress bar, bed occupancy, the residents who owe rent (with one-tap WhatsApp reminders) and quick actions.
- **Rooms** — rooms grouped by floor, beds coloured green (vacant) or red (occupied, showing the resident's first name). Tap a bed to assign someone or open their profile.
- **Residents** — search by name or phone, filter Active / Vacated / Pending rent, full profiles with call, WhatsApp, payment history and deposit status. Vacating frees the bed, stops future dues, records the deposit refund and keeps all history.
- **Payments** — month by month dues with Paid / Partial / Pending / Overdue status, multiple receipts per month, per-row reminders and a **Send reminders** screen that opens WhatsApp one person at a time (free, no bulk API).
- **Reports** — property, year and month filters; overview with income vs expense chart and year-to-date; collection summary and defaulters; occupancy and vacancy trend; expenses by category. CSV and a printable/PDF report.
- **Settings** — owner name, due day, UPI, editable WhatsApp message, **Change PIN**, **Large text** switch, **Share backup** / back up / restore, demo data and clear-all.

### App lock and privacy

- **PIN lock** — optional 4 digits, set or changed in Settings. Asked on every launch and after the app has been in the background for two minutes. The PIN itself is never stored: only a salted hash, kept apart from your hostel data.
- **Forgot PIN?** There is no reset code and no "email me" — that would defeat the lock. The only way back in is *Restore a backup* from the lock screen (or Settings). Restoring gives you a fresh PIN setup, and the restored data is your own backup file.
- **ID numbers** — the resident profile shows only the last 4 digits (`•••• 1234`) until you tap **Show**.
- **Large text** — Settings → *Large text* makes every screen about 15% bigger for easier reading.

## Rules built in

- A due is created automatically for every active resident at the start of each month (and any months skipped while the app was closed).
- Rent becomes **overdue** after the due day; partial payments stay amber with the balance kept.
- A resident's **first month** can be pro-rated by joining date.
- Beds can never be given to two people; occupied beds are rejected by the forms.
- Vacating stops dues after the vacating month and keeps every past receipt.
- Editing rent asks **from which month** the new rent applies; earlier months keep the old amount, and receipts already collected are untouched.
- Money is shown in Indian format (`₹12,500`, `₹1,25,000`) and dates as `22 Nov 2026`.

## Data safety

Everything lives on this phone, so:

- **Back up weekly** from Settings → *Share backup* (sends the JSON file to Google Drive, WhatsApp or Files — whichever your phone offers) or *Back up data* (downloads it). Restore it on a new phone with *Restore data*.
- Clearing browser data / uninstalling the browser will erase the app's storage. Keep a backup file.
- The app shows a red reminder on Home when there is no backup or the last one is over a week old, with Share and Download buttons right there.

## Files

```
index.html            the whole app (HTML + CSS + JS, no build step)
manifest.webmanifest  PWA manifest
sw.js                 service worker (offline cache + "updated" toast)
icon-192.png          app icon
icon-512.png          app icon
tests/                jsdom tests for the tricky logic
```

## Development

```bash
npm install
npm test        # runs the four jsdom suites
npm run serve   # static server on :8080
```

The tests cover the home dashboard, rooms/beds, resident wizard, payment receipts and WhatsApp receipts, reminders, reports, CSV/print, backup sharing and restore, the PIN lock, masked IDs, large text, rent changes by month, pro-rating, month rollover, vacating and validation.

No frameworks, no trackers, no network calls, no accounts.
