import { Router } from "express";


import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";


import {
  acknowledgeReview,
  createPerformance,
  deletePerformance,
  getAllPerformance,
  getMyPerformance,
  getMyPerformanceById,
  getPerformanceById,
  getPerformanceSummary,
  submitSelfReview,
  updatePerformance,
} from "../controllers/performance.controller.js";

const router = Router();

router.use(protect);



router.get("/my", getMyPerformance);
router.get("/my/:id", getMyPerformanceById);
router.patch("/my/:id/self-review", submitSelfReview);
router.patch("/my/:id/acknowledge", acknowledgeReview);



router.get("/summary", authorize("admin"), getPerformanceSummary);

router
  .route("/")
  .get(authorize("admin"), getAllPerformance)
  .post(authorize("admin"), createPerformance);

router
  .route("/:id")
  .get(authorize("admin"), getPerformanceById)
  .put(authorize("admin"), updatePerformance)
  .delete(authorize("admin"), deletePerformance);

export default router;