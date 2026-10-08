import express from "express";

import {
  createSupportTicket,
  getMySupportTickets,
  getMySupportTicket,
  getAllSupportTickets,
  getSupportTicketById,
  updateSupportTicket,
  deleteSupportTicket,
} from "../controllers/supportTicket.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();


const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ApiError(403, "Only admin can access this"));
  }
  next();
};




router.get("/admin/tickets", protect, adminOnly, getAllSupportTickets);


router.get("/admin/tickets/:id", protect, adminOnly, getSupportTicketById);


router.patch("/admin/tickets/:id", protect, adminOnly, updateSupportTicket);

router.delete("/admin/tickets/:id", protect, adminOnly, deleteSupportTicket);


router.post("/tickets", protect, createSupportTicket);


router.get("/tickets/my", protect, getMySupportTickets);

router.get("/tickets/:id", protect, getMySupportTicket);

export default router;