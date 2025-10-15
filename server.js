import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import quizRoutes from "./routes/quizRoutes.js";
import smsRoutes from "./routes/smsRoutes.js"; 
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import adminRoutes from "./routes/admin.js";


dotenv.config();

const app = express();

// ✅ Connect to MongoDB
connectDB();

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/subscription", subscriptionRoutes); // MTN subscription, disbursement, callback
// After other app.use() calls

app.use("/api/admin", adminRoutes);
// ✅ Health check route
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// ✅ Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
