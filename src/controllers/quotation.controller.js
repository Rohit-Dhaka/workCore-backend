import mongoose from "mongoose";

import CompanySettings from "../models/CompanySettings.js";
import Counter from "../models/Counter.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import Service from "../models/Service.js";


import cloudinary from "../config/cloudinary.js";

import {
  QUOTATION_STATUSES,
  SERVICE_CATEGORIES,
  STATUS_TRANSITIONS,
} from "../utils/quotationConstants.js";



const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (res, next, error) => {
  if (error?.name === "ValidationError") {
    return fail(
      res,
      400,
      Object.values(error.errors)
        .map((item) => item.message)
        .join(", "),
    );
  }

  if (error?.code === 11000) {
    return fail(
      res,
      409,
      error.keyPattern?.name
        ? "This service already exists in the selected category"
        : "Duplicate value, please try again",
    );
  }

  if (error?.name === "CastError") {
    return fail(res, 400, `Invalid value for ${error.path}`);
  }

  return next(error);
};

const pick = (source, fields) =>
  Object.fromEntries(
    fields
      .filter((field) => source?.[field] !== undefined)
      .map((field) => [field, source[field]]),
  );

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};


const endOfDay = (value) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const parseJsonField = (value) => {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
};


const companyData = (settings) => {
  const { _id, key, __v, createdAt, updatedAt, ...rest } = settings.toObject();
  return rest;
};

const findQuotation = async (id, res) => {
  if (!mongoose.isValidObjectId(id)) {
    fail(res, 400, "Invalid quotation id");
    return null;
  }

  const quotation = await Quotation.findById(id);

  if (!quotation) {
    fail(res, 404, "Quotation not found");
    return null;
  }

  return quotation;
};


const expireOldQuotations = () =>
  Quotation.updateMany(
    { status: { $in: ["Sent", "Viewed"] }, validUntil: { $lt: new Date() } },
    {
      $set: { status: "Expired" },
      $push: {
        statusHistory: {
          status: "Expired",
          at: new Date(),
          note: "Validity period ended",
        },
      },
    },
  );


const nextNumber = async (settings, date) => {
  const format = settings.quotationNumberFormat;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  
  let key = "quotation";
  if (/\{YYYY\}|\{YY\}/.test(format)) key += `-${year}`;
  if (/\{MM\}/.test(format)) key += `-${month}`;

  const seq = await Counter.next(key);

  return format
    .replaceAll("{PREFIX}", settings.quotationPrefix)
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{YY}", String(year).slice(-2))
    .replaceAll("{MM}", month)
    .replaceAll("{SEQ}", String(seq).padStart(settings.sequencePadding, "0"));
};



const SETTINGS_FIELDS = [
  "companyName",
  "tagline",
  "about",
  "address",
  "email",
  "phone",
  "website",
  "gstNumber",
  "socialLinks",
  "defaultTaxRate",
  "quotationPrefix",
  "quotationNumberFormat",
  "sequencePadding",
  "defaultValidityDays",
  "paymentTemplates",
  "defaultTerms",
  "defaultExclusions",
  "defaultNotes",
  "footerText",
  "bankDetails",
  "upiId",
];


const SETTINGS_JSON_FIELDS = [
  "socialLinks",
  "paymentTemplates",
  "defaultTerms",
  "defaultExclusions",
  "bankDetails",
];


export const getSettings = async (req, res, next) => {
  try {
    const settings = await CompanySettings.getSettings();

    return res.json({ success: true, data: { settings } });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const updateSettings = async (req, res, next) => {
  try {
    const settings = await CompanySettings.getSettings();

    for (const field of SETTINGS_FIELDS) {
      if (req.body[field] === undefined) continue;

      let value = req.body[field];

      if (SETTINGS_JSON_FIELDS.includes(field)) {
        try {
          value = parseJsonField(value);
        } catch {
          return fail(res, 400, `${field} must be valid JSON`);
        }
      }

      settings.set(field, value);
    }

    const oldPublicId = settings.logo?.publicId;

    if (req.file) {
      
      settings.logo = { url: req.file.path, publicId: req.file.filename };
    } else if (String(req.body.removeLogo) === "true") {
      settings.logo = { url: "", publicId: "" };
    }

    await settings.save();

    if (oldPublicId && oldPublicId !== settings.logo?.publicId) {
      await cloudinary.uploader.destroy(oldPublicId).catch(() => {});
    }

    return res.json({
      success: true,
      message: "Settings saved successfully",
      data: { settings },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};



const SERVICE_FIELDS = [
  "name",
  "category",
  "description",
  "details",
  "defaultPrice",
  "pricingType",
  "unit",
  "taxRate",
  "defaultTimeline",
  "defaultRevisions",
  "defaultFeatures",
  "defaultDeliverables",
  "defaultExclusions",
  "isActive",
];

const SEED_SERVICES = {
  "Website & Web Development": [
    "Static Website", "Landing Page", "Business Website", "Dynamic Website",
    "Portfolio Website", "E-commerce Website", "Booking Website",
    "Custom Web Application", "Admin Dashboard", "CMS Website",
    "Website Redesign", "Website Maintenance",
  ],
  "Software Development": [
    "Custom Software", "ERP", "CRM", "HRMS", "Inventory Management",
    "Billing Software", "School Management System",
    "Hospital Management System", "SaaS Product", "API Development",
    "Backend Development", "Custom Web Application",
  ],
  "UI/UX & Design": [
    "UI/UX Design", "Website Design", "Mobile App UI/UX", "Dashboard Design",
    "Figma Design", "Wireframing", "Prototype", "Logo Design",
    "Brand Identity", "Social Media Design", "Banner Design",
  ],
  "Digital Marketing": [
    "Social Media Management", "Instagram Management", "Facebook Management",
    "LinkedIn Management", "SEO", "Google Ads", "Meta Ads",
    "Content Marketing", "Social Media Content", "Reels / Video Editing",
    "Digital Marketing Strategy",
  ],
  "Other Services": [
    "Domain Setup", "Hosting Setup", "Deployment", "SSL Setup",
    "Technical Support", "Bug Fixing", "Website Migration",
    "Performance Optimization", "Third-party API Integration", "Consultation",
  ],
};

const MONTHLY_SERVICES = new Set([
  "Website Maintenance", "Social Media Management", "Instagram Management",
  "Facebook Management", "LinkedIn Management", "SEO", "Google Ads",
  "Meta Ads", "Content Marketing", "Social Media Content",
  "Reels / Video Editing", "Technical Support",
]);


export const getServices = async (req, res, next) => {
  try {
    const filter = {};

    if (SERVICE_CATEGORIES.includes(req.query.category)) {
      filter.category = req.query.category;
    }

    if (req.query.active === "true") filter.isActive = true;

    if (req.query.q?.trim()) {
      filter.name = new RegExp(escapeRegex(req.query.q.trim()), "i");
    }

    const services = await Service.find(filter).sort({ category: 1, name: 1 });

    return res.json({ success: true, data: { services } });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const createService = async (req, res, next) => {
  try {
    const data = pick(req.body, SERVICE_FIELDS);

    if (data.taxRate === "") data.taxRate = null;

    const service = await Service.create(data);

    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: { service },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const updateService = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return fail(res, 400, "Invalid service id");
    }

    const service = await Service.findById(req.params.id);

    if (!service) return fail(res, 404, "Service not found");

    const data = pick(req.body, SERVICE_FIELDS);

    if (data.taxRate === "") data.taxRate = null;

    service.set(data);
    await service.save();

    return res.json({
      success: true,
      message: "Service updated successfully",
      data: { service },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const deleteService = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return fail(res, 400, "Invalid service id");
    }

    const service = await Service.findByIdAndDelete(req.params.id);

    if (!service) return fail(res, 404, "Service not found");

    return res.json({ success: true, message: "Service deleted successfully" });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const seedServices = async (req, res, next) => {
  try {
    const operations = Object.entries(SEED_SERVICES).flatMap(
      ([category, names]) =>
        names.map((name) => ({
          updateOne: {
            filter: { category, name },
            update: {
              $setOnInsert: {
                category,
                name,
                pricingType: MONTHLY_SERVICES.has(name) ? "Monthly" : "One Time",
                defaultPrice: 0,
                unit: "Nos",
                isActive: true,
              },
            },
            upsert: true,
            setDefaultsOnInsert: true,
          },
        })),
    );

    const result = await Service.bulkWrite(operations);

    return res.json({
      success: true,
      message: `${result.upsertedCount} services added`,
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};



const ITEM_FIELDS = [
  "_id",
  "service",
  "name",
  "category",
  "description",
  "details",
  "features",
  "deliverables",
  "pricingType",
  "quantity",
  "unit",
  "rate",
  "discountType",
  "discount",
  "taxRate",
  "timeline",
  "revisions",
  "notes",
];


const buildQuotationData = (body, settings, isCreate) => {
  const data = {};

  ["client", "project", "budget"].forEach((key) => {
    if (body[key] && typeof body[key] === "object") data[key] = body[key];
  });

  if (Array.isArray(body.items)) {
    data.items = body.items.map((item) => {
      const clean = pick(item, ITEM_FIELDS);

      if (clean.taxRate === undefined || clean.taxRate === "") {
        clean.taxRate = settings.defaultTaxRate;
      }

      return clean;
    });
  }

  ["deliverables", "exclusions", "terms", "milestones"].forEach((key) => {
    if (Array.isArray(body[key])) data[key] = body[key];
  });

  if (body.notes !== undefined) data.notes = body.notes;

  if (body.paymentTerms && typeof body.paymentTerms === "object") {
    data.paymentTerms = body.paymentTerms;
  }

  if (body.issueDate) data.issueDate = new Date(body.issueDate);
  if (body.validUntil) data.validUntil = endOfDay(body.validUntil);

  if (isCreate) {
    data.terms ??= [...settings.defaultTerms];
    data.exclusions ??= [...settings.defaultExclusions];
    data.notes ??= settings.defaultNotes;

    if (!data.paymentTerms) {
      const template =
        settings.paymentTemplates.find((item) => item.isDefault) ||
        settings.paymentTemplates[0];

      if (template) {
        data.paymentTerms = {
          name: template.name,
          milestones: template.milestones.map((m) => ({
            label: m.label,
            percent: m.percent,
          })),
        };
      }
    }

    data.issueDate ??= new Date();
    data.validUntil ??= endOfDay(
      addDays(data.issueDate, settings.defaultValidityDays),
    );
  }

  return data;
};


export const getQuotations = async (req, res, next) => {
  try {
    await expireOldQuotations();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const filter = {};

    if (QUOTATION_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    if (req.query.q?.trim()) {
      const rx = new RegExp(escapeRegex(req.query.q.trim()), "i");

      filter.$or = [
        { quotationNumber: rx },
        { "client.name": rx },
        { "client.companyName": rx },
        { "project.name": rx },
      ];
    }

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? endOfDay(req.query.to) : null;

    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      filter.issueDate = {};
      if (from && !Number.isNaN(from.getTime())) filter.issueDate.$gte = from;
      if (to && !Number.isNaN(to.getTime())) filter.issueDate.$lte = to;
    }

    const [quotations, total, grouped] = await Promise.all([
      Quotation.find(filter)
        .select(
          "-items -companySnapshot -deliverables -exclusions -terms -notes -milestones -statusHistory",
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Quotation.countDocuments(filter),
      Quotation.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            value: { $sum: "$totals.grandTotal" },
          },
        },
      ]),
    ]);

    const stats = {};
    QUOTATION_STATUSES.forEach((status) => {
      stats[status] = { count: 0, value: 0 };
    });
    grouped.forEach((item) => {
      stats[item._id] = { count: item.count, value: item.value };
    });

    return res.json({
      success: true,
      data: {
        quotations,
        stats,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const getQuotationById = async (req, res, next) => {
  try {
    await expireOldQuotations();

    const quotation = await findQuotation(req.params.id, res);

    if (!quotation) return;

    const company =
      quotation.companySnapshot ||
      companyData(await CompanySettings.getSettings());

    return res.json({ success: true, data: { quotation, company } });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const createQuotation = async (req, res, next) => {
  try {
    const settings = await CompanySettings.getSettings();
    const data = buildQuotationData(req.body, settings, true);

    const quotation = new Quotation({
      ...data,
      quotationNumber: "PENDING",
      createdBy: req.user._id,
      statusHistory: [{ status: "Draft", at: new Date(), note: "Created" }],
    });

    
    await quotation.validate();

    quotation.quotationNumber = await nextNumber(settings, data.issueDate);

    await quotation.save();

    return res.status(201).json({
      success: true,
      message: "Quotation created successfully",
      data: { quotation },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const updateQuotation = async (req, res, next) => {
  try {
    const quotation = await findQuotation(req.params.id, res);

    if (!quotation) return;

    if (quotation.status !== "Draft") {
      return fail(
        res,
        400,
        "Only Draft quotations can be edited. Duplicate it to make changes.",
      );
    }

    const settings = await CompanySettings.getSettings();

    quotation.set(buildQuotationData(req.body, settings, false));

    await quotation.save();

    return res.json({
      success: true,
      message: "Quotation updated successfully",
      data: { quotation },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const deleteQuotation = async (req, res, next) => {
  try {
    const quotation = await findQuotation(req.params.id, res);

    if (!quotation) return;

    if (quotation.status === "Converted") {
      return fail(res, 400, "A quotation converted to an invoice cannot be deleted");
    }

    await quotation.deleteOne();

    return res.json({ success: true, message: "Quotation deleted successfully" });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const duplicateQuotation = async (req, res, next) => {
  try {
    const original = await findQuotation(req.params.id, res);

    if (!original) return;

    const settings = await CompanySettings.getSettings();
    const src = original.toObject();
    const now = new Date();

    const copy = new Quotation({
      quotationNumber: "PENDING",
      client: src.client,
      project: src.project,
      budget: src.budget,
      items: src.items.map(
        ({ _id, subtotal, discountAmount, taxAmount, total, ...rest }) => rest,
      ),
      deliverables: src.deliverables,
      exclusions: src.exclusions,
      terms: src.terms,
      notes: src.notes,
      milestones: src.milestones.map(({ _id, ...rest }) => rest),
      paymentTerms: src.paymentTerms,
      issueDate: now,
      validUntil: endOfDay(addDays(now, settings.defaultValidityDays)),
      duplicatedFrom: original._id,
      createdBy: req.user._id,
      statusHistory: [
        {
          status: "Draft",
          at: now,
          note: `Duplicated from ${original.quotationNumber}`,
        },
      ],
    });

    await copy.validate();

    copy.quotationNumber = await nextNumber(settings, now);

    await copy.save();

    return res.status(201).json({
      success: true,
      message: "Quotation duplicated successfully",
      data: { quotation: copy },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const changeQuotationStatus = async (req, res, next) => {
  try {
    const quotation = await findQuotation(req.params.id, res);

    if (!quotation) return;

    const { status, note, validUntil } = req.body;
    const cleanNote = String(note || "").trim();

    if (!QUOTATION_STATUSES.includes(status)) {
      return fail(res, 400, "Invalid status");
    }

    if (status === "Converted") {
      return fail(res, 400, "Use the Convert to Invoice action");
    }

    if (!STATUS_TRANSITIONS[quotation.status].includes(status)) {
      return fail(
        res,
        400,
        `Cannot change status from ${quotation.status} to ${status}`,
      );
    }

    const now = new Date();

    if (status === "Sent") {
      if (quotation.items.length === 0) {
        return fail(res, 400, "Add at least one service before sending");
      }

      if (validUntil) quotation.validUntil = endOfDay(validUntil);

      if (quotation.validUntil < now) {
        return fail(res, 400, "Valid until date has passed. Please set a new date.");
      }

      quotation.sentAt = now;
      
      quotation.companySnapshot = companyData(await CompanySettings.getSettings());
    } else if (status === "Viewed") {
      quotation.viewedAt = now;
    } else if (status === "Accepted" || status === "Rejected") {
      quotation.respondedAt = now;
      quotation.rejectionReason = status === "Rejected" ? cleanNote : "";
    } else if (status === "Draft") {
      quotation.sentAt = null;
      quotation.viewedAt = null;
      quotation.respondedAt = null;
      quotation.rejectionReason = "";
      quotation.companySnapshot = null;
    }

    quotation.status = status;
    quotation.statusHistory.push({ status, at: now, note: cleanNote });

    await quotation.save();

    return res.json({
      success: true,
      message: `Quotation marked as ${status}`,
      data: { quotation },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};


export const convertToInvoice = async (req, res, next) => {
  try {
    const quotation = await findQuotation(req.params.id, res);

    if (!quotation) return;

    if (quotation.invoice) {
      return fail(res, 409, "This quotation is already converted to an invoice");
    }

    if (quotation.status !== "Accepted") {
      return fail(res, 400, "Only an Accepted quotation can be converted to an invoice");
    }

    const now = new Date();
    const src = quotation.toObject();
    const seq = await Counter.next(`invoice-${now.getFullYear()}`);

    const invoice = await Invoice.create({
      invoiceNumber: `INV-${now.getFullYear()}-${String(seq).padStart(3, "0")}`,
      quotation: quotation._id,
      issueDate: now,
      dueDate: addDays(now, 7),
      client: src.client,
      project: { name: src.project.name, description: src.project.description },
      items: src.items.map((item) => ({
        name: item.name,
        description: item.description,
        pricingType: item.pricingType,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        subtotal: item.subtotal,
        discountAmount: item.discountAmount,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
        total: item.total,
      })),
      totals: src.totals,
      paymentTerms: src.paymentTerms,
      terms: src.terms,
      notes: src.notes,
      createdBy: req.user._id,
    });

    quotation.status = "Converted";
    quotation.invoice = invoice._id;
    quotation.statusHistory.push({
      status: "Converted",
      at: now,
      note: `Invoice ${invoice.invoiceNumber} created`,
    });

    await quotation.save();

    return res.status(201).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} created`,
      data: { quotation, invoice },
    });
  } catch (error) {
    return handleError(res, next, error);
  }
};



export const getPublicQuotation = async (req, res, next) => {
  try {
    await expireOldQuotations();

    const quotation = await Quotation.findOne({
      viewToken: req.params.token,
      status: { $ne: "Draft" },
    }).select(
      "-createdBy -statusHistory -viewToken -invoice -duplicatedFrom -rejectionReason",
    );

    if (!quotation) return fail(res, 404, "Quotation not found");

    
    if (quotation.status === "Sent") {
      const now = new Date();

      await Quotation.updateOne(
        { _id: quotation._id, status: "Sent" },
        {
          $set: { status: "Viewed", viewedAt: now },
          $push: {
            statusHistory: { status: "Viewed", at: now, note: "Opened by client" },
          },
        },
      );

      quotation.status = "Viewed";
      quotation.viewedAt = now;
    }

    const company =
      quotation.companySnapshot ||
      companyData(await CompanySettings.getSettings());

    return res.json({ success: true, data: { quotation, company } });
  } catch (error) {
    return handleError(res, next, error);
  }
};