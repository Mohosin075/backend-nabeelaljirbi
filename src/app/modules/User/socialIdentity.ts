import ApiError from "../../../errors/ApiErrors";

// A submitted phone number alone is not proof of account ownership.
export async function verifySocialPhone(
  payload: { idToken?: string; phoneNumber?: string },
  verify: (token: string) => Promise<{ phone_number?: string }> = async token => {
    const firebase = await import("../../../helpars/firebase/firebase");
    return firebase.default.auth().verifyIdToken(token, true);
  },
) {
  if (typeof payload.idToken !== "string" || !payload.idToken.trim())
    throw new ApiError(401, "A verified identity token is required; use phone OTP to sign in");
  let identity;
  try { identity = await verify(payload.idToken); }
  catch { throw new ApiError(401, "Identity verification failed; use phone OTP to sign in"); }
  if (!identity.phone_number || identity.phone_number !== payload.phoneNumber)
    throw new ApiError(403, "The identity must verify the requested phone number");
  return identity.phone_number;
}
