import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { createNotificationRetryHandler } from "./handler.mjs";

Deno.serve(createNotificationRetryHandler({
  env: name => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession:false, autoRefreshToken:false } }),
  logError: message => console.error(message)
}));
