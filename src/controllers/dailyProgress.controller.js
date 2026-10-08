import DailyProgress from "../models/dailyProgress.model.js";

import {
  getTodayProgressService,
  getOrCreateTodayProgressService,
  getWeeklyProgressService,
  getAllProgressService,
} from "../services/dailyProgress.service.js";




export const getTodayProgress = async (req, res) => {
  try {
    const employeeId = req.user._id;

    let progress =
      await getTodayProgressService(employeeId);

    if (!progress) {
      progress =
        await getOrCreateTodayProgressService(employeeId);
    }

    return res.status(200).json({
      success: true,
      message: "Today's progress fetched successfully",
      data: progress,
    });
  } catch (error) {
    console.error(
      "getTodayProgress error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch today's progress",
    });
  }
};




export const saveProgressSlot = async (req, res) => {
  try {
    const employeeId = req.user._id;

    const {
      slot,
      work,
      achievements,
      blockers,
      hours,
    } = req.body;

    const validSlots = [
      "morning",
      "afternoon",
      "evening",
    ];

    if (!validSlots.includes(slot)) {
      return res.status(400).json({
        success: false,
        message: "Invalid progress slot",
      });
    }

    let progress =
      await getOrCreateTodayProgressService(
        employeeId
      );

    
    if (progress.status === "submitted") {
      return res.status(403).json({
        success: false,
        message:
          "Daily progress has already been submitted and is locked.",
      });
    }

    progress[slot] = {
      work: work || "",
      achievements: achievements || "",
      blockers: blockers || "",
      hours: Number(hours || 0),
      savedAt: new Date(),
    };

    await progress.save();

    return res.status(200).json({
      success: true,
      message: `${slot} progress saved successfully`,
      data: progress,
    });
  } catch (error) {
    console.error(
      "saveProgressSlot error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to save progress",
    });
  }
};




export const submitDailyProgress = async (
  req,
  res
) => {
  try {
    const employeeId = req.user._id;

    const progress =
      await DailyProgress.findOne({
        employee: employeeId,
        date: {
          $gte: new Date(
            new Date().setHours(0, 0, 0, 0)
          ),
          $lte: new Date(
            new Date().setHours(23, 59, 59, 999)
          ),
        },
      });

    if (!progress) {
      return res.status(404).json({
        success: false,
        message:
          "Today's progress not found",
      });
    }

    if (progress.status === "submitted") {
      return res.status(400).json({
        success: false,
        message:
          "Daily progress has already been submitted.",
      });
    }

 

    const hasProgress =
      progress.morning?.work ||
      progress.morning?.achievements ||
      progress.afternoon?.work ||
      progress.afternoon?.achievements ||
      progress.evening?.work ||
      progress.evening?.achievements;

    if (!hasProgress) {
      return res.status(400).json({
        success: false,
        message:
          "Please add some progress before submitting.",
      });
    }

    progress.status = "submitted";
    progress.submittedAt = new Date();

    await progress.save();

    return res.status(200).json({
      success: true,
      message:
        "Daily progress submitted successfully and locked.",
      data: progress,
    });
  } catch (error) {
    console.error(
      "submitDailyProgress error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to submit daily progress",
    });
  }
};




export const getEmployeeWeeklyProgress = async (
  req,
  res
) => {
  try {
    const employeeId = req.user._id;

    const {
      startDate,
      endDate,
    } = req.query;

    const progress =
      await getWeeklyProgressService(
        employeeId,
        startDate,
        endDate
      );

    return res.status(200).json({
      success: true,
      message:
        "Weekly progress fetched successfully",
      data: progress,
    });
  } catch (error) {
    console.error(
      "getEmployeeWeeklyProgress error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch weekly progress",
    });
  }
};




export const getAdminProgress = async (
  req,
  res
) => {
  try {
    const {
      employee,
      startDate,
      endDate,
      status,
    } = req.query;

    const progress =
      await getAllProgressService({
        employee,
        startDate,
        endDate,
        status,
      });

    return res.status(200).json({
      success: true,
      message:
        "Employee progress fetched successfully",
      data: progress,
    });
  } catch (error) {
    console.error(
      "getAdminProgress error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch employee progress",
    });
  }
};



export const getAdminWeeklyProgress = async (
  req,
  res
) => {
  try {
    const {
      employee,
      startDate,
      endDate,
    } = req.query;

    if (!employee) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const progress =
      await getWeeklyProgressService(
        employee,
        startDate,
        endDate
      );

    return res.status(200).json({
      success: true,
      message:
        "Employee weekly progress fetched successfully",
      data: progress,
    });
  } catch (error) {
    console.error(
      "getAdminWeeklyProgress error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch employee weekly progress",
    });
  }
};




export const getProgressSummary = async (
  req,
  res
) => {
  try {
    const {
      startDate,
      endDate,
    } = req.query;

    const progress =
      await getAllProgressService({
        startDate,
        endDate,
      });

    const total = progress.length;

    const submitted = progress.filter(
      (item) => item.status === "submitted"
    ).length;

    const draft = progress.filter(
      (item) => item.status === "draft"
    ).length;

    let totalHours = 0;

    progress.forEach((item) => {
      totalHours +=
        Number(item.morning?.hours || 0) +
        Number(item.afternoon?.hours || 0) +
        Number(item.evening?.hours || 0);
    });

    return res.status(200).json({
      success: true,
      message:
        "Progress summary fetched successfully",

      data: {
        total,
        submitted,
        draft,
        totalHours,
      },
    });
  } catch (error) {
    console.error(
      "getProgressSummary error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch progress summary",
    });
  }
};