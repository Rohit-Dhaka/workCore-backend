import mongoose from "mongoose";

import Expense, {
  EXPENSE_CATEGORIES,
  PAYMENT_MODES,
} from "../models/Expense.model.js";
import { ApiError, asyncHandler } from "../middlewares/error.middleware.js";

import {uploadToCloudinary,deleteFromCloudinary,} from "../utils/cloudinary.js";



const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const pad = (n) => String(n).padStart(2, "0");


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

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid expense id");
  }
};


const readFields = (body) => {
  const title = String(body.title || "").trim();

  if (title.length < 2 || title.length > 100) {
    throw new ApiError(400, "Title 2 se 100 akshar ka hona chahiye");
  }

  const amount = round2(body.amount);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    throw new ApiError(400, "Amount sahi bharo (0 se zyada)");
  }

  if (!EXPENSE_CATEGORIES.includes(body.category)) {
    throw new ApiError(400, "Invalid category");
  }

  const paymentMode = body.paymentMode || "cash";

  if (!PAYMENT_MODES.includes(paymentMode)) {
    throw new ApiError(400, "Invalid payment mode");
  }

  const date = toDateOnly(body.date);

  if (date > todayIST()) {
    throw new ApiError(400, "Aane wali date ka kharcha nahi jod sakte");
  }

  const vendor = String(body.vendor || "").trim();
  const note = String(body.note || "").trim();

  if (vendor.length > 100) {
    throw new ApiError(400, "Vendor 100 akshar se zyada nahi ho sakta");
  }

  if (note.length > 500) {
    throw new ApiError(400, "Note 500 akshar se zyada nahi ho sakta");
  }

  return {
    title,
    amount,
    category: body.category,
    paymentMode,
    date,
    vendor,
    note,
  };
};

const buildFilter = (query) => {
  const { from, to, category, paymentMode, search } = query;
  const filter = {};

  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = toDateOnly(from);
    if (to) filter.date.$lte = toDateOnly(to);
  }

  if (EXPENSE_CATEGORIES.includes(category)) filter.category = category;
  if (PAYMENT_MODES.includes(paymentMode)) filter.paymentMode = paymentMode;

  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [{ title: regex }, { vendor: regex }, { note: regex }];
  }

  return filter;
};



export const createExpense = asyncHandler(async (req, res) => {
  const data = readFields(req.body);

  let receipt = { url: "", publicId: "" };

  if (req.file) {
    receipt = await uploadToCloudinary(req.file.buffer, "erp/expenses");
  }

  const expense = await Expense.create({
    ...data,
    receipt,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: "Kharcha jud gaya",
    expense,
  });
});



export const getExpenses = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);

  const filter = buildFilter(req.query);

  const [expenses, total, groups] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    Expense.countDocuments(filter),

    
    Expense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const byCategory = groups.map((g) => ({
    category: g._id,
    total: round2(g.total),
    count: g.count,
  }));

  const summary = {
    total: round2(byCategory.reduce((sum, g) => sum + g.total, 0)),
    count: byCategory.reduce((sum, g) => sum + g.count, 0),
    byCategory,
  };

  res.status(200).json({
    success: true,
    expenses,
    summary,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});


export const getExpenseTrend = asyncHandler(async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 12);

  const today = todayIST();

  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (months - 1), 1)
  );

  const rows = await Expense.aggregate([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$date" } },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const map = Object.fromEntries(rows.map((r) => [r._id, r.total]));

  
  const trend = Array.from({ length: months }, (_, i) => {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)
    );

    const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

    return { month: key, total: round2(map[key] || 0) };
  });

  res.status(200).json({ success: true, trend });
});



export const updateExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const expense = await Expense.findById(id);

  if (!expense) throw new ApiError(404, "Kharcha nahi mila");

  const data = readFields(req.body);

  Object.assign(expense, data);

  let oldPublicId = "";

  if (req.file) {
    
    oldPublicId = expense.receipt?.publicId;
    expense.receipt = await uploadToCloudinary(req.file.buffer, "erp/expenses");
  } else if (req.body.removeReceipt === "true") {
    
    oldPublicId = expense.receipt?.publicId;
    expense.receipt = { url: "", publicId: "" };
  }

  await expense.save();

  
  if (oldPublicId) await deleteFromCloudinary(oldPublicId);

  res.status(200).json({
    success: true,
    message: "Kharcha update ho gaya",
    expense,
  });
});



export const deleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkId(id);

  const expense = await Expense.findById(id);

  if (!expense) throw new ApiError(404, "Kharcha nahi mila");

  const publicId = expense.receipt?.publicId;

  await expense.deleteOne();

  if (publicId) await deleteFromCloudinary(publicId);

  res.status(200).json({
    success: true,
    message: "Kharcha delete ho gaya",
  });
});