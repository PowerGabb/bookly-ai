import prisma from "../utils/prisma.js";
import midtransClient from "midtrans-client";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

// Inisialisasi Snap
let snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});


export const createPayment = async (req, res) => {
  try {
    const { subscription_type } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!subscription_type) {
      return errorResponse(res, "subscription_type is required", 400);
    }

    // Get subscription details
    const subscriptionDetails = {
      1: { name: "Pro Plan", price: 75000 },
      2: { name: "Premium Plan", price: 225000 },
    }[subscription_type];

    if (!subscriptionDetails) {
      return errorResponse(res, "Invalid subscription type", 400);
    }

    // Cek transaksi yang sudah ada dengan subscription type yang sama
    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        user_id: userId,
        subscription_type: subscription_type,
        status: "PENDING",
        created_at: {
          // Cek transaksi yang dibuat dalam 24 jam terakhir
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Jika ada transaksi yang masih valid, gunakan yang sudah ada
    if (existingTransaction && existingTransaction.snap_token) {
      return successResponse(res, "Using existing payment", 200, {
        token: existingTransaction.snap_token,
        redirect_url: existingTransaction.payment_details.redirect_url,
      });
    }

    // Jika tidak ada transaksi yang valid, buat baru
    const orderId = `ORDER-${Date.now()}`;
    const snapResponse = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: subscriptionDetails.price,
      },
      customer_details: {
        first_name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      item_details: [
        {
          id: `SUB-${subscription_type}`,
          price: subscriptionDetails.price,
          quantity: 1,
          name: subscriptionDetails.name,
        },
      ],
    });

    // Simpan transaksi baru
    await prisma.transaction.create({
      data: {
        order_id: orderId,
        user_id: userId,
        amount: subscriptionDetails.price,
        subscription_type: subscription_type,
        status: "PENDING",
        snap_token: snapResponse.token,
        payment_details: snapResponse,
      },
    });

    return successResponse(res, "Payment initiated successfully", 200, {
      token: snapResponse.token,
      redirect_url: snapResponse.redirect_url,
    });
  } catch (error) {
    console.error("Payment error:", error);
    return errorResponse(res, error.message, 500);
  }
};

export const handleCallback = async (req, res) => {
  try {
    const { order_id, transaction_status, fraud_status } = req.body;

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

    // Update transaction status
    const transaction = await prisma.transaction.update({
      where: { order_id },
      data: { status },
    });

    // If payment successful, update user subscription
    if (status === "SUCCESS") {
      await prisma.user.update({
        where: { id: transaction.user_id },
        data: { subscription_level: transaction.subscription_type },
      });
    }

    return successResponse(res, "Callback processed", 200);
  } catch (error) {
    console.error("Callback error:", error);
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

    try {
      const response = await fetch(
        `${process.env.MIDTRANS_API_URL}/v1/transactions/${transaction.snap_token}/status`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization:
              "Basic " +
              Buffer.from(process.env.MIDTRANS_SERVER_KEY + ":").toString(
                "base64"
              ),
          },
        }
      );

      const statusData = await response.json();

      let status = transaction.status;
      if (
        statusData.transaction_status === "settlement" ||
        statusData.transaction_status === "capture"
      ) {
        status = "SUCCESS";

        await prisma.user.update({
          where: { id: transaction.user_id },
          data: { subscription_level: transaction.subscription_type },
        });
      } else if (statusData.transaction_status === "pending") {
        status = "PENDING";
      } else if (
        ["deny", "cancel", "expire"].includes(statusData.transaction_status)
      ) {
        status = "FAILED";
      }

      if (status !== transaction.status) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status },
        });

        if (status === "SUCCESS") {
          await prisma.user.update({
            where: { id: transaction.user_id },
            data: { subscription_level: transaction.subscription_type },
          });
        }
      }

      return successResponse(res, "Payment status retrieved", 200, {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        status: status,
        payment_details: transaction.payment_details,
      });
    } catch (midtransError) {
      console.error("Midtrans status error:", midtransError);
      return successResponse(
        res,
        "Payment status retrieved from database",
        200,
        {
          transaction_id: transaction.id,
          order_id: transaction.order_id,
          status: transaction.status,
          payment_details: transaction.payment_details,
        }
      );
    }
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

    return successResponse(res, "Pending transaction found", 200, {
      token: pendingTransaction.payment_details.token,
      redirect_url: pendingTransaction.payment_details.redirect_url,
    });
  } catch (error) {
    console.error("Get pending transaction error:", error);
    return errorResponse(res, error.message, 500);
  }
};
