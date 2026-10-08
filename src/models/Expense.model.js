import mongoose from "mongoose";

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Internet",
  "Travel",
  "Food",
  "Office Supplies",
  "Maintenance",
  "Marketing",
  "Other",
];

export const PAYMENT_MODES = ["cash", "bank_transfer", "upi", "card", "cheque"];

const expenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0.01 },

    
    date: { type: Date, required: true, index: true },

    paymentMode: {
      type: String,
      enum: PAYMENT_MODES,
      default: "cash",
    },

    vendor: { type: String, trim: true, default: "", maxlength: 100 },
    note: { type: String, trim: true, default: "", maxlength: 500 },

    
    receipt: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1, createdAt: -1 });

export default mongoose.model("Expense", expenseSchema);