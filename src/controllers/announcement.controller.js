import mongoose from "mongoose";

import Announcement from "../models/announcement.model.js";
import AnnouncementRead from "../models/announcementRead.model.js";

import { validateAnnouncement } from "../validators/announcement.validator.js";




export const createAnnouncement = async (req, res) => {
  try {
    const {
      title,
      content,
      type,
      priority,
      audience,
      department,
      expiresAt,
      isPublished,
    } = req.body;

    const validationError =
      validateAnnouncement(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const announcement =
      await Announcement.create({
        title: title.trim(),
        content: content.trim(),
        type: type || "general",
        priority: priority || "medium",
        audience: audience || "all",
        department: department || "",
        expiresAt: expiresAt || null,
        isPublished: Boolean(isPublished),
        publishedAt: isPublished
          ? new Date()
          : null,
        createdBy: req.user._id,
      });

    const populatedAnnouncement =
      await Announcement.findById(
        announcement._id
      ).populate(
        "createdBy",
        "firstName lastName email"
      );

    return res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: populatedAnnouncement,
    });
  } catch (error) {
    console.error(
      "Create announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create announcement",
      error: error.message,
    });
  }
};




export const getAllAnnouncements = async (
  req,
  res
) => {
  try {
    const {
      search,
      type,
      priority,
      audience,
      isPublished,
    } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        {
          title: {
            $regex: search,
            $options: "i",
          },
        },
        {
          content: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    if (type) {
      filter.type = type;
    }

    if (priority) {
      filter.priority = priority;
    }

    if (audience) {
      filter.audience = audience;
    }

    if (isPublished !== undefined) {
      filter.isPublished =
        isPublished === "true";
    }

    const announcements =
      await Announcement.find(filter)
        .populate(
          "createdBy",
          "firstName lastName email"
        )
        .sort({
          createdAt: -1,
        });

    return res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements,
    });
  } catch (error) {
    console.error(
      "Get announcements error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch announcements",
      error: error.message,
    });
  }
};




export const getEmployeeAnnouncements = async (
  req,
  res
) => {
  try {
    const employee = req.user;

    const now = new Date();

    const audienceConditions = [
      {
        audience: "all",
      },
    ];

    if (
      employee.role === "employee" ||
      employee.role === "manager"
    ) {
      audienceConditions.push({
        audience: "employees",
      });
    }

    if (
      employee.role === "admin" ||
      employee.role === "hr"
    ) {
      audienceConditions.push({
        audience: "admins",
      });
    }

    
    if (employee.department) {
      audienceConditions.push({
        audience: "employees",
        department: employee.department,
      });
    }

    const announcements =
      await Announcement.find({
        isPublished: true,

        $or: audienceConditions,

        $and: [
          {
            $or: [
              {
                expiresAt: null,
              },
              {
                expiresAt: {
                  $gte: now,
                },
              },
            ],
          },
        ],
      })
        .populate(
          "createdBy",
          "firstName lastName"
        )
        .sort({
          publishedAt: -1,
          createdAt: -1,
        });

    const announcementIds =
      announcements.map(
        (item) => item._id
      );

    const readRecords =
      await AnnouncementRead.find({
        employee: employee._id,
        announcement: {
          $in: announcementIds,
        },
      }).select("announcement");

    const readSet = new Set(
      readRecords.map((item) =>
        item.announcement.toString()
      )
    );

    const result = announcements.map(
      (announcement) => ({
        ...announcement.toObject(),

        isRead: readSet.has(
          announcement._id.toString()
        ),
      })
    );

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error(
      "Get employee announcements error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch your announcements",
      error: error.message,
    });
  }
};




export const getAnnouncementById = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    if (
      !mongoose.Types.ObjectId.isValid(id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid announcement ID",
      });
    }

    const announcement =
      await Announcement.findById(id)
        .populate(
          "createdBy",
          "firstName lastName email"
        );

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: announcement,
    });
  } catch (error) {
    console.error(
      "Get announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch announcement",
      error: error.message,
    });
  }
};




export const updateAnnouncement = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const validationError =
      validateAnnouncement(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const {
      title,
      content,
      type,
      priority,
      audience,
      department,
      expiresAt,
      isPublished,
    } = req.body;

    const announcement =
      await Announcement.findById(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    announcement.title = title.trim();
    announcement.content = content.trim();
    announcement.type =
      type || "general";
    announcement.priority =
      priority || "medium";
    announcement.audience =
      audience || "all";
    announcement.department =
      department || "";
    announcement.expiresAt =
      expiresAt || null;

    if (
      Boolean(isPublished) &&
      !announcement.isPublished
    ) {
      announcement.publishedAt =
        new Date();
    }

    if (!Boolean(isPublished)) {
      announcement.publishedAt = null;
    }

    announcement.isPublished =
      Boolean(isPublished);

    await announcement.save();

    const updated =
      await Announcement.findById(id)
        .populate(
          "createdBy",
          "firstName lastName email"
        );

    return res.status(200).json({
      success: true,
      message:
        "Announcement updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error(
      "Update announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update announcement",
      error: error.message,
    });
  }
};




export const deleteAnnouncement = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const announcement =
      await Announcement.findById(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    await AnnouncementRead.deleteMany({
      announcement: id,
    });

    await Announcement.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message:
        "Announcement deleted successfully",
    });
  } catch (error) {
    console.error(
      "Delete announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to delete announcement",
      error: error.message,
    });
  }
};




export const toggleAnnouncementPublish =
  async (req, res) => {
    try {
      const { id } = req.params;

      const announcement =
        await Announcement.findById(id);

      if (!announcement) {
        return res.status(404).json({
          success: false,
          message:
            "Announcement not found",
        });
      }

      announcement.isPublished =
        !announcement.isPublished;

      announcement.publishedAt =
        announcement.isPublished
          ? new Date()
          : null;

      await announcement.save();

      return res.status(200).json({
        success: true,
        message:
          announcement.isPublished
            ? "Announcement published"
            : "Announcement unpublished",
        data: announcement,
      });
    } catch (error) {
      console.error(
        "Toggle publish error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update publish status",
        error: error.message,
      });
    }
  };




export const markAnnouncementAsRead =
  async (req, res) => {
    try {
      const { id } = req.params;

      const announcement =
        await Announcement.findById(id);

      if (!announcement) {
        return res.status(404).json({
          success: false,
          message:
            "Announcement not found",
        });
      }

      await AnnouncementRead.findOneAndUpdate(
        {
          announcement: id,
          employee: req.user._id,
        },
        {
          announcement: id,
          employee: req.user._id,
          readAt: new Date(),
        },
        {
          upsert: true,
          new: true,
        }
      );

      return res.status(200).json({
        success: true,
        message:
          "Announcement marked as read",
      });
    } catch (error) {
      console.error(
        "Mark announcement read error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to mark announcement as read",
        error: error.message,
      });
    }
  };




export const getAnnouncementReadStats =
  async (req, res) => {
    try {
      const { id } = req.params;

      const totalEmployees =
        await AnnouncementRead.countDocuments({
          announcement: id,
        });

      return res.status(200).json({
        success: true,
        data: {
          readCount: totalEmployees,
        },
      });
    } catch (error) {
      console.error(
        "Read stats error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch read statistics",
        error: error.message,
      });
    }
  };