import mongoose from "mongoose";
import Attendance from "../models/Attendance.model.js";
import Employee from "../models/Employee.model.js";
import { ApiError } from "../middlewares/error.middleware.js";

const STATUSES = [
  "present",
  "half_day",
  "absent",
  "paid_leave",
  "unpaid_leave",
  "work_from_home",
  "holiday",
];


const toDateOnly = (input) => {
  const str = typeof input === "string" ? input.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new ApiError(400, "Date YYYY-MM-DD format me do");
  }
  const d = new Date(`${str}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    throw new ApiError(400, "Invalid date");
  }
  return d;
};


const todayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  );
};

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid employee id");
  }
};


export const markAttendance = async (req, res) => {
  const { employeeId, date, status, note } = req.body;

  if (!employeeId || !date || !status) {
    throw new ApiError(400, "employeeId, date aur status zaruri hain");
  }

  checkId(employeeId);

  if (!STATUSES.includes(status)) {
    throw new ApiError(400, "Invalid attendance status");
  }

  const attendanceDate = toDateOnly(date);

  
  if (attendanceDate > todayIST()) {
    throw new ApiError(400, "Future date ki attendance mark nahi kar sakte");
  }

  const employee = await Employee.findOne({
    _id: employeeId,
    isDeleted: false,
  });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  
  const attendance = await Attendance.findOneAndUpdate(
    { employeeId, date: attendanceDate },
    {
      status,
      note: note?.trim() || "",
      markedBy: req.user._id,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  res.status(200).json({
    success: true,
    message: "Attendance mark ho gayi",
    attendance,
  });
};


export const getAttendanceByDate = async (req, res) => {
  const date = req.query.date
    ? toDateOnly(req.query.date)
    : todayIST();

  const employees = await Employee.find({
    isDeleted: false,
    role: "employee",
  })
    .select("firstName lastName designation profileImage isActive")
    .sort({ firstName: 1 });

  const records = await Attendance.find({ date });

  const recordMap = new Map(
    records.map((r) => [r.employeeId.toString(), r])
  );

  const sheet = employees.map((emp) => {
    const record = recordMap.get(emp._id.toString());
    return {
      employee: emp,
      attendance: record
        ? { _id: record._id, status: record.status, note: record.note }
        : null, 
    };
  });

  res.status(200).json({
    success: true,
    date: date.toISOString().slice(0, 10),
    isFuture: date > todayIST(),
    sheet,
  });
};


export const getEmployeeAttendance = async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const employee = await Employee.findOne({ _id: id, isDeleted: false });

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  let year;
  let month;

  if (req.query.month) {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) {
      throw new ApiError(400, "Month YYYY-MM format me do");
    }
    [year, month] = req.query.month.split("-").map(Number);
    if (month < 1 || month > 12) {
      throw new ApiError(400, "Invalid month");
    }
  } else {
    const today = todayIST();
    year = today.getUTCFullYear();
    month = today.getUTCMonth() + 1;
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const records = await Attendance.find({
    employeeId: id,
    date: { $gte: start, $lt: end },
  }).sort({ date: 1 });

  
  const summary = {};
  STATUSES.forEach((s) => (summary[s] = 0));
  records.forEach((r) => {
    summary[r.status] += 1;
  });

  summary.totalLeave = summary.paid_leave + summary.unpaid_leave;
  summary.totalMarked = records.length;

  res.status(200).json({
    success: true,
    employee: {
      _id: employee._id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      designation: employee.designation,
      profileImage: employee.profileImage,
    },
    month: `${year}-${String(month).padStart(2, "0")}`,
    summary,
    records,
  });
};

export const deleteAttendance = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid attendance id");
  }

  const attendance = await Attendance.findByIdAndDelete(id);

  if (!attendance) {
    throw new ApiError(404, "Attendance record not found");
  }

  res.status(200).json({
    success: true,
    message: "Attendance hata di gayi",
  });
};