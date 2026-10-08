import mongoose from "mongoose";


const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    type: {
      type: String,
      enum: ["raw_material", "finished_goods", "wip", "general"],
      default: "general",
    },
    location: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const Warehouse = mongoose.model("Warehouse", warehouseSchema);

export default Warehouse;