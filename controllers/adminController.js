import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import csv from "csv-parser";
import fs from "fs";

// ---------------- Users ----------------
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await User.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- Quizzes ----------------
export const createQuiz = async (req, res) => {
  try {
    const { title, questions } = req.body;

    if (!title || !questions || !questions.length) {
      return res.status(400).json({ success: false, message: "Title and questions are required" });
    }

    const quiz = await Quiz.create({ title, questions, active: true });
    res.status(201).json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all quizzes with active question count
export const getQuizzes = async (req, res) => {
  try {
    const quizzes = await Quiz.find().sort({ createdAt: -1 });
    const quizzesWithActiveCount = quizzes.map((q) => ({
      ...q.toObject(),
      activeQuestions: q.questions.length, // assuming all questions are active
    }));
    res.json({ success: true, quizzes: quizzesWithActiveCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuizById = async (req, res) => {
  try {
    const { quizId } = req.params;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- Questions ----------------
export const addQuestionToQuiz = async (req, res) => {
  try {
    const { quizId, q, options, correctIndex } = req.body;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions.push({ q, options, correctIndex });
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuestion = async (req, res) => {
  try {
    const { quizId, qIndex } = req.params;
    const { q, options, correctIndex } = req.body;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions[qIndex] = { q, options, correctIndex };
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    const { quizId, qIndex } = req.params;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    quiz.questions.splice(qIndex, 1);
    await quiz.save();
    res.json({ success: true, quiz });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------- CSV Upload ----------------
export const uploadCSV = async (req, res) => {
  try {
    const { quizId } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    if (!quizId) return res.status(400).json({ success: false, message: "Quiz ID required" });

    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", async () => {
        const parsedQuestions = results.map((row) => ({
          q: row.q,
          options: [row.option1, row.option2, row.option3, row.option4],
          correctIndex: parseInt(row.correctIndex, 10),
        }));

        quiz.questions.push(...parsedQuestions);
        await quiz.save();
        fs.unlinkSync(req.file.path);

        res.json({ success: true, quiz });
      });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
