import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";
import {
  changeQuotationStatus,
  convertToInvoice,
  createQuotation,
  createService,
  deleteQuotation,
  deleteService,
  duplicateQuotation,
  getPublicQuotation,
  getQuotationById,
  getQuotations,
  getServices,
  getSettings,
  seedServices,
  updateQuotation,
  updateService,
  updateSettings,
} from "../controllers/quotation.controller.js";

const router = Router();

router.get("/public/:token", getPublicQuotation);

router.use(protect, authorize("admin"));

router
  .route("/settings")
  .get(getSettings)
  .put(upload.single("logo"), updateSettings);

router.route("/services").get(getServices).post(createService);
router.post("/services/seed", seedServices);
router.route("/services/:id").put(updateService).delete(deleteService);

router.route("/").get(getQuotations).post(createQuotation);

router.post("/:id/duplicate", duplicateQuotation);
router.patch("/:id/status", changeQuotationStatus);
router.post("/:id/convert", convertToInvoice);

router
  .route("/:id")
  .get(getQuotationById)
  .put(updateQuotation)
  .delete(deleteQuotation);

export default router;
