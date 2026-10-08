import mongoose from "mongoose";
import Asset from "../models/Asset.js";
import Employee from "../models/Employee.model.js";

const httpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

const EMP_FIELDS = "firstName lastName email designation profileImage";

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw httpError(400, "Invalid ID");
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createAsset = async (data) => {
  const exists = await Asset.findOne({ assetCode: data.assetCode.toUpperCase() });
  if (exists) throw httpError(409, "Ye asset code pehle se maujood hai");

  return Asset.create(data);
};

export const getAssets = async (query) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 100);

  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ name: rx }, { assetCode: rx }, { serialNumber: rx }];
  }

  const [items, total] = await Promise.all([
    Asset.find(filter)
      .select("-assignments")
      .populate("currentHolder", EMP_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Asset.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

export const getAssetById = async (id) => {
  assertValidId(id);

  const asset = await Asset.findById(id)
    .populate("currentHolder", EMP_FIELDS)
    .populate("assignments.employee", EMP_FIELDS);

  if (!asset) throw httpError(404, "Asset nahi mila");
  return asset;
};

export const updateAsset = async (id, data) => {
  assertValidId(id);

  if (data.assetCode) {
    const clash = await Asset.findOne({
      assetCode: data.assetCode.toUpperCase(),
      _id: { $ne: id },
    });
    if (clash) throw httpError(409, "Ye asset code pehle se maujood hai");
  }

  const asset = await Asset.findByIdAndUpdate(
    id,
    { $set: data },
    { new: true, runValidators: true }
  )
    .select("-assignments")
    .populate("currentHolder", EMP_FIELDS);

  if (!asset) throw httpError(404, "Asset nahi mila");
  return asset;
};

export const deleteAsset = async (id) => {
  assertValidId(id);

  const asset = await Asset.findById(id);
  if (!asset) throw httpError(404, "Asset nahi mila");

  if (asset.status === "assigned") {
    throw httpError(400, "Assigned asset delete nahi ho sakta, pehle return lo");
  }

  await asset.deleteOne();
};

export const assignAsset = async (id, { employeeId, conditionOnAssign, note }) => {
  assertValidId(id);

  const employee = await Employee.findById(employeeId).select("_id");
  if (!employee) throw httpError(404, "Employee nahi mila");

  
  const asset = await Asset.findOneAndUpdate(
    { _id: id, status: "available" },
    {
      $set: { status: "assigned", currentHolder: employeeId },
      $push: {
        assignments: {
          employee: employeeId,
          assignedAt: new Date(),
          conditionOnAssign,
          note,
        },
      },
    },
    { new: true }
  );

  if (!asset) {
    const existing = await Asset.findById(id).select("status");
    if (!existing) throw httpError(404, "Asset nahi mila");
    throw httpError(400, `Asset assign nahi ho sakta (status: ${existing.status})`);
  }

  return getAssetById(id);
};

export const returnAsset = async (id, { condition, nextStatus, note }) => {
  assertValidId(id);

  const asset = await Asset.findById(id);
  if (!asset) throw httpError(404, "Asset nahi mila");

  if (asset.status !== "assigned") {
    throw httpError(400, "Ye asset kisi ko assign nahi hai");
  }

  const current = [...asset.assignments].reverse().find((a) => !a.returnedAt);
  if (current) {
    current.returnedAt = new Date();
    current.conditionOnReturn = condition || asset.condition;
    if (note) current.note = note;
  }

  asset.currentHolder = null;
  asset.status = nextStatus || "available";
  if (condition) asset.condition = condition;

  await asset.save();
  return getAssetById(id);
};

export const changeStatus = async (id, status) => {
  assertValidId(id);

  const asset = await Asset.findById(id);
  if (!asset) throw httpError(404, "Asset nahi mila");

  if (asset.status === "assigned") {
    throw httpError(400, "Assigned asset ka status badalne se pehle use return lo");
  }

  asset.status = status;
  await asset.save();

  return Asset.findById(id)
    .select("-assignments")
    .populate("currentHolder", EMP_FIELDS);
};

export const getSummary = async () => {
  const rows = await Asset.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        value: { $sum: "$purchasePrice" },
      },
    },
  ]);

  const summary = {
    total: 0,
    available: 0,
    assigned: 0,
    under_repair: 0,
    retired: 0,
    totalValue: 0,
  };

  rows.forEach((r) => {
    summary[r._id] = r.count;
    summary.total += r.count;
    summary.totalValue += r.value;
  });

  return summary;
};