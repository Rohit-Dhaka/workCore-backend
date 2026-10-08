import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";
import {
  getCrmStats,
  getFollowUps,
  getLeads,
  getLead,
  createLead,
  updateLead,
  updateLeadStatus,
  deleteLead,
  addLeadNote,
  deleteLeadNote,
  addFollowUp,
  updateFollowUp,
  deleteFollowUp,
  linkQuotation,
  unlinkQuotation,
  convertLeadToClient,
  getClients,
  getClient,
  createClient,
  updateClient,
  addClientNote,
  deleteClient,
} from "../controllers/crm.controller.js";

const router = Router();

router.use(protect, authorize("admin"));

router.get("/stats", getCrmStats);
router.get("/follow-ups", getFollowUps);

router.route("/leads").get(getLeads).post(createLead);
router.route("/leads/:id").get(getLead).put(updateLead).delete(deleteLead);
router.patch("/leads/:id/status", updateLeadStatus);
router.post("/leads/:id/notes", addLeadNote);
router.delete("/leads/:id/notes/:noteId", deleteLeadNote);
router.post("/leads/:id/follow-ups", addFollowUp);
router
  .route("/leads/:id/follow-ups/:followUpId")
  .patch(updateFollowUp)
  .delete(deleteFollowUp);
router.post("/leads/:id/quotations", linkQuotation);
router.delete("/leads/:id/quotations/:quotationId", unlinkQuotation);
router.post("/leads/:id/convert", convertLeadToClient);

router.route("/clients").get(getClients).post(createClient);
router
  .route("/clients/:id")
  .get(getClient)
  .put(updateClient)
  .delete(deleteClient);
router.post("/clients/:id/notes", addClientNote);

export default router;