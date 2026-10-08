import mongoose from "mongoose";

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },

    leaveType: {
      type: String,
      enum: ["paid_leave", "unpaid_leave"],
      required: true,
    },

    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },

    days: { type: Number, required: true, min: 1 },

    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },

    reviewNote: { type: String, trim: true, default: "", maxlength: 500 },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

leaveSchema.index({ employee: 1, createdAt: -1 });
leaveSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Leave", leaveSchema);