import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";
import {upload} from "../middlewares/upload.middleware.js";
import * as c from "../controllers/project.controller.js";

const router = Router();
const admin = authorize("admin");

router.use(protect);

router.route("/projects").get(c.getProjects).post(admin, c.createProject);
router.route("/projects/:id").get(c.getProject).put(admin, c.updateProject).delete(admin, c.deleteProject);
router.post("/projects/:id/milestones", admin, c.addMilestone);
router.route("/projects/:id/milestones/:milestoneId").put(admin, c.updateMilestone).delete(admin, c.deleteMilestone);
router.post("/projects/:id/expenses", admin, c.addExpense);
router.delete("/projects/:id/expenses/:expenseId", admin, c.deleteExpense);
router.get("/projects/:id/budget", admin, c.getProjectBudget);

router.get("/tasks/my", c.getMyTasks);
router.get("/tasks/calendar", c.getCalendar);
router.get("/tasks/kanban/:projectId", c.getKanban);
router.route("/tasks").get(c.getTasks).post(admin, c.createTask);
router.route("/tasks/:id").get(c.getTask).put(admin, c.updateTask).delete(admin, c.deleteTask);
router.patch("/tasks/:id/status", c.updateTaskStatus);
router.post("/tasks/:id/comments", c.addComment);
router.delete("/tasks/:id/comments/:commentId", c.deleteComment);
router.post("/tasks/:id/attachments", upload.array("files", 5), c.addAttachment);
router.delete("/tasks/:id/attachments/:attachmentId", c.deleteAttachment);

router.route("/timesheets").get(c.getTimesheets).post(c.logTime);
router.delete("/timesheets/:id", c.deleteTimesheet);
router.get("/workload", admin, c.getWorkload);

router.get("/notifications", c.getNotifications);
router.patch("/notifications/read-all", c.markAllNotificationsRead);
router.patch("/notifications/:id/read", c.markNotificationRead);
router.delete("/notifications/:id", c.deleteNotification);

export default router;