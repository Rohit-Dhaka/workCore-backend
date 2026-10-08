import express from "express";

import {
  getMyAttendance,
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
} from "../controllers/me.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();

const employeeOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "employee") {
    return next(new ApiError(403, "Only employee can access this"));
  }
  next();
};

router.use(protect, employeeOnly);

router.get("/attendance", getMyAttendance);
router.get("/profile", getMyProfile);
router.patch("/profile", upload.single("profileImage"), updateMyProfile);
router.patch("/password", changeMyPassword);

export default router;