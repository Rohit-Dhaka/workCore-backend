import mongoose from "mongoose";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
];

export const LEAD_SOURCES = [
  "website",
  "referral",
  "social_media",
  "cold_call",
  "email",
  "event",
  "other",
];

const followUpSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    type: {
      type: String,
      enum: ["call", "email", "meeting", "whatsapp", "other"],
      default: "call",
    },
    note: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["pending", "done"], default: "pending" },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    source: { type: String, enum: LEAD_SOURCES, default: "other" },
    serviceInterest: { type: String, trim: true, default: "" },
    budget: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    lostReason: { type: String, trim: true, default: "" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    notes: [noteSchema],
    followUps: [followUpSchema],
    quotations: [{ type: mongoose.Schema.Types.ObjectId, ref: "Quotation" }],
    convertedClient: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    convertedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

leadSchema.index({ name: "text", company: "text", email: "text" });
leadSchema.index({ status: 1, createdAt: -1 });

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    gstNumber: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    quotations: [{ type: mongoose.Schema.Types.ObjectId, ref: "Quotation" }],
    notes: [noteSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

clientSchema.index({ name: "text", company: "text", email: "text" });

export const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
export const Client =
  mongoose.models.Client || mongoose.model("Client", clientSchema);