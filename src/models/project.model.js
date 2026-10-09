import mongoose from "mongoose";

const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });

const milestoneSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  dueDate: Date,
  status: { type: String, enum: ["pending", "completed"], default: "pending" },
  completedAt: Date,
});

const expenseSchema = new Schema({
  title: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, default: Date.now },
  addedBy: Schema.Types.ObjectId,
});

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    client: { type: String, trim: true },
    status: {
      type: String,
      enum: ["planning", "active", "on_hold", "completed", "cancelled"],
      default: "planning",
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    startDate: Date,
    deadline: Date,
    manager: ref("Employee"),
    members: [ref("Employee")],
    milestones: [milestoneSchema],
    budget: { type: Number, default: 0, min: 0 },
    hourlyRate: { type: Number, default: 0, min: 0 },
    expenses: [expenseSchema],
    createdBy: Schema.Types.ObjectId,
  },
  { timestamps: true }
);
projectSchema.index({ status: 1, deadline: 1 });

const commentSchema = new Schema(
  {
    user: Schema.Types.ObjectId,
    userName: String,
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

const attachmentSchema = new Schema({
  url: { type: String, required: true },
  publicId: String,
  name: String,
  uploadedBy: Schema.Types.ObjectId,
  uploadedAt: { type: Date, default: Date.now },
});

const taskSchema = new Schema(
  {
    project: { ...ref("Project"), required: true },
    milestone: Schema.Types.ObjectId,
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ["todo", "in_progress", "review", "done"], default: "todo" },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    assignees: [ref("Employee")],
    startDate: Date,
    dueDate: Date,
    completedAt: Date,
    estimatedHours: { type: Number, default: 0, min: 0 },
    loggedHours: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0 },
    comments: [commentSchema],
    attachments: [attachmentSchema],
    createdBy: Schema.Types.ObjectId,
  },
  { timestamps: true }
);
taskSchema.index({ project: 1, status: 1, order: 1 });
taskSchema.index({ assignees: 1, status: 1 });
taskSchema.index({ dueDate: 1 });

const timesheetSchema = new Schema(
  {
    employee: { ...ref("Employee"), required: true },
    task: { ...ref("Task"), required: true },
    project: { ...ref("Project"), required: true },
    date: { type: Date, required: true },
    hours: { type: Number, required: true, min: 0.1, max: 24 },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);
timesheetSchema.index({ employee: 1, date: -1 });
timesheetSchema.index({ project: 1, date: -1 });

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, default: "general" },
    title: { type: String, required: true },
    message: String,
    link: String,
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Project = mongoose.model("Project", projectSchema);
export const Task = mongoose.model("Task", taskSchema);
export const Timesheet = mongoose.model("Timesheet", timesheetSchema);
export const Notification = mongoose.model("Notification", notificationSchema);