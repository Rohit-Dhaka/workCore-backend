import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {


    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Employee ID is required"],
      index: true,
    },


    date: {
      type: Date,
      required: [true, "Attendance date is required"],
      index: true,
    },

  

    status: {
      type: String,
      enum: [
        "present",
        "half_day",
        "absent",
        "paid_leave",
        "unpaid_leave",
        "work_from_home",
        "holiday",
      ],
      required: [true, "Attendance status is required"],
    },



    checkIn: {
      type: Date,
      default: null,
    },

    checkOut: {
      type: Date,
      default: null,
    },



    workingHours: {
      type: Number,
      default: 0,
      min: 0,
    },

    

    note: {
      type: String,
      trim: true,
      maxlength: [500, "Note cannot exceed 500 characters"],
      default: "",
    },



    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Marked by is required"],
    },
  },
  {
    timestamps: true,
  }
);



attendanceSchema.index(
  {
    employeeId: 1,
    date: 1,
  },
  {
    unique: true,
  }
);

const Attendance = mongoose.model(
  "Attendance",
  attendanceSchema
);

export default Attendance;