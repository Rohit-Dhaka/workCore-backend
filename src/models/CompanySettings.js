import mongoose from "mongoose";

import {
  DEFAULT_EXCLUSIONS,
  DEFAULT_PAYMENT_TEMPLATES,
  DEFAULT_TERMS,
} from "../utils/quotationConstants.js";

const { Schema } = mongoose;



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
      min: [0, "Percent cannot be negative"],
      max: [100, "Percent cannot be more than 100"],
    },
  },
  { _id: false },
);

const paymentTemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Payment template name is required"],
      trim: true,
    },
    milestones: { type: [paymentMilestoneSchema], default: [] },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const socialLinkSchema = new Schema(
  {
    platform: {
      type: String,
      required: [true, "Social platform is required"],
      trim: true,
    },
    url: {
      type: String,
      required: [true, "Social link URL is required"],
      trim: true,
    },
  },
  { _id: false },
);



const companySettingsSchema = new Schema(
  {
    
    key: {
      type: String,
      default: "company",
      unique: true,
      immutable: true,
    },

    
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
    },
    logo: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },
    tagline: { type: String, trim: true, default: "" },
    about: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    gstNumber: { type: String, trim: true, uppercase: true, default: "" },
    socialLinks: { type: [socialLinkSchema], default: [] },

    
    defaultTaxRate: { type: Number, min: 0, max: 100, default: 18 },
    quotationPrefix: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: "QT",
    },
    
    quotationNumberFormat: {
      type: String,
      trim: true,
      default: "{PREFIX}-{YYYY}-{SEQ}",
    },
    sequencePadding: { type: Number, min: 1, max: 8, default: 3 },
    defaultValidityDays: { type: Number, min: 1, max: 365, default: 14 },

    paymentTemplates: {
      type: [paymentTemplateSchema],
      default: () => DEFAULT_PAYMENT_TEMPLATES.map((item) => ({ ...item })),
    },
    defaultTerms: { type: [String], default: () => [...DEFAULT_TERMS] },
    defaultExclusions: {
      type: [String],
      default: () => [...DEFAULT_EXCLUSIONS],
    },
    defaultNotes: {
      type: String,
      trim: true,
      default:
        "Final project scope will be confirmed after requirement discussion and approval.",
    },
    footerText: {
      type: String,
      trim: true,
      default: "Thank you for considering us for your project.",
    },

    
    bankDetails: {
      accountHolder: { type: String, trim: true, default: "" },
      bankName: { type: String, trim: true, default: "" },
      accountNumber: { type: String, trim: true, default: "" },
      ifscCode: { type: String, trim: true, uppercase: true, default: "" },
      branch: { type: String, trim: true, default: "" },
    },
    upiId: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);



companySettingsSchema.pre("validate", function () {
  if (!this.quotationNumberFormat.includes("{SEQ}")) {
    this.invalidate(
      "quotationNumberFormat",
      "Quotation number format must contain {SEQ}",
    );
  }

  this.defaultTerms = (this.defaultTerms || [])
    .map((item) => String(item).trim())
    .filter(Boolean);

  this.defaultExclusions = (this.defaultExclusions || [])
    .map((item) => String(item).trim())
    .filter(Boolean);

  this.paymentTemplates.forEach((template) => {
    const total = template.milestones.reduce(
      (sum, milestone) => sum + milestone.percent,
      0,
    );

    if (Math.abs(total - 100) > 0.01) {
      this.invalidate(
        "paymentTemplates",
        `Payment template "${template.name}" must total 100% (currently ${total}%)`,
      );
    }
  });

  
  const defaultIndex = this.paymentTemplates.findIndex((t) => t.isDefault);

  this.paymentTemplates.forEach((template, index) => {
    template.isDefault = index === defaultIndex;
  });
});



companySettingsSchema.statics.getSettings = async function () {
  return this.findOneAndUpdate(
    { key: "company" },
    {
      $setOnInsert: {
        key: "company",
        companyName: "Your Company Name",
        tagline: "Code. Design. Deliver.",
        about:
          "We build modern websites, software solutions, digital products and growth-focused digital experiences for businesses.",
        paymentTemplates: DEFAULT_PAYMENT_TEMPLATES,
        defaultTerms: DEFAULT_TERMS,
        defaultExclusions: DEFAULT_EXCLUSIONS,
      },
    },
    { new: true, upsert: true },
  );
};

const CompanySettings = mongoose.model(
  "CompanySettings",
  companySettingsSchema,
);

export default CompanySettings;