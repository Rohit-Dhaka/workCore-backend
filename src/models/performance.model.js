import mongoose from "mongoose";

const { Schema } = mongoose;

const clamp = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Number(value) || 0));

const round1 = (value) => Math.round(value * 10) / 10;

const goalPercent = (goal) =>
  goal.target > 0 ? clamp((goal.progress / goal.target) * 100) : 0;

const kpiPercent = (kpi) =>
  kpi.target > 0 ? clamp((kpi.achieved / kpi.target) * 100) : 0;



const kpiSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "KPI name is required"],
      trim: true,
    },
    unit: { type: String, trim: true, default: "" },
    target: {
      type: Number,
      required: [true, "KPI target is required"],
      min: [0.01, "KPI target must be greater than 0"],
    },
    achieved: { type: Number, min: 0, default: 0 },
    
    weight: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: true },
);



const goalSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, "Goal title is required"],
      trim: true,
    },
    description: { type: String, trim: true, default: "" },
    target: { type: Number, min: 1, max: 100, default: 100 },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      enum: ["Not Started", "In Progress", "Completed"],
      default: "Not Started",
    },
    dueDate: { type: Date, default: null },
  },
  { _id: true },
);



const performanceSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Employee is required"],
      index: true,
    },

    
    period: {
      type: String,
      required: [true, "Review period is required"],
      trim: true,
    },

    periodType: {
      type: String,
      enum: ["Monthly", "Quarterly", "Half-Yearly", "Yearly"],
      default: "Quarterly",
    },

    kpis: { type: [kpiSchema], default: [] },
    goals: { type: [goalSchema], default: [] },

    
    kpiScore: { type: Number, min: 0, max: 100, default: 0 },
    goalScore: { type: Number, min: 0, max: 100, default: 0 },
    overallScore: { type: Number, min: 0, max: 100, default: 0 },

    
    selfRating: { type: Number, min: 0, max: 5, default: 0 },
    selfComment: { type: String, trim: true, maxlength: 1000, default: "" },
    selfSubmittedAt: { type: Date, default: null },

    
    managerRating: { type: Number, min: 0, max: 5, default: 0 },
    managerFeedback: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    status: {
      type: String,
      enum: ["Draft", "In Review", "Completed"],
      default: "Draft",
      index: true,
    },

    reviewDate: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },

    
    createdBy: {
      type: Schema.Types.ObjectId,
      refPath: "createdByModel",
      default: null,
    },
    createdByModel: {
      type: String,
      enum: ["User", "Employee"],
      default: "User",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

performanceSchema.index({ employee: 1, period: 1 }, { unique: true });
performanceSchema.index({ status: 1, period: 1 });



performanceSchema.pre("validate", function () {
  
  this.goals.forEach((goal) => {
    const pct = goalPercent(goal);
    goal.status =
      pct >= 100 ? "Completed" : pct > 0 ? "In Progress" : "Not Started";
  });

  
  if (this.kpis.length > 0) {
    const totalWeight = this.kpis.reduce((sum, k) => sum + (k.weight || 0), 0);

    this.kpiScore = round1(
      totalWeight > 0
        ? this.kpis.reduce((sum, k) => sum + kpiPercent(k) * k.weight, 0) /
            totalWeight
        : this.kpis.reduce((sum, k) => sum + kpiPercent(k), 0) /
            this.kpis.length,
    );
  }

  
  this.goalScore = this.goals.length
    ? round1(
        this.goals.reduce((sum, g) => sum + goalPercent(g), 0) /
          this.goals.length,
      )
    : 0;

  
  const parts = [
    { score: this.kpiScore, weight: 40, present: this.kpis.length > 0 || this.kpiScore > 0 },
    { score: this.goalScore, weight: 40, present: this.goals.length > 0 },
    { score: (this.managerRating / 5) * 100, weight: 20, present: this.managerRating > 0 },
  ].filter((part) => part.present);

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);

  this.overallScore = totalWeight
    ? round1(parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight)
    : 0;
});



performanceSchema.virtual("grade").get(function () {
  const score = this.overallScore;

  if (score >= 90) return "Outstanding";
  if (score >= 75) return "Exceeds Expectations";
  if (score >= 60) return "Meets Expectations";
  if (score >= 40) return "Needs Improvement";
  return "Poor";
});

const Performance = mongoose.model("Performance", performanceSchema);

export default Performance;