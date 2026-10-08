import Calendar from "../models/calendar.model.js";

const getUserId = (req) => {
  return req.user?._id || req.user?.id || req.user?.userId;
};

export const createCalendarEvent = async (req, res) => {
  try {
    const userId = getUserId(req);

    const {
      title,
      description,
      type,
      startDate,
      endDate,
      allDay,
      location,
      meetingLink,
      audience,
      department,
      team,
      employees,
      priority,
      reminder,
      repeat,
    } = req.body;

    if (!title || !type || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Title, type, start date and end date are required",
      });
    }

    const event = await Calendar.create({
      title,
      description,
      type,
      startDate,
      endDate,
      allDay,
      location,
      meetingLink,
      audience,
      department: audience === "Department" ? department : null,
      team: audience === "Team" ? team : null,
      employees:
        audience === "Selected Employees" ? employees || [] : [],
      priority,
      reminder,
      repeat,
      createdBy: userId,
    });

    const populatedEvent = await Calendar.findById(event._id)
      .populate("createdBy", "firstName lastName email")            
      .populate("employees", "firstName lastName email");

    return res.status(201).json({
      success: true,
      message: "Calendar event created successfully",
      event: populatedEvent,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCalendarEvents = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      type,
      status = "Active",
    } = req.query;

    const query = {
      status,
    };

    if (type) {
      query.type = type;
    }

    if (startDate && endDate) {
      query.startDate = {
        $lte: new Date(endDate),
      };

      query.endDate = {
        $gte: new Date(startDate),
      };
    }

    const events = await Calendar.find(query)
      .populate("createdBy", "firstName lastName email")            
      .populate("employees", "firstName lastName email")
      .sort({ startDate: 1 });

    return res.status(200).json({
      success: true,
      count: events.length,
      events,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCalendarEventById = async (req, res) => {
  try {
    const event = await Calendar.findById(req.params.id)
      .populate("createdBy", "firstName lastName email")
      .populate("employees", "firstName lastName email");

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar event not found",
      });
    }

    return res.status(200).json({
      success: true,
      event,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateCalendarEvent = async (req, res) => {
  try {
    const event = await Calendar.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar event not found",
      });
    }

    const {
      title,
      description,
      type,
      startDate,
      endDate,
      allDay,
      location,
      meetingLink,
      audience,      
      team,
      employees,
      priority,
      reminder,
      repeat,
      status,
    } = req.body;

    event.title = title ?? event.title;
    event.description = description ?? event.description;
    event.type = type ?? event.type;
    event.startDate = startDate ?? event.startDate;
    event.endDate = endDate ?? event.endDate;
    event.allDay = allDay ?? event.allDay;
    event.location = location ?? event.location;
    event.meetingLink = meetingLink ?? event.meetingLink;
    event.audience = audience ?? event.audience;

    if (audience === "Department") {
      event.department = department || null;
      event.team = null;
      event.employees = [];
    } else if (audience === "Team") {
      event.department = null;
      event.team = team || null;
      event.employees = [];
    } else if (audience === "Selected Employees") {
      event.department = null;
      event.team = null;
      event.employees = employees || [];
    } else if (audience === "Everyone") {
      event.department = null;
      event.team = null;
      event.employees = [];
    }

    event.priority = priority ?? event.priority;
    event.reminder = reminder ?? event.reminder;
    event.repeat = repeat ?? event.repeat;
    event.status = status ?? event.status;

    await event.save();

    const updatedEvent = await Calendar.findById(event._id)
      .populate("createdBy", "firstName lastName email")
      .populate("department", "name")
      .populate("team", "name")
      .populate("employees", "firstName lastName email");

    return res.status(200).json({
      success: true,
      message: "Calendar event updated successfully",
      event: updatedEvent,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteCalendarEvent = async (req, res) => {
  try {
    const event = await Calendar.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Calendar event not found",
      });
    }

    await Calendar.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Calendar event deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};