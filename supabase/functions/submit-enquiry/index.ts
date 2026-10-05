import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { createEnquiryHandler } from "./handler.mjs";

Deno.serve(createEnquiryHandler({
  env: name => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  logError: message => console.error(message)
}));
