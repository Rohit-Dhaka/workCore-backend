import mongoose from "mongoose";
import { ROLES } from "../types/auth.types.js";

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String, required: true, select: false },

    mobile: { type: String, trim: true, default: "" },

    gender: {
      type: String,
      enum: ["male", "female", "other", ""],
      default: "",
    },

    dob: { type: Date, default: null },

    
    profileImage: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
    },

    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.EMPLOYEE,
    },

    isActive: { type: Boolean, default: true }, 
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);