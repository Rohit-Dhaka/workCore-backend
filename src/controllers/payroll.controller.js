import mongoose from "mongoose";

import Payroll from "../models/Payroll.model.js";
import Attendance from "../models/Attendance.model.js";
import Employee from "../models/Employee.model.js";
import { ApiError, asyncHandler } from "../middlewares/error.middleware.js";

const PAYMENT_MODES = ["cash", "bank_transfer", "upi", "cheque"];

const EMPLOYEE_FIELDS =
  "firstName lastName email mobile designation profileImage";



const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const pad = (n) => String(n).padStart(2, "0");


const todayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())
  );
};

const currentMonthKey = () => {
  const t = todayIST();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
};

const parseMonth = (value) => {
  const key = String(value || "");

  if (!/^\d{4}-\d{2}$/.test(key)) {
    throw new ApiError(400, "Month YYYY-MM format me do");
  }

  const [year, month] = key.split("-").map(Number);

  if (month < 1 || month > 12) {
    throw new ApiError(400, "Invalid month");
  }

  return { year, month, key };
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid payroll id");
  }
};

const toMoney = (value, label) => {
  if (value === undefined || value === null || value === "") return 0;

  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    throw new ApiError(400, `${label} 0 ya usse zyada hona chahiye`);
  }

  return round2(n);
};

const calcNet = ({ basicSalary, attendanceDeduction, bonus, otherDeduction }) =>
  Math.max(
    round2(basicSalary - attendanceDeduction + bonus - otherDeduction),
    0
  );


const buildPayroll = ({
  basicSalary,
  daysInMonth,
  elapsedDays,
  counts,
  bonus,
  otherDeduction,
}) => {
  const salary = round2(basicSalary);
  const perDaySalary = daysInMonth ? salary / daysInMonth : 0;

  const present = counts.present || 0;
  const half = counts.half_day || 0;
  const absent = counts.absent || 0;
  const paidLeave = counts.paid_leave || 0;
  const unpaidLeave = counts.unpaid_leave || 0;

  const deductibleDays = absent + unpaidLeave + half * 0.5;
  const attendanceDeduction = round2(deductibleDays * perDaySalary);

  return {
    basicSalary: salary,
    daysInMonth,
    presentDays: present,
    halfDays: half,
    absentDays: absent,
    paidLeaveDays: paidLeave,
    unpaidLeaveDays: unpaidLeave,
    unmarkedDays: Math.max(elapsedDays - (counts.marked || 0), 0),
    perDaySalary: round2(perDaySalary),
    payableDays: round2(daysInMonth - deductibleDays),
    attendanceDeduction,
    bonus,
    otherDeduction,
    netSalary: calcNet({
      basicSalary: salary,
      attendanceDeduction,
      bonus,
      otherDeduction,
    }),
  };
};

const emptyCounts = () => ({
  present: 0,
  half_day: 0,
  absent: 0,
  paid_leave: 0,
  unpaid_leave: 0,
  marked: 0,
});


export const generatePayroll = asyncHandler(async (req, res) => {
  const { year, month, key } = parseMonth(req.body.month);

  const todayKey = currentMonthKey();

  if (key > todayKey) {
    throw new ApiError(400, "Aane wale mahine ki payroll nahi ban sakti");
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  
  const elapsedDays =
    key === todayKey ? todayIST().getUTCDate() : daysInMonth;

  const employees = await Employee.find({
    isDeleted: false,
    isActive: true,
    role: "employee",
  });

  if (employees.length === 0) {
    throw new ApiError(404, "Koi active employee nahi mila");
  }

  const ids = employees.map((e) => e._id);

  
  const rows = await Attendance.aggregate([
    {
      $match: {
        employeeId: { $in: ids },
        date: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: { employeeId: "$employeeId", status: "$status" },
        count: { $sum: 1 },
      },
    },
  ]);

  const countMap = {};

  rows.forEach((row) => {
    const empId = row._id.employeeId.toString();

    if (!countMap[empId]) countMap[empId] = emptyCounts();

    countMap[empId][row._id.status] =
      (countMap[empId][row._id.status] || 0) + row.count;
    countMap[empId].marked += row.count;
  });

  const existing = await Payroll.find({ month: key, employee: { $in: ids } });
  const existingMap = new Map(existing.map((p) => [p.employee.toString(), p]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const emp of employees) {
    const old = existingMap.get(emp._id.toString());

    
    if (old?.status === "paid") {
      skipped += 1;
      continue;
    }

    const data = buildPayroll({
      basicSalary: emp.basicSalary,
      daysInMonth,
      elapsedDays,
      counts: countMap[emp._id.toString()] || emptyCounts(),
      bonus: old?.bonus || 0,
      otherDeduction: old?.otherDeduction || 0,
    });

    if (old) {
      Object.assign(old, data);
      await old.save();
      updated += 1;
    } else {
      await Payroll.create({
        employee: emp._id,
        month: key,
        ...data,
        generatedBy: req.user._id,
      });
      created += 1;
    }
  }

  res.status(200).json({
    success: true,
    message: `Payroll ready: ${created} nayi, ${updated} update, ${skipped} paid (chhodi gayi)`,
    result: { created, updated, skipped },
  });
});



export const getPayrolls = asyncHandler(async (req, res) => {
  const { key } = parseMonth(req.query.month || currentMonthKey());

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const { status, search } = req.query;

  const baseFilter = { month: key };
  const filter = { ...baseFilter };

  if (["draft", "paid"].includes(status)) filter.status = status;

  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), "i");

    const matched = await Employee.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    }).select("_id");

    filter.employee = { $in: matched.map((e) => e._id) };
  }

  const [payrolls, total, totals] = await Promise.all([
    Payroll.find(filter)
      .populate("employee", EMPLOYEE_FIELDS)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    Payroll.countDocuments(filter),

    
    Payroll.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$netSalary" },
        },
      },
    ]),
  ]);

  const stats = {
    count: 0,
    totalNet: 0,
    paidNet: 0,
    pendingNet: 0,
    paidCount: 0,
    draftCount: 0,
  };

  totals.forEach((row) => {
    stats.count += row.count;
    stats.totalNet += row.amount;

    if (row._id === "paid") {
      stats.paidNet = row.amount;
      stats.paidCount = row.count;
    } else {
      stats.pendingNet = row.amount;
      stats.draftCount = row.count;
    }
  });

  res.status(200).json({
    success: true,
    month: key,
    payrolls,
    stats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});



export const updatePayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const payroll = await Payroll.findById(id);

  if (!payroll) throw new ApiError(404, "Payroll nahi mili");

  if (payroll.status === "paid") {
    throw new ApiError(400, "Paid payroll badli nahi ja sakti");
  }

  const { bonus, otherDeduction, note } = req.body;

  if (bonus !== undefined) payroll.bonus = toMoney(bonus, "Bonus");

  if (otherDeduction !== undefined) {
    payroll.otherDeduction = toMoney(otherDeduction, "Other deduction");
  }

  if (note !== undefined) {
    if (String(note).length > 500) {
      throw new ApiError(400, "Note 500 akshar se zyada nahi ho sakta");
    }
    payroll.note = String(note).trim();
  }

  payroll.netSalary = calcNet(payroll);

  await payroll.save();

  const updated = await Payroll.findById(id)
    .populate("employee", EMPLOYEE_FIELDS)
    .lean();

  res.status(200).json({
    success: true,
    message: "Payroll update ho gayi",
    payroll: updated,
  });
});



export const markPayrollPaid = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const paymentMode = req.body.paymentMode || "bank_transfer";

  if (!PAYMENT_MODES.includes(paymentMode)) {
    throw new ApiError(400, "Invalid payment mode");
  }

  const payroll = await Payroll.findById(id);

  if (!payroll) throw new ApiError(404, "Payroll nahi mili");

  if (payroll.status === "paid") {
    throw new ApiError(400, "Ye payroll pehle hi paid hai");
  }

  payroll.status = "paid";
  payroll.paymentMode = paymentMode;
  payroll.paidAt = new Date();
  payroll.paidBy = req.user._id;

  await payroll.save();

  const updated = await Payroll.findById(id)
    .populate("employee", EMPLOYEE_FIELDS)
    .lean();

  res.status(200).json({
    success: true,
    message: "Salary paid mark ho gayi",
    payroll: updated,
  });
});



export const deletePayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const payroll = await Payroll.findById(id);

  if (!payroll) throw new ApiError(404, "Payroll nahi mili");

  if (payroll.status === "paid") {
    throw new ApiError(400, "Paid payroll delete nahi ho sakti");
  }

  await payroll.deleteOne();

  res.status(200).json({
    success: true,
    message: "Payroll delete ho gayi",
  });
});


export const getMyPayrolls = asyncHandler(async (req, res) => {
  const payrolls = await Payroll.find({
    employee: req.user._id,
    status: "paid",
  })
    .sort({ month: -1 })
    .lean();

  const totalReceived = payrolls.reduce((sum, p) => sum + p.netSalary, 0);

  res.status(200).json({
    success: true,
    payrolls,
    summary: {
      count: payrolls.length,
      totalReceived: round2(totalReceived),
      latest: payrolls[0] || null,
    },
  });
});