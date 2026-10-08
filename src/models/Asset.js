import mongoose from "mongoose";

const assignmentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    assignedAt: { type: Date, default: Date.now },
    returnedAt: { type: Date },
    conditionOnAssign: { type: String, trim: true },
    conditionOnReturn: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { _id: true }
);

const assetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    assetCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    category: {
      type: String,
      enum: [
        "laptop",
        "desktop",
        "mobile",
        "tablet",
        "monitor",
        "accessory",
        "furniture",
        "id_card",
        "other",
      ],
      default: "other",
    },

    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    serialNumber: { type: String, trim: true },

    purchaseDate: { type: Date },
    purchasePrice: { type: Number, min: 0, default: 0 },
    warrantyUntil: { type: Date },

    condition: {
      type: String,
      enum: ["new", "good", "fair", "poor"],
      default: "good",
    },

    status: {
      type: String,
      enum: ["available", "assigned", "under_repair", "retired"],
      default: "available",
      index: true,
    },

    
    currentHolder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
      index: true,
    },

    
    assignments: [assignmentSchema],

    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

assetSchema.index({ name: "text", assetCode: "text", serialNumber: "text" });

export default mongoose.model("Asset", assetSchema);