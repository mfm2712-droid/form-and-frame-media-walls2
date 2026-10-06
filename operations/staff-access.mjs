// UI access checks complement database RLS; they never grant database rights.
export async function checkStaffAccess(client) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error?.name === "AuthSessionMissingError") return { state:"signed_out" };
    if (error) return { state:"unavailable" };
    if (!data?.user) return { state:"signed_out" };
    const profile = await client.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    if (profile.error) return { state:"unavailable" };
    if (!["owner", "staff"].includes(profile.data?.role)) return { state:"unassigned" };
    return { state:"authorized", role:profile.data.role };
  } catch {
    return { state:"unavailable" };
  }
}

export function staffAccessMessage(state) {
  if (state === "unassigned") return "You are signed in, but this account has not been added to the Form & Frame team. Ask the owner to enable your staff access, or sign out to use another account.";
  if (state === "signed_out") return "Your session has ended. Sign in again with your registered work email.";
  return "We couldn't verify your staff access. Check your connection and retry. Business records remain hidden until access is confirmed.";
}
