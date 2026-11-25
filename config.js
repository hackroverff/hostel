/* ===========================================================================
   Hostel Manager - cloud config
   ---------------------------------------------------------------------------
   Leave both values as they are to keep everything on this phone. The app then
   works exactly like a local-only install: no account server, no internet, no
   data leaves the device.

   To sync between phones:
     1. Create a free project at https://supabase.com
     2. Open the SQL editor and run supabase/schema.sql
     3. Authentication -> Users -> Add user: create the owner's email + password
     4. Authentication -> Providers -> Email: turn "Enable sign ups" OFF
     5. Paste the Project URL and the publishable (anon) key below

   The publishable key is meant to be public: it ships in the browser, and row
   level security in supabase/schema.sql is what keeps every hostel's rows
   private to its own login. Paste the publishable key, never a private one.
   =========================================================================== */
window.APP_CONFIG = {
  SUPABASE_URL: 'PASTE_PROJECT_URL',
  SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY'
};
