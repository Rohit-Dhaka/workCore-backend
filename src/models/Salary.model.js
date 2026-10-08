import mongoose from "mongoose";

const salarySchema = new mongoose.Schema(
  {
   

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Employee ID is required"],
      index: true,
    },

  

    month: {
      type: Number,
      required: [true, "Salary month is required"],
      min: [1, "Month must be between 1 and 12"],
      max: [12, "Month must be between 1 and 12"],
    },

    year: {
      type: Number,
      required: [true, "Salary year is required"],
      min: [2000, "Invalid salary year"],
    },

  

    basicSalary: {
      type: Number,
      required: [true, "Basic salary is required"],
      min: [0, "Basic salary cannot be negative"],
    },

    

    allowances: {
      type: Number,
      default: 0,
      min: [0, "Allowances cannot be negative"],
    },

    bonus: {
      type: Number,
      default: 0,
      min: [0, "Bonus cannot be negative"],
    },

    overtimeAmount: {
      type: Number,
      default: 0,
      min: [0, "Overtime amount cannot be negative"],
    },


    deductions: {
      type: Number,
      default: 0,
      min: [0, "Deductions cannot be negative"],
    },

    attendanceDeduction: {
      type: Number,
      default: 0,
      min: [0, "Attendance deduction cannot be negative"],
    },



    grossSalary: {
      type: Number,
      default: 0,
      min: [0, "Gross salary cannot be negative"],
    },

    netSalary: {
      type: Number,
      default: 0,
      min: [0, "Net salary cannot be negative"],
    },

  

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "partial"],
      default: "pending",
      index: true,
    },

 

    paidAmount: {
      type: Number,
      default: 0,
      min: [0, "Paid amount cannot be negative"],
    },

    paymentDate: {
      type: Date,
      default: null,
    },

    paymentMethod: {
      type: String,
      enum: [
        "cash",
        "bank_transfer",
        "upi",
        "cheque",
        "other",
        null,
      ],
      default: null,
    },



    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
      default: "",
    },


    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Created by is required"],
    },
  },
  {
    timestamps: true,
  }
);



salarySchema.index(
  {
    employeeId: 1,
    month: 1,
    year: 1,
  },
  {
    unique: true,
  }
);



const Salary = mongoose.model("Salary", salarySchema);

export default Salary;