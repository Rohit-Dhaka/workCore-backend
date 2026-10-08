import mongoose from "mongoose";
import { Lead, Client, LEAD_STATUSES } from "../models/Crm.js";

const handle = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pick = (source, keys) =>
  keys.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

const getPaging = (query) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const notFound = (res, label) =>
  res.status(404).json({ success: false, message: `${label} not found` });

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

const LEAD_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "source",
  "serviceInterest",
  "budget",
  "assignedTo",
];

const CLIENT_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "website",
  "address",
  "gstNumber",
  "status",
];

const ASSIGNEE_SELECT = "firstName lastName designation";

export const getCrmStats = handle(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const grouped = await Lead.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: "$budget" } } },
  ]);

  const pipeline = LEAD_STATUSES.map((status) => {
    const found = grouped.find((item) => item._id === status);
    return { status, count: found?.count || 0, value: found?.value || 0 };
  });

  const totalLeads = pipeline.reduce((sum, item) => sum + item.count, 0);
  const wonLeads = pipeline.find((item) => item.status === "won").count;
  const openValue = pipeline
    .filter((item) => !["won", "lost"].includes(item.status))
    .reduce((sum, item) => sum + item.value, 0);

  const followUpCounts = await Lead.aggregate([
    { $match: { status: { $nin: ["won", "lost"] } } },
    { $unwind: "$followUps" },
    { $match: { "followUps.status": "pending" } },
    {
      $group: {
        _id: null,
        overdue: {
          $sum: { $cond: [{ $lt: ["$followUps.date", startOfDay] }, 1, 0] },
        },
        today: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$followUps.date", startOfDay] },
                  { $lte: ["$followUps.date", endOfDay] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const totalClients = await Client.countDocuments();

  res.json({
    success: true,
    data: {
      pipeline,
      totalLeads,
      totalClients,
      openValue,
      conversionRate: totalLeads
        ? Math.round((wonLeads / totalLeads) * 1000) / 10
        : 0,
      followUps: {
        overdue: followUpCounts[0]?.overdue || 0,
        today: followUpCounts[0]?.today || 0,
      },
    },
  });
});

export const getFollowUps = handle(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const weekEnd = new Date(endOfDay);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const range = req.query.range || "today";
  let dateMatch = { $gte: startOfDay, $lte: endOfDay };
  if (range === "overdue") dateMatch = { $lt: startOfDay };
  if (range === "upcoming") dateMatch = { $gt: endOfDay, $lte: weekEnd };

  const items = await Lead.aggregate([
    { $match: { status: { $nin: ["won", "lost"] } } },
    { $unwind: "$followUps" },
    { $match: { "followUps.status": "pending", "followUps.date": dateMatch } },
    { $sort: { "followUps.date": 1 } },
    {
      $project: {
        _id: 0,
        leadId: "$_id",
        leadName: "$name",
        company: 1,
        phone: 1,
        email: 1,
        leadStatus: "$status",
        followUp: "$followUps",
      },
    },
  ]);

  res.json({ success: true, data: items });
});

export const getLeads = handle(async (req, res) => {
  const { page, limit, skip } = getPaging(req.query);
  const { search, status, source, assignedTo } = req.query;

  const filter = {};
  if (status && LEAD_STATUSES.includes(status)) filter.status = status;
  if (source) filter.source = source;
  if (assignedTo && mongoose.isValidObjectId(assignedTo)) {
    filter.assignedTo = assignedTo;
  }
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }];
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate("assignedTo", ASSIGNEE_SELECT)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Lead.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: leads,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getLead = handle(async (req, res) => {
  const lead = await Lead.findById(req.params.id)
    .populate("assignedTo", ASSIGNEE_SELECT)
    .populate("convertedClient", "name company");
  if (!lead) return notFound(res, "Lead");
  res.json({ success: true, data: lead });
});

export const createLead = handle(async (req, res) => {
  const data = pick(req.body, LEAD_FIELDS);
  if (!data.name) return badRequest(res, "Lead name is required");
  if (data.assignedTo === "") delete data.assignedTo;
  const lead = await Lead.create({ ...data, createdBy: req.user?._id });
  res.status(201).json({ success: true, message: "Lead created", data: lead });
});

export const updateLead = handle(async (req, res) => {
  const data = pick(req.body, LEAD_FIELDS);
  if (data.assignedTo === "") data.assignedTo = null;
  const lead = await Lead.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
  }).populate("assignedTo", ASSIGNEE_SELECT);
  if (!lead) return notFound(res, "Lead");
  res.json({ success: true, message: "Lead updated", data: lead });
});

export const updateLeadStatus = handle(async (req, res) => {
  const { status, lostReason } = req.body;
  if (!LEAD_STATUSES.includes(status)) {
    return badRequest(res, "Invalid lead status");
  }
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  lead.status = status;
  lead.lostReason = status === "lost" ? lostReason || "" : "";
  await lead.save();
  res.json({ success: true, message: "Lead status updated", data: lead });
});

export const deleteLead = handle(async (req, res) => {
  const lead = await Lead.findByIdAndDelete(req.params.id);
  if (!lead) return notFound(res, "Lead");
  res.json({ success: true, message: "Lead deleted" });
});

export const addLeadNote = handle(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return badRequest(res, "Note text is required");
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  lead.notes.unshift({ text, createdBy: req.user?._id });
  await lead.save();
  res.status(201).json({ success: true, message: "Note added", data: lead });
});

export const deleteLeadNote = handle(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  const note = lead.notes.id(req.params.noteId);
  if (!note) return notFound(res, "Note");
  note.deleteOne();
  await lead.save();
  res.json({ success: true, message: "Note deleted", data: lead });
});

export const addFollowUp = handle(async (req, res) => {
  const { date, type, note } = req.body;
  if (!date || isNaN(new Date(date).getTime())) {
    return badRequest(res, "A valid follow-up date is required");
  }
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  lead.followUps.push({ date, type, note });
  await lead.save();
  res.status(201).json({ success: true, message: "Follow-up scheduled", data: lead });
});

export const updateFollowUp = handle(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  const followUp = lead.followUps.id(req.params.followUpId);
  if (!followUp) return notFound(res, "Follow-up");

  const data = pick(req.body, ["date", "type", "note", "status"]);
  Object.assign(followUp, data);
  if (data.status === "done") followUp.completedAt = new Date();
  if (data.status === "pending") followUp.completedAt = undefined;

  await lead.save();
  res.json({ success: true, message: "Follow-up updated", data: lead });
});

export const deleteFollowUp = handle(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  const followUp = lead.followUps.id(req.params.followUpId);
  if (!followUp) return notFound(res, "Follow-up");
  followUp.deleteOne();
  await lead.save();
  res.json({ success: true, message: "Follow-up deleted", data: lead });
});

export const linkQuotation = handle(async (req, res) => {
  const { quotationId } = req.body;
  if (!mongoose.isValidObjectId(quotationId)) {
    return badRequest(res, "A valid quotation id is required");
  }
  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { $addToSet: { quotations: quotationId } },
    { new: true }
  );
  if (!lead) return notFound(res, "Lead");
  res.json({ success: true, message: "Quotation linked", data: lead });
});

export const unlinkQuotation = handle(async (req, res) => {
  const lead = await Lead.findByIdAndUpdate(
    req.params.id,
    { $pull: { quotations: req.params.quotationId } },
    { new: true }
  );
  if (!lead) return notFound(res, "Lead");
  res.json({ success: true, message: "Quotation unlinked", data: lead });
});

export const convertLeadToClient = handle(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return notFound(res, "Lead");
  if (lead.convertedClient) {
    return badRequest(res, "This lead is already converted to a client");
  }

  const client = await Client.create({
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    ...pick(req.body, ["website", "address", "gstNumber"]),
    lead: lead._id,
    quotations: lead.quotations,
    notes: lead.notes,
    createdBy: req.user?._id,
  });

  lead.status = "won";
  lead.lostReason = "";
  lead.convertedClient = client._id;
  lead.convertedAt = new Date();
  await lead.save();

  res.status(201).json({
    success: true,
    message: "Lead converted to client",
    data: { lead, client },
  });
});

export const getClients = handle(async (req, res) => {
  const { page, limit, skip } = getPaging(req.query);
  const { search, status } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: regex }, { company: regex }, { email: regex }, { phone: regex }];
  }

  const [clients, total] = await Promise.all([
    Client.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Client.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: clients,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getClient = handle(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) return notFound(res, "Client");
  res.json({ success: true, data: client });
});

export const createClient = handle(async (req, res) => {
  const data = pick(req.body, CLIENT_FIELDS);
  if (!data.name) return badRequest(res, "Client name is required");
  const client = await Client.create({ ...data, createdBy: req.user?._id });
  res.status(201).json({ success: true, message: "Client created", data: client });
});

export const updateClient = handle(async (req, res) => {
  const client = await Client.findByIdAndUpdate(
    req.params.id,
    pick(req.body, CLIENT_FIELDS),
    { new: true, runValidators: true }
  );
  if (!client) return notFound(res, "Client");
  res.json({ success: true, message: "Client updated", data: client });
});

export const addClientNote = handle(async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return badRequest(res, "Note text is required");
  const client = await Client.findById(req.params.id);
  if (!client) return notFound(res, "Client");
  client.notes.unshift({ text, createdBy: req.user?._id });
  await client.save();
  res.status(201).json({ success: true, message: "Note added", data: client });
});

export const deleteClient = handle(async (req, res) => {
  const client = await Client.findByIdAndDelete(req.params.id);
  if (!client) return notFound(res, "Client");
  await Lead.updateMany(
    { convertedClient: client._id },
    { $unset: { convertedClient: "", convertedAt: "" } }
  );
  res.json({ success: true, message: "Client deleted" });
});