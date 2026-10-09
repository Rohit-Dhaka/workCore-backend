



import mongoose from "mongoose";

import {
  Supplier,
  Warehouse,
  Item,
  BOM,
  StockBatch,
  Movement,
  Counter,
  ProductionOrder,
  CustomerOrder,
} from "../models/manufacturing.model.js";


/* =====================================================================
   Helpers
   ===================================================================== */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const must = (cond, msg) => { if (!cond) throw bad(msg); };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const q3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v, d = 0) => (v === undefined || v === null || v === '' ? d : Number(v));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = (obj = {}, keys) => keys.reduce((o, k) => (obj[k] !== undefined ? { ...o, [k]: obj[k] } : o), {});

async function get(Model, id, label) {
  if (!mongoose.isValidObjectId(id)) throw bad(`${label} is required`);
  const doc = await Model.findById(id);
  if (!doc) throw new HttpError(404, `${label} not found`);
  return doc;
}

async function nextNo(key, prefix) {
  const c = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(c.seq).padStart(4, '0')}`;
}

function range(q) {
  if (!q.from && !q.to) return null;
  const r = {};
  if (q.from) r.$gte = new Date(q.from);
  if (q.to) { const d = new Date(q.to); d.setHours(23, 59, 59, 999); r.$lte = d; }
  return r;
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* =====================================================================
   Stock engine (single place that touches StockBatch + Movement)
   ===================================================================== */

async function onHand(itemId, warehouseId) {
  const match = { item: oid(itemId), qty: { $gt: 0 } };
  if (warehouseId) match.warehouse = oid(warehouseId);
  const [r] = await StockBatch.aggregate([
    { $match: match },
    { $group: { _id: null, qty: { $sum: '$qty' }, value: { $sum: { $multiply: ['$qty', '$unitCost'] } } } },
  ]);
  return { qty: q3(r?.qty || 0), value: money(r?.value || 0) };
}

/** Add stock to a batch (creates the batch if needed). Returns { batch, undo }. */
async function addStock({ item, warehouse, batchNo, qty, unitCost = 0, type, refType, refNo, note, supplier }) {
  qty = q3(qty);
  must(qty > 0, 'Quantity must be greater than zero');
  let batch = await StockBatch.findOne({ item, warehouse, batchNo });
  if (batch) {
    const total = q3(batch.qty + qty);
    batch.unitCost = total > 0 ? (batch.qty * batch.unitCost + qty * unitCost) / total : unitCost;
    batch.qty = total;
    await batch.save();
  } else {
    batch = await StockBatch.create({ item, warehouse, batchNo, qty, unitCost, supplier });
  }
  const mv = await Movement.create({ item, warehouse, batchNo, type, qty, unitCost, refType, refNo, note });
  return {
    batch,
    undo: async () => {
      await StockBatch.updateOne({ _id: batch._id }, { $inc: { qty: -qty } });
      await Movement.deleteOne({ _id: mv._id });
    },
  };
}

/** Decide which batches to take from (no writes). FIFO unless explicit batches are given. */
async function allocate({ item, warehouse, qty, batchNo, batches }) {
  qty = q3(qty);
  const rows = await StockBatch.find({ item, warehouse, qty: { $gt: 0 } }).sort({ receivedAt: 1, _id: 1 });

  if (batches && batches.length) {
    const merged = new Map();
    for (const b of batches) merged.set(b.batchNo, q3((merged.get(b.batchNo) || 0) + num(b.qty)));
    const out = [];
    for (const [no, take] of merged) {
      if (take <= 0) continue;
      const row = rows.find((r) => r.batchNo === no);
      must(row, `Batch ${no} has no stock in this warehouse`);
      must(take <= row.qty, `Batch ${no} has only ${row.qty} available`);
      out.push({ row, take });
    }
    const sum = q3(out.reduce((s, o) => s + o.take, 0));
    must(sum === qty, `Batch quantities (${sum}) must add up to ${qty}`);
    return out;
  }

  const pool = batchNo ? rows.filter((r) => r.batchNo === batchNo) : rows;
  const out = [];
  let need = qty;
  for (const row of pool) {
    if (need <= 0) break;
    const take = q3(Math.min(row.qty, need));
    out.push({ row, take });
    need = q3(need - take);
  }
  must(need <= 0, `Insufficient stock: required ${qty}, available ${q3(qty - need)}`);
  return out;
}

/** Remove stock. Returns { allocations: [{batchNo, qty, unitCost}], undo }. */
async function removeStock({ item, warehouse, qty, batchNo, batches, type, refType, refNo, note }) {
  qty = q3(qty);
  must(qty > 0, 'Quantity must be greater than zero');
  const plan = await allocate({ item, warehouse, qty, batchNo, batches });

  const done = [];
  for (const { row, take } of plan) {
    const upd = await StockBatch.findOneAndUpdate({ _id: row._id, qty: { $gte: take } }, { $inc: { qty: -take } });
    if (!upd) {
      for (const d of done) await StockBatch.updateOne({ _id: d.row._id }, { $inc: { qty: d.take } });
      throw new HttpError(409, 'Stock changed while processing. Please try again.');
    }
    done.push({ row, take });
  }

  const allocations = [];
  const moveIds = [];
  for (const { row, take } of done) {
    const mv = await Movement.create({
      item, warehouse, batchNo: row.batchNo, type, qty: -take, unitCost: row.unitCost, refType, refNo, note,
    });
    moveIds.push(mv._id);
    allocations.push({ batchNo: row.batchNo, qty: take, unitCost: row.unitCost });
  }
  return {
    allocations,
    undo: async () => {
      for (const d of done) await StockBatch.updateOne({ _id: d.row._id }, { $inc: { qty: d.take } });
      await Movement.deleteMany({ _id: { $in: moveIds } });
    },
  };
}

/* Reservations: raw materials held by open production orders, FG held by open customer orders */
async function rawReservations({ warehouse, excludeOrderId } = {}) {
  const q = { status: { $in: ['PLANNED', 'IN_PROGRESS'] } };
  if (warehouse) q.rmWarehouse = warehouse;
  if (excludeOrderId) q._id = { $ne: excludeOrderId };
  const orders = await ProductionOrder.find(q).populate('bom', 'materials');
  const map = new Map();
  for (const o of orders) {
    for (const m of o.bom?.materials || []) {
      const k = String(m.item);
      map.set(k, q3((map.get(k) || 0) + m.qtyPerUnit * (1 + m.wastagePct / 100) * o.plannedQty));
    }
  }
  return map;
}

async function fgReservations() {
  const orders = await CustomerOrder.find({ status: { $in: ['PENDING', 'PARTIAL'] } });
  const map = new Map();
  for (const o of orders) map.set(String(o.product), q3((map.get(String(o.product)) || 0) + o.pending));
  return map;
}

async function stockSummary({ type, q, warehouse } = {}) {
  const itemQ = {};
  if (type) itemQ.type = type;
  if (q) { const rx = new RegExp(esc(q), 'i'); itemQ.$or = [{ name: rx }, { sku: rx }, { category: rx }]; }
  const items = await Item.find(itemQ).sort('name');

  const match = { qty: { $gt: 0 } };
  if (warehouse) match.warehouse = oid(warehouse);
  const rows = await StockBatch.aggregate([
    { $match: match },
    { $group: {
      _id: { item: '$item', warehouse: '$warehouse' },
      qty: { $sum: '$qty' },
      value: { $sum: { $multiply: ['$qty', '$unitCost'] } },
      batches: { $sum: 1 },
    } },
  ]);
  const whName = new Map((await Warehouse.find()).map((w) => [String(w._id), w.name]));
  const byItem = new Map();
  for (const r of rows) {
    const k = String(r._id.item);
    const e = byItem.get(k) || { onHand: 0, value: 0, batches: 0, warehouses: [] };
    e.onHand += r.qty; e.value += r.value; e.batches += r.batches;
    e.warehouses.push({ warehouse: String(r._id.warehouse), name: whName.get(String(r._id.warehouse)), qty: q3(r.qty) });
    byItem.set(k, e);
  }

  const rawRes = await rawReservations();
  const fgRes = await fgReservations();
  return items.map((it) => {
    const e = byItem.get(String(it._id)) || { onHand: 0, value: 0, batches: 0, warehouses: [] };
    const reserved = (it.type === 'RAW' ? rawRes : fgRes).get(String(it._id)) || 0;
    const onHandQty = q3(e.onHand);
    return {
      _id: it._id, name: it.name, sku: it.sku, category: it.category, unit: it.unit, type: it.type,
      cost: it.cost, sellingPrice: it.sellingPrice, reorderLevel: it.reorderLevel, batchTracking: it.batchTracking,
      onHand: onHandQty,
      reserved: q3(reserved),
      available: q3(onHandQty - reserved),
      value: money(e.value),
      batches: e.batches,
      low: it.reorderLevel > 0 && onHandQty <= it.reorderLevel,
      warehouses: e.warehouses,
    };
  });
}

/* =====================================================================
   Suppliers & Warehouses (simple CRUD)
   ===================================================================== */

const suppliers = {
  list: wrap(async (req, res) => {
    const q = req.query.q ? { name: new RegExp(esc(req.query.q), 'i') } : {};
    res.json(await Supplier.find(q).sort('name'));
  }),
  create: wrap(async (req, res) => {
    res.status(201).json(await Supplier.create(pick(req.body, ['name', 'phone', 'email', 'address'])));
  }),
  update: wrap(async (req, res) => {
    const d = await get(Supplier, req.params.id, 'Supplier');
    d.set(pick(req.body, ['name', 'phone', 'email', 'address']));
    await d.save();
    res.json(d);
  }),
  remove: wrap(async (req, res) => {
    const d = await get(Supplier, req.params.id, 'Supplier');
    await Item.updateMany({ suppliers: d._id }, { $pull: { suppliers: d._id } });
    await d.deleteOne();
    res.json({ ok: true });
  }),
};

const warehouses = {
  list: wrap(async (req, res) => res.json(await Warehouse.find().sort('name'))),
  create: wrap(async (req, res) => res.status(201).json(await Warehouse.create(pick(req.body, ['name'])))),
  update: wrap(async (req, res) => {
    const d = await get(Warehouse, req.params.id, 'Warehouse');
    d.set(pick(req.body, ['name']));
    await d.save();
    res.json(d);
  }),
  remove: wrap(async (req, res) => {
    const d = await get(Warehouse, req.params.id, 'Warehouse');
    must(!(await StockBatch.exists({ warehouse: d._id })) && !(await Movement.exists({ warehouse: d._id })),
      'This warehouse has stock history and cannot be deleted');
    await d.deleteOne();
    res.json({ ok: true });
  }),
};

/* =====================================================================
   Items
   ===================================================================== */

const ITEM_FIELDS = ['name', 'sku', 'type', 'category', 'unit', 'cost', 'sellingPrice', 'reorderLevel', 'batchTracking', 'suppliers'];

const items = {
  list: wrap(async (req, res) => {
    const q = {};
    if (req.query.type) q.type = req.query.type;
    if (req.query.category) q.category = req.query.category;
    if (req.query.q) { const rx = new RegExp(esc(req.query.q), 'i'); q.$or = [{ name: rx }, { sku: rx }, { category: rx }]; }
    res.json(await Item.find(q).populate('suppliers', 'name').sort('name'));
  }),
  get: wrap(async (req, res) => {
    const d = await Item.findById(req.params.id).populate('suppliers', 'name');
    if (!d) throw new HttpError(404, 'Item not found');
    res.json(d);
  }),
  create: wrap(async (req, res) => {
    const d = await Item.create(pick(req.body, ITEM_FIELDS));
    res.status(201).json(await d.populate('suppliers', 'name'));
  }),
  update: wrap(async (req, res) => {
    const d = await get(Item, req.params.id, 'Item');
    const data = pick(req.body, ITEM_FIELDS);
    if (data.type && data.type !== d.type) {
      const used = (await Movement.exists({ item: d._id })) || (await BOM.exists({ $or: [{ product: d._id }, { 'materials.item': d._id }] }));
      must(!used, 'Item type cannot be changed once it is used');
    }
    d.set(data);
    await d.save();
    res.json(await d.populate('suppliers', 'name'));
  }),
  remove: wrap(async (req, res) => {
    const d = await get(Item, req.params.id, 'Item');
    const used = (await Movement.exists({ item: d._id }))
      || (await BOM.exists({ $or: [{ product: d._id }, { 'materials.item': d._id }] }))
      || (await ProductionOrder.exists({ product: d._id }))
      || (await CustomerOrder.exists({ product: d._id }));
    must(!used, 'This item is used in stock, BOM or orders and cannot be deleted');
    await d.deleteOne();
    res.json({ ok: true });
  }),
};

/* =====================================================================
   Production planning (shared by BOM + Production)
   ===================================================================== */

async function planFor({ bom, qty = 0, rmWarehouse, excludeOrderId, physicalOnly = false }) {
  const b = await BOM.findById(bom).populate('materials.item').populate('product', 'name sku unit');
  if (!b) throw new HttpError(404, 'BOM not found');
  qty = q3(num(qty));
  const reserved = physicalOnly ? new Map() : await rawReservations({ warehouse: rmWarehouse, excludeOrderId });

  const lines = [];
  let maxQty = null;
  let bottleneck = null;
  let materialUnit = 0;
  for (const m of b.materials) {
    const perUnit = m.qtyPerUnit * (1 + m.wastagePct / 100);
    const stock = await onHand(m.item._id, rmWarehouse);
    const available = Math.max(0, q3(stock.qty - (reserved.get(String(m.item._id)) || 0)));
    const required = q3(perUnit * qty);
    const shortage = Math.max(0, q3(required - available));
    const possible = perUnit > 0 ? Math.floor(available / perUnit) : Infinity;
    if (maxQty === null || possible < maxQty) { maxQty = possible; bottleneck = m.item.name; }
    materialUnit += perUnit * m.item.cost;
    lines.push({
      item: m.item._id, name: m.item.name, sku: m.item.sku, unit: m.item.unit,
      qtyPerUnit: m.qtyPerUnit, wastagePct: m.wastagePct,
      netRequired: q3(m.qtyPerUnit * qty),
      required, available, shortage, maxQty: possible === Infinity ? null : possible,
      unitCost: m.item.cost, lineCost: money(required * m.item.cost),
    });
  }
  const materialCost = money(materialUnit * qty);
  const labourCost = money(b.labourCost * qty);
  const overheadCost = money(b.overheadCost * qty);
  const totalCost = money(materialCost + labourCost + overheadCost);
  return {
    bom: b._id, bomName: b.name, product: b.product,
    qty,
    lines,
    shortages: lines.filter((l) => l.shortage > 0).map((l) => l.name),
    canProduce: qty > 0 && lines.every((l) => l.shortage === 0),
    maxQty: maxQty === null || maxQty === Infinity ? 0 : maxQty,
    bottleneck: lines.length ? bottleneck : null,
    estimate: {
      materialCost, labourCost, overheadCost, totalCost,
      unitCost: qty > 0 ? money(totalCost / qty) : money(materialUnit + b.labourCost + b.overheadCost),
      sellingValue: money(b.sellingPrice * qty),
      profit: money(b.sellingPrice * qty - totalCost),
    },
  };
}

/* =====================================================================
   BOM
   ===================================================================== */

function bomView(b) {
  const o = b.toJSON();
  let materialCost = 0;
  o.materials = o.materials.map((m) => {
    const cost = m.item?.cost || 0;
    const effective = m.qtyPerUnit * (1 + m.wastagePct / 100);
    const lineCost = effective * cost;
    materialCost += lineCost;
    return { ...m, effectiveQty: q3(effective), unitCost: cost, lineCost: money(lineCost) };
  });
  o.materialCost = money(materialCost);
  o.totalCost = money(materialCost + b.labourCost + b.overheadCost);
  o.profit = money(b.sellingPrice - o.totalCost);
  o.margin = b.sellingPrice ? money((o.profit / b.sellingPrice) * 100) : 0;
  return o;
}

async function cleanBom(body) {
  const product = await get(Item, body.product, 'Product');
  must(product.type === 'FINISHED', 'BOM product must be a finished product');
  must(Array.isArray(body.materials) && body.materials.length > 0, 'Add at least one raw material');
  const seen = new Set();
  const materials = [];
  for (const m of body.materials) {
    const item = await get(Item, m.item, 'Raw material');
    must(item.type === 'RAW', `${item.name} is not a raw material`);
    must(!seen.has(String(item._id)), `${item.name} is added more than once`);
    seen.add(String(item._id));
    const qtyPerUnit = num(m.qtyPerUnit);
    const wastagePct = num(m.wastagePct);
    must(qtyPerUnit > 0, `Quantity for ${item.name} must be greater than zero`);
    must(wastagePct >= 0 && wastagePct <= 100, 'Wastage % must be between 0 and 100');
    materials.push({ item: item._id, qtyPerUnit, wastagePct });
  }
  const labourCost = num(body.labourCost);
  const overheadCost = num(body.overheadCost);
  must(labourCost >= 0 && overheadCost >= 0, 'Costs cannot be negative');
  return {
    product: product._id,
    name: (body.name || 'Standard').trim(),
    materials,
    labourCost,
    overheadCost,
    sellingPrice: body.sellingPrice === undefined || body.sellingPrice === '' ? product.sellingPrice : num(body.sellingPrice),
  };
}

const populateBom = (q) => q.populate('product', 'name sku unit sellingPrice').populate('materials.item', 'name sku unit cost');

const bom = {
  list: wrap(async (req, res) => {
    const q = {};
    if (req.query.product) q.product = req.query.product;
    const list = await populateBom(BOM.find(q).sort('-createdAt'));
    res.json(list.map(bomView));
  }),
  get: wrap(async (req, res) => {
    const d = await populateBom(BOM.findById(req.params.id));
    if (!d) throw new HttpError(404, 'BOM not found');
    res.json(bomView(d));
  }),
  create: wrap(async (req, res) => {
    const d = await BOM.create(await cleanBom(req.body));
    res.status(201).json(bomView(await populateBom(BOM.findById(d._id))));
  }),
  update: wrap(async (req, res) => {
    const d = await get(BOM, req.params.id, 'BOM');
    d.set(await cleanBom({ ...req.body, product: req.body.product || d.product }));
    await d.save();
    res.json(bomView(await populateBom(BOM.findById(d._id))));
  }),
  remove: wrap(async (req, res) => {
    const d = await get(BOM, req.params.id, 'BOM');
    must(!(await ProductionOrder.exists({ bom: d._id })), 'This BOM is used by production orders and cannot be deleted');
    await d.deleteOne();
    res.json({ ok: true });
  }),
  requirements: wrap(async (req, res) => {
    res.json(await planFor({ bom: req.params.id, qty: req.query.qty, rmWarehouse: req.query.warehouse }));
  }),
};

/* =====================================================================
   Inventory
   ===================================================================== */

const inventory = {
  summary: wrap(async (req, res) => {
    res.json(await stockSummary({ type: req.query.type, q: req.query.q, warehouse: req.query.warehouse }));
  }),

  batches: wrap(async (req, res) => {
    const q = req.query.all ? {} : { qty: { $gt: 0 } };
    if (req.query.item) q.item = req.query.item;
    if (req.query.warehouse) q.warehouse = req.query.warehouse;
    if (req.query.type) {
      const ids = await Item.find({ type: req.query.type }).distinct('_id');
      q.item = req.query.item ? q.item : { $in: ids };
    }
    const rows = await StockBatch.find(q)
      .populate('item', 'name sku unit type').populate('warehouse', 'name').populate('supplier', 'name')
      .sort({ receivedAt: 1 });
    res.json(rows.map((b) => ({ ...b.toJSON(), value: money(b.qty * b.unitCost) })));
  }),

  movements: wrap(async (req, res) => {
    const q = {};
    if (req.query.item) q.item = req.query.item;
    if (req.query.warehouse) q.warehouse = req.query.warehouse;
    if (req.query.type) q.type = req.query.type;
    if (req.query.batchNo) q.batchNo = req.query.batchNo;
    const r = range(req.query);
    if (r) q.date = r;
    const limit = Math.min(num(req.query.limit, 200), 1000);
    res.json(await Movement.find(q).populate('item', 'name sku unit').populate('warehouse', 'name').sort({ date: -1, _id: -1 }).limit(limit));
  }),

  receive: wrap(async (req, res) => {
    const b = req.body;
    const item = await get(Item, b.item, 'Item');
    const wh = await get(Warehouse, b.warehouse, 'Warehouse');
    const qty = q3(num(b.qty));
    must(qty > 0, 'Quantity must be greater than zero');
    const unitCost = num(b.unitCost, item.cost);
    must(unitCost >= 0, 'Unit cost cannot be negative');
    if (b.supplier) await get(Supplier, b.supplier, 'Supplier');

    let batchNo = String(b.batchNo || '').trim().toUpperCase();
    if (!item.batchTracking) batchNo = 'DEFAULT';
    else if (!batchNo) batchNo = await nextNo('lot', item.type === 'RAW' ? 'RM' : 'FG');

    const before = await onHand(item._id);
    const { batch } = await addStock({
      item: item._id, warehouse: wh._id, batchNo, qty, unitCost, type: 'RECEIVE',
      refType: 'RECEIPT', refNo: b.reference || undefined, note: b.note, supplier: b.supplier || undefined,
    });
    if (item.type === 'RAW') {           // moving-average cost keeps BOM costing current
      item.cost = Math.round(((before.value + qty * unitCost) / (before.qty + qty)) * 10000) / 10000;
      await item.save();
    }
    res.status(201).json(batch);
  }),

  transfer: wrap(async (req, res) => {
    const b = req.body;
    const item = await get(Item, b.item, 'Item');
    const from = await get(Warehouse, b.fromWarehouse, 'Source warehouse');
    const to = await get(Warehouse, b.toWarehouse, 'Destination warehouse');
    must(String(from._id) !== String(to._id), 'Source and destination must be different');
    const qty = q3(num(b.qty));
    must(qty > 0, 'Quantity must be greater than zero');

    const refNo = await nextNo('transfer', 'TR');
    const out = await removeStock({
      item: item._id, warehouse: from._id, qty, batchNo: b.batchNo || undefined,
      type: 'TRANSFER_OUT', refType: 'TRANSFER', refNo, note: `To ${to.name}${b.note ? ' - ' + b.note : ''}`,
    });
    const undos = [out.undo];
    try {
      for (const a of out.allocations) {
        const r = await addStock({
          item: item._id, warehouse: to._id, batchNo: a.batchNo, qty: a.qty, unitCost: a.unitCost,
          type: 'TRANSFER_IN', refType: 'TRANSFER', refNo, note: `From ${from.name}`,
        });
        undos.push(r.undo);
      }
    } catch (e) {
      for (const u of undos.reverse()) await u().catch(() => {});
      throw e;
    }
    res.status(201).json({ ok: true, refNo, moved: out.allocations });
  }),

  adjust: wrap(async (req, res) => {
    const b = req.body;
    const item = await get(Item, b.item, 'Item');
    const wh = await get(Warehouse, b.warehouse, 'Warehouse');
    const type = b.type === 'DAMAGE' ? 'DAMAGE' : 'ADJUST';
    let qty = q3(num(b.qty));
    must(qty !== 0, 'Quantity cannot be zero');
    must(b.note && String(b.note).trim(), 'Please enter a reason');
    const refNo = await nextNo('adjust', 'ADJ');
    const base = { item: item._id, warehouse: wh._id, type, refType: 'ADJUSTMENT', refNo, note: b.note };

    if (type === 'DAMAGE' || qty < 0) {
      qty = Math.abs(qty);
      await removeStock({ ...base, qty, batchNo: b.batchNo || undefined });
    } else {
      let batchNo = String(b.batchNo || '').trim();
      if (!item.batchTracking) batchNo = 'DEFAULT';
      must(batchNo, 'Batch number is required to add stock');
      await addStock({ ...base, batchNo, qty, unitCost: item.cost });
    }
    res.status(201).json({ ok: true, refNo });
  }),

  trace: wrap(async (req, res) => {
    const batchNo = req.params.batchNo;
    const moves = await Movement.find({ batchNo }).populate('item', 'name sku unit type').populate('warehouse', 'name').sort({ date: 1, _id: 1 });
    must(moves.length, `No batch found with number ${batchNo}`);
    const stock = await StockBatch.find({ batchNo, qty: { $gt: 0 } }).populate('item', 'name sku unit').populate('warehouse', 'name');

    // production that created this batch + the raw batches it consumed
    const madeBy = await ProductionOrder.find({ fgBatchNo: batchNo, status: 'COMPLETED' }).populate('product', 'name sku');
    const madeFrom = [];
    for (const po of madeBy) {
      const used = await Movement.find({ refNo: po.orderNo, type: 'PRODUCTION_CONSUME' }).populate('item', 'name sku unit');
      madeFrom.push({
        orderNo: po.orderNo, product: po.product, qty: po.plannedQty, completedAt: po.completedAt,
        materials: used.map((u) => ({ item: u.item, batchNo: u.batchNo, qty: Math.abs(u.qty) })),
      });
    }

    // where a raw batch was consumed
    const consumedIn = [];
    const consumeNos = [...new Set(moves.filter((m) => m.type.startsWith('PRODUCTION_C') || m.type === 'PRODUCTION_WASTAGE').map((m) => m.refNo))];
    if (consumeNos.length) {
      const pos = await ProductionOrder.find({ orderNo: { $in: consumeNos } }).populate('product', 'name sku');
      for (const po of pos) consumedIn.push({ orderNo: po.orderNo, product: po.product, fgBatchNo: po.fgBatchNo, qty: po.plannedQty });
    }

    // dispatches of this batch
    const dispatches = [];
    const orderNos = [...new Set(moves.filter((m) => m.type === 'DISPATCH').map((m) => m.refNo))];
    if (orderNos.length) {
      const orders = await CustomerOrder.find({ orderNo: { $in: orderNos } });
      for (const o of orders) {
        for (const d of o.dispatches) {
          const part = d.batches.find((x) => x.batchNo === batchNo);
          if (part) dispatches.push({ orderNo: o.orderNo, customer: o.customer, date: d.date, qty: part.qty });
        }
      }
    }
    res.json({ batchNo, stock, movements: moves, madeFrom, consumedIn, dispatches });
  }),
};

/* =====================================================================
   Production
   ===================================================================== */

const populatePO = (q) => q
  .populate('product', 'name sku unit').populate('bom', 'name')
  .populate('rmWarehouse', 'name').populate('fgWarehouse', 'name').populate('consumption.item', 'name sku unit');

async function cleanProduction(b, existingId) {
  const product = await get(Item, b.product, 'Product');
  must(product.type === 'FINISHED', 'Please select a finished product');
  const bomDoc = await get(BOM, b.bom, 'BOM');
  must(String(bomDoc.product) === String(product._id), 'The BOM does not belong to the selected product');
  const rm = await get(Warehouse, b.rmWarehouse, 'Raw material warehouse');
  const fg = await get(Warehouse, b.fgWarehouse, 'Finished goods warehouse');
  const plannedQty = q3(num(b.plannedQty));
  must(plannedQty > 0, 'Planned quantity must be greater than zero');

  
  const fgBatchNo = String(b.fgBatchNo || '').trim().toUpperCase() || await nextNo('lot', 'FG');
  const clash = await ProductionOrder.findOne({
    product: product._id, fgBatchNo, status: { $ne: 'CANCELLED' }, ...(existingId ? { _id: { $ne: existingId } } : {}),
  });
  must(!clash, `FG batch ${fgBatchNo} is already used for this product`);
  must(!(await StockBatch.exists({ item: product._id, batchNo: fgBatchNo })), `FG batch ${fgBatchNo} already exists in stock`);

  const startDate = b.startDate ? new Date(b.startDate) : undefined;
  const endDate = b.endDate ? new Date(b.endDate) : undefined;
  must(!(startDate && endDate && endDate < startDate), 'End date cannot be before start date');
  const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(b.priority) ? b.priority : 'MEDIUM';
  return {
    product: product._id, bom: bomDoc._id, rmWarehouse: rm._id, fgWarehouse: fg._id,
    plannedQty, fgBatchNo, startDate, endDate, priority,
  };
}

const production = {
  plan: wrap(async (req, res) => {
    must(req.query.bom, 'Select a BOM');
    res.json(await planFor({
      bom: req.query.bom, qty: req.query.qty, rmWarehouse: req.query.rmWarehouse || undefined,
      excludeOrderId: req.query.exclude || undefined,
    }));
  }),

  list: wrap(async (req, res) => {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.product) q.product = req.query.product;
    const r = range(req.query);
    if (r) q.createdAt = r;
    res.json(await populatePO(ProductionOrder.find(q).sort({ createdAt: -1 })));
  }),

  get: wrap(async (req, res) => {
    const d = await populatePO(ProductionOrder.findById(req.params.id));
    if (!d) throw new HttpError(404, 'Production order not found');
    const open = ['PLANNED', 'IN_PROGRESS'].includes(d.status);
    const plan = open
      ? await planFor({ bom: d.bom._id, qty: d.plannedQty, rmWarehouse: d.rmWarehouse._id, excludeOrderId: d._id })
      : null;
    res.json({ ...d.toJSON(), plan });
  }),

  create: wrap(async (req, res) => {
    const data = await cleanProduction(req.body);
    const d = await ProductionOrder.create({ ...data, orderNo: await nextNo('production', 'PO') });
    res.status(201).json(await populatePO(ProductionOrder.findById(d._id)));
  }),

  update: wrap(async (req, res) => {
    const d = await get(ProductionOrder, req.params.id, 'Production order');
    must(d.status === 'PLANNED', 'Only planned orders can be edited');
    d.set(await cleanProduction({ ...d.toJSON(), ...req.body }, d._id));
    await d.save();
    res.json(await populatePO(ProductionOrder.findById(d._id)));
  }),

  start: wrap(async (req, res) => {
    const d = await get(ProductionOrder, req.params.id, 'Production order');
    must(d.status === 'PLANNED', 'Only planned orders can be started');
    d.status = 'IN_PROGRESS';
    if (!d.startDate) d.startDate = new Date();
    await d.save();
    res.json(await populatePO(ProductionOrder.findById(d._id)));
  }),

  cancel: wrap(async (req, res) => {
    const d = await get(ProductionOrder, req.params.id, 'Production order');
    must(['PLANNED', 'IN_PROGRESS'].includes(d.status), 'Only open orders can be cancelled');
    d.status = 'CANCELLED';
    await d.save();
    res.json(await populatePO(ProductionOrder.findById(d._id)));
  }),

  remove: wrap(async (req, res) => {
    const d = await get(ProductionOrder, req.params.id, 'Production order');
    must(['PLANNED', 'CANCELLED'].includes(d.status), 'Only planned or cancelled orders can be deleted');
    await d.deleteOne();
    res.json({ ok: true });
  }),

  complete: wrap(async (req, res) => {
    const po = await get(ProductionOrder, req.params.id, 'Production order');
    must(['PLANNED', 'IN_PROGRESS'].includes(po.status), 'This order is already closed');
    const bomDoc = await BOM.findById(po.bom).populate('materials.item');
    must(bomDoc, 'BOM no longer exists');

    // 1. Check physical stock for every material before touching anything
    const plan = await planFor({ bom: po.bom, qty: po.plannedQty, rmWarehouse: po.rmWarehouse, physicalOnly: true });
    must(plan.shortages.length === 0, `Not enough material to complete: ${plan.shortages.join(', ')}`);

    const undos = [];
    try {
      // 2. Deduct consumed material and record wastage (FIFO across batches)
      const consumption = [];
      let materialCost = 0;
      for (const m of bomDoc.materials) {
        const consumedQty = q3(m.qtyPerUnit * po.plannedQty);
        const wastageQty = q3(consumedQty * m.wastagePct / 100);
        const base = { item: m.item._id, warehouse: po.rmWarehouse, refType: 'PRODUCTION', refNo: po.orderNo };
        let cost = 0;

        const used = await removeStock({ ...base, qty: consumedQty, type: 'PRODUCTION_CONSUME', note: `For ${po.fgBatchNo}` });
        undos.push(used.undo);
        cost += used.allocations.reduce((s, a) => s + a.qty * a.unitCost, 0);

        if (wastageQty > 0) {
          const lost = await removeStock({ ...base, qty: wastageQty, type: 'PRODUCTION_WASTAGE', note: `Wastage for ${po.fgBatchNo}` });
          undos.push(lost.undo);
          cost += lost.allocations.reduce((s, a) => s + a.qty * a.unitCost, 0);
        }
        materialCost += cost;
        consumption.push({ item: m.item._id, consumedQty, wastageQty, cost: money(cost) });
      }

      // 3. Production cost
      materialCost = money(materialCost);
      const labourCost = money(bomDoc.labourCost * po.plannedQty);
      const overheadCost = money(bomDoc.overheadCost * po.plannedQty);
      const totalCost = money(materialCost + labourCost + overheadCost);
      const unitCost = totalCost / po.plannedQty;

      // 4. Add finished goods as a new batch
      const fg = await addStock({
        item: po.product, warehouse: po.fgWarehouse, batchNo: po.fgBatchNo, qty: po.plannedQty, unitCost,
        type: 'PRODUCTION_OUTPUT', refType: 'PRODUCTION', refNo: po.orderNo, note: 'Production output',
      });
      undos.push(fg.undo);

      // 5. Close the order
      Object.assign(po, {
        status: 'COMPLETED', completedAt: new Date(), consumption, materialCost, labourCost, overheadCost,
        totalCost, unitCost: Math.round(unitCost * 10000) / 10000,
      });
      if (!po.startDate) po.startDate = po.completedAt;
      po.endDate = po.completedAt;
      await po.save();

      await Item.updateOne({ _id: po.product }, { cost: Math.round(unitCost * 10000) / 10000 });
    } catch (e) {
      for (const u of undos.reverse()) await u().catch(() => {});
      throw e;
    }
    res.json(await populatePO(ProductionOrder.findById(po._id)));
  }),
};

/* =====================================================================
   Customer orders & dispatch
   ===================================================================== */

const populateOrder = (q) => q.populate('product', 'name sku unit').populate('dispatches.warehouse', 'name');

async function cleanOrder(b, product) {
  const qty = q3(num(b.qty));
  must(qty > 0, 'Ordered quantity must be greater than zero');
  const price = num(b.price, product.sellingPrice);
  const discount = num(b.discount);
  const tax = num(b.tax);
  must(price >= 0, 'Price cannot be negative');
  must(discount >= 0 && discount <= 100, 'Discount must be between 0 and 100');
  must(tax >= 0 && tax <= 100, 'Tax must be between 0 and 100');
  return { qty, price, discount, tax };
}

const orders = {
  list: wrap(async (req, res) => {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.paymentStatus) q.paymentStatus = req.query.paymentStatus;
    if (req.query.pending) q.status = { $in: ['PENDING', 'PARTIAL'] };
    if (req.query.q) { const rx = new RegExp(esc(req.query.q), 'i'); q.$or = [{ orderNo: rx }, { customer: rx }]; }
    const r = range(req.query);
    if (r) q.createdAt = r;
    res.json(await populateOrder(CustomerOrder.find(q).sort({ createdAt: -1 })));
  }),

  get: wrap(async (req, res) => {
    const d = await populateOrder(CustomerOrder.findById(req.params.id));
    if (!d) throw new HttpError(404, 'Order not found');
    res.json(d);
  }),

  create: wrap(async (req, res) => {
    const b = req.body;
    const product = await get(Item, b.product, 'Product');
    must(product.type === 'FINISHED', 'Please select a finished product');
    must(b.customer && String(b.customer).trim(), 'Customer is required');
    const money_ = await cleanOrder(b, product);
    const d = await CustomerOrder.create({
      orderNo: await nextNo('order', 'ORD'),
      customer: String(b.customer).trim(),
      product: product._id,
      ...money_,
      deliveryDate: b.deliveryDate ? new Date(b.deliveryDate) : undefined,
      paymentStatus: ['UNPAID', 'PARTIAL', 'PAID'].includes(b.paymentStatus) ? b.paymentStatus : 'UNPAID',
    });
    res.status(201).json(await populateOrder(CustomerOrder.findById(d._id)));
  }),

  update: wrap(async (req, res) => {
    const d = await get(CustomerOrder, req.params.id, 'Order');
    must(d.status !== 'CANCELLED', 'Cancelled orders cannot be edited');
    const b = req.body;
    if (b.customer !== undefined) { must(String(b.customer).trim(), 'Customer is required'); d.customer = String(b.customer).trim(); }
    if (b.deliveryDate !== undefined) d.deliveryDate = b.deliveryDate ? new Date(b.deliveryDate) : undefined;
    if (b.paymentStatus && ['UNPAID', 'PARTIAL', 'PAID'].includes(b.paymentStatus)) d.paymentStatus = b.paymentStatus;

    const dispatched = d.dispatchedQty > 0;
    if (dispatched) {
      const changedLocked = ['product', 'price', 'discount', 'tax'].some((k) => b[k] !== undefined && String(b[k]) !== String(k === 'product' ? d.product : d[k]));
      must(!changedLocked, 'Product, price, discount and tax cannot change after dispatch has started');
    }
    if (b.qty !== undefined || (!dispatched && (b.product || b.price !== undefined || b.discount !== undefined || b.tax !== undefined))) {
      const product = await get(Item, dispatched ? d.product : (b.product || d.product), 'Product');
      must(product.type === 'FINISHED', 'Please select a finished product');
      const merged = await cleanOrder({
        qty: b.qty ?? d.qty, price: b.price ?? d.price, discount: b.discount ?? d.discount, tax: b.tax ?? d.tax,
      }, product);
      must(merged.qty >= d.dispatchedQty, `Quantity cannot be less than already dispatched (${d.dispatchedQty})`);
      d.set({ product: product._id, ...merged });
    }
    d.status = d.dispatchedQty >= d.qty ? 'DISPATCHED' : d.dispatchedQty > 0 ? 'PARTIAL' : 'PENDING';
    await d.save();
    res.json(await populateOrder(CustomerOrder.findById(d._id)));
  }),

  cancel: wrap(async (req, res) => {
    const d = await get(CustomerOrder, req.params.id, 'Order');
    must(d.dispatchedQty === 0, 'Orders with dispatched goods cannot be cancelled');
    must(d.status !== 'CANCELLED', 'Order is already cancelled');
    d.status = 'CANCELLED';
    await d.save();
    res.json(await populateOrder(CustomerOrder.findById(d._id)));
  }),

  dispatch: wrap(async (req, res) => {
    const b = req.body;
    const o = await get(CustomerOrder, req.params.id, 'Order');
    must(o.status !== 'CANCELLED', 'This order is cancelled');
    const pending = o.pending;
    must(pending > 0, 'Nothing left to dispatch on this order');
    const wh = await get(Warehouse, b.warehouse, 'Warehouse');

    const batches = (Array.isArray(b.batches) ? b.batches : [])
      .filter((x) => num(x.qty) > 0)
      .map((x) => ({ batchNo: String(x.batchNo), qty: q3(num(x.qty)) }));
    const full = b.mode === 'full';
    const qty = batches.length ? q3(batches.reduce((s, x) => s + x.qty, 0)) : full ? pending : q3(num(b.qty));
    must(qty > 0, 'Enter the quantity to dispatch');
    must(qty <= pending, `Cannot dispatch more than the pending quantity (${pending})`);
    must(!(full && qty !== pending), 'A full dispatch must cover the whole pending quantity');

    const out = await removeStock({
      item: o.product, warehouse: wh._id, qty, batches: batches.length ? batches : undefined,
      type: 'DISPATCH', refType: 'ORDER', refNo: o.orderNo, note: `Dispatch to ${o.customer}`,
    });
    try {
      const cost = money(out.allocations.reduce((s, a) => s + a.qty * a.unitCost, 0));
      const revenue = money(qty * o.netUnitPrice);
      o.dispatches.push({ date: new Date(), warehouse: wh._id, qty, cost, revenue, batches: out.allocations });
      o.dispatchedQty = q3(o.dispatchedQty + qty);
      o.status = o.dispatchedQty >= o.qty ? 'DISPATCHED' : 'PARTIAL';
      await o.save();
    } catch (e) {
      await out.undo();
      throw e;
    }
    res.json(await populateOrder(CustomerOrder.findById(o._id)));
  }),
};

/* =====================================================================
   Reports & dashboard
   ===================================================================== */

async function dispatchRows(q) {
  const r = range(q);
  const filter = { 'dispatches.0': { $exists: true } };
  if (r) filter['dispatches.date'] = r;
  const list = await CustomerOrder.find(filter).populate('product', 'name sku unit').sort({ createdAt: -1 });
  const rows = [];
  for (const o of list) {
    for (const d of o.dispatches) {
      if (r && ((r.$gte && d.date < r.$gte) || (r.$lte && d.date > r.$lte))) continue;
      rows.push({
        date: d.date, orderNo: o.orderNo, customer: o.customer, product: o.product,
        batches: d.batches.map((x) => `${x.batchNo} (${x.qty})`).join(', '),
        qty: d.qty, revenue: d.revenue, cost: d.cost, profit: money(d.revenue - d.cost),
      });
    }
  }
  return rows.sort((a, b) => b.date - a.date);
}

const sum = (rows, k) => money(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

async function groupMoves(types, q) {
  const match = { type: { $in: types } };
  const r = range(q);
  if (r) match.date = r;
  const rows = await Movement.aggregate([
    { $match: match },
    { $group: {
      _id: { item: '$item', type: '$type' },
      qty: { $sum: { $abs: '$qty' } },
      value: { $sum: { $multiply: [{ $abs: '$qty' }, '$unitCost'] } },
      entries: { $sum: 1 },
    } },
  ]);
  const map = new Map((await Item.find({ _id: { $in: rows.map((x) => x._id.item) } })).map((i) => [String(i._id), i]));
  return rows.map((x) => {
    const it = map.get(String(x._id.item));
    return { item: it?.name, sku: it?.sku, unit: it?.unit, type: x._id.type, qty: q3(x.qty), value: money(x.value), entries: x.entries };
  }).sort((a, b) => b.value - a.value);
}

const reports = {
  get: wrap(async (req, res) => {
    const q = req.query;
    switch (req.params.type) {
      case 'production': {
        const f = {};
        const r = range(q);
        if (r) f.createdAt = r;
        if (q.status) f.status = q.status;
        const list = await populatePO(ProductionOrder.find(f).sort({ createdAt: -1 }));
        const rows = list.map((p) => ({
          orderNo: p.orderNo, product: p.product?.name, fgBatchNo: p.fgBatchNo, status: p.status, priority: p.priority,
          qty: p.plannedQty, materialCost: p.materialCost, labourCost: p.labourCost, overheadCost: p.overheadCost,
          totalCost: p.totalCost, unitCost: p.unitCost, date: p.completedAt || p.createdAt,
        }));
        const done = rows.filter((x) => x.status === 'COMPLETED');
        return res.json({ rows, totals: { orders: rows.length, completedQty: sum(done, 'qty'), totalCost: sum(done, 'totalCost') } });
      }
      case 'raw-stock':
      case 'fg-stock': {
        const rows = await stockSummary({ type: req.params.type === 'raw-stock' ? 'RAW' : 'FINISHED', q: q.q });
        return res.json({ rows, totals: { items: rows.length, qty: sum(rows, 'onHand'), value: sum(rows, 'value'), low: rows.filter((x) => x.low).length } });
      }
      case 'consumption': {
        const rows = await groupMoves(['PRODUCTION_CONSUME'], q);
        return res.json({ rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } });
      }
      case 'wastage': {
        const rows = await groupMoves(['PRODUCTION_WASTAGE', 'DAMAGE'], q);
        return res.json({ rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') } });
      }
      case 'orders':
      case 'pending-orders': {
        const f = {};
        const r = range(q);
        if (r) f.createdAt = r;
        if (req.params.type === 'pending-orders') f.status = { $in: ['PENDING', 'PARTIAL'] };
        else if (q.status) f.status = q.status;
        const list = await populateOrder(CustomerOrder.find(f).sort({ createdAt: -1 }));
        const rows = list.map((o) => ({
          orderNo: o.orderNo, customer: o.customer, product: o.product?.name, qty: o.qty, dispatched: o.dispatchedQty,
          pending: o.pending, total: o.total, deliveryDate: o.deliveryDate, paymentStatus: o.paymentStatus, status: o.status,
        }));
        return res.json({ rows, totals: { orders: rows.length, qty: sum(rows, 'qty'), pending: sum(rows, 'pending'), total: sum(rows, 'total') } });
      }
      case 'dispatch': {
        const rows = await dispatchRows(q);
        return res.json({ rows, totals: { dispatches: rows.length, qty: sum(rows, 'qty'), revenue: sum(rows, 'revenue') } });
      }
      case 'profit': {
        const d = await dispatchRows(q);
        const by = new Map();
        for (const r of d) {
          const k = r.product?.name || 'Unknown';
          const e = by.get(k) || { product: k, qty: 0, revenue: 0, cost: 0, profit: 0 };
          e.qty += r.qty; e.revenue += r.revenue; e.cost += r.cost; e.profit += r.profit;
          by.set(k, e);
        }
        const rows = [...by.values()].map((e) => ({
          ...e, qty: q3(e.qty), revenue: money(e.revenue), cost: money(e.cost), profit: money(e.profit),
          margin: e.revenue ? money((e.profit / e.revenue) * 100) : 0,
        }));
        const revenue = sum(rows, 'revenue');
        const profit = sum(rows, 'profit');
        return res.json({ rows, totals: { qty: sum(rows, 'qty'), revenue, cost: sum(rows, 'cost'), profit, margin: revenue ? money((profit / revenue) * 100) : 0 } });
      }
      default:
        throw new HttpError(404, 'Unknown report');
    }
  }),
};

const dashboard = wrap(async (req, res) => {
  const [raw, fg] = await Promise.all([stockSummary({ type: 'RAW' }), stockSummary({ type: 'FINISHED' })]);
  const lowItems = [...raw, ...fg].filter((x) => x.low);

  const today = await ProductionOrder.find({ status: 'COMPLETED', completedAt: { $gte: startOfToday() } });
  const done = await ProductionOrder.find({ status: 'COMPLETED', ...(range(req.query) ? { completedAt: range(req.query) } : {}) });
  const open = await CustomerOrder.find({ status: { $in: ['PENDING', 'PARTIAL'] } });
  const d = await dispatchRows(req.query);

  const [recentProduction, recentOrders] = await Promise.all([
    populatePO(ProductionOrder.find().sort({ createdAt: -1 }).limit(6)),
    populateOrder(CustomerOrder.find().sort({ createdAt: -1 }).limit(6)),
  ]);

  res.json({
    todayProduction: { orders: today.length, qty: q3(today.reduce((s, p) => s + p.plannedQty, 0)) },
    rawStockValue: sum(raw, 'value'),
    fgStockValue: sum(fg, 'value'),
    lowStock: { count: lowItems.length, items: lowItems.slice(0, 8).map((x) => ({ name: x.name, sku: x.sku, onHand: x.onHand, reorderLevel: x.reorderLevel, unit: x.unit })) },
    pendingOrders: open.length,
    pendingDispatch: q3(open.reduce((s, o) => s + o.pending, 0)),
    productionCost: sum(done, 'totalCost'),
    sellingValue: sum(d, 'revenue'),
    profit: sum(d, 'profit'),
    recentProduction,
    recentOrders
  });
});

export {
  HttpError,
  suppliers,
  warehouses,
  items,
  bom,
  inventory,
  production,
  orders,
  reports,
  dashboard,
};


