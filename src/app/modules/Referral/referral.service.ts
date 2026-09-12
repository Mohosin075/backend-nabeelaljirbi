import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { paginationHelpers } from "../../../utils/paginationHelper";


const ReferralBonus = async (referralCode: string, userId: string
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  
  const referral = await prisma.user.findUnique({
    where: {
      referralCode: referralCode
    }
  })

  if (!referral) throw new ApiError(httpStatus.NOT_FOUND, "Referral code not valid");
  
  // Refer used 
  const tx = await prisma.$transaction([
    // Refer used 
    prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        totalEarnings: {
          increment: 1
         },
        currentEarnings: {
          increment: 1
        },
        wallet: {
          increment: 1
        }
      }
    }),

    // Create topup record
    prisma.topUp.create({
      data: {
        userId: user.id,
        amount: 1,
        type: "REFERALL"
      }
    }),

    // Referals user
    prisma.user.update({
      where: {
        id: referral.id
      },
      data: {
        totalReferrals: {
          increment: 1
        },
        totalEarnings: {
          increment: 1
         },
        currentEarnings: {
          increment: 1
        },
        wallet: {
          increment: 1
        }
      }
    }),

    // Create topup record
    prisma.topUp.create({
      data: {
        userId: referral.id,
        amount: 1,
        type: "REFERALL"
      }
    })
  ])

  return tx;
}


const claimRefelarsBunus  = async(userId: string, amount: number) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  if (user.currentEarnings < amount) throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient balance");

  return "Do not need already added main balance";
  
  // await prisma.user.update({
  //   where: {
  //     id: user.id
  //   },
  //   data: {
  //     wallet: {
  //       increment: amount
  //     },
  //     currentEarnings: {
  //       decrement: amount
  //     }
  //   }
  // })
  
}


export const ReferralService = {
  ReferralBonus,
  claimRefelarsBunus
};
