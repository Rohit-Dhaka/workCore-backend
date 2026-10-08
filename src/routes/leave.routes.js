import express from "express";

import {
  applyLeave,
  getMyLeaves,
  cancelMyLeave,
  getAllLeaves,
  reviewLeave,
} from "../controllers/leave.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ApiError(403, "Only admin can access this"));
  }
  next();
};

const employeeOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "employee") {
    return next(new ApiError(403, "Only employee can access this"));
  }
  next();
};

router.use(protect);


router.post("/", employeeOnly, applyLeave);
router.get("/my", employeeOnly, getMyLeaves);
router.patch("/my/:id/cancel", employeeOnly, cancelMyLeave);
router.get("/", adminOnly, getAllLeaves);
router.patch("/:id/review", adminOnly, reviewLeave);

export default router;