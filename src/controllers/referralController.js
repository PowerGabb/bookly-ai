import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import { generateReferralCode } from "../utils/referralCode.js";

// Mendapatkan atau membuat kode referral untuk user
export const getReferralCode = async (req, res) => {
  try {
    const userId = req.user.id;
    
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referral_code: true }
    });

    if (!user.referral_code) {
      // Generate kode referral jika belum ada
      const referralCode = await generateReferralCode();
      
      user = await prisma.user.update({
        where: { id: userId },
        data: { referral_code: referralCode },
        select: { referral_code: true }
      });
    }

    return successResponse(res, "Referral code retrieved successfully", 200, {
      referral_code: user.referral_code
    });
  } catch (error) {
    console.error("Get referral code error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Mendapatkan riwayat referral
export const getReferralHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const referrals = await prisma.referral.findMany({
      where: { 
        OR: [
          { giver_id: userId },
          { user_id: userId }
        ]
      },
      include: {
        giver: {
          select: {
            name: true,
            email: true
          }
        },
        user: {
          select: {
            name: true,
            email: true
          }
        },
        transaction: {
          select: {
            amount: true,
            credit_type: true,
            created_at: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    return successResponse(res, "Referral history retrieved successfully", 200, {
      referrals
    });
  } catch (error) {
    console.error("Get referral history error:", error);
    return errorResponse(res, error.message, 500);
  }
}; 