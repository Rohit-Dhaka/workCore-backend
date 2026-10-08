import express from "express";

import {
  createExpense,
  getExpenses,
  getExpenseTrend,
  updateExpense,
  deleteExpense,
} from "../controllers/expense.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ApiError(403, "Only admin can access this"));
  }
  next();
};

router.use(protect, adminOnly);

router.get("/", getExpenses);
router.get("/trend", getExpenseTrend);
router.post("/", upload.single("receipt"), createExpense);
router.patch("/:id", upload.single("receipt"), updateExpense);
router.delete("/:id", deleteExpense);

export default router;