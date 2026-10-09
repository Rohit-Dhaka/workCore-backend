import mongoose from "mongoose";
import { Project, Task, Timesheet, Notification } from "../models/project.model.js";
import Employee from "../models/employee.model.js";
import cloudinary from "../config/cloudinary.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isAdmin = (req) => req.user.role === "admin";
const uid = (req) => req.user._id;
const userName = (req) =>
  req.user.name || [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || "User";
const fail = (res, code, message) => res.status(code).json({ success: false, message });
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const oid = (v) => new mongoose.Types.ObjectId(v);

const notify = async (recipients, actor, data) => {
  const ids = [...new Set(recipients.filter(Boolean).map(String))].filter((i) => i !== String(actor));
  if (ids.length) await Notification.insertMany(ids.map((user) => ({ user, ...data })));
};

const canAccessProject = (project, req) =>
  isAdmin(req) ||
  String(project.manager) === String(uid(req)) ||
  project.members.some((m) => String(m._id || m) === String(uid(req)));

const taskScope = async (req) => {
  if (isAdmin(req)) return {};
  const ids = await Project.find({ $or: [{ manager: uid(req) }, { members: uid(req) }] }).distinct("_id");
  return { project: { $in: ids } };
};

const getAccessibleTask = async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    fail(res, 404, "Task not found");
    return null;
  }
  const project = await Project.findById(task.project);
  if (!project || !canAccessProject(project, req)) {
    fail(res, 403, "Access denied");
    return null;
  }
  return { task, project };
};

const paginate = (req) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  return { page, limit, skip: (page - 1) * limit };
};

const progressMap = async (projectIds) => {
  const rows = await Task.aggregate([
    { $match: { project: { $in: projectIds } } },
    { $group: { _id: { project: "$project", status: "$status" }, count: { $sum: 1 } } },
  ]);
  const map = {};
  rows.forEach(({ _id, count }) => {
    const key = String(_id.project);
    map[key] = map[key] || { total: 0, done: 0 };
    map[key].total += count;
    if (_id.status === "done") map[key].done += count;
  });
  return map;
};

const withProgress = (project, map) => {
  const s = map[String(project._id)] || { total: 0, done: 0 };
  return {
    ...project,
    taskCount: s.total,
    doneCount: s.done,
    progress: s.total ? Math.round((s.done / s.total) * 100) : 0,
  };
};

export const createProject = wrap(async (req, res) => {
  const { name } = req.body;
  if (!name) return fail(res, 400, "Project name is required");
  const project = await Project.create({ ...req.body, createdBy: uid(req) });
  await notify([project.manager, ...project.members], uid(req), {
    type: "project",
    title: "Added to a project",
    message: `You have been added to project "${project.name}"`,
    link: `/projects/${project._id}`,
  });
  res.status(201).json({ success: true, data: project });
});

export const getProjects = wrap(async (req, res) => {
  const { status, priority, search } = req.query;
  const { page, limit, skip } = paginate(req);
  const filter = {};
  if (!isAdmin(req)) filter.$or = [{ manager: uid(req) }, { members: uid(req) }];
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (search) filter.name = { $regex: search, $options: "i" };

  const [items, total] = await Promise.all([
    Project.find(filter)
      .select("-expenses")
      .populate("manager", "firstName lastName profileImage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Project.countDocuments(filter),
  ]);
  const map = await progressMap(items.map((p) => p._id));
  ok(res, items.map((p) => withProgress(p, map)), { total, page, pages: Math.ceil(total / limit) });
});

export const getProject = wrap(async (req, res) => {
  const project = await Project.findById(req.params.id)
    .populate("manager", "firstName lastName profileImage designation")
    .populate("members", "firstName lastName profileImage designation")
    .lean();
  if (!project) return fail(res, 404, "Project not found");
  if (!canAccessProject(project, req)) return fail(res, 403, "Access denied");
  if (!isAdmin(req)) {
    delete project.expenses;
    delete project.budget;
    delete project.hourlyRate;
  }
  const map = await progressMap([project._id]);
  ok(res, withProgress(project, map));
});

export const updateProject = wrap(async (req, res) => {
  const { milestones, expenses, createdBy, ...body } = req.body;
  const project = await Project.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!project) return fail(res, 404, "Project not found");
  await notify([project.manager, ...project.members], uid(req), {
    type: "project",
    title: "Project updated",
    message: `Project "${project.name}" was updated (status: ${project.status})`,
    link: `/projects/${project._id}`,
  });
  ok(res, project);
});

export const deleteProject = wrap(async (req, res) => {
  const project = await Project.findByIdAndDelete(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  await Promise.all([Task.deleteMany({ project: project._id }), Timesheet.deleteMany({ project: project._id })]);
  ok(res, { message: "Project deleted" });
});

export const addMilestone = wrap(async (req, res) => {
  if (!req.body.title) return fail(res, 400, "Milestone title is required");
  const project = await Project.findById(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  project.milestones.push(req.body);
  await project.save();
  ok(res, project.milestones);
});

export const updateMilestone = wrap(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  const milestone = project.milestones.id(req.params.milestoneId);
  if (!milestone) return fail(res, 404, "Milestone not found");
  const { title, description, dueDate, status } = req.body;
  if (title !== undefined) milestone.title = title;
  if (description !== undefined) milestone.description = description;
  if (dueDate !== undefined) milestone.dueDate = dueDate;
  if (status !== undefined) {
    milestone.status = status;
    milestone.completedAt = status === "completed" ? new Date() : undefined;
  }
  await project.save();
  if (status === "completed") {
    await notify([project.manager, ...project.members], uid(req), {
      type: "milestone",
      title: "Milestone completed",
      message: `"${milestone.title}" completed in "${project.name}"`,
      link: `/projects/${project._id}`,
    });
  }
  ok(res, project.milestones);
});

export const deleteMilestone = wrap(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  project.milestones.pull(req.params.milestoneId);
  await project.save();
  ok(res, project.milestones);
});

export const addExpense = wrap(async (req, res) => {
  const { title, amount } = req.body;
  if (!title || amount === undefined) return fail(res, 400, "Title and amount are required");
  const project = await Project.findById(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  project.expenses.push({ ...req.body, addedBy: uid(req) });
  await project.save();
  ok(res, project.expenses);
});

export const deleteExpense = wrap(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return fail(res, 404, "Project not found");
  project.expenses.pull(req.params.expenseId);
  await project.save();
  ok(res, project.expenses);
});

export const getProjectBudget = wrap(async (req, res) => {
  const project = await Project.findById(req.params.id).lean();
  if (!project) return fail(res, 404, "Project not found");

  const byEmployee = await Timesheet.aggregate([
    { $match: { project: project._id } },
    { $group: { _id: "$employee", hours: { $sum: "$hours" } } },
    { $sort: { hours: -1 } },
  ]);
  const employees = await Employee.find({ _id: { $in: byEmployee.map((e) => e._id) } })
    .select("firstName lastName")
    .lean();
  const nameOf = Object.fromEntries(employees.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));

  const totalHours = byEmployee.reduce((s, e) => s + e.hours, 0);
  const labourCost = totalHours * project.hourlyRate;
  const expensesTotal = project.expenses.reduce((s, e) => s + e.amount, 0);
  const spent = labourCost + expensesTotal;

  ok(res, {
    budget: project.budget,
    hourlyRate: project.hourlyRate,
    totalHours,
    labourCost,
    expensesTotal,
    spent,
    remaining: project.budget - spent,
    percentUsed: project.budget ? Math.round((spent / project.budget) * 100) : 0,
    overBudget: project.budget > 0 && spent > project.budget,
    expenses: project.expenses,
    hoursByEmployee: byEmployee.map((e) => ({
      employee: e._id,
      name: nameOf[String(e._id)] || "Unknown",
      hours: e.hours,
      cost: e.hours * project.hourlyRate,
    })),
  });
});

export const createTask = wrap(async (req, res) => {
  const { project: projectId, title } = req.body;
  if (!projectId || !title) return fail(res, 400, "Project and title are required");
  const project = await Project.findById(projectId);
  if (!project) return fail(res, 404, "Project not found");
  const status = req.body.status || "todo";
  const order = await Task.countDocuments({ project: projectId, status });
  const task = await Task.create({ ...req.body, order, createdBy: uid(req) });
  await notify(task.assignees, uid(req), {
    type: "task",
    title: "New task assigned",
    message: `"${task.title}" in "${project.name}" is assigned to you`,
    link: `/tasks/${task._id}`,
  });
  res.status(201).json({ success: true, data: task });
});

export const getTasks = wrap(async (req, res) => {
  const { project, status, priority, assignee, search, dueFrom, dueTo, overdue } = req.query;
  const { page, limit, skip } = paginate(req);
  const filter = await taskScope(req);
  if (project) filter.project = project;
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (assignee) filter.assignees = assignee;
  if (search) filter.title = { $regex: search, $options: "i" };
  if (dueFrom || dueTo) {
    filter.dueDate = {};
    if (dueFrom) filter.dueDate.$gte = new Date(dueFrom);
    if (dueTo) filter.dueDate.$lte = new Date(dueTo);
  }
  if (overdue === "true") {
    filter.dueDate = { ...(filter.dueDate || {}), $lt: new Date() };
    filter.status = { $ne: "done" };
  }

  const [items, total] = await Promise.all([
    Task.find(filter)
      .select("-comments -attachments")
      .populate("project", "name")
      .populate("assignees", "firstName lastName profileImage")
      .sort({ dueDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Task.countDocuments(filter),
  ]);
  ok(res, items, { total, page, pages: Math.ceil(total / limit) });
});

export const getMyTasks = wrap(async (req, res) => {
  const filter = { assignees: uid(req) };
  if (req.query.status) filter.status = req.query.status;
  const items = await Task.find(filter)
    .select("-comments -attachments")
    .populate("project", "name")
    .sort({ dueDate: 1 })
    .lean();
  ok(res, items);
});

export const getKanban = wrap(async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) return fail(res, 404, "Project not found");
  if (!canAccessProject(project, req)) return fail(res, 403, "Access denied");
  const filter = { project: project._id };
  if (req.query.assignee) filter.assignees = req.query.assignee;
  if (req.query.priority) filter.priority = req.query.priority;
  const tasks = await Task.find(filter)
    .select("-comments.text -attachments.url")
    .populate("assignees", "firstName lastName profileImage")
    .sort({ order: 1, createdAt: 1 })
    .lean();
  const columns = { todo: [], in_progress: [], review: [], done: [] };
  tasks.forEach((t) =>
    columns[t.status].push({
      ...t,
      commentCount: t.comments?.length || 0,
      attachmentCount: t.attachments?.length || 0,
      comments: undefined,
      attachments: undefined,
    })
  );
  ok(res, columns);
});

export const getCalendar = wrap(async (req, res) => {
  const from = new Date(req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const to = new Date(req.query.to || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59));
  const scope = await taskScope(req);
  const tasks = await Task.find({ ...scope, dueDate: { $gte: from, $lte: to } })
    .select("title status priority dueDate project assignees")
    .populate("project", "name")
    .populate("assignees", "firstName lastName")
    .lean();

  const projectFilter = isAdmin(req) ? {} : { $or: [{ manager: uid(req) }, { members: uid(req) }] };
  const projects = await Project.find({
    ...projectFilter,
    $or: [{ deadline: { $gte: from, $lte: to } }, { "milestones.dueDate": { $gte: from, $lte: to } }],
  })
    .select("name deadline milestones")
    .lean();

  const milestones = [];
  const deadlines = [];
  projects.forEach((p) => {
    if (p.deadline && p.deadline >= from && p.deadline <= to) deadlines.push({ project: p._id, name: p.name, date: p.deadline });
    p.milestones.forEach((m) => {
      if (m.dueDate && m.dueDate >= from && m.dueDate <= to)
        milestones.push({ _id: m._id, project: p._id, projectName: p.name, title: m.title, status: m.status, date: m.dueDate });
    });
  });
  ok(res, { tasks, milestones, deadlines });
});

export const getTask = wrap(async (req, res) => {
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const task = await Task.findById(req.params.id)
    .populate("project", "name milestones")
    .populate("assignees", "firstName lastName profileImage designation")
    .lean();
  ok(res, task);
});

export const updateTask = wrap(async (req, res) => {
  const { comments, attachments, loggedHours, createdBy, ...body } = req.body;
  const before = await Task.findById(req.params.id);
  if (!before) return fail(res, 404, "Task not found");
  if (body.status === "done" && before.status !== "done") body.completedAt = new Date();
  if (body.status && body.status !== "done") body.completedAt = undefined;
  const task = await Task.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });

  const oldIds = before.assignees.map(String);
  const newlyAdded = task.assignees.filter((a) => !oldIds.includes(String(a)));
  await notify(newlyAdded, uid(req), {
    type: "task",
    title: "New task assigned",
    message: `"${task.title}" is assigned to you`,
    link: `/tasks/${task._id}`,
  });
  ok(res, task);
});

export const updateTaskStatus = wrap(async (req, res) => {
  const { status, order } = req.body;
  if (!["todo", "in_progress", "review", "done"].includes(status)) return fail(res, 400, "Invalid status");
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const { task, project } = found;
  const isAssignee = task.assignees.some((a) => String(a) === String(uid(req)));
  if (!isAdmin(req) && !isAssignee && String(project.manager) !== String(uid(req)))
    return fail(res, 403, "Only assignees or the project manager can move this task");

  const changed = task.status !== status;
  task.status = status;
  task.completedAt = status === "done" ? new Date() : undefined;
  task.order = order !== undefined ? order : await Task.countDocuments({ project: task.project, status });
  await task.save();

  if (changed) {
    await notify([task.createdBy, project.manager, ...task.assignees], uid(req), {
      type: "task",
      title: "Task status changed",
      message: `"${task.title}" moved to ${status.replace("_", " ")}`,
      link: `/tasks/${task._id}`,
    });
  }
  ok(res, task);
});

export const deleteTask = wrap(async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) return fail(res, 404, "Task not found");
  await Timesheet.deleteMany({ task: task._id });
  ok(res, { message: "Task deleted" });
});

export const addComment = wrap(async (req, res) => {
  if (!req.body.text?.trim()) return fail(res, 400, "Comment text is required");
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const { task } = found;
  task.comments.push({ user: uid(req), userName: userName(req), text: req.body.text });
  await task.save();
  await notify([task.createdBy, ...task.assignees], uid(req), {
    type: "comment",
    title: "New comment",
    message: `${userName(req)} commented on "${task.title}"`,
    link: `/tasks/${task._id}`,
  });
  ok(res, task.comments);
});

export const deleteComment = wrap(async (req, res) => {
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const { task } = found;
  const comment = task.comments.id(req.params.commentId);
  if (!comment) return fail(res, 404, "Comment not found");
  if (!isAdmin(req) && String(comment.user) !== String(uid(req))) return fail(res, 403, "Not allowed");
  task.comments.pull(req.params.commentId);
  await task.save();
  ok(res, task.comments);
});

export const addAttachment = wrap(async (req, res) => {
  if (!req.files?.length) return fail(res, 400, "No file uploaded");
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const { task } = found;
  req.files.forEach((f) =>
    task.attachments.push({ url: f.path, publicId: f.filename, name: f.originalname, uploadedBy: uid(req) })
  );
  await task.save();
  await notify([task.createdBy, ...task.assignees], uid(req), {
    type: "attachment",
    title: "New attachment",
    message: `${userName(req)} added a file to "${task.title}"`,
    link: `/tasks/${task._id}`,
  });
  ok(res, task.attachments);
});

export const deleteAttachment = wrap(async (req, res) => {
  const found = await getAccessibleTask(req, res);
  if (!found) return;
  const { task } = found;
  const file = task.attachments.id(req.params.attachmentId);
  if (!file) return fail(res, 404, "Attachment not found");
  if (!isAdmin(req) && String(file.uploadedBy) !== String(uid(req))) return fail(res, 403, "Not allowed");
  if (file.publicId) await cloudinary.uploader.destroy(file.publicId, { resource_type: "auto" }).catch(() => {});
  task.attachments.pull(req.params.attachmentId);
  await task.save();
  ok(res, task.attachments);
});

export const logTime = wrap(async (req, res) => {
  const { task: taskId, hours, date, note } = req.body;
  const h = Number(hours);
  if (!taskId || !h || h <= 0 || h > 24) return fail(res, 400, "Valid task and hours (0-24) are required");
  const day = date ? new Date(date) : new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (day > endOfToday) return fail(res, 400, "Cannot log time for a future date");

  const task = await Task.findById(taskId);
  if (!task) return fail(res, 404, "Task not found");
  const employee = isAdmin(req) && req.body.employee ? req.body.employee : uid(req);
  if (!isAdmin(req) && !task.assignees.some((a) => String(a) === String(employee)))
    return fail(res, 403, "You can log time only on tasks assigned to you");

  const entry = await Timesheet.create({ employee, task: task._id, project: task.project, date: day, hours: h, note });
  await Task.findByIdAndUpdate(task._id, { $inc: { loggedHours: h } });
  res.status(201).json({ success: true, data: entry });
});

export const getTimesheets = wrap(async (req, res) => {
  const { employee, project, task, from, to } = req.query;
  const filter = {};
  if (isAdmin(req)) {
    if (employee) filter.employee = employee;
  } else filter.employee = uid(req);
  if (project) filter.project = project;
  if (task) filter.task = task;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) filter.date.$lte = new Date(to);
  }
  const [items, totals] = await Promise.all([
    Timesheet.find(filter)
      .populate("employee", "firstName lastName")
      .populate("task", "title")
      .populate("project", "name")
      .sort({ date: -1 })
      .lean(),
    Timesheet.aggregate([
      { $match: { ...filter, ...(filter.employee ? { employee: oid(filter.employee) } : {}), ...(filter.project ? { project: oid(filter.project) } : {}), ...(filter.task ? { task: oid(filter.task) } : {}) } },
      { $group: { _id: null, hours: { $sum: "$hours" } } },
    ]),
  ]);
  ok(res, items, { totalHours: totals[0]?.hours || 0 });
});

export const deleteTimesheet = wrap(async (req, res) => {
  const entry = await Timesheet.findById(req.params.id);
  if (!entry) return fail(res, 404, "Timesheet entry not found");
  if (!isAdmin(req) && String(entry.employee) !== String(uid(req))) return fail(res, 403, "Not allowed");
  await entry.deleteOne();
  await Task.findByIdAndUpdate(entry.task, { $inc: { loggedHours: -entry.hours } });
  ok(res, { message: "Entry deleted" });
});

export const getWorkload = wrap(async (req, res) => {
  const now = new Date();
  const from = new Date(req.query.from || new Date(now.getFullYear(), now.getMonth(), 1));
  const to = new Date(req.query.to || now);

  const [taskStats, hourStats, employees] = await Promise.all([
    Task.aggregate([
      { $match: { status: { $ne: "done" } } },
      { $unwind: "$assignees" },
      {
        $group: {
          _id: "$assignees",
          openTasks: { $sum: 1 },
          overdueTasks: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] } },
          urgentTasks: { $sum: { $cond: [{ $eq: ["$priority", "urgent"] }, 1, 0] } },
          estimatedHours: { $sum: "$estimatedHours" },
        },
      },
    ]),
    Timesheet.aggregate([
      { $match: { date: { $gte: from, $lte: to } } },
      { $group: { _id: "$employee", hours: { $sum: "$hours" } } },
    ]),
    Employee.find().select("firstName lastName designation profileImage").lean(),
  ]);

  const taskMap = Object.fromEntries(taskStats.map((t) => [String(t._id), t]));
  const hourMap = Object.fromEntries(hourStats.map((h) => [String(h._id), h.hours]));
  const data = employees
    .map((e) => {
      const t = taskMap[String(e._id)] || {};
      return {
        employee: e,
        openTasks: t.openTasks || 0,
        overdueTasks: t.overdueTasks || 0,
        urgentTasks: t.urgentTasks || 0,
        estimatedHours: t.estimatedHours || 0,
        loggedHours: hourMap[String(e._id)] || 0,
      };
    })
    .sort((a, b) => b.openTasks - a.openTasks);
  ok(res, data, { from, to });
});

export const getNotifications = wrap(async (req, res) => {
  const filter = { user: uid(req) };
  if (req.query.unread === "true") filter.isRead = false;
  const [items, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: uid(req), isRead: false }),
  ]);
  ok(res, items, { unreadCount });
});

export const markNotificationRead = wrap(async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: uid(req) }, { isRead: true }, { new: true });
  if (!n) return fail(res, 404, "Notification not found");
  ok(res, n);
});

export const markAllNotificationsRead = wrap(async (req, res) => {
  await Notification.updateMany({ user: uid(req), isRead: false }, { isRead: true });
  ok(res, { message: "All notifications marked as read" });
});

export const deleteNotification = wrap(async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, user: uid(req) });
  ok(res, { message: "Notification deleted" });
});