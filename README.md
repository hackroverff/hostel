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

On the very first open the app asks you to choose a **4-digit PIN** (enter it twice) before it shows anything else. After that the PIN is asked each time the app opens, and again if you leave it for more than two minutes — so someone who borrows your phone cannot read your residents' details. No account, no password, no internet.

## First 5 minutes

1. Choose your **4-digit PIN** when the app opens, then tap the **gear** on Home → set your name, the **rent due day** (default 5th) and your **UPI ID**. Tap **Save settings**.
2. **Rooms** → add each room: number, floor, sharing type, beds, rent per bed, AC / Non-AC. Sharing can be **Single or 2 to 8 sharing**; picking one fills the number of beds for you (you can still change it). Beds (Bed 1, Bed 2…) are created automatically. On an empty Rooms screen there is also **Quick setup**, which fills both hostels with the usual rooms after you confirm (it never runs on its own):
   - Men's hostel — 4 rooms of 8 beds on Ground, 1st, 2nd and 3rd floor (32 beds) at ₹4,000 per bed.
   - Ladies hostel — 5 rooms on the 1st floor: 2, 2, 2, 3 and 1 sharing (10 beds) at ₹6,500 per bed.

   Every room stays editable afterwards (a room set to 8 sharing is still 8 sharing when you open it again).
3. **Residents** → **Add resident** in three short steps: details → room & bed → rent & deposit. The first month can be pro-rated or charged full.
4. **Payments** → tap a row to record money received (cash / UPI / bank transfer). Part payments keep a balance and can have several receipts. After saving you can send a short **WhatsApp receipt** with the amount, month, balance and date. For a hostel on **Split hostel bill**, tap **Add electricity bill** for the month: the bill is shared equally between everyone who stayed there that month and added to each due.
5. **Reports** → pick a month and download **CSV** or use **Print / PDF**.

## What it does

- **Home** — rent collected / pending / expenses / profit for the month, a collection progress bar, bed occupancy, the residents who owe rent (with one-tap WhatsApp reminders) and quick actions.
- **Rooms** — rooms grouped by floor, beds coloured green (vacant) or red (occupied, showing the resident's first name). Tap a bed to assign someone or open their profile.
- **Residents** — search by name or phone, filter Active / Vacated / Pending rent, full profiles with call, WhatsApp, payment history and deposit status. Vacating frees the bed, stops future dues, records the deposit refund and keeps all history.
- **Payments** — month by month dues with Paid / Partial / Pending / Overdue status, multiple receipts per month, per-row reminders and a **Send reminders** screen that opens WhatsApp one person at a time (free, no bulk API).
- **Reports** — property, year and month filters; overview with income vs expense chart and year-to-date; collection summary and defaulters; occupancy and vacancy trend; expenses by category. CSV and a printable/PDF report.
- **Settings** — owner name, due day, UPI, editable WhatsApp message; per-hostel **Hostel settings** (monthly rent per bed, advance, and electricity as *Fixed per person* with an amount, or *Split hostel bill*); **Change PIN**, **Large text** switch, **Share backup** / back up / restore, and **Erase everything**.

### Rent and electricity

- Every due has two parts: **Rent** and **Electricity**. The payment screen, receipt and WhatsApp reminder show the total with both lines named.
- **Fixed per person** (Men's hostel default, ₹250) — the same amount is added to every monthly due at that hostel. Change it in Settings → Hostel settings.
- **Split hostel bill** (Ladies hostel default) — one bill per hostel per month, entered on the Payments screen. It is divided equally between every resident who was at that hostel at any point in that month, rounded to the nearest rupee, and each person's share appears on their due. A different room does not matter.
- Until the bill is entered those dues show **Electricity pending**; rent can still be recorded.
- One person's share can be edited on their due (**Edit** next to Electricity) — for example when someone used a fan or an AC. Their edited share is kept when the bill or the resident list changes; **Use the automatic share** puts it back. Joining, vacating or re-saving the bill recalculates everyone else's share.
- **Reports** show Rent and Electricity as separate income lines.

### App lock and privacy

- **PIN lock** — 4 digits, chosen on first open and changeable in Settings. Asked on every launch and after the app has been in the background for two minutes. The PIN itself is never stored: only a salted hash, kept apart from your hostel data.
- **Forgot PIN?** There is no reset code and no "email me" — that would defeat the lock. The only way back in is *Restore a backup* from the lock screen (or Settings). Restoring gives you a fresh PIN setup, and the restored data is your own backup file.
- **ID numbers** — the resident profile shows only the last 4 digits (`•••• 1234`) until you tap **Show**.
- **Large text** — Settings → *Large text* makes every screen about 15% bigger for easier reading.

## Rules built in

- A due is created automatically for every active resident at the start of each month (and any months skipped while the app was closed).
- Rent becomes **overdue** after the due day; partial payments stay amber with the balance kept.
- A resident's **first month** can be pro-rated by joining date.
- Electricity is never guessed: a split hostel shows *Electricity pending* until the owner enters that month's bill, and the split follows the resident list of that month.
- Beds can never be given to two people; occupied beds are rejected by the forms.
- Vacating stops dues after the vacating month and keeps every past receipt.
- Editing rent asks **from which month** the new rent applies; earlier months keep the old amount, and receipts already collected are untouched.
- Money is shown in Indian format (`₹12,500`, `₹1,25,000`) and dates as `22 Nov 2026`.

## Data safety

Everything lives on this phone, so:

- **Back up weekly** from Settings → *Share backup* (sends the JSON file to Google Drive, WhatsApp or Files — whichever your phone offers) or *Back up data* (downloads it). Restore it on a new phone with *Restore data*.
- *Erase everything* in Settings asks for your PIN first, then deletes every resident, room, payment and expense after a red confirmation. **Back up before you use it.**
- Clearing browser data / uninstalling the browser will erase the app's storage. Keep a backup file.
- The app shows a red reminder on Home when there is no backup or the last one is over a week old, with Share and Download buttons right there.

## Files

```
index.html            the whole app (HTML + CSS + JS, no build step)
manifest.webmanifest  PWA manifest
sw.js                 service worker (offline cache + "updated" toast)
icon-192.png          app icon
icon-512.png          app icon
tests/                jsdom tests (smoke, logic, details, electricity, security)
```

## Development

```bash
npm install
npm test        # runs the five jsdom suites (smoke, logic, details, electricity, security)
npm run serve   # static server on :8080
```

The tests cover the home dashboard, rooms/beds, resident wizard, payment receipts and WhatsApp receipts, reminders, reports, CSV/print, backup sharing and restore, the first-open PIN setup, the PIN lock, erase-everything, masked IDs, large text, rent changes by month, pro-rating, month rollover, vacating and validation. They seed their own small fixture (`tests/fixture.js`) — no sample data ships in the app.

No frameworks, no trackers, no network calls, no accounts.
