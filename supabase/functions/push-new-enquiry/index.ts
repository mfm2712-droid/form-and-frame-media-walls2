import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";
import { createPushHandler, isValidVapidSubject } from "./handler.mjs";

const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const subject = Deno.env.get("VAPID_SUBJECT") || "";
if (publicKey && privateKey && isValidVapidSubject(subject)) webpush.setVapidDetails(subject, publicKey, privateKey);

Deno.serve(createPushHandler({
  env: name => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  sendPush: (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
  logError: message => console.error(message)
}));
