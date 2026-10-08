import mongoose from "mongoose";

import Leave from "../models/Leave.model.js";
import Attendance from "../models/Attendance.model.js";
import Employee from "../models/Employee.model.js";
import { ApiError, asyncHandler } from "../middlewares/error.middleware.js";

const LEAVE_TYPES = ["paid_leave", "unpaid_leave"];
const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"];
const MAX_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

const EMPLOYEE_FIELDS =
  "firstName lastName email mobile designation profileImage";


const toDateOnly = (input) => {
  const str = typeof input === "string" ? input.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new ApiError(400, "Date YYYY-MM-DD format me do");
  }
  const d = new Date(`${str}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new ApiError(400, "Invalid date");
  return d;
};


const todayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  );
};

const countDays = (from, to) => Math.round((to - from) / DAY_MS) + 1;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid leave id");
  }
};


export const applyLeave = asyncHandler(async (req, res) => {
  const { leaveType, fromDate, toDate, reason } = req.body;

  if (!LEAVE_TYPES.includes(leaveType)) {
    throw new ApiError(400, "Invalid leave type");
  }

  const from = toDateOnly(fromDate);
  const to = toDateOnly(toDate || fromDate);

  if (from < todayIST()) {
    throw new ApiError(400, "Purani date ki leave apply nahi kar sakte");
  }

  if (to < from) {
    throw new ApiError(400, "To date, From date se pehle nahi ho sakti");
  }

  const days = countDays(from, to);

  if (days > MAX_DAYS) {
    throw new ApiError(400, `Ek request me max ${MAX_DAYS} din ki leave`);
  }

  const cleanReason = String(reason || "").trim();

  if (cleanReason.length < 5) {
    throw new ApiError(400, "Reason kam se kam 5 akshar ka likho");
  }

  if (cleanReason.length > 500) {
    throw new ApiError(400, "Reason 500 akshar se zyada nahi ho sakta");
  }

  
  const overlap = await Leave.findOne({
    employee: req.user._id,
    status: { $in: ["pending", "approved"] },
    fromDate: { $lte: to },
    toDate: { $gte: from },
  });

  if (overlap) {
    throw new ApiError(409, "In dino ki leave pehle se apply ho chuki hai");
  }

  const leave = await Leave.create({
    employee: req.user._id,
    leaveType,
    fromDate: from,
    toDate: to,
    days,
    reason: cleanReason,
  });

  res.status(201).json({
    success: true,
    message: "Leave request bhej di gayi",
    leave,
  });
});



export const getMyLeaves = asyncHandler(async (req, res) => {
  const leaves = await Leave.find({ employee: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  const year = todayIST().getUTCFullYear();

  const summary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    paidDays: 0,
    unpaidDays: 0,
  };

  leaves.forEach((leave) => {
    if (summary[leave.status] !== undefined) summary[leave.status] += 1;

    
    if (
      leave.status === "approved" &&
      new Date(leave.fromDate).getUTCFullYear() === year
    ) {
      if (leave.leaveType === "paid_leave") summary.paidDays += leave.days;
      else summary.unpaidDays += leave.days;
    }
  });

  res.status(200).json({ success: true, leaves, summary });
});



export const cancelMyLeave = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const leave = await Leave.findOne({ _id: id, employee: req.user._id });

  if (!leave) throw new ApiError(404, "Leave request nahi mili");

  if (leave.status !== "pending") {
    throw new ApiError(400, "Sirf pending request cancel ho sakti hai");
  }

  leave.status = "cancelled";
  await leave.save();

  res.status(200).json({
    success: true,
    message: "Leave request cancel ho gayi",
    leave,
  });
});



export const getAllLeaves = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const { status, type, search } = req.query;

  const filter = {};

  if (LEAVE_STATUSES.includes(status)) filter.status = status;
  if (LEAVE_TYPES.includes(type)) filter.leaveType = type;

  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), "i");

    const matched = await Employee.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    }).select("_id");

    filter.employee = { $in: matched.map((e) => e._id) };
  }

  const [leaves, total, statusCounts] = await Promise.all([
    Leave.find(filter)
      .populate("employee", EMPLOYEE_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    Leave.countDocuments(filter),

    
    Leave.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const stats = { total: 0 };
  LEAVE_STATUSES.forEach((s) => (stats[s] = 0));
  statusCounts.forEach((row) => {
    stats[row._id] = row.count;
    stats.total += row.count;
  });

  res.status(200).json({
    success: true,
    leaves,
    stats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});



export const reviewLeave = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const { status, reviewNote } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    throw new ApiError(400, "Status approved ya rejected hona chahiye");
  }

  const note = String(reviewNote || "").trim();

  if (note.length > 500) {
    throw new ApiError(400, "Note 500 akshar se zyada nahi ho sakta");
  }

  const leave = await Leave.findById(id);

  if (!leave) throw new ApiError(404, "Leave request nahi mili");

  if (leave.status !== "pending") {
    throw new ApiError(400, "Ye request pehle hi review ho chuki hai");
  }

  
  if (status === "approved") {
    const ops = [];

    for (let i = 0; i < leave.days; i += 1) {
      const date = new Date(leave.fromDate.getTime() + i * DAY_MS);

      ops.push({
        updateOne: {
          filter: { employeeId: leave.employee, date },
          update: {
            $set: {
              status: leave.leaveType,
              note: `Leave approved: ${leave.reason}`.slice(0, 500),
              markedBy: req.user._id,
            },
          },
          upsert: true,
        },
      });
    }

    await Attendance.bulkWrite(ops);
  }

  leave.status = status;
  leave.reviewNote = note;
  leave.reviewedBy = req.user._id;
  leave.reviewedAt = new Date();
  await leave.save();

  const updated = await Leave.findById(id)
    .populate("employee", EMPLOYEE_FIELDS)
    .lean();

  res.status(200).json({
    success: true,
    message:
      status === "approved"
        ? "Leave approve ho gayi aur attendance me lag gayi"
        : "Leave reject ho gayi",
    leave: updated,
  });
});