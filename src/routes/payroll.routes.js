import express from "express";

import {
  generatePayroll,
  getPayrolls,
  updatePayroll,
  markPayrollPaid,
  deletePayroll,
  getMyPayrolls,
} from "../controllers/payroll.controller.js";

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


router.get("/my", employeeOnly, getMyPayrolls);


router.post("/generate", adminOnly, generatePayroll);
router.get("/", adminOnly, getPayrolls);
router.patch("/:id", adminOnly, updatePayroll);
router.patch("/:id/pay", adminOnly, markPayrollPaid);
router.delete("/:id", adminOnly, deletePayroll);

export default router;