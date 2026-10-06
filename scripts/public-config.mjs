export const FORM_AND_FRAME_SUPABASE_REF = "otqzhocismdjbvvsjnpe";

export function resolvePublicConfig(environment) {
  const supabaseUrl = (environment.FF_PUBLIC_SUPABASE_URL || "").trim();
  const supabaseAnonKey = (environment.FF_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (environment.VERCEL_ENV === "production" && (!supabaseUrl || !supabaseAnonKey)) {
    throw new Error("Production builds require both public Supabase configuration values so the enquiry form cannot ship disconnected.");
  }
  if ((supabaseUrl && !supabaseAnonKey) || (!supabaseUrl && supabaseAnonKey)) {
    throw new Error("Set both FF_PUBLIC_SUPABASE_URL and FF_PUBLIC_SUPABASE_ANON_KEY, or leave both unset.");
  }
  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec(supabaseUrl);
  if (supabaseUrl && !match) {
    throw new Error("FF_PUBLIC_SUPABASE_URL must be a standard HTTPS Supabase project URL.");
  }
  if (match && match[1].toLowerCase() !== FORM_AND_FRAME_SUPABASE_REF) {
    throw new Error("This Form & Frame build is configured for a different Supabase project. Check the project reference; do not use another product's database.");
  }
  if (supabaseAnonKey) {
    // This checks the deployment configuration, not a JWT signature. Supabase
    // verifies the key at runtime. Never serialize a privileged key to browsers.
    let claims;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(supabaseAnonKey)) throw new Error();
      claims = JSON.parse(Buffer.from(supabaseAnonKey.split(".")[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("FF_PUBLIC_SUPABASE_ANON_KEY must be the legacy public anon JWT; the enquiry gateway currently requires a JWT-based key.");
    }
    if (claims?.role !== "anon" || claims?.ref !== FORM_AND_FRAME_SUPABASE_REF) {
      throw new Error("Only the Form & Frame public anon key may be included in browser configuration; privileged or other-project keys are forbidden.");
    }
  }
  const vapidPublicKey = (environment.FF_OPERATIONS_VAPID_PUBLIC_KEY || "").trim();
  if (vapidPublicKey && !/^B[A-Za-z0-9_-]{86}$/.test(vapidPublicKey)) {
    throw new Error("FF_OPERATIONS_VAPID_PUBLIC_KEY must be a valid uncompressed P-256 public key in base64url form.");
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    supabaseAnonKey,
    vapidPublicKey
  };
}
