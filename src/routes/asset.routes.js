import { Router } from "express";

import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";

import {
  validateCreateAsset,
  validateUpdateAsset,
  validateAssign,
  validateReturn,
  validateStatus,
} from "../validators/asset.validator.js";
import * as controller from "../controllers/asset.controller.js";

const router = Router();


router.use(protect, authorize("admin"));

router.get("/summary", controller.getSummary);

router.route("/")
  .get(controller.getAssets)
  .post(validateCreateAsset, controller.createAsset);

router.route("/:id")
  .get(controller.getAssetById)
  .put(validateUpdateAsset, controller.updateAsset)
  .delete(controller.deleteAsset);

router.patch("/:id/assign", validateAssign, controller.assignAsset);
router.patch("/:id/return", validateReturn, controller.returnAsset);
router.patch("/:id/status", validateStatus, controller.changeStatus);

export default router;