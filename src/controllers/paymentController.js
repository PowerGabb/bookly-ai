import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";
import midtransClient from 'midtrans-client';

// Buat instance Midtrans
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION ? process.env.MIDTRANS_IS_PRODUCTION === "true" : true,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

export const createPayment = async (req, res) => {
  try {
    const { subscription_type, referral_code } = req.body;
    const userId = req.user.id;

    if (!subscription_type) {
      return errorResponse(res, "subscription_type is required", 400);
    }

    // Get subscription details
    const subscriptionDetails = {
      1: { name: "Pro Plan", price: 9.90 },
      2: { name: "Premium Plan", price: 17.90 },
    }[subscription_type];

    if (!subscriptionDetails) {
      return errorResponse(res, "Invalid subscription type", 400);
    }

    // Konversi harga dari dolar ke rupiah (1 USD = 16000 IDR)
    const USD_TO_IDR = 16000;
    const priceInIDR = Math.round(subscriptionDetails.price * USD_TO_IDR);

    // Cek apakah user sudah pernah berlangganan
    const existingSubscription = await prisma.transaction.findFirst({
      where: {
        user_id: userId,
        status: "SUCCESS"
      }
    });

    // Jika referral code diberikan dan user belum pernah berlangganan
    let discount = 0;
    if (referral_code && !existingSubscription) {
      const referrer = await prisma.user.findUnique({
        where: { referral_code }
      });

      if (referrer) {
        // Berikan diskon 10% untuk user baru
        discount = Math.round(priceInIDR * 0.1);
      }
    }

    // Cek transaksi yang sudah ada
    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        user_id: userId,
        subscription_type: subscription_type,
        status: "PENDING",
        created_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (existingTransaction && existingTransaction.snap_token) {
      return successResponse(res, "Using existing payment", 200, {
        token: existingTransaction.snap_token,
        redirect_url: existingTransaction.payment_details.redirect_url,
      });
    }

    // Buat order ID unik
    const orderId = `SUB-${Date.now()}`;

    // Buat parameter untuk Midtrans
    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: priceInIDR - discount
      },
      customer_details: {
        first_name: req.user.name,
        email: req.user.email,
        phone: req.user.phone
      },
      item_details: [
        {
          id: `SUB-${subscription_type}`,
          price: priceInIDR - discount,
          quantity: 1,
          name: `${subscriptionDetails.name} subscription`
        }
      ],
      metadata: {
        userId: userId.toString(),
        subscriptionType: subscription_type.toString(),
        referralCode: referral_code || null,
        discount: discount.toString()
      }
    };

    // Buat transaksi di Midtrans
    const midtransResponse = await snap.createTransaction(parameter);

    if (!midtransResponse.token) {
      throw new Error('Failed to create Midtrans transaction');
    }

    // Simpan transaksi baru
    await prisma.transaction.create({
      data: {
        order_id: orderId,
        user_id: userId,
        amount: subscriptionDetails.price,
        subscription_type: subscription_type,
        status: "PENDING",
        snap_token: midtransResponse.token,
        payment_details: midtransResponse
      },
    });

    return successResponse(res, "Payment initiated successfully", 200, {
      token: midtransResponse.token,
      redirect_url: midtransResponse.redirect_url
    });
  } catch (error) {
    console.error("Payment error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Fungsi untuk mereset kredit user yang sudah expired
const resetExpiredSubscriptionCredits = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscription_level: true,
        subscription_expire_date: true,
      }
    });

    // Jika user adalah pro/premium dan subscription sudah expired
    if (user.subscription_level > 0 && new Date() > new Date(user.subscription_expire_date)) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          subscription_level: 0,
          ai_credit: 0,
          tts_credit: 0,
        }
      });
    }
  } catch (error) {
    console.error('Error resetting credits:', error);
  }
};

export const handleCallback = async (req, res) => {
  console.log(req.body);
  try {
    const { order_id, transaction_status, fraud_status } = req.body;

    // Cek transaksi
    const transaction = await prisma.transaction.findFirst({
      where: { order_id },
      include: {
        user: true
      }
    });

    if (!transaction) {
      return errorResponse(res, "Transaction not found", 404);
    }

    // Jika transaksi sudah SUCCESS, jangan proses lagi
    if (transaction.status === "SUCCESS") {
      return successResponse(res, "Transaction already processed", 200);
    }

    let status;
    if (transaction_status == "capture") {
      status = fraud_status == "accept" ? "SUCCESS" : "CHALLENGE";
    } else if (transaction_status == "settlement") {
      status = "SUCCESS";
    } else if (["cancel", "deny", "expire"].includes(transaction_status)) {
      status = "FAILED";
    } else if (transaction_status == "pending") {
      status = "PENDING";
    }

    // Jika akan menjadi SUCCESS, proses pembayaran
    if (status === "SUCCESS") {
      try {
        await prisma.$transaction(async (prisma) => {
          // Reset kredit jika subscription sebelumnya sudah expired
          await resetExpiredSubscriptionCredits(transaction.user_id);

          // Update transaction status
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { 
              status,
              payment_details: {
                ...transaction.payment_details,
                transaction_status,
                fraud_status
              }
            },
          });

          // Update user subscription
          const subscriptionEndDate = new Date();
          subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1); // Tambah 1 bulan

          await prisma.user.update({
            where: { id: transaction.user_id },
            data: { 
              subscription_level: transaction.subscription_type,
              subscription_expire_date: subscriptionEndDate,
              ai_credit: 999999999,
              tts_credit: 999999999
            },
          });

          // Jika ada referral code dan pembayaran berhasil
          if (transaction.payment_details.metadata?.referralCode) {
            const referrer = await prisma.user.findUnique({
              where: { referral_code: transaction.payment_details.metadata.referralCode }
            });

            if (referrer) {
              // Berikan bonus kredit AI kepada referrer
              await prisma.user.update({
                where: { id: referrer.id },
                data: {
                  ai_credit: {
                    increment: 50 // Bonus 50 kredit AI
                  },
                  tts_credit: {
                    increment: 50 // Bonus 50 kredit TTS
                  }
                }
              });

              // Catat referral
              await prisma.referral.create({
                data: {
                  referral_code: transaction.payment_details.metadata.referralCode,
                  giver_id: referrer.id,
                  user_id: transaction.user_id,
                  credit_type: "AI_CHAT",
                  credits_earned: 50,
                  transaction_id: transaction.id
                }
              });
            }
          }
        });
      } catch (transactionError) {
        throw transactionError;
      }
    } else {
      // Update status untuk non-SUCCESS
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { 
          status,
          payment_details: {
            ...transaction.payment_details,
            transaction_status,
            fraud_status
          }
        }
      });
    }

    return successResponse(res, "Callback processed", 200);
  } catch (error) {
    console.error('Error processing webhook:', error);
    return errorResponse(res, error.message, 500);
  }
};

export const getStatus = async (req, res) => {
  try {
    const { token } = req.params;

    const transaction = await prisma.transaction.findFirst({
      where: { snap_token: token },
    });

    if (!transaction) {
      return errorResponse(res, "Transaction not found", 404);
    }

    if (transaction.user_id !== req.user.id) {
      return errorResponse(res, "Unauthorized", 403);
    }

    // Jika transaksi sudah SUCCESS, langsung kembalikan status
    if (transaction.status === "SUCCESS") {
      return successResponse(res, "Payment status retrieved", 200, {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        status: transaction.status,
        payment_details: transaction.payment_details,
      });
    }

    try {
      // Cek status transaksi menggunakan midtrans-client
      const statusData = await snap.transaction.notification(token);
      let status = transaction.status;

      if (
        statusData.transaction_status === "settlement" ||
        statusData.transaction_status === "capture"
      ) {
        // Hanya proses jika status sebelumnya bukan SUCCESS
        if (transaction.status !== "SUCCESS") {
          status = "SUCCESS";
          await prisma.$transaction(async (prisma) => {
            // Reset kredit jika subscription sebelumnya sudah expired
            await resetExpiredSubscriptionCredits(transaction.user_id);

            // Update transaction status
            await prisma.transaction.update({
              where: { id: transaction.id },
              data: { 
                status,
                payment_details: {
                  ...transaction.payment_details,
                  ...statusData
                }
              },
            });

            // Update user subscription
            const subscriptionEndDate = new Date();
            subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);

            await prisma.user.update({
              where: { id: transaction.user_id },
              data: { 
                subscription_level: transaction.subscription_type,
                subscription_expire_date: subscriptionEndDate,
                ai_credit: 999999999,
                tts_credit: 999999999
              },
            });
          });
        }
      } else if (statusData.transaction_status === "pending") {
        status = "PENDING";
      } else if (
        ["deny", "cancel", "expire"].includes(statusData.transaction_status)
      ) {
        status = "FAILED";
      }

      // Update status hanya jika bukan SUCCESS
      if (status !== transaction.status && status !== "SUCCESS") {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { 
            status,
            payment_details: {
              ...transaction.payment_details,
              ...statusData
            }
          },
        });
      }

      return successResponse(res, "Payment status retrieved", 200, {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        status: status,
        payment_details: transaction.payment_details,
      });
    } catch (midtransError) {
      return successResponse(res, "Payment status retrieved from database", 200, {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        status: transaction.status,
        payment_details: transaction.payment_details,
      });
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

export const getPendingTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { subscription_type } = req.query;

    const pendingTransaction = await prisma.transaction.findFirst({
      where: {
        user_id: userId,
        subscription_type: parseInt(subscription_type),
        status: "PENDING",
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (!pendingTransaction) {
      return errorResponse(res, "No pending transaction found", 404);
    }

    return successResponse(res, "Pending transaction found", 200, {
      token: pendingTransaction.snap_token,
      redirect_url: pendingTransaction.payment_details.redirect_url
    });
  } catch (error) {
    console.error("Get pending transaction error:", error);
    return errorResponse(res, error.message, 500);
  }
};

export const getSubscriptionPlans = async (req, res) => {
  try {
    const plans = {
      1: { 
        name: "Pro Plan", 
        price: 9.90,
        description: "Full access to all premium features",
        features: [
          "Unlimited books",
          "HD audio quality",
          "AI Chat with books",
          "Offline mode",
          "Exclusive content",
          "Latest updates"
        ],
        period: "month"
      },
      2: { 
        name: "Premium Plan", 
        price: 17.90,
        description: "Save 20% with annual subscription",
        features: [
          "All Premium features",
          "Save 20%",
          "Priority access",
          "Beta tester features"
        ],
        period: "year"
      }
    };

    return successResponse(res, "Subscription plans retrieved successfully", 200, { plans });
  } catch (error) {
    console.error("Get subscription plans error:", error);
    return errorResponse(res, error.message, 500);
  }
};

export const checkAndResetExpiredSubscriptions = async (req, res) => {
  try {
    // Ambil semua user yang memiliki subscription_level > 0
    const users = await prisma.user.findMany({
      where: {
        subscription_level: {
          gt: 0
        },
        subscription_expire_date: {
          not: null
        }
      }
    });

    let resetCount = 0;
    for (const user of users) {
      if (new Date() > new Date(user.subscription_expire_date)) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscription_level: 0,
            ai_credit: 0,
            tts_credit: 0,
          }
        });
        resetCount++;
      }
    }

    return successResponse(res, "Successfully checked and reset expired subscriptions", 200, {
      total_checked: users.length,
      total_reset: resetCount
    });
  } catch (error) {
    console.error("Error checking expired subscriptions:", error);
    return errorResponse(res, error.message, 500);
  }
};
