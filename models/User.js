import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: String,
  otpExpiry: Date,
  lastOtpSent: Date,
  isPhoneVerified: { type: Boolean, default: false },
  verifyAttempts: { type: Number, default: 0 },
  isAttemptQuiz: { type: Boolean, default: false },
  currentSzlAssigned: { type: Number, default: 0 },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", default: null },
  currentQuestionIndex: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  totalAmountSpent: { type: Number, default: 0 },
  totalTimeTaken: { type: Number, default: 0 }, // in seconds
});

export default mongoose.model("User", userSchema);
