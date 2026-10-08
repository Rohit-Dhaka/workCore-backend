import { Router } from "express";

import {
  login,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
} from "../controllers/auth.controller.js";

import { protect } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/login", login);

router.get("/me", protect, getAdminProfile);
router.put("/me", protect, updateAdminProfile);
router.put("/change-password", protect, changeAdminPassword);

export default router;