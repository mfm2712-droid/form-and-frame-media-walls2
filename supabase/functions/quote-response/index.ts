import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { createQuoteResponseHandler } from "./handler.mjs";

Deno.serve(createQuoteResponseHandler({
  env: name => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  logError: message => console.error(message)
}));
