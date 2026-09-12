import { User } from "@prisma/client";
import httpStatus from "http-status";
import bcrypt from "bcrypt";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { jwtHelpers } from "../../../utils/jwtHelpers";

import Twilio from "twilio";
import { generateReferralCode } from "../../../helpars/referralles";

const client = Twilio(config.twilio.accountSid, config.twilio.authToken);

// Helper to generate access & refresh tokens
export const generateTokens = (user: User, role?: string) => {
  const accessToken = jwtHelpers.generateToken(
    {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role || role,
    },
    config.jwt.jwt_secret as string,
    config.jwt.expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role || role,
    },
    config.jwt.refresh_token_secret as string,
    config.jwt.refresh_token_expires_in as string,
  );

  return { accessToken, refreshToken };
};

type OTPChannel = "sms" | "whatsapp";

const resolveOTPChannel = (OTPSender?: string): OTPChannel => {
  if (!OTPSender) {
    return "sms";
  }

  const normalizedSender = OTPSender.toLowerCase().replace(/[\s_-]/g, "");

  if (normalizedSender === "whatsapp") {
    return "whatsapp";
  }

  if (normalizedSender === "sms") {
    return "sms";
  }

  throw new ApiError(
    httpStatus.BAD_REQUEST,
    "Invalid OTP sender. Use sms or whatsapp",
  );
};

// Send OTP to phone number
const sendOTP = async (phoneNumber: string, OTPSender?: string) => {
  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  if (user?.banned) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User is banned");
  }

  if (!phoneNumber.startsWith("+")) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Phone number must start with + and country code",
    );
  }

  // For testing purposes, skip OTP for a specific number
  if (user?.phoneNumber === "+8801763170733") {
    console.log("Test number detected, skipping OTP send");

    const { accessToken, refreshToken } = generateTokens(user);

    // Update user tokens and optional FCM token
    await prisma.user.update({
      where: { phoneNumber },
      data: { accessToken, refreshToken },
    });

    return {
      message: "Login successfully",
      accessToken,
      refreshToken,
      profileCompleted: user.profileCompleted,
      role: user.role,
    };
  }

  const channel = resolveOTPChannel(OTPSender);

  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

  console.log(`========================================`);
  console.log(`[OTP GENERATED & SENT]`);
  console.log(`📱 Phone Number: ${phoneNumber}`);
  console.log(`📡 Channel     : ${channel}`);
  console.log(`🔑 DEV OTP CODE: ${generatedOtp} (or master: 123456)`);
  console.log(`========================================`);

  try {
    // Send OTP via Twilio
    const verification = await client.verify.v2
      .services(`${config.twilio.serviceSid}`)
      .verifications.create({ to: phoneNumber, channel });

    console.log(`[Twilio OTP Sent Status]: ${verification.status}`);

    // Track user, save OTP to database
    await prisma.user.upsert({
      where: { phoneNumber },
      update: {
        otp: generatedOtp,
        otpExpiresAt: otpExpiresAt,
      },
      create: {
        phoneNumber,
        otp: generatedOtp,
        otpExpiresAt: otpExpiresAt,
        referralCode: generateReferralCode(),
      },
    });

    return {
      message: "OTP sent successfully",
      status: verification.status, // usually "pending"
      otp: generatedOtp, // returned for development UI / debugging if needed
    };
  } catch (error: any) {
    console.error("Twilio OTP Error (Saving local OTP anyway for dev):", error.code || error.message);

    // Save local OTP even if Twilio fails so dev testing continues
    await prisma.user.upsert({
      where: { phoneNumber },
      update: {
        otp: generatedOtp,
        otpExpiresAt: otpExpiresAt,
      },
      create: {
        phoneNumber,
        otp: generatedOtp,
        otpExpiresAt: otpExpiresAt,
        referralCode: generateReferralCode(),
      },
    });

    return {
      message: "OTP sent (Development mode)",
      status: "pending",
      otp: generatedOtp,
    };
  }
};

// // Verify OTP and login
const verifyUserByOTP = async (
  phoneNumber: string,
  otp: string,
  fcmToken?: string,
) => {
  const user = await prisma.user.findUnique({ where: { phoneNumber } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  console.log(`========================================`);
  console.log(`[OTP VERIFICATION REQUEST]`);
  console.log(`📱 Phone Number: ${phoneNumber}`);
  console.log(`🔑 Submitted OTP: ${otp}`);
  console.log(`========================================`);

  // Allow master test OTP (123456) or locally generated database OTP
  const isMasterOtp = otp === "123456";
  const isLocalOtpValid =
    user.otp &&
    user.otp === otp &&
    user.otpExpiresAt &&
    user.otpExpiresAt > new Date();

  if (isMasterOtp || isLocalOtpValid) {
    console.log(`[OTP VERIFIED SUCCESSFULLY via Local/Dev OTP]`);
    const { accessToken, refreshToken } = generateTokens(user);

    await prisma.user.update({
      where: { phoneNumber },
      data: {
        accessToken,
        refreshToken,
        fcmToken,
        otp: null,
        otpExpiresAt: null,
      },
    });

    return {
      message: "OTP verified successfully",
      accessToken,
      refreshToken,
      profileCompleted: user.profileCompleted,
      role: user.role,
    };
  }

  try {
    const verificationCheck = await client.verify.v2
      .services(`${config.twilio.serviceSid}`)
      .verificationChecks.create({
        to: phoneNumber,
        code: otp,
      });

    if (verificationCheck.status !== "approved") {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid or expired OTP");
    }

    // Generate JWT tokens for login
    const { accessToken, refreshToken } = generateTokens(user);

    // Update user tokens and optional FCM token
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
  } catch (error: any) {
    console.error("Twilio Verification Error:", error.code, error.message);

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "OTP verification failed. Please try again.",
    );
  }
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

// update code
export const AuthServices = {
  sendOTP,
  verifyUserByOTP,
  refreshToken,
  deleteAccout
};
