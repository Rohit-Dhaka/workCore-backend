import crypto from "crypto";
import mongoose from "mongoose";

import {
  BUDGET_STATUSES,
  PRICING_TYPES,
  PROJECT_PRIORITIES,
  QUOTATION_STATUSES,
  SERVICE_CATEGORIES,
  cleanList,
  round2,
} from "../utils/quotationConstants.js";

const { Schema } = mongoose;



const itemSchema = new Schema(
  {
    service: { type: Schema.Types.ObjectId, ref: "Service", default: null },

    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
    },
    category: {
      type: String,
      enum: SERVICE_CATEGORIES,
      default: "Other Services",
    },
    description: { type: String, trim: true, default: "" },
    details: { type: String, trim: true, default: "" },
    features: { type: [String], default: [] },
    deliverables: { type: [String], default: [] },

    pricingType: { type: String, enum: PRICING_TYPES, default: "One Time" },
    quantity: { type: Number, min: 0, default: 1 },
    unit: { type: String, trim: true, default: "Nos" },
    rate: { type: Number, min: 0, default: 0 },

    discountType: {
      type: String,
      enum: ["Amount", "Percent"],
      default: "Amount",
    },
    discount: { type: Number, min: 0, default: 0 },
    taxRate: { type: Number, min: 0, max: 100, default: 0 },

    timeline: { type: String, trim: true, default: "" },
    revisions: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true, default: "" },

    
    subtotal: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: true },
);



const milestoneSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, "Milestone title is required"],
      trim: true,
    },
    description: { type: String, trim: true, default: "" },
    durationDays: { type: Number, min: 0, default: 0 },
  },
  { _id: true },
);

const paymentMilestoneSchema = new Schema(
  {
    label: {
      type: String,
      required: [true, "Payment milestone label is required"],
      trim: true,
    },
    percent: {
      type: Number,
      required: [true, "Payment milestone percent is required"],
      min: 0,
      max: 100,
    },
  },
  { _id: false },
);

const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: QUOTATION_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, default: "" },
  },
  { _id: false },
);



const quotationSchema = new Schema(
  {
    quotationNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    status: {
      type: String,
      enum: QUOTATION_STATUSES,
      default: "Draft",
      index: true,
    },

    issueDate: { type: Date, default: Date.now },
    validUntil: {
      type: Date,
      required: [true, "Valid until date is required"],
    },

    
    client: {
      name: {
        type: String,
        required: [true, "Client name is required"],
        trim: true,
      },
      companyName: { type: String, trim: true, default: "" },
      contactPerson: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      gstNumber: { type: String, trim: true, uppercase: true, default: "" },
      notes: { type: String, trim: true, default: "" },
    },

    
    project: {
      name: {
        type: String,
        required: [true, "Project name is required"],
        trim: true,
      },
      type: { type: String, trim: true, default: "" },
      description: { type: String, trim: true, default: "" },
      businessGoal: { type: String, trim: true, default: "" },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      duration: { type: String, trim: true, default: "" },
      priority: {
        type: String,
        enum: PROJECT_PRIORITIES,
        default: "Medium",
      },
    },

    
    budget: {
      min: { type: Number, min: 0, default: null },
      max: { type: Number, min: 0, default: null },
      status: {
        type: String,
        enum: BUDGET_STATUSES,
        default: "Not Specified",
      },
    },

    
    items: { type: [itemSchema], default: [] },

    totals: {
      subtotal: { type: Number, default: 0 },
      discountTotal: { type: Number, default: 0 },
      taxTotal: { type: Number, default: 0 },
      
      grandTotal: { type: Number, default: 0 },
      
      oneTimeTotal: { type: Number, default: 0 },
      recurringMonthly: { type: Number, default: 0 },
      recurringYearly: { type: Number, default: 0 },
    },

    
    deliverables: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    terms: { type: [String], default: [] },
    notes: { type: String, trim: true, default: "" },

    milestones: { type: [milestoneSchema], default: [] },

    paymentTerms: {
      name: { type: String, trim: true, default: "" },
      milestones: { type: [paymentMilestoneSchema], default: [] },
    },

    
    sentAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: "" },
    statusHistory: { type: [statusHistorySchema], default: [] },

    
    companySnapshot: { type: Schema.Types.Mixed, default: null },

    
    viewToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },

    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", default: null },
    duplicatedFrom: {
      type: Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
    },

    
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

quotationSchema.index({ status: 1, validUntil: 1 });
quotationSchema.index({ createdAt: -1 });



quotationSchema.pre("validate", function () {
  

  const totals = {
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 0,
    oneTimeTotal: 0,
    recurringMonthly: 0,
    recurringYearly: 0,
  };

  this.items.forEach((item) => {
    item.features = cleanList(item.features);
    item.deliverables = cleanList(item.deliverables);

    const subtotal = round2(item.quantity * item.rate);

    const rawDiscount =
      item.discountType === "Percent"
        ? (subtotal * Math.min(item.discount, 100)) / 100
        : item.discount;

    const discountAmount = round2(Math.min(rawDiscount, subtotal));

    
    const taxAmount = round2(
      ((subtotal - discountAmount) * item.taxRate) / 100,
    );

    const total = round2(subtotal - discountAmount + taxAmount);

    item.subtotal = subtotal;
    item.discountAmount = discountAmount;
    item.taxAmount = taxAmount;
    item.total = total;

    totals.subtotal += subtotal;
    totals.discountTotal += discountAmount;
    totals.taxTotal += taxAmount;
    totals.grandTotal += total;

    if (item.pricingType === "Monthly") totals.recurringMonthly += total;
    else if (item.pricingType === "Yearly") totals.recurringYearly += total;
    else totals.oneTimeTotal += total;
  });

  Object.keys(totals).forEach((key) => {
    totals[key] = round2(totals[key]);
  });

  this.totals = totals;

  

  this.deliverables = cleanList(this.deliverables);
  this.exclusions = cleanList(this.exclusions);
  this.terms = cleanList(this.terms);

  

  const { min, max } = this.budget;
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;

  let budgetStatus = "Not Specified";

  if (hasMin || hasMax) {
    if (hasMax && totals.oneTimeTotal > max) budgetStatus = "Above Budget";
    else if (hasMin && totals.oneTimeTotal < min) budgetStatus = "Below Budget";
    else budgetStatus = "Within Budget";
  }

  this.budget.status = budgetStatus;

  if (hasMin && hasMax && min > max) {
    this.invalidate("budget.min", "Budget minimum cannot be above maximum");
  }

  

  if (this.validUntil && this.issueDate && this.validUntil < this.issueDate) {
    this.invalidate(
      "validUntil",
      "Valid until date cannot be before issue date",
    );
  }

  const { startDate, endDate } = this.project;

  if (startDate && endDate && endDate < startDate) {
    this.invalidate(
      "project.endDate",
      "Project end date cannot be before start date",
    );
  }

  

  if (this.paymentTerms.milestones.length > 0) {
    const percent = this.paymentTerms.milestones.reduce(
      (sum, milestone) => sum + milestone.percent,
      0,
    );

    if (Math.abs(percent - 100) > 0.01) {
      this.invalidate(
        "paymentTerms",
        `Payment terms must total 100% (currently ${percent}%)`,
      );
    }
  }
});



quotationSchema.virtual("isExpired").get(function () {
  return (
    ["Sent", "Viewed"].includes(this.status) &&
    this.validUntil &&
    this.validUntil < new Date()
  );
});

const Quotation = mongoose.model("Quotation", quotationSchema);

export default Quotation;