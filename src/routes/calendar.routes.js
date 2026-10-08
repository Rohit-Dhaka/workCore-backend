import express from "express";

import {
  createCalendarEvent,
  getCalendarEvents,
  getCalendarEventById,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../controllers/calendar.controller.js";

import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.post("/", createCalendarEvent);

router.get("/", getCalendarEvents);

router.get("/:id", getCalendarEventById);

router.put("/:id", updateCalendarEvent);

router.delete("/:id", deleteCalendarEvent);

export default router;