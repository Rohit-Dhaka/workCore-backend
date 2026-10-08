import mongoose from "mongoose";

const supportTicketSchema = new mongoose.Schema(
  {
  

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },



    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
      minlength: [5, "Subject must be at least 5 characters"],
      maxlength: [150, "Subject cannot exceed 150 characters"],
    },

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: ["IT Support", "HR", "Finance", "Payroll", "Other"],
        message: "Invalid ticket category",
      },
    },

    priority: {
      type: String,
      required: true,
      enum: {
        values: ["Low", "Medium", "High", "Urgent"],
        message: "Invalid ticket priority",
      },
      default: "Medium",
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: [10, "Description must be at least 10 characters"],
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },



    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved", "Closed"],
      default: "Open",
      index: true,
    },

  

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
      index: true,
    },

  

    adminNote: {
      type: String,
      trim: true,
      default: "",
      maxlength: [2000, "Admin note cannot exceed 2000 characters"],
    },



    resolvedAt: {
      type: Date,
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);



supportTicketSchema.index({
  employee: 1,
  createdAt: -1,
});

supportTicketSchema.index({
  status: 1,
  priority: 1,
  createdAt: -1,
});

export default mongoose.model("SupportTicket", supportTicketSchema);