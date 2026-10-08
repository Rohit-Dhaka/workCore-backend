import express from "express";
import {
  createEmployee,
  getEmployees,
  getEmployeeById,
  updateEmployee,
  toggleEmployeeStatus,
  deleteEmployee,
  changeEmployeePassword,
} from "../controllers/employee.controller.js";
import { upload } from "../middlewares/upload.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import { ApiError } from "../middlewares/error.middleware.js";

const router = express.Router();


const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return next(new ApiError(403, "Only admin can access this"));
  }
  next();
};


router.use(protect, adminOnly);

router.post("/", upload.single("profileImage"), createEmployee);
router.get("/", getEmployees);
router.put("/:id",upload.single("profileImage") , updateEmployee);
router.patch("/:id/status", toggleEmployeeStatus);
router.patch("/:id/password", changeEmployeePassword);
router.delete("/:id", deleteEmployee);
router.get("/:id", getEmployeeById);

export default router;