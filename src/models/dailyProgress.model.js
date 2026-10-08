import mongoose from "mongoose";

const progressSlotSchema = new mongoose.Schema(
  {
    work: {
      type: String,
      trim: true,
      default: "",
    },

    achievements: {
      type: String,
      trim: true,
      default: "",
    },

    blockers: {
      type: String,
      trim: true,
      default: "",
    },

    hours: {
      type: Number,
      min: 0,
      max: 24,
      default: 0,
    },

    savedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const dailyProgressSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    morning: {
      type: progressSlotSchema,
      default: () => ({}),
    },

    afternoon: {
      type: progressSlotSchema,
      default: () => ({}),
    },

    evening: {
      type: progressSlotSchema,
      default: () => ({}),
    },

    stata: {
      type: String,
      enum: ["draft", "submitted"],
      default: "draft",
      index: true,
    },

    submittedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


dailyProgressSchema.index(
  { employee: 1, date: 1 },
  { unique: true }
);

const DailyProgress = mongoose.model(
  "DailyProgress",
  dailyProgressSchema
);

export default DailyProgress;