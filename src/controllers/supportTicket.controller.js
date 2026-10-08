import mongoose from "mongoose";

import SupportTicket from "../models/supportTicket.model.js";
import Employee from "../models/Employee.model.js";
import { validateCreateTicket } from "../validators/supportTicket.validator.js";
import { ApiError, asyncHandler } from "../middlewares/error.middleware.js";


const ASSIGNEE_FIELDS = "firstName lastName email designation profileImage";


export const createSupportTicket = async (req, res) => {
  try {
    const { subject, category, priority, description } = req.body;

    const validation = validateCreateTicket({
      subject,
      category,
      priority,
      description,
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    const ticket = await SupportTicket.create({
      employee: req.user._id,
      subject: subject.trim(),
      category,
      priority,
      description: description.trim(),
      status: "Open",
    });

    const populatedTicket = await SupportTicket.findById(ticket._id)
      .populate("employee", "firstName lastName email mobile designation")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      ticket: populatedTicket,
    });
  } catch (error) {
    console.error("Create Support Ticket Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create support ticket",
    });
  }
};


export const getMySupportTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({
      employee: req.user._id,
    })
      .populate("assignedTo", ASSIGNEE_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error("Get My Support Tickets Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch support tickets",
    });
  }
};



export const getMySupportTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await SupportTicket.findOne({
      _id: id,
      employee: req.user._id,
    })
      .populate("employee", "firstName lastName email mobile designation")
      .populate("assignedTo", ASSIGNEE_FIELDS)
      .lean();

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    return res.status(200).json({
      success: true,
      ticket,
    });
  } catch (error) {
    console.error("Get Support Ticket Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch support ticket",
    });
  }
};



const TICKET_STATUSES = ["Open", "In Progress", "Resolved", "Closed"];
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const TICKET_CATEGORIES = ["IT Support", "HR", "Finance", "Payroll", "Other"];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkTicketId = (id) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, "Invalid ticket id");
  }
};

const EMPLOYEE_FIELDS =
  "firstName lastName email mobile designation profileImage";



export const getAllSupportTickets = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 100);
  const { status, priority, category, assigned, search } = req.query;

  const filter = {};

  if (TICKET_STATUSES.includes(status)) filter.status = status;
  if (TICKET_PRIORITIES.includes(priority)) filter.priority = priority;
  if (TICKET_CATEGORIES.includes(category)) filter.category = category;

  
  if (assigned === "none") {
    filter.assignedTo = null;
  } else if (assigned && mongoose.isValidObjectId(assigned)) {
    filter.assignedTo = assigned;
  }

  
  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), "i");

    const matchedEmployees = await Employee.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    }).select("_id");

    filter.$or = [
      { subject: regex },
      { employee: { $in: matchedEmployees.map((e) => e._id) } },
    ];
  }

  const [tickets, total, statusCounts, urgentOpen] = await Promise.all([
    SupportTicket.find(filter)
      .populate("employee", EMPLOYEE_FIELDS)
      .populate("assignedTo", ASSIGNEE_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),

    SupportTicket.countDocuments(filter),

    
    SupportTicket.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    SupportTicket.countDocuments({
      priority: "Urgent",
      status: { $in: ["Open", "In Progress"] },
    }),
  ]);

  const stats = { total: 0, urgent: urgentOpen };
  TICKET_STATUSES.forEach((s) => (stats[s] = 0));
  statusCounts.forEach((row) => {
    stats[row._id] = row.count;
    stats.total += row.count;
  });

  res.status(200).json({
    success: true,
    tickets,
    stats,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});



export const getSupportTicketById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkTicketId(id);

  const ticket = await SupportTicket.findById(id)
    .populate("employee", EMPLOYEE_FIELDS)
    .populate("assignedTo", ASSIGNEE_FIELDS)
    .lean();

  if (!ticket) {
    throw new ApiError(404, "Support ticket not found");
  }

  res.status(200).json({ success: true, ticket });
});



export const updateSupportTicket = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkTicketId(id);

  const ticket = await SupportTicket.findById(id);

  if (!ticket) {
    throw new ApiError(404, "Support ticket not found");
  }

  const { status, priority, adminNote, assignedTo } = req.body;

  
  if (priority !== undefined) {
    if (!TICKET_PRIORITIES.includes(priority)) {
      throw new ApiError(400, "Invalid ticket priority");
    }
    ticket.priority = priority;
  }

  
  if (adminNote !== undefined) {
    if (String(adminNote).length > 2000) {
      throw new ApiError(400, "Admin note cannot exceed 2000 characters");
    }
    ticket.adminNote = String(adminNote).trim();
  }

  
  if (assignedTo !== undefined) {
    if (assignedTo === "none" || assignedTo === null || assignedTo === "") {
      ticket.assignedTo = null;
    } else {
      if (!mongoose.isValidObjectId(assignedTo)) {
        throw new ApiError(400, "Invalid employee id");
      }

      const assignee = await Employee.findOne({
        _id: assignedTo,
        isDeleted: false,
      });

      if (!assignee) {
        throw new ApiError(404, "Employee not found");
      }

      if (!assignee.isActive) {
        throw new ApiError(400, "Inactive employee ko assign nahi kar sakte");
      }

      ticket.assignedTo = assignee._id;
    }
  }

  
  if (status !== undefined) {
    if (!TICKET_STATUSES.includes(status)) {
      throw new ApiError(400, "Invalid ticket status");
    }

    ticket.status = status;

    if (status === "Open" || status === "In Progress") {
      
      ticket.resolvedAt = null;
      ticket.closedAt = null;
    }

    if (status === "Resolved") {
      ticket.resolvedAt = ticket.resolvedAt || new Date();
      ticket.closedAt = null;
    }

    if (status === "Closed") {
      ticket.resolvedAt = ticket.resolvedAt || new Date();
      ticket.closedAt = ticket.closedAt || new Date();
    }
  }

  await ticket.save();

  const updated = await SupportTicket.findById(id)
    .populate("employee", EMPLOYEE_FIELDS)
    .populate("assignedTo", ASSIGNEE_FIELDS)
    .lean();

  res.status(200).json({
    success: true,
    message: "Ticket updated successfully",
    ticket: updated,
  });
});



export const deleteSupportTicket = asyncHandler(async (req, res) => {
  const { id } = req.params;
  checkTicketId(id);

  const ticket = await SupportTicket.findByIdAndDelete(id);

  if (!ticket) {
    throw new ApiError(404, "Support ticket not found");
  }

  res.status(200).json({
    success: true,
    message: "Ticket deleted successfully",
  });
});