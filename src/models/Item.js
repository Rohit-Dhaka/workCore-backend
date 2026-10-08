import mongoose from "mongoose";

export const UNITS = ["kg", "g", "ton", "ltr", "ml", "pcs", "mtr", "box", "set"];

const supplierLinkSchema = new mongoose.Schema(
  {
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    supplierSku: { type: String, trim: true },
    leadTimeDays: { type: Number, default: 0, min: 0 },
    lastPrice: { type: Number, default: 0, min: 0 },
    isPreferred: { type: Boolean, default: false },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ["raw", "finished"],
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: { type: String, trim: true },
    description: { type: String, trim: true },
    unit: { type: String, enum: UNITS, required: true },
    hsnCode: { type: String, trim: true },

    
    reorderLevel: { type: Number, default: 0, min: 0 },
    isBatchTracked: { type: Boolean, default: true },
    shelfLifeDays: { type: Number, default: 0, min: 0 },

    
    standardCost: { type: Number, default: 0, min: 0 }, 
    sellingPrice: { type: Number, default: 0, min: 0 },

    
    suppliers: [supplierLinkSchema],

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);


itemSchema.pre("validate", function () {
  if (this.itemType === "raw") this.sellingPrice = 0;
  if (this.itemType === "finished") this.suppliers = [];
  
});

itemSchema.index({ name: "text", sku: "text" });
itemSchema.index({ itemType: 1, isActive: 1 });

export default mongoose.model("Item", itemSchema);