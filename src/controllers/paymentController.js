import prisma from "../utils/prisma.js";
import Stripe from 'stripe';
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createPayment = async (req, res) => {
  try {
    const { subscription_type, referral_code } = req.body;
    const userId = req.user.id;

    if (!subscription_type) {
      return errorResponse(res, "subscription_type is required", 400);
    }

    // Get subscription details
    const subscriptionDetails = {
      1: { name: "Pro Plan", price: 9.90, priceId: process.env.STRIPE_PRO_PRICE_ID },
      2: { name: "Premium Plan", price: 17.90, priceId: process.env.STRIPE_PREMIUM_PRICE_ID },
    }[subscription_type];

    if (!subscriptionDetails) {
      return errorResponse(res, "Invalid subscription type", 400);
    }

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
        discount = Math.round(subscriptionDetails.price * 0.1 * 100);
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

    if (existingTransaction && existingTransaction.payment_intent_id) {
      const session = await stripe.checkout.sessions.retrieve(
        existingTransaction.payment_intent_id
      );
      
      if (session.status === "open") {
        return successResponse(res, "Using existing payment", 200, {
          sessionId: session.id,
          url: session.url
        });
      }
    }

    // Buat Stripe Checkout Session baru
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: subscriptionDetails.name,
              description: `${subscriptionDetails.name} subscription for Bookly AI`,
            },
            unit_amount: Math.round(subscriptionDetails.price * 100) - discount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/subscription/success`,
      cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
      customer_email: req.user.email,
      metadata: {
        userId: userId.toString(),
        subscriptionType: subscription_type.toString(),
        referralCode: referral_code || null,
        discount: discount.toString()
      }
    });

    // Simpan transaksi baru
    await prisma.transaction.create({
      data: {
        order_id: session.id,
        user_id: userId,
        amount: subscriptionDetails.price,
        subscription_type: subscription_type,
        status: "PENDING",
        payment_intent_id: session.id,
        payment_details: {
          ...session,
          discount,
          referral_code
        }
      },
    });

    return successResponse(res, "Payment initiated successfully", 200, {
      sessionId: session.id,
      url: session.url
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
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Error processing webhook:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Session data:', JSON.stringify(session, null, 2));
      
      // Validasi data yang diperlukan
      if (!session.metadata?.userId || !session.metadata?.subscriptionType) {
        console.error('Missing required metadata:', session.metadata);
        return res.status(400).send('Missing required metadata');
      }

      try {
        // Reset kredit jika subscription sebelumnya sudah expired
        await resetExpiredSubscriptionCredits(session.metadata.userId);

        // Update transaction status
        const transaction = await prisma.transaction.update({
          where: { order_id: session.id },
          data: { 
            status: "SUCCESS",
            payment_intent_id: session.payment_intent,
            payment_details: session
          },
        });

        console.log('Transaction updated:', transaction);

        // Update user subscription
        const subscriptionEndDate = new Date();
        subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1); // Tambah 1 bulan

        const user = await prisma.user.update({
          where: { id: session.metadata.userId },
          data: { 
            subscription_level: parseInt(session.metadata.subscriptionType),
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null,
            subscription_expire_date: subscriptionEndDate,
            ai_credit: 999999999,
            tts_credit: 999999999
          },
        });

        // Jika ada referral code dan pembayaran berhasil
        if (session.metadata.referralCode) {
          const referrer = await prisma.user.findUnique({
            where: { referral_code: session.metadata.referralCode }
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
                referral_code: session.metadata.referralCode,
                giver_id: referrer.id,
                user_id: session.metadata.userId,
                credit_type: "AI_CHAT",
                credits_earned: 50,
                transaction_id: transaction.id
              }
            });
          }
        }

        console.log('User subscription updated:', user);
        break;
      } catch (error) {
        console.error('Database update failed:', error);
        return res.status(500).send('Failed to update database');
      }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).end();
};

export const getStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const transaction = await prisma.transaction.findFirst({
      where: { payment_intent_id: sessionId },
    });

    if (!transaction) {
      return errorResponse(res, "Transaction not found", 404);
    }

    if (transaction.user_id !== req.user.id) {
      return errorResponse(res, "Unauthorized", 403);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    let status = transaction.status;

    if (session.payment_status === "paid") {
      status = "SUCCESS";
    } else if (session.status === "open") {
      status = "PENDING";
    } else {
      status = "FAILED";
    }

    if (status !== transaction.status) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status },
      });
    }

    return successResponse(res, "Payment status retrieved", 200, {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      status: status,
      payment_details: session
    });
  } catch (error) {
    console.error("Get status error:", error);
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

    const session = await stripe.checkout.sessions.retrieve(
      pendingTransaction.payment_intent_id
    );

    return successResponse(res, "Pending transaction found", 200, {
      sessionId: session.id,
      url: session.url
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
        priceId: process.env.STRIPE_PRO_PRICE_ID,
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
        priceId: process.env.STRIPE_PREMIUM_PRICE_ID,
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
