import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Payment from "../models/Payment.js";
import DailyQuizAttempt from "../models/DailyQuizAttempt.js";
const router = express.Router();
const getTargetEnv = process.env.MTN_ENVIRONMENT || "mtnswaziland";
const callbackUrl = process.env.MTN_CALLBACK_URL || "https://superwinnings.com/mtnwap/callback";
const collectionPrimaryKey = process.env.MTN_COLLECTION_PRIMARY_KEY;
const disbursementPrimaryKey = process.env.MTN_DISBURSEMENT_PRIMARY_KEY;
const apiUser = process.env.MTN_API_USER;
const apiKey = process.env.MTN_API_KEY;
const apiUserDisbursement = process.env.MTN_API_USER_DISBURSEMENT;
const apiKeyDisbursement = process.env.MTN_API_KEY_DISBURSEMENT;
const baseUrl = process.env.MTN_BASE_URL || "https://proxy.momoapi.mtn.com";
let cachedToken = null;
let tokenExpiry = null;
let cachedDisbursementToken = null;
let tokenDisbursementExpiry = null;

// ----------------------------
// JWT Middleware
// ----------------------------
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    const user = await User.findOne({ phone: decoded.phone });
    if (!user) return res.status(401).json({ success: false, error: "User not found" });

    req.userDb = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
};


// ----------------------------
// Momo Access Token Cache
// ----------------------------
const getMomoAccessToken = async () => {
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      `${baseUrl}/collection/token/`,
      {}, // no body needed
      {
        headers: {
          'Ocp-Apim-Subscription-Key': collectionPrimaryKey,
          'Authorization': 'Basic ' + Buffer.from(`${apiUser}:${apiKey}`).toString("base64")
        },
        maxBodyLength: Infinity
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = new Date(Date.now() + response.data.expires_in * 1000);
    return cachedToken;
  } catch (err) {
    console.error("❌ Momo Token Error:", err.response?.data || err.message);
    throw new Error("Failed to get Momo access token");
  }
};

//
const getMomoDisbursementAccessToken = async () => {
  if (cachedDisbursementToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedDisbursementToken;
  }

  try {
    const response = await axios.post(
      `${baseUrl}/disbursement/token/`,
      {}, // no body needed
      {
        headers: {
          'Ocp-Apim-Subscription-Key': disbursementPrimaryKey,
          'Authorization': 'Basic ' + Buffer.from(`${apiUserDisbursement}:${apiKeyDisbursement}`).toString("base64")
        },
        maxBodyLength: Infinity
      }
    );

    cachedDisbursementToken = response.data.access_token;
    tokenDisbursementExpiry = new Date(Date.now() + response.data.expires_in * 1000);
    return cachedDisbursementToken;
  } catch (err) {
    console.error("❌ Momo Token Error:", err.response?.data || err.message);
    throw new Error("Failed to get Momo access token");
  }
};


// ----------------------------
// Create Subscription
// ----------------------------
router.post("/create", authenticateUser, async (req, res) => {
  try {
    let phone = req.user.phone.replace(/^\+/, '');
    const { amount } = req.body;


    if (!amount) {
      return res.status(400).json({ success: false, error: "Amount required" });
    }

    const token = await getMomoAccessToken();
    const referenceId = uuidv4();

    const headers = {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": collectionPrimaryKey,
      "Content-Type": "application/json",
      "X-Reference-Id": referenceId,
      "X-Target-Environment": getTargetEnv,
      "X-Callback-Url": callbackUrl,
    };

    const url = `${baseUrl}/collection/v1_0/requesttopay`;
    const body = {
      amount: amount.toString(),
      currency: "SZL",
      externalId: referenceId,
      payer: { partyIdType: "MSISDN", partyId: phone },
      payerMessage: "Daily Gaming Subscription",
      payeeNote: "MTN Momo Subscription",
    };

    const response = await axios.post(url, body, { headers });

    if (response.status === 202) {
      console.log("✅ Request accepted by MTN:", referenceId);

      // Wait a short delay before checking payment status (MTN needs time to process)
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const statusUrl = `${baseUrl}/collection/v1_0/requesttopay/${referenceId}`;
      const statusRes = await axios.get(statusUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Ocp-Apim-Subscription-Key": collectionPrimaryKey,
          "X-Target-Environment": getTargetEnv,
        },
      });

      const paymentStatus = statusRes.data.status;
      // Store all info in DB
      const paymentRecord = await Payment.create({
        userId: req.user.id,
        phone,
        referenceId,
        amount,
        status: paymentStatus,
        reason: statusRes.data.reason || null,
        payerMessage: body.payerMessage,
        payeeNote: body.payeeNote,
        rawResponse: statusRes.data,
      });


      let message;
      if (paymentStatus === "FAILED") {
        message = `❌ Payment failed${paymentRecord.reason ? ` due to ${paymentRecord.reason}` : ""}.`;
      } else if (paymentStatus === "SUCCESSFUL") {
        var user = await User.findById(req.user.id);
        if (user) {
          user.currentSzlAssigned += amount;
          user.isAttemptQuiz = false;
          await user.save();
        }
        message = "✅ Payment successful!";
      } else {
        message = "⌛ Payment is initiated. Please wait for approval.";
      }

      return res.json({
        success: true,
        message,
        referenceId,
        paymentStatus,
        data: paymentRecord,
      });
    } else {
      return res.status(500).json({ success: false, error: "Failed to initiate payment" });
    }
  } catch (err) {
    console.error("❌ Subscription error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// ----------------------------
// Check Subscription Status
// ----------------------------
router.get("/status/:referenceId", authenticateUser, async (req, res) => {
  try {
    const { referenceId } = req.params;

    const token = await getMomoAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": collectionPrimaryKey,
      "X-Target-Environment": getTargetEnv,
    };

    const url = `${baseUrl}/collection/v1_0/requesttopay/${referenceId}`;
    const response = await axios.get(url, { headers });

    const paymentStatus = response.data.status;
    // Store all info in DB
    const paymentRecord = await Payment.findOneAndUpdate(
      { referenceId, userId: req.user.id },
      { status: paymentStatus, reason: response.data.reason || null, rawResponse: response.data },
      { new: true }
    );

    let message;
    if (paymentStatus === "FAILED") {
      message = `❌ Payment failed${paymentRecord.reason ? ` due to ${paymentRecord.reason}` : ""}.`;
    } else if (paymentStatus === "SUCCESSFUL") {
      var user = await User.findById(req.user.id);
      if (user) {
        user.currentSzlAssigned += amount;
        user.isAttemptQuiz = false;
        await user.save();
      }
      message = "✅ Payment successful!";
    } else {
      message = "⌛ Payment is initiated. Please wait for approval.";
    }

    res.json({
      success: true,
      message,
      status: response.data.status,
      paymentRecord, // Return the updated payment record
    });
  } catch (err) {
    console.error(
      "❌ Subscription status error:",
      err.response?.data || err.message
    );
    res.status(500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// ----------------------------
// Get User Payments
// ----------------------------
router.get("/payments", authenticateUser, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, payments });
  } catch (err) {
    console.error("❌ Error fetching payments:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch payments" });
  }
});

// ----------------------------
// Reward Daily Winners
// ----------------------------
router.post("/reward-winners", async (req, res) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(yesterday); 
    today.setDate(today.getDate() + 1);

    // 1. Get Top 2 Winners
    const dailyLeaderboard = await DailyQuizAttempt.aggregate([
      {
        $match: {
          date: { $gte: yesterday, $lt: today },
          isEligibleForLeaderboard: true,
        },
      },
      {
        $group: {
          _id: "$userId",
          dailyPoints: { $sum: "$dailyPoints" },
          dailyTimeTaken: { $sum: "$dailyTimeTaken" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      { $unwind: "$userDetails" },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          phone: "$userDetails.phone",
          dailyPoints: 1,
          dailyTimeTaken: 1,
        },
      },
      { $sort: { dailyPoints: -1, dailyTimeTaken: 1 } },
      { $limit: 2 }, // ✅ top 2 winners
    ]);

    if (dailyLeaderboard.length === 0) {
      console.log("No eligible daily winners found for yesterday.");
      return res.status(200).json({
        success: true,
        message: "No eligible daily winners found for yesterday.",
      });
    }

    // 2. Reward each winner
    const rewardResults = [];
    const token = await getMomoDisbursementAccessToken();

    for (const [index, winner] of dailyLeaderboard.entries()) {
      const rewardAmount = index === 0 ? 500 : 300; // ✅ Example: 1st place = 500, 2nd = 300
      const referenceId = uuidv4();

      console.log(`Attempting to reward winner ${index + 1}: ${winner.phone} with ${rewardAmount} SZL`);

      const headers = {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": disbursementPrimaryKey,
        "Content-Type": "application/json",
        "X-Reference-Id": referenceId,
        "X-Target-Environment": getTargetEnv,
        "X-Callback-Url": callbackUrl,
      };

      const disbursementUrl = `${baseUrl}/disbursement/v1_0/transfer`;
      const disbursementBody = {
        amount: rewardAmount.toString(),
        currency: "SZL",
        externalId: referenceId,
        payee: { partyIdType: "MSISDN", partyId: winner.phone },
        payerMessage: "Daily Quiz Winner Reward",
        payeeNote: "Congratulations!",
      };

      let paymentStatus = "FAILED";
      let paymentReason = "Unknown error during disbursement initiation";

      try {
        const disbursementResponse = await axios.post(disbursementUrl, disbursementBody, { headers });

        if (disbursementResponse.status === 202) {
          console.log(`✅ Disbursement accepted by MTN for ${winner.phone}`);
          await new Promise((resolve) => setTimeout(resolve, 3000));

          const statusUrl = `${baseUrl}/disbursement/v1_0/transfer/${referenceId}`;
          const statusRes = await axios.get(statusUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Ocp-Apim-Subscription-Key": disbursementPrimaryKey,
              "X-Target-Environment": getTargetEnv,
            },
          });

          paymentStatus = statusRes.data.status;
          paymentReason = statusRes.data.reason || null;

          if (paymentStatus === "SUCCESSFUL") {
            const user = await User.findById(winner.userId);
            if (user) {
              user.currentSzlAssigned += rewardAmount;
              await user.save();
            }
            console.log(`🎉 Successfully rewarded ${winner.phone} with ${rewardAmount} SZL.`);
          } else {
            console.log(`⚠️ Disbursement for ${winner.phone} was ${paymentStatus}. Reason: ${paymentReason}`);
          }

          await Payment.create({
            userId: winner.userId,
            phone: winner.phone,
            referenceId,
            amount: rewardAmount,
            status: paymentStatus,
            reason: paymentReason,
            payerMessage: disbursementBody.payerMessage,
            payeeNote: disbursementBody.payeeNote,
            rawResponse: statusRes.data,
          });
        } else {
          console.error(`❌ MTN did not accept disbursement for ${winner.phone}`);
        }
      } catch (error) {
        console.error(`❌ Failed disbursement for ${winner.phone}:`, error.response?.data || error.message);
        paymentReason = error.response?.data?.message || error.message;
      }

      rewardResults.push({
        phone: winner.phone,
        rewardAmount,
        paymentStatus,
        paymentReason,
      });
    }

    // 3. Final response summary
    return res.json({
      success: true,
      message: "Top 2 winners processed successfully.",
      results: rewardResults,
    });
  } catch (err) {
    console.error("❌ rewardDailyWinners error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


export default router;
