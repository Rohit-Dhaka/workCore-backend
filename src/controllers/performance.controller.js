import mongoose from "mongoose";


import Performance from "../models/performance.model.js";

import Employee from "../models/Employee.model.js"; 

const STATUSES = ["Draft", "In Review", "Completed"];
const EMPLOYEE_VISIBLE = ["In Review", "Completed"];

const EMPLOYEE_FIELDS = "firstName lastName email designation profileImage";



const isAdmin = (req) => String(req.user?.role || "").toLowerCase() === "admin";

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (res, next, error) => {
  if (error?.name === "ValidationError") {
    const message = Object.values(error.errors)
      .map((item) => item.message)
      .join(", ");
    return fail(res, 400, message);
  }

  if (error?.code === 11000) {
    return fail(
      res,
      409,
      "Is employee ka is period ka review pehle se maujood hai",
    );
  }

  if (error?.name === "CastError") {
    return fail(res, 400, "Invalid value provided");
  }

  return next(error);
};


const toEmployeeView = (doc) => {
  const data = doc.toObject({ virtuals: true });

  if (data.status !== "Completed") {
    delete data.managerRating;
    delete data.managerFeedback;
  }

  return data;
};

const sameId = (a, b) => String(a?._id || a) === String(b?._id || b);



export const createPerformance = async (req, res, next) => {
  try {
    const { employee, period, periodType, kpis, goals, status } = req.body;

    if (!mongoose.isValidObjectId(employee)) {
      return fail(res, 400, "Valid employee is required");
    }

    const exists = await Employee.findById(employee).select("_id");

    if (!exists) return fail(res, 404, "Employee not found");

    if (status && !["Draft", "In Review"].includes(status)) {
      return fail(res, 400, "New review sirf Draft ya In Review ho sakta hai");
    }

    const performance = await Performance.create({
      employee,
      period: period?.trim(),
      periodType,
      kpis: Array.isArray(kpis) ? kpis : [],
      goals: Array.isArray(goals) ? goals : [],
      status: status || "Draft",
      createdBy: req.user._id,
      createdByModel: isAdmin(req) ? "User" : "Employee",
    });

    return res.status(201).json({
      success: true,
      message: "Performance review created successfully",
      data: { performance },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const getAllPerformance = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const filter = {};

    if (req.query.status && STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.period) filter.period = req.query.period;
    if (req.query.periodType) filter.periodType = req.query.periodType;

    if (req.query.employee) {
      if (!mongoose.isValidObjectId(req.query.employee)) {
        return fail(res, 400, "Invalid employee id");
      }
      filter.employee = req.query.employee;
    }

    const [performances, total] = await Promise.all([
      Performance.find(filter)
        .populate("employee", EMPLOYEE_FIELDS)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Performance.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        performances,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const getPerformanceSummary = async (req, res, next) => {
  try {
    const match = req.query.period ? { period: req.query.period } : {};

    const [byStatus, averages, topPerformers] = await Promise.all([
      Performance.aggregate([
        { $match: match },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Performance.aggregate([
        { $match: { ...match, status: "Completed" } },
        {
          $group: {
            _id: null,
            overall: { $avg: "$overallScore" },
            kpi: { $avg: "$kpiScore" },
            goal: { $avg: "$goalScore" },
          },
        },
      ]),
      Performance.find({ ...match, status: "Completed" })
        .sort({ overallScore: -1 })
        .limit(5)
        .select("employee period overallScore")
        .populate("employee", EMPLOYEE_FIELDS),
    ]);

    const counts = { Draft: 0, "In Review": 0, Completed: 0 };
    byStatus.forEach((item) => {
      counts[item._id] = item.count;
    });

    const avg = averages[0] || { overall: 0, kpi: 0, goal: 0 };

    return res.json({
      success: true,
      data: {
        total: counts.Draft + counts["In Review"] + counts.Completed,
        counts,
        averages: {
          overall: Math.round(avg.overall * 10) / 10,
          kpi: Math.round(avg.kpi * 10) / 10,
          goal: Math.round(avg.goal * 10) / 10,
        },
        topPerformers,
      },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const updatePerformance = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findById(id);

    if (!review) return fail(res, 404, "Performance review not found");

    const {
      period,
      periodType,
      kpis,
      goals,
      managerRating,
      managerFeedback,
      status,
    } = req.body;

    if (period !== undefined) review.period = String(period).trim();
    if (periodType !== undefined) review.periodType = periodType;

  
    if (Array.isArray(kpis)) review.kpis = kpis;
    if (Array.isArray(goals)) review.goals = goals;

    if (managerRating !== undefined) review.managerRating = Number(managerRating);
    if (managerFeedback !== undefined) {
      review.managerFeedback = String(managerFeedback).trim();
    }

    if (status !== undefined) {
      if (!STATUSES.includes(status)) return fail(res, 400, "Invalid status");
      review.status = status;
    }

    if (review.status === "Completed") {
      if (!(review.managerRating >= 1)) {
        return fail(res, 400, "Review complete karne ke liye manager rating (1-5) zaroori hai");
      }
      review.reviewDate = review.reviewDate || new Date();
    } else {
      review.reviewDate = null;
      review.acknowledgedAt = null;
    }

    await review.save();

    return res.json({
      success: true,
      message: "Performance review updated successfully",
      data: { performance: review },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const deletePerformance = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findByIdAndDelete(id);

    if (!review) return fail(res, 404, "Performance review not found");

    return res.json({
      success: true,
      message: "Performance review deleted successfully",
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const getPerformanceById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findById(id).populate(
      "employee",
      EMPLOYEE_FIELDS,
    );

    if (!review) return fail(res, 404, "Performance review not found");

    return res.json({ success: true, data: { performance: review } });
  } catch (error) {
    return handleError(res, next, error);
  }
};




export const getMyPerformance = async (req, res, next) => {
  try {
    const filter = {
      employee: req.user._id,
      status: { $in: EMPLOYEE_VISIBLE },
    };

    if (req.query.period) filter.period = req.query.period;

    const reviews = await Performance.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: { performances: reviews.map(toEmployeeView) },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const getMyPerformanceById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findOne({
      _id: id,
      employee: req.user._id,
      status: { $in: EMPLOYEE_VISIBLE },
    });

    if (!review) return fail(res, 404, "Performance review not found");

    return res.json({
      success: true,
      data: { performance: toEmployeeView(review) },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const submitSelfReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findOne({
      _id: id,
      employee: req.user._id,
    });

    if (!review || !EMPLOYEE_VISIBLE.includes(review.status)) {
      return fail(res, 404, "Performance review not found");
    }

    if (review.status !== "In Review") {
      return fail(res, 400, "Self review sirf In Review status me submit ho sakta hai");
    }

    const { selfRating, selfComment, goals } = req.body;

    if (selfRating !== undefined) {
      const rating = Number(selfRating);

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return fail(res, 400, "Self rating 1 se 5 ke beech honi chahiye");
      }

      review.selfRating = rating;
    }

    if (selfComment !== undefined) {
      review.selfComment = String(selfComment).trim().slice(0, 1000);
    }

    
    if (Array.isArray(goals)) {
      goals.forEach(({ _id, progress }) => {
        const goal = review.goals.id(_id);
        const value = Number(progress);

        if (goal && progress !== undefined && !Number.isNaN(value)) {
          goal.progress = Math.min(Math.max(value, 0), goal.target);
        }
      });
    }

    review.selfSubmittedAt = new Date();

    await review.save();

    return res.json({
      success: true,
      message: "Self review submitted successfully",
      data: { performance: toEmployeeView(review) },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const acknowledgeReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) return fail(res, 400, "Invalid id");

    const review = await Performance.findOne({
      _id: id,
      employee: req.user._id,
    });

    if (!review || !sameId(review.employee, req.user._id)) {
      return fail(res, 404, "Performance review not found");
    }

    if (review.status !== "Completed") {
      return fail(res, 400, "Sirf Completed review acknowledge ho sakta hai");
    }

    review.acknowledgedAt = review.acknowledgedAt || new Date();

    await review.save();

    return res.json({
      success: true,
      message: "Review acknowledged",
      data: { performance: toEmployeeView(review) },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};