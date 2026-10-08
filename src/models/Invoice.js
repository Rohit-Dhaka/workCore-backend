import mongoose from "mongoose";

import { round2 } from "../utils/quotationConstants.js";

const { Schema } = mongoose;

const invoiceItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    pricingType: { type: String, default: "One Time" },
    quantity: { type: Number, default: 1 },
    unit: { type: String, default: "Nos" },
    rate: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: true },
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, trim: true },

    quotation: {
      type: Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["Unpaid", "Partially Paid", "Paid", "Cancelled"],
      default: "Unpaid",
      index: true,
    },

    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, default: null },

    client: {
      name: { type: String, trim: true, default: "" },      
      contactPerson: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },      
      
    },

    project: {
      name: { type: String, trim: true, default: "" },
      description: { type: String, trim: true, default: "" },
    },

    items: { type: [invoiceItemSchema], default: [] },

    totals: {
      subtotal: { type: Number, default: 0 },
      discountTotal: { type: Number, default: 0 },
      taxTotal: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
      oneTimeTotal: { type: Number, default: 0 },
      recurringMonthly: { type: Number, default: 0 },
      recurringYearly: { type: Number, default: 0 },
    },

    paymentTerms: {
      name: { type: String, default: "" },
      milestones: [
        {
          _id: false,
          label: { type: String },
          percent: { type: Number },
        },
      ],
    },

    terms: { type: [String], default: [] },
    notes: { type: String, trim: true, default: "" },

    amountPaid: { type: Number, min: 0, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

invoiceSchema.virtual("balanceDue").get(function () {
  return round2(this.totals.grandTotal - this.amountPaid);
});

const Invoice = mongoose.model("Invoice", invoiceSchema);

export default Invoice;