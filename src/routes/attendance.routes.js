import express from "express";
import {
  markAttendance,
  getAttendanceByDate,
  getEmployeeAttendance,
  deleteAttendance,
} from "../controllers/attendance.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();


const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ApiError(403, "Only admin can access this"));
  }
  next();
};

router.use(protect, adminOnly);

router.post("/", markAttendance);
router.get("/", getAttendanceByDate);
router.get("/employee/:id", getEmployeeAttendance);
router.delete("/:id", deleteAttendance);

export default router;