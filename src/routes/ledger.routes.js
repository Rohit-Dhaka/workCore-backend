import express from "express";

import {
  createLedger,
  getLedger,
  getLedgerById,
  updateLedger,
  deleteLedger,
  addPayment,
  deletePayment,
  getLedgerSummary,
  getOverdueLedger,
  getLedgerByType,
} from "../controllers/ledger.controller.js";


import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();




router.get(
  "/summary",
  protect,
  getLedgerSummary
);




router.get(
  "/overdue",
  protect,
  getOverdueLedger
);



router.get(
  "/type/:type",
  protect,
  getLedgerByType
);




router.get(
  "/",
  protect,
  getLedger
);



router.post(
  "/",
  protect,
  createLedger
);




router.get(
  "/:id",
  protect,
  getLedgerById
);




router.put(
  "/:id",
  protect,
  updateLedger
);



router.delete(
  "/:id",
  protect,
  deleteLedger
);




router.post(
  "/:id/payment",
  protect,
  addPayment
);




router.delete(
  "/:id/payment/:paymentId",
  protect,
  deletePayment
);


export default router;