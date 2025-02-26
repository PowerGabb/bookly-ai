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

export const createTopup = async (req, res) => {
  try {
    const { package_id } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!package_id) {
      return errorResponse(res, "package_id is required", 400);
    }

    // Get package details from database
    const packageDetails = await prisma.creditPackage.findFirst({
      where: {
        id: package_id,
        is_active: true,
      },
    });

    if (!packageDetails) {
      return errorResponse(res, "Invalid or inactive package", 400);
    }

    // Cek transaksi yang sudah ada
    const existingTransaction = await prisma.creditTransaction.findFirst({
      where: {
        user_id: userId,
        credit_type: packageDetails.credit_type,
        status: "PENDING",
        created_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (existingTransaction?.snap_token) {
      return successResponse(res, "Using existing payment", 200, {
        token: existingTransaction.snap_token,
        redirect_url: existingTransaction.payment_details.redirect_url,
      });
    }

    const orderId = `TOPUP-${Date.now()}`;
    const snapResponse = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: packageDetails.price,
      },
      customer_details: {
        first_name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      item_details: [
        {
          id: `${packageDetails.credit_type}-${package_id}`,
          price: packageDetails.price,
          quantity: 1,
          name: `${packageDetails.name} - ${packageDetails.credits} credits`,
        },
      ],
    });

    await prisma.creditTransaction.create({
      data: {
        order_id: orderId,
        user_id: userId,
        amount: packageDetails.price,
        credit_type: packageDetails.credit_type,
        credit_amount: packageDetails.credits,
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
    console.error("Topup error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Tambahkan endpoint untuk mendapatkan daftar paket
export const getPackages = async (req, res) => {
  try {
    const packages = await prisma.creditPackage.findMany({
      where: {
        is_active: true,
      },
      orderBy: {
        price: 'asc',
      },
    });

    return successResponse(res, "Packages retrieved successfully", 200, {
      packages,
    });
  } catch (error) {
    console.error("Get packages error:", error);
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

    const transaction = await prisma.creditTransaction.update({
      where: { order_id },
      data: { status },
    });

    // If payment successful, update user credits
    if (status === "SUCCESS") {
      const creditField =
        transaction.credit_type === "AI_CHAT" ? "ai_credit" : "tts_credit";
      await prisma.user.update({
        where: { id: transaction.user_id },
        data: {
          [creditField]: {
            increment: transaction.credit_amount,
          },
        },
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

    const transaction = await prisma.creditTransaction.findFirst({
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

        // Update user credits
        const creditField =
          transaction.credit_type === "AI_CHAT" ? "ai_credit" : "tts_credit";
        await prisma.user.update({
          where: { id: transaction.user_id },
          data: {
            [creditField]: {
              increment: transaction.credit_amount,
            },
          },
        });
      } else if (statusData.transaction_status === "pending") {
        status = "PENDING";
      } else if (
        ["deny", "cancel", "expire"].includes(statusData.transaction_status)
      ) {
        status = "FAILED";
      }

      if (status !== transaction.status) {
        await prisma.creditTransaction.update({
          where: { id: transaction.id },
          data: { status },
        });
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
