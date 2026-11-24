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
3. **Residents** → **Add resident** in three short steps: details → room & bed → rent & deposit. The rent step shows exactly what the joining month costs (see *Mid-month joining and leaving* below) — **Pro-rate** is the default, **Full month** is one tap away, and the days or the amount can be typed over by hand.
4. **Payments** → tap a row to record money received (cash / UPI / bank transfer). Part payments keep a balance and can have several receipts. After saving you can send a short **WhatsApp receipt** with the amount, month, balance and date. For a hostel on **Split hostel bill**, tap **Add electricity bill** for the month: the bill is shared equally between everyone who stayed there that month and added to each due.
5. **Reports** → pick a month and download **CSV** or use **Print / PDF**.

## What it does

- **Home** — rent collected / pending / expenses / profit for the month, a collection progress bar, bed occupancy, the residents who owe rent (with one-tap WhatsApp reminders) and quick actions.
- **Rooms** — rooms grouped by floor, beds coloured green (vacant) or red (occupied, showing the resident's first name). Tap a bed to assign someone or open their profile.
- **Residents** — search by name or phone, filter Active / Vacated / Pending rent, full profiles with call, WhatsApp, payment history and deposit status. Vacating frees the bed, stops future dues, records the deposit refund and keeps all history.
- **Payments** — month by month dues with Paid / Partial / Pending / Overdue status, multiple receipts per month, per-row reminders and a **Send reminders** screen that opens WhatsApp one person at a time (free, no bulk API).
- **Reports** — property, year and month filters; overview with income vs expense chart and year-to-date; collection summary and defaulters; occupancy and vacancy trend; expenses by category. CSV and a printable/PDF report.
- **Settings** — owner name, due day, UPI, editable WhatsApp message; per-hostel **Hostel settings** (monthly rent per bed, advance, electricity as *Fixed per person* with an amount or *Split hostel bill*, and the mid-month joining/leaving rules); the **account** row with cloud **sync status** and **Log out**, **Large text** switch, **Share backup** / back up / restore, and **Erase everything**.

### Mid-month joining and leaving

Every hostel has its own five rules in **Settings → Hostel settings**:

| Setting | Default | What it does |
| --- | --- | --- |
| Day rate basis | **Fixed 30 days** | Per-day rate = monthly rent ÷ 30, or ÷ the actual days in that month |
| Count the joining day | **Yes** | Whether the joining day itself is charged |
| Rounding | **Nearest rupee** | Nearest rupee, round up or round down |
| Pro-rate electricity for mid-month joiners | **No (full share)** | Split bill: shares weighted by days stayed. Fixed per person: amount × days ÷ basis |
| Charge the full month if a resident leaves mid-month | **Yes** | No = the leaving month is charged by days stayed |

The formula, everywhere in the app: **per-day rate = monthly rent ÷ day-rate basis**, **part-month rent = per-day rate × days stayed**, always **capped at the full monthly rent** (the per-day rate is shown to the paisa, e.g. ₹216.67).

**Add resident, step 3** shows the working instead of asking a question:

```
Rent ₹6,500 ÷ 30 days = ₹216.67 per day
Joined 20 Nov · 11 days (counting joining day)
First month rent                                    ₹2,383
```

- **Pro-rate** is selected by default; **Full month** charges the whole month instead.
- *Days charged* and *First month rent* can both be typed over; the card then says **edited** (the amount wins over the days). *Use the calculated amount* puts it back.
- Joining on the 1st is always a full month, whatever the settings say.

The same breakdown follows the money: it appears on the **due sheet**, on the **receipt** and in the **WhatsApp message**, and `{days}` (e.g. `11 of 30 days`) and `{perday}` are available as message tags.

**Leaving mid-month** follows the hostel's last setting. With *Yes* nothing changes (the full month stands). With *No*, vacating recalculates that month's due by days stayed and updates the balance; the deposit refund flow is exactly as before.

**Changing these settings** recalculates the affected dues immediately. Dues that already have money recorded against them are **left untouched** — the app says how many, with a warning at the top of Hostel settings (tap *Got it* to dismiss).

### Rent and electricity
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

Tests (and a phone-only install of a build that ships with keys) switch the cloud off with `window.HOSTEL_CONFIG = { cloud: false }` — every jsdom suite does this so nothing touches the network.

The anon key is public by design — row level security above is what keeps each account's data private. Never put the **service_role** key in the app.

## Rules built in

- A due is created automatically for every active resident at the start of each month (and any months skipped while the app was closed).
- Rent becomes **overdue** after the due day; partial payments stay amber with the balance kept.
- A resident joining or leaving mid-month is charged by days stayed, using that hostel's rules (see above); a part month never costs more than a full month.
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
tests/                jsdom tests (smoke, logic, details, electricity, rooms, auth, prorate)
```

## Development

```bash
npm install
npm test        # runs the seven jsdom suites (smoke, logic, details, electricity, rooms, auth, prorate)
npm run serve   # static server on :8080
```

The tests cover the home dashboard, rooms/beds and 1–8 sharing, the resident wizard, mid-month joining and leaving rent, payment receipts and WhatsApp receipts, reminders, reports, CSV/print, backup sharing and restore, erase-everything, masked IDs, large text, rent changes by month, month rollover, vacating, validation, and the account and sync layer (login gate, local account, sessions, Supabase sign-in/sign-up, pull, debounced push, token refresh, offline status) against a stubbed `fetch`. `tests/prorate.test.js` covers the mid-month engine on its own: joining on the 1st, fixed-30 vs actual days in 30- and 31-day months, the joining day counted and not counted, all three roundings, electricity pro-rated for both hostel types, leaving mid-month with both settings, hand-edited days and amounts, and the settings recalculation including its warning for dues that already have payments.

They seed their own small fixture (`tests/fixture.js`) — no sample data ships in the app.

No frameworks, no trackers, no analytics. The only network calls are the ones to your own Supabase project (and still none without keys).
