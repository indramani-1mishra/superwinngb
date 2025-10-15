
import Quiz from "../models/Quiz.js";
import User from "../models/User.js"; // Import User model
import Payment from "../models/Payment.js"; // Import Payment model
import DailyQuizAttempt from "../models/DailyQuizAttempt.js"; // Import DailyQuizAttempt model

export const createQuiz = async (req, res) => {
  try {
    const { title, questions } = req.body;

    if (!title || !questions || !questions.length) {
      return res.status(400).json({ success: false, message: "Title and questions are required" });
    }

    const quiz = await Quiz.create({
      title,
      questions,
      createdBy: req.user._id,
      active: true
    });

    res.status(201).json({ success: true, quiz });
  } catch (err) {
    console.error("createQuiz error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find().populate("createdBy", "name email");
    res.json({ success: true, quizzes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuestionSet = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get today's date for daily attempt tracking
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailyAttempt = await DailyQuizAttempt.findOne({
      userId: userId,
      date: today,
    });

    if (!dailyAttempt) {
      dailyAttempt = await DailyQuizAttempt.create({
        userId: userId,
        date: today,
        quizId: user.quizId,
        currentQuestionIndex: user.currentQuestionIndex, 
      });
    }

    if (dailyAttempt.setsCompleted >= 20) {
      return res.status(403).json({ success: false, message: "You have reached the daily limit of 20 question sets. Please try again tomorrow." });
    }

    if (user.isAttemptQuiz) {
      return res.status(403).json({ success: false, message: "You have previously failed a set. Please purchase a plan to continue." });
    }

    let { currentQuestionIndex, quizId } = user;

    if (!quizId) {
      // If no quizId, fetch the first active quiz
      const firstQuiz = await Quiz.findOne({ active: true });
      if (!firstQuiz) {
        return res.status(404).json({ success: false, message: "No active quizzes available" });
      }
      quizId = firstQuiz._id;
      currentQuestionIndex = 0;
      user.quizId = quizId;
      user.currentQuestionIndex = currentQuestionIndex;
      await user.save();
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const questionsInSet = 10;
    const start = currentQuestionIndex;
    const end = Math.min(start + questionsInSet, quiz.questions.length);

    const questionSet = quiz.questions.slice(start, end).map(q => ({
      _id: q._id,
      q: q.q,
      options: q.options,
      correctIndex: q.correctIndex,
    }));

    res.json({
      success: true,
      quizId: quiz._id,
      questions: questionSet,
      startIndex: start,
      endIndex: end,
      totalQuestions: quiz.questions.length,
    });

  } catch (err) {
    console.error("getQuestionSet error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuestionIndex = async (req, res) => {
  try {
    const userId = req.user.id;
    const { newIndex, quizId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.quizId.toString() !== quizId) {
      return res.status(400).json({ success: false, message: "Invalid quiz ID for user" });
    }

    user.currentQuestionIndex = newIndex;
    await user.save();

    res.json({ success: true, message: "Question index updated", currentQuestionIndex: newIndex });
  } catch (err) {
    console.error("updateQuestionIndex error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markQuizAttempted = async (req, res) => {
  try {
    const userId = req.user.id; 
    const { score, timeTaken } = req.body; 

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Get today's date for daily attempt tracking
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailyAttempt = await DailyQuizAttempt.findOne({
      userId: userId,
      date: today,
    });

    if (!dailyAttempt) {
      // This should ideally not happen if getQuestionSet is called first, but as a fallback
      dailyAttempt = await DailyQuizAttempt.create({
        userId: userId,
        date: today,
      });
    }

    // Update daily attempt stats
    dailyAttempt.setsCompleted += 1;
    dailyAttempt.dailyPoints += score || 0;
    dailyAttempt.dailyTimeTaken += timeTaken || 0;

    if (score < 10) {
      // User failed a set
      user.isAttemptQuiz = true;
      user.currentQuestionIndex = 0; 
      user.quizId = null; // Clear quizId
      await user.save();
      await dailyAttempt.save();
      return res.json({ success: true, message: "User failed a set and progress reset. Please purchase a plan to continue." });
    } else {
      // User got 10/10 for the set
      if (dailyAttempt.setsCompleted >= 20 && dailyAttempt.dailyPoints === (20 * 10)) { // 20 sets * 10 points/set
        dailyAttempt.isEligibleForLeaderboard = true;
        // Update lifetime stats only if eligible for leaderboard
        user.totalPoints += dailyAttempt.dailyPoints;
        user.totalTimeTaken += dailyAttempt.dailyTimeTaken;
        await user.save();
      }
      await dailyAttempt.save();
      return res.json({ success: true, message: "Set completed successfully." });
    }
  } catch (err) {
    console.error("markQuizAttempted error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dailyLeaderboard = await DailyQuizAttempt.aggregate([
      {
        $match: {
          date: {
            $gte: today,
            $lt: tomorrow,
          },
          isEligibleForLeaderboard: true, // Only include users eligible for leaderboard
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
          from: "users", // The collection name for the User model
          localField: "_id",
          foreignField: "_id",
          as: "userDetails",
        },
      },
      {
        $unwind: "$userDetails",
      },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          phone: "$userDetails.phone",
          dailyPoints: 1,
          dailyTimeTaken: 1,
        },
      },
      {
        $sort: {
          dailyPoints: -1, // Sort by points descending
          dailyTimeTaken: 1, // Then by time taken ascending
        },
      },
      {
        $limit: 10, // Return top 10 users for the daily leaderboard
      },
    ]);

    res.json({ success: true, leaderboard: dailyLeaderboard });
  } catch (err) {
    console.error("getLeaderboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resetDailyAttemptStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.isAttemptQuiz = false;
    await user.save();

    // Optionally, reset the daily attempt for today if a new payment allows it
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await DailyQuizAttempt.findOneAndUpdate(
      { userId: userId, date: today },
      { $set: { setsCompleted: 0, dailyPoints: 0, dailyTimeTaken: 0, isEligibleForLeaderboard: false } },
      { new: true, upsert: true } // Create if not exists, return updated doc
    );

    res.json({ success: true, message: "Daily attempt status reset successfully." });
  } catch (err) {
    console.error("resetDailyAttemptStatus error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuiz = async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).populate("createdBy", "name email");
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
