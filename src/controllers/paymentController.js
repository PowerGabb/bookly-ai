import prisma from "../utils/prisma.js";
import Stripe from 'stripe';
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createPayment = async (req, res) => {
  try {
    const { subscription_type } = req.body;
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
            unit_amount: Math.round(subscriptionDetails.price * 100),
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
        subscriptionType: subscription_type.toString()
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
        payment_details: session
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

export const handleCallback = async (req, res) => {
  console.log('Webhook body:', JSON.stringify(req.body, null, 2));
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody, 
      sig, 
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return errorResponse(res, `Webhook Error: ${err.message}`, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Session data:', JSON.stringify(session, null, 2));
    
    // Validasi data yang diperlukan
    if (!session.metadata?.userId || !session.metadata?.subscriptionType) {
      console.error('Missing required metadata:', session.metadata);
      return errorResponse(res, 'Missing required metadata', 400);
    }

    try {
      // Update transaction status
      const transaction = await prisma.transaction.update({
        where: { order_id: session.id },
        data: { 
          status: "SUCCESS",
          payment_intent: session.payment_intent
        },
      });

      console.log('Transaction updated:', transaction);

      // Update user subscription
      const user = await prisma.user.update({
        where: { id: parseInt(session.metadata.userId) },
        data: { 
          subscription_level: parseInt(session.metadata.subscriptionType),
          subscription_expire_date: new Date(Date.now() + (parseInt(session.metadata.subscriptionType) === 1 ? 30 : 365) * 24 * 60 * 60 * 1000)
        },
      });

      console.log('User subscription updated:', user);

      return successResponse(res, "Webhook processed successfully", 200);
    } catch (error) {
      console.error('Database update failed:', error);
      return errorResponse(res, 'Failed to update database', 500);
    }
  }

  return successResponse(res, "Webhook processed", 200);
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
