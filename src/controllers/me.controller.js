import Attendance from "../models/Attendance.model.js";
import Employee from "../models/Employee.model.js";
import { ApiError, asyncHandler } from "../middlewares/error.middleware.js";
import { comparePassword, hashPassword } from "../utils/hashPassword.js";


import {uploadToCloudinary,deleteFromCloudinary,} from "../utils/cloudinary.js ";

const STATUSES = [
  "present",
  "half_day",
  "absent",
  "paid_leave",
  "unpaid_leave",
  "work_from_home",
  "holiday",
];



const pad = (n) => String(n).padStart(2, "0");


const todayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  );
};

const parseMonth = (value) => {
  let key = String(value || "");

  if (!key) {
    const t = todayIST();
    key = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
  }

  if (!/^\d{4}-\d{2}$/.test(key)) {
    throw new ApiError(400, "Month YYYY-MM format me do");
  }

  const [year, month] = key.split("-").map(Number);

  if (month < 1 || month > 12) {
    throw new ApiError(400, "Invalid month");
  }

  return { year, month, key };
};



export const getMyAttendance = asyncHandler(async (req, res) => {
  const { year, month, key } = parseMonth(req.query.month);

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const records = await Attendance.find({
    employeeId: req.user._id,
    date: { $gte: start, $lt: end },
  })
    .sort({ date: 1 })
    .lean();

  const summary = {};
  STATUSES.forEach((s) => (summary[s] = 0));

  records.forEach((r) => {
    if (summary[r.status] !== undefined) summary[r.status] += 1;
  });

  summary.totalLeave = summary.paid_leave + summary.unpaid_leave;
  summary.totalMarked = records.length;

  res.status(200).json({
    success: true,
    month: key,
    summary,
    records,
  });
});



export const getMyProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id).lean();

  if (!employee) throw new ApiError(404, "Employee nahi mila");

  delete employee.password;

  res.status(200).json({ success: true, employee });
});


export const updateMyProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id);

  if (!employee) throw new ApiError(404, "Employee nahi mila");

  const { mobile } = req.body;
  let changed = false;

  if (mobile !== undefined && mobile.trim() !== employee.mobile) {
    const cleanMobile = String(mobile).trim();

    if (!/^[0-9+\-\s]{10,15}$/.test(cleanMobile)) {
      throw new ApiError(400, "Mobile number 10 se 15 digit ka hona chahiye");
    }

    employee.mobile = cleanMobile;
    changed = true;
  }

  let oldPublicId = "";

  if (req.file) {
    oldPublicId = employee.profileImage?.publicId;
    employee.profileImage = await uploadToCloudinary(req.file.buffer);
    changed = true;
  }

  if (!changed) {
    throw new ApiError(400, "Kuch badla nahi hai");
  }

  await employee.save();

  
  if (oldPublicId) {
    await deleteFromCloudinary(oldPublicId);
  }

  const result = employee.toObject();
  delete result.password;

  res.status(200).json({
    success: true,
    message: "Profile update ho gayi",
    employee: result,
  });
});



export const changeMyPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Purana aur naya password dono do");
  }

  if (String(newPassword).length < 6) {
    throw new ApiError(400, "Naya password kam se kam 6 akshar ka ho");
  }

  if (currentPassword === newPassword) {
    throw new ApiError(400, "Naya password purane se alag hona chahiye");
  }

  const employee = await Employee.findById(req.user._id).select("+password");

  if (!employee) throw new ApiError(404, "Employee nahi mila");

  const match = await comparePassword(currentPassword, employee.password);

  if (!match) {
    throw new ApiError(400, "Purana password galat hai");
  }

  employee.password = await hashPassword(newPassword);
  await employee.save();

  res.status(200).json({
    success: true,
    message: "Password badal gaya",
  });
});