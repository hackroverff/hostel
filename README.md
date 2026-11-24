# Hostel Manager

A simple, private rent manager for a single hostel owner in Chennai. **One file, no subscription.** It runs in the phone browser and can be installed to the home screen like a normal app. It works fully offline, and can optionally sync to your own Supabase account so the same data opens on any phone.

Designed for:
- Sathvika MV Ladies Hostel
- Sathvika MV Men's Hostel

## Open it

Host the folder anywhere static (or run `npm run serve` and open `http://<your-ip>:8080`). On the phone:

- **iPhone / iPad** — Safari → Share → **Add to Home Screen**
- **Android** — Chrome → ⋮ → **Install app** / **Add to Home screen**

After the first visit it works offline. Data is cached on the phone in `localStorage`; if you add Supabase keys (see below) it is also saved to your own cloud account.

On the very first open the app asks for a **username and password** before it shows anything else — so someone who borrows your phone cannot read your residents' details. Leave *Stay signed in* ticked and you are not asked again on that phone. Without Supabase keys this is a **local account**: the password is kept only as a salted hash on the phone, and nothing is uploaded anywhere.

## First 5 minutes

1. Create your **account** (username + password) when the app opens, then tap the **gear** on Home → set your name, the **rent due day** (default 5th) and your **UPI ID**. Tap **Save settings**.
2. **Rooms** → add each room: number, floor, sharing type, beds, rent per bed, AC / Non-AC. Sharing can be **Single or 2 to 8 sharing**; picking one fills the number of beds for you (you can still change it). Beds (Bed 1, Bed 2…) are created automatically. On an empty Rooms screen there is also **Quick setup**, which fills both hostels with the usual rooms after you confirm (it never runs on its own):
   - Men's hostel — 4 rooms of 8 beds on Ground, 1st, 2nd and 3rd floor (32 beds) at ₹4,000 per bed.
   - Ladies hostel — 5 rooms on the 1st floor: 2, 2, 2, 3 and 1 sharing (10 beds) at ₹6,500 per bed.

   Every room stays editable afterwards (a room set to 8 sharing is still 8 sharing when you open it again).
3. **Residents** → **Add resident** in three short steps: details → room & bed → rent & deposit. Every new resident is charged the **full monthly rent** for the month they join.
4. **Payments** → tap a row to record money received (cash / UPI / bank transfer). Part payments keep a balance and can have several receipts. After saving you can send a short **WhatsApp receipt** with the amount, month, balance and date. For a hostel on **Split hostel bill**, tap **Add electricity bill** for the month: the bill is shared equally between everyone who stayed there that month and added to each due.
5. **Reports** → pick a month and download **CSV** or use **Print / PDF**.

## What it does

- **Home** — rent collected / pending / expenses / profit for the month, a collection progress bar, bed occupancy, the residents who owe rent (with one-tap WhatsApp reminders) and quick actions.
- **Rooms** — rooms grouped by floor, beds coloured green (vacant) or red (occupied, showing the resident's first name). Tap a bed to assign someone or open their profile.
- **Residents** — search by name or phone, filter Active / Vacated / Pending rent, full profiles with call, WhatsApp, payment history and deposit status. Vacating frees the bed, stops future dues, records the deposit refund and keeps all history.
- **Payments** — month by month dues with Paid / Partial / Pending / Overdue status, multiple receipts per month, per-row reminders and a **Send reminders** screen that opens WhatsApp one person at a time (free, no bulk API).
- **Reports** — property, year and month filters; overview with income vs expense chart and year-to-date; collection summary and defaulters; occupancy and vacancy trend; expenses by category. CSV and a printable/PDF report.
- **Settings** — owner name, due day, UPI, editable WhatsApp message; per-hostel **Hostel settings** (monthly rent per bed, advance, and electricity as *Fixed per person* with an amount, or *Split hostel bill*); the **account** row with cloud **sync status** and **Log out**, **Large text** switch, **Share backup** / back up / restore, and **Erase everything**.

### Rent and electricity

- Every due has two parts: **Rent** and **Electricity**. The payment screen, receipt and WhatsApp reminder show the total with both lines named.
- **Fixed per person** (Men's hostel default, ₹250) — the same amount is added to every monthly due at that hostel. Change it in Settings → Hostel settings.
- **Split hostel bill** (Ladies hostel default) — one bill per hostel per month, entered on the Payments screen. It is divided equally between every resident who was at that hostel at any point in that month, rounded to the nearest rupee, and each person's share appears on their due. A different room does not matter.
- Until the bill is entered those dues show **Electricity pending**; rent can still be recorded.
- One person's share can be edited on their due (**Edit** next to Electricity) — for example when someone used a fan or an AC. Their edited share is kept when the bill or the resident list changes; **Use the automatic share** puts it back. Joining, vacating or re-saving the bill recalculates everyone else's share.
- **Reports** show Rent and Electricity as separate income lines.

### Account, privacy and cloud sync

- **Login** — a username (or email) and a password. The app cannot be opened without it.
- **Local account (default)** — no Supabase keys: the password is stored only as a salted PBKDF2 hash on the phone, next to your data. Nothing leaves the phone, and *Forgot password?* offers to start a new local account (your data stays).
- **Cloud account (optional)** — add your Supabase project URL and anon key (next section) and the same login opens the same hostel data on any phone. A change is pushed about a second after you make it; opening the app or coming back to it pulls newer data from the cloud. `localStorage` stays as an offline cache, so the app opens instantly and keeps working with no internet.
- **Sync status** — Settings → *Account* shows **Synced**, **Syncing…**, **Offline – saved locally** or **Not synced – saved locally**, plus **Sync now** and **Log out**. With no keys it says **Cloud sync off**.
- **ID numbers** — the resident profile shows only the last 4 digits (`•••• 1234`) until you tap **Show**.
- **Large text** — Settings → *Large text* makes every screen about 15% bigger for easier reading.

## Supabase setup (optional, for cloud sync)

1. Create a free project at [supabase.com](https://supabase.com) and open **SQL Editor**.
2. Run this once:

```sql
create table if not exists public.hostel_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.hostel_data enable row level security;

create policy "own row" on public.hostel_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. In **Project Settings → API** copy the **Project URL** and the **anon public** key.
4. Put them at the top of the `<script>` in `index.html`:

```js
var SUPABASE_URL = 'https://yourproject.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOi...';
var SUPABASE_TABLE = 'hostel_data';
```

   (They can also come from `window.HOSTEL_CONFIG = { supabaseUrl, supabaseAnonKey }`, from `<meta name="hostel-supabase-url">` / `<meta name="hostel-supabase-key">`, or from `localStorage.hostelManager.config`.)

5. In **Authentication → Providers → Email** keep email sign-in enabled. A plain username like `owner` is posted to Supabase as `owner@hostel.local` (change the domain with `usernameDomain` in `HOSTEL_CONFIG`); use a real email address as the username if you want password-reset emails. Turn **Confirm email** off if you want accounts to work immediately.

The anon key is public by design — row level security above is what keeps each account's data private. Never put the **service_role** key in the app.

## Rules built in

- A due is created automatically for every active resident at the start of each month (and any months skipped while the app was closed).
- Rent becomes **overdue** after the due day; partial payments stay amber with the balance kept.
- A resident joining on the 20th is still charged the **full monthly rent** for that month — there is no pro-rating anywhere.
- Electricity is never guessed: a split hostel shows *Electricity pending* until the owner enters that month's bill, and the split follows the resident list of that month.
- Beds can never be given to two people; occupied beds are rejected by the forms.
- Vacating stops dues after the vacating month and keeps every past receipt.
- Editing rent asks **from which month** the new rent applies; earlier months keep the old amount, and receipts already collected are untouched.
- Money is shown in Indian format (`₹12,500`, `₹1,25,000`) and dates as `22 Nov 2026`.

## Data safety

Data is cached on this phone (and, with cloud sync, saved to your account), so:

- **Back up weekly** from Settings → *Share backup* (sends the JSON file to Google Drive, WhatsApp or Files — whichever your phone offers) or *Back up data* (downloads it). Restore it on a new phone with *Restore data*.
- *Erase everything* in Settings asks for a red confirmation, then deletes every resident, room, payment and expense (and, when signed in to the cloud, the saved copy too). **Back up before you use it.**
- Clearing browser data / uninstalling the browser erases the cache on that phone; with cloud sync your data comes back when you sign in again. Keep a backup file too.
- The app shows a red reminder on Home when there is no backup or the last one is over a week old, with Share and Download buttons right there.

## Files

```
index.html            the whole app (HTML + CSS + JS, no build step)
manifest.webmanifest  PWA manifest
sw.js                 service worker (offline cache + "updated" toast)
icon-192.png          app icon
icon-512.png          app icon
tests/                jsdom tests (smoke, logic, details, electricity, rooms, auth)
```

## Development

```bash
npm install
npm test        # runs the six jsdom suites (smoke, logic, details, electricity, rooms, auth)
npm run serve   # static server on :8080
```

The tests cover the home dashboard, rooms/beds and 1–8 sharing, the resident wizard, full-month joining rent, payment receipts and WhatsApp receipts, reminders, reports, CSV/print, backup sharing and restore, erase-everything, masked IDs, large text, rent changes by month, month rollover, vacating, validation, and the account and sync layer (login gate, local account, sessions, Supabase sign-in/sign-up, pull, debounced push, token refresh, offline status) against a stubbed `fetch`. They seed their own small fixture (`tests/fixture.js`) — no sample data ships in the app.

No frameworks, no trackers, no analytics. The only network calls are the ones to your own Supabase project (and still none without keys).
