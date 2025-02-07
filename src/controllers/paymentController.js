import prisma from '../utils/prisma.js';
import midtransClient from 'midtrans-client';
import { errorResponse } from '../libs/errorResponse.js';
import { successResponse } from '../libs/successResponse.js';

// Inisialisasi Core API
let core = new midtransClient.CoreApi({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

export const createPayment = async (req, res) => {
  try {
    const { subscription_type, payment_method } = req.body;
    const userId = req.user.id;

    // Get subscription details
    const subscriptionDetails = {
      1: { name: 'Basic Plan', price: 29000 },
      2: { name: 'Premium Plan', price: 49000 }
    }[subscription_type];

    if (!subscriptionDetails) {
      return errorResponse(res, 'Invalid subscription type', 400);
    }

    const orderId = `ORDER-${Date.now()}`;

    // Base transaction details
    let transactionDetails = {
      transaction_details: {
        order_id: orderId,
        gross_amount: subscriptionDetails.price
      },
      customer_details: {
        first_name: req.user.name,
        email: req.user.email,
        phone: req.user.phone
      },
      item_details: [{
        id: `SUB-${subscription_type}`,
        price: subscriptionDetails.price,
        quantity: 1,
        name: subscriptionDetails.name,
      }]
    };

    // Customize payment method based on selection
    switch (payment_method) {
      case 'bca_va':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "bank_transfer",
          bank_transfer: {
            bank: "bca"
          }
        };
        break;

      case 'bni_va':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "bank_transfer",
          bank_transfer: {
            bank: "bni"
          }
        };
        break;

      case 'bri_va':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "bank_transfer",
          bank_transfer: {
            bank: "bri"
          }
        };
        break;

      case 'gopay':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "gopay"
        };
        break;

      case 'shopeepay':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "shopeepay",
          shopeepay: {
            callback_url: "https://your-website.com/callback"
          }
        };
        break;

      case 'indomaret':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "cstore",
          cstore: {
            store: "indomaret",
            message: "Pembayaran untuk Bookly Premium"
          }
        };
        break;

      case 'alfamart':
        transactionDetails = {
          ...transactionDetails,
          payment_type: "cstore",
          cstore: {
            store: "alfamart",
            message: "Pembayaran untuk Bookly Premium"
          }
        };
        break;

      default:
        return errorResponse(res, 'Invalid payment method', 400);
    }

    // Buat transaksi di database
    const transaction = await prisma.transaction.create({
      data: {
        order_id: orderId,
        user_id: userId,
        amount: subscriptionDetails.price,
        subscription_type: subscription_type,
        status: 'PENDING',
        payment_type: payment_method
      }
    });

    // Buat charge ke Midtrans
    const charge = await core.charge(transactionDetails);

    return successResponse(res, 'Payment initiated successfully', 200, {
      transaction_id: transaction.id,
      order_id: orderId,
      payment_details: charge
    });

  } catch (error) {
    console.error('Payment error:', error);
    return errorResponse(res, error.message, 500);
  }
};

export const handleCallback = async (req, res) => {
  try {
    const notification = req.body;

    const statusResponse = await core.transaction.notification(notification);
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    let status;
    if (transactionStatus == 'capture') {
      if (fraudStatus == 'challenge') {
        status = 'CHALLENGE';
      } else if (fraudStatus == 'accept') {
        status = 'SUCCESS';
      }
    } else if (transactionStatus == 'settlement') {
      status = 'SUCCESS';
    } else if (transactionStatus == 'cancel' ||
      transactionStatus == 'deny' ||
      transactionStatus == 'expire') {
      status = 'FAILED';
    } else if (transactionStatus == 'pending') {
      status = 'PENDING';
    }

    // Update transaction status
    const transaction = await prisma.transaction.update({
      where: { order_id: orderId },
      data: { status }
    });

    // If payment successful, update user subscription
    if (status === 'SUCCESS') {
      await prisma.user.update({
        where: { id: transaction.user_id },
        data: { subscription_level: transaction.subscription_type }
      });
    }

    return successResponse(res, 'Callback processed', 200);

  } catch (error) {
    console.error('Callback error:', error);
    return errorResponse(res, error.message, 500);
  }
};