import express from "express";

import {
  createAnnouncement,
  getAllAnnouncements,
  getEmployeeAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  toggleAnnouncementPublish,
  markAnnouncementAsRead,
  getAnnouncementReadStats,
} from "../controllers/announcement.controller.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/announcement.middleware.js";

const router = express.Router();


router.use(protect);


router.get("/my", getEmployeeAnnouncements);

router.patch("/:id/read", markAnnouncementAsRead);



router.post("/", requireAdmin, createAnnouncement);

router.get("/admin", requireAdmin, getAllAnnouncements);

router.get("/:id/read-stats", requireAdmin, getAnnouncementReadStats);

router.patch("/:id/publish", requireAdmin, toggleAnnouncementPublish);

router.put("/:id", requireAdmin, updateAnnouncement);

router.delete("/:id", requireAdmin, deleteAnnouncement);


router.get("/:id", getAnnouncementById);

export default router;