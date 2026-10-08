import mongoose from "mongoose";

import {
  PRICING_TYPES,
  SERVICE_CATEGORIES,
  cleanList,
} from "../utils/quotationConstants.js";

const { Schema } = mongoose;


const serviceSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
    },
    category: {
      type: String,
      enum: { values: SERVICE_CATEGORIES, message: "Invalid service category" },
      required: [true, "Service category is required"],
      index: true,
    },
    description: { type: String, trim: true, default: "" },
    details: { type: String, trim: true, default: "" },

    defaultPrice: { type: Number, min: 0, default: 0 },
    pricingType: {
      type: String,
      enum: { values: PRICING_TYPES, message: "Invalid pricing type" },
      default: "One Time",
    },
    

    
    taxRate: { type: Number, min: 0, max: 100, default: null },

    defaultTimeline: { type: String, trim: true, default: "" },
    defaultRevisions: { type: Number, min: 0, default: 0 },

    defaultFeatures: { type: [String], default: [] },
    defaultDeliverables: { type: [String], default: [] },
    defaultExclusions: { type: [String], default: [] },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);


serviceSchema.index({ category: 1, name: 1 }, { unique: true });

serviceSchema.pre("validate", function () {
  this.defaultFeatures = cleanList(this.defaultFeatures);
  this.defaultDeliverables = cleanList(this.defaultDeliverables);
  this.defaultExclusions = cleanList(this.defaultExclusions);
});

const Service = mongoose.model("Service", serviceSchema);

export default Service;