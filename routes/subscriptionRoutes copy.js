import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

// ----------------------------
// MTN Access Token Cache
// ----------------------------
let cachedToken = null;
let tokenExpiry = null;

const getMtnAccessToken = async (clientId, clientSecret, tokenUrl) => {
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post(
      tokenUrl,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = new Date(new Date().getTime() + 14 * 60 * 1000); // 14 min cache
    return cachedToken;
  } catch (err) {
    console.error("❌ MTN Token Error:", err.response?.data || err.message);
    throw new Error("Failed to get MTN access token");
  }
};

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


const getTargetEnv = process.env.MTN_ENVIRONMENT || "mtnswaziland";
const callbackUrl = process.env.MTN_CALLBACK_URL || "https://superwinnings.com/mtnwap/callback"; 

// ----------------------------
// Test Route
// ----------------------------
router.get("/", authenticateUser, (req, res) => {
  res.json({
    success: true,
    message: "MTN Subscription/Disbursement API is working ✅",
    user: req.user,
  });
});

// ----------------------------
// Create Subscription
// ----------------------------
router.post("/create", authenticateUser, async (req, res) => {
  try {
    const phone = req.user.phone;
    const { amount } = req.body;
    if (!amount)
      return res.status(400).json({ success: false, error: "Amount required" });

    const token = await getMtnAccessToken(
      process.env.MTN_CLIENT_ID,
      process.env.MTN_CLIENT_SECRET,
      process.env.MTN_TOKEN_URL
    );

    const referenceId = uuidv4();

    const headers = {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": process.env.MTN_COLLECTION_PRIMARY_KEY,
      "Content-Type": "application/json",
      "X-Reference-Id": referenceId,
      "X-Target-Environment": getTargetEnv,
      "X-Callback-Url": callbackUrl, // ✅ Added callback URL
    };

    const url = `${process.env.MTN_PARTNER_URL}/collection/v1_0/requesttopay`;
    const body = {
      amount: amount.toString(),
      currency: "SZL",
      externalId: referenceId,
      payer: { partyIdType: "MSISDN", partyId: phone },
      payerMessage: "Daily Gaming Subscription",
      payeeNote: "MTN Momo Subscription",
    };

    const response = await axios.post(url, body, { headers });

    console.log("MTN Subscription Response:", response.data);

    res.json({
      success: true,
      message: "Subscription initiated",
      referenceId,
      data: response.data,
    });
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

    const token = await getMtnAccessToken(
      process.env.MTN_CLIENT_ID,
      process.env.MTN_CLIENT_SECRET,
      process.env.MTN_TOKEN_URL
    );

    const headers = {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": process.env.MTN_COLLECTION_PRIMARY_KEY,
      "X-Target-Environment": getTargetEnv,
    };

    const url = `${process.env.MTN_PARTNER_URL}/collection/v1_0/requesttopay/${referenceId}`;
    const response = await axios.get(url, { headers });

    res.json({
      success: true,
      status: response.data.status,
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

export default router;
