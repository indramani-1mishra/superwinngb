import express from "express";
import { registerUser, loginUser , getMe ,updateMe  } from "../controllers/auth.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", protect, getMe);
router.put("/me", protect, updateMe );

export default router;
