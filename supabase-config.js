/* =========================================================
   CAMPUSGIGS — SUPABASE CONFIG
   Paste your own project's values below. Find them in your
   Supabase dashboard under Project Settings -> API:
     - "Project URL"       -> SUPABASE_URL
     - "anon public" key   -> SUPABASE_ANON_KEY

   The anon key is SAFE to expose in frontend code — it's
   designed to be public. It only works within the limits
   your Row Level Security (RLS) policies allow. Never put
   your "service_role" key here; that one bypasses RLS
   entirely and must stay on a server, never in the browser.
   ========================================================= */

const SUPABASE_URL = "https://xrkwacldunjxrdpndxvc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhya3dhY2xkdW5qeHJkcG5keHZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTIxMDMsImV4cCI6MjA5Nzk2ODEwM30.PIYeWF9eA-aSH3L9jD_E99QFSr-wkvQ-VSPhpwfD3lI";

// Creates one shared Supabase client other scripts can use via window.supabaseClient.
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);