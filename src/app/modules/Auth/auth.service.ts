import { randomInt, randomUUID } from "node:crypto";
import { User } from "@prisma/client";
import httpStatus from "http-status";
import bcrypt from "bcrypt";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { jwtHelpers } from "../../../utils/jwtHelpers";

import Twilio from "twilio";
import { generateReferralCode } from "../../../helpars/referralles";
import emailSender from "../../../helpars/emailSender/emailSender";
import { otpEmail } from "../../../emails/otpEmail";

const client = Twilio(config.twilio.accountSid, config.twilio.authToken);

// Helper to generate access & refresh tokens
export const generateTokens = (user: User, role?: string) => {
  const effectiveRole = user.role || role;
  const payload: any = {
    id: user.id,
    phoneNumber: user.phoneNumber,
    role: effectiveRole,
  };
  if (effectiveRole === "ADMIN") {
    payload.adminTier = user.adminTier || "SUPER_ADMIN";
  }

  const accessToken = jwtHelpers.generateToken(
    payload,
    config.jwt.jwt_secret as string,
    config.jwt.expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    payload,
    config.jwt.refresh_token_secret as string,
    config.jwt.refresh_token_expires_in as string,
  );

  return { accessToken, refreshToken };
};

type OTPChannel = "sms" | "whatsapp";

// Resolve primary OTP channel prioritizing WhatsApp
const resolvePrimaryOTPChannel = async (
  requestedSender?: string
): Promise<{ primary: OTPChannel; fallback?: OTPChannel }> => {
  const otpSettings = await prisma.oTPSystem.findFirst();
  const isWhatsappEnabled = otpSettings ? otpSettings.WhatsApp : true;
  const isSmsEnabled = otpSettings ? otpSettings.SMS : false; // Off by default
  if (!isWhatsappEnabled && !isSmsEnabled) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, "OTP delivery is currently disabled");
  }

  const normalized = requestedSender?.toLowerCase().replace(/[\s_-]/g, "");

  if (normalized === "sms") {
    if (!isSmsEnabled && isWhatsappEnabled) {
      // SMS is disabled in settings, route to WhatsApp
      return { primary: "whatsapp" };
    }
    return {
      primary: "sms",
      fallback: isWhatsappEnabled ? "whatsapp" : undefined,
    };
  }

  // Default: WhatsApp is prioritized, SMS is fallback if enabled
  if (isWhatsappEnabled) {
    return {
      primary: "whatsapp",
      fallback: isSmsEnabled ? "sms" : undefined,
    };
  } else if (isSmsEnabled) {
    return { primary: "sms" };
  }

  throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, "OTP delivery is currently disabled");
};

// Send OTP to phone number prioritizing WhatsApp with fallback
const sendOTP = async (phoneNumber: string, OTPSender?: string) => {
  if (typeof phoneNumber !== "string" || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Phone number must start with + and country code");
  }
  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  if (user && (user.banned || user.status !== "ACTIVE")) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User is banned");
  }

  const { primary, fallback } = await resolvePrimaryOTPChannel(OTPSender);

  let channelUsed: OTPChannel = primary;
  let verificationStatus = "pending";
  let sendSuccess = false;

  // 1. Try sending via primary channel (WhatsApp prioritized)
  try {
    const verification = await client.verify.v2
      .services(`${config.twilio.serviceSid}`)
      .verifications.create({ to: phoneNumber, channel: primary });

    console.log(`[Twilio OTP Sent via ${primary}]: ${verification.status}`);
    verificationStatus = verification.status;
    sendSuccess = true;
  } catch (primaryErr: any) {
    console.warn(`Primary OTP channel (${primary}) failed: ${primaryErr.code || primaryErr.message || "unknown error"}`);

    // 2. If primary (WhatsApp) failed and fallback (SMS) is available, try fallback
    if (fallback) {
      console.log(`Attempting fallback OTP via ${fallback}...`);
      try {
        const fallbackVerification = await client.verify.v2
          .services(`${config.twilio.serviceSid}`)
          .verifications.create({ to: phoneNumber, channel: fallback });

        console.log(
          `[Twilio Fallback OTP Sent via ${fallback}]: ${fallbackVerification.status}`
        );
        channelUsed = fallback;
        verificationStatus = fallbackVerification.status;
        sendSuccess = true;
      } catch (fallbackErr: any) {
        console.error(`Fallback OTP channel (${fallback}) failed: ${fallbackErr.code || fallbackErr.message || "unknown error"}`);
      }
    }
  }

  if (!sendSuccess) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, "Unable to send OTP. Please try again later.");
  }

  // Twilio owns the challenge. Never create a second, undelivered login code.
  await prisma.user.upsert({
    where: { phoneNumber },
    update: { otp: null, otpExpiresAt: null },
    create: {
      phoneNumber,
      referralCode: generateReferralCode(),
    },
  });

  return {
    message: `OTP sent successfully via ${channelUsed}`,
    channel: channelUsed,
    status: verificationStatus,
  };
};

// Verify OTP and login
const verifyUserByOTP = async (
  phoneNumber: string,
  otp: string,
  fcmToken?: string,
) => {
  const user = await prisma.user.findUnique({ where: { phoneNumber } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  if (user.banned || user.status !== "ACTIVE")
    throw new ApiError(httpStatus.FORBIDDEN, "Account is inactive or banned");

  let isVerified = false;

  // Only a code verified by the delivery provider can establish phone ownership.
  if (!isVerified) {
    try {
      const verificationCheck = await client.verify.v2
        .services(`${config.twilio.serviceSid}`)
        .verificationChecks.create({
          to: phoneNumber,
          code: otp,
        });

      if (verificationCheck.status === "approved") {
        isVerified = true;
        console.log(`✅ [OTP VERIFIED VIA TWILIO]: ${phoneNumber}`);
      }
    } catch (error: any) {
      console.warn("Twilio Verification Check Error:", error.code, error.message);
    }
  }

  if (!isVerified) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Invalid or expired OTP",
    );
  }

  // Generate JWT tokens for login
  const { accessToken, refreshToken } = generateTokens(user);

  // Update user tokens and clear OTP
  await prisma.user.update({
    where: { phoneNumber },
    data: { accessToken, refreshToken, fcmToken, otp: null, otpExpiresAt: null },
  });

  return {
    message: "OTP verified successfully",
    accessToken,
    refreshToken,
    profileCompleted: user.profileCompleted,
    role: user.role,
  };
};

const refreshToken = async (refreshToken: string) => {
  const decoded = jwtHelpers.verifyToken(
    refreshToken,
    config.jwt.refresh_token_secret as string,
  ) as { phoneNumber: string } | null;

  if (!decoded) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid token");

  const user = await prisma.user.findUnique({
    where: { phoneNumber: decoded.phoneNumber },
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  if (user.refreshToken !== refreshToken)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid token");

  const { accessToken } = generateTokens(user);

  // Update only access token
  await prisma.user.update({
    where: { phoneNumber: user.phoneNumber },
    data: { accessToken },
  });

  return { accessToken };
};

const deleteAccout = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  await prisma.user.delete({
    where: { id: userId }
  })

  return {
    message: "Account deleted successfully"
  }

}

const adminLogin = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;
  const cleanInput = email.trim();

  const user = await prisma.user.findFirst({
    where: {
      role: { in: ['ADMIN', 'CLINIC', 'MANAGER', 'DOCTOR'] },
      OR: [
        { email: { equals: cleanInput, mode: 'insensitive' } },
        { phoneNumber: cleanInput },
      ],
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "Account not found with provided email or phone");
  }

  if (user.banned || user.status !== 'ACTIVE') {
    throw new ApiError(httpStatus.FORBIDDEN, "Account is inactive or banned");
  }

  if (!user.password) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Password is not initialized for this account. Please login with OTP or request a password reset."
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid password");
  }

  const { accessToken, refreshToken } = generateTokens(user, user.role || 'ADMIN');

  await prisma.user.update({
    where: { id: user.id },
    data: { accessToken, refreshToken },
  });

  const adminTier = user.role === 'ADMIN' ? (user.adminTier || "SUPER_ADMIN") : null;

  return {
    message: `${user.role || 'User'} logged in successfully`,
    accessToken,
    refreshToken,
    role: user.role,
    adminTier,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      adminTier,
    },
  };
};

const dashboardRoles: NonNullable<User["role"]>[] = ['ADMIN', 'CLINIC', 'MANAGER', 'DOCTOR'];
const recoveryAccount = (emailOrPhone: string) => prisma.user.findFirst({
  where: {
    role: { in: dashboardRoles },
    OR: [{ email: { equals: emailOrPhone.trim(), mode: 'insensitive' } }, { phoneNumber: emailOrPhone.trim() }],
  },
});

const forgotPassword = async (payload: { emailOrPhone: string }) => {
  const user = await recoveryAccount(payload.emailOrPhone);
  if (!user) throw new ApiError(404, 'No dashboard account found with provided email or phone');
  if (user.banned || user.status !== 'ACTIVE') throw new ApiError(403, 'Account is inactive or banned');
  const emailRequested = payload.emailOrPhone.includes('@');
  let resetToken: string;
  if (emailRequested) {
    resetToken = randomInt(100000, 1000000).toString();
    try {
      await emailSender('Password Reset Code', user.email!, otpEmail(resetToken));
    } catch {
      throw new ApiError(503, 'Unable to send password reset email. Please try again later.');
    }
  } else {
    const { primary, fallback } = await resolvePrimaryOTPChannel();
    const deliver = (channel: OTPChannel) => client.verify.v2.services(String(config.twilio.serviceSid))
      .verifications.create({ to: user.phoneNumber, channel });
    try { await deliver(primary); }
    catch {
      if (!fallback) throw new ApiError(503, 'Unable to send password reset code. Please try again later.');
      try { await deliver(fallback); }
      catch { throw new ApiError(503, 'Unable to send password reset code. Please try again later.'); }
    }
    resetToken = 'phone:' + randomUUID();
  }
  await prisma.user.update({ where: { id: user.id }, data: {
    passwordResetToken: resetToken,
    passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
  } });
  return { message: emailRequested ? 'Password reset code sent to your email.' : 'Password reset code sent to your phone.' };
};

const resetPassword = async (payload: { emailOrPhone: string; token: string; newPassword: string }) => {
  const user = await recoveryAccount(payload.emailOrPhone);
  if (!user || user.banned || user.status !== 'ACTIVE' || !user.passwordResetToken ||
      !user.passwordResetExpires || user.passwordResetExpires <= new Date()) {
    throw new ApiError(400, 'Invalid or expired password reset token');
  }
  let verified = false;
  if (user.passwordResetToken.startsWith('phone:')) {
    try {
      const check = await client.verify.v2.services(String(config.twilio.serviceSid))
        .verificationChecks.create({ to: user.phoneNumber, code: payload.token });
      verified = check.status === 'approved';
    } catch { /* Invalid or expired provider challenge. */ }
  } else {
    verified = user.passwordResetToken === payload.token;
  }
  if (!verified) throw new ApiError(400, 'Invalid or expired password reset token');
  const password = await bcrypt.hash(payload.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: {
    password, passwordResetToken: null, passwordResetExpires: null,
    accessToken: null, refreshToken: null,
  } });
  return { message: 'Password reset successfully. You can now login with your new password.' };
};

// update code
export const AuthServices = {
  sendOTP,
  verifyUserByOTP,
  refreshToken,
  deleteAccout,
  adminLogin,
  forgotPassword,
  resetPassword,
};
