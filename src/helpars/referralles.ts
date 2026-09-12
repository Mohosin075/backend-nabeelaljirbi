import crypto from "crypto";

export const generateReferralCode = (prefix = "SALAMA") => {
  const randomPart = crypto
    .randomBytes(4)
    .toString("hex")
    .substring(0, 6)
    .toUpperCase();

  return `${prefix}${randomPart}`;
};
