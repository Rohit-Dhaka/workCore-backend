import mongoose from "mongoose";

const calendarSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    type: {
      type: String,
      enum: [
        "Holiday",
        "Meeting",
        "Event",
        "Birthday",
        "Anniversary",
        "Training",
        "Interview",
        "Performance Review",
        "Payroll",
        "Deadline",
        "Leave",
        "Other",
      ],
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
    
    },

    allDay: {
      type: Boolean,
      default: false,
    },

    location: {
      type: String,
      trim: true,
      default: "",
    },

    meetingLink: {
      type: String,
      trim: true,
      default: "",
    },

    audience: {
      type: String,
      enum: [
        "Everyone",
        "Department",
        "Team",
        "Selected Employees",
      ],
      default: "Everyone",
    },


    employees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
      },
    ],

    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },

    reminder: {
      type: String,
      enum: [
        "None",
        "10 Minutes Before",
        "30 Minutes Before",
        "1 Hour Before",
        "1 Day Before",
      ],
      default: "None",
    },

    repeat: {
      type: String,
      enum: [
        "Never",
        "Daily",
        "Weekly",
        "Monthly",
        "Yearly",
      ],
      default: "Never",
    },

    status: {
      type: String,
      enum: ["Active", "Cancelled"],
      default: "Active",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

calendarSchema.index({
  startDate: 1,
  endDate: 1,
});

calendarSchema.index({
  type: 1,
});

const Calendar = mongoose.model("Calendar", calendarSchema);

export default Calendar;