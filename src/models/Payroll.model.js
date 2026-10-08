import mongoose from "mongoose";

const payrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },

    
    month: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
      index: true,
    },

    
    basicSalary: { type: Number, required: true, min: 0 },
    daysInMonth: { type: Number, required: true },

    presentDays: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    paidLeaveDays: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    unmarkedDays: { type: Number, default: 0 },

    perDaySalary: { type: Number, default: 0 },
    payableDays: { type: Number, default: 0 },
    attendanceDeduction: { type: Number, default: 0 },

    
    bonus: { type: Number, default: 0, min: 0 },
    otherDeduction: { type: Number, default: 0, min: 0 },
    note: { type: String, trim: true, default: "", maxlength: 500 },

    netSalary: { type: Number, default: 0, min: 0 },

    
    status: {
      type: String,
      enum: ["draft", "paid"],
      default: "draft",
      index: true,
    },

    paymentMode: {
      type: String,
      enum: ["cash", "bank_transfer", "upi", "cheque", ""],
      default: "",
    },

    paidAt: { type: Date, default: null },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);


payrollSchema.index({ employee: 1, month: 1 }, { unique: true });

export default mongoose.model("Payroll", payrollSchema);