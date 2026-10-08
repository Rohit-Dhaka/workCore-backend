import express from "express";

import {
  getTodayProgress,
  saveProgressSlot,
  submitDailyProgress,
  getEmployeeWeeklyProgress,
  getAdminProgress,
  getAdminWeeklyProgress,
  getProgressSummary,
} from "../controllers/dailyProgress.controller.js";


import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

 

router.get(
  "/today",
  protect,
  getTodayProgress
);

router.post(
  "/save",
  protect,
  saveProgressSlot
);

router.post(
  "/:id/submit",
  protect,
  submitDailyProgress
);

router.get(
  "/weekly",
  protect,
  getEmployeeWeeklyProgress
);



router.get(
  "/admin/all",
  protect,
  getAdminProgress
);

router.get(
  "/admin/weekly",
  protect,
  getAdminWeeklyProgress
);

router.get(
  "/admin/summary",
  protect,
  getProgressSummary
);


export default router;