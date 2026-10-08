import mongoose from "mongoose";
import { GENDERS } from "../types/employee.types.js";

const employeeSchema = new mongoose.Schema(
  {

    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    mobile: {
      type: String,
      required: true,
      trim: true,
    },

    gender: {
      type: String,
      enum: GENDERS,
      required: true,
    },

    dob: {
      type: Date,
      required: true,
    },


   email: {
  type: String,
  required: true,
  unique: true,
  lowercase: true,
  trim: true,
},

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    role: {
      type: String,
      enum: ["employee", "admin"],
      default: "employee",
      required: true,
    },


    profileImage: {
      url: {
        type: String,
        default: "",
      },

      publicId: {
        type: String,
        default: "",
      },
    },


    designation: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    basicSalary: {
      type: Number,
      default: 0,
      min: 0,
    },


    remark: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },


    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;
