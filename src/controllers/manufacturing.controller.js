
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


// import mongoose from "mongoose";
// import {
//   Supplier,
//   Customer,
//   Item,
//   Bom,
//   StockMovement,
//   Counter,
//   Purchase,
//   ProductionOrder,
//   SalesOrder,
// } from "../models/manufacturing.model.js";

// class HttpError extends Error {
//   constructor(status, message) {
//     super(message);
//     this.status = status;
//   }
// }

// const bad = (message) => new HttpError(400, message);

// const must = (condition, message) => {
//   if (!condition) throw bad(message);
// };

// const wrap = (fn) => (req, res, next) =>
//   Promise.resolve(fn(req, res, next)).catch(next);

// const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
// const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

// const num = (value, fallback = 0) =>
//   value === undefined || value === null || value === "" ? fallback : Number(value);

// const esc = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// const pick = (source = {}, keys) =>
//   keys.reduce((acc, key) => {
//     if (source[key] !== undefined) acc[key] = source[key];
//     return acc;
//   }, {});

// const getDoc = async (Model, id, label) => {
//   if (!mongoose.isValidObjectId(id)) throw bad(`${label} is required`);
//   const doc = await Model.findById(id);
//   if (!doc) throw new HttpError(404, `${label} not found`);
//   return doc;
// };

// const nextNo = async (key, prefix) => {
//   const year = new Date().getFullYear();
//   const counter = await Counter.findByIdAndUpdate(
//     `${key}-${year}`,
//     { $inc: { seq: 1 } },
//     { new: true, upsert: true }
//   );
//   return `${prefix}-${year}-${String(counter.seq).padStart(4, "0")}`;
// };

// const rollback = async (undos) => {
//   for (const undo of [...undos].reverse()) await undo().catch(() => {});
// };

// const searchFilter = (text, fields) => {
//   const rx = new RegExp(esc(text), "i");
//   return { $or: fields.map((field) => ({ [field]: rx })) };
// };

// const stockIn = async ({ item, qty, unitCost, type, refType, refNo, note }) => {
//   qty = r3(qty);
//   must(qty > 0, "Quantity must be greater than zero");

//   const after = await Item.findByIdAndUpdate(
//     item,
//     { $inc: { currentStock: qty } },
//     { new: true }
//   );
//   if (!after) throw new HttpError(404, "Item not found");

//   const previousCost = after.costPrice;
//   const before = r3(after.currentStock - qty);

//   if (unitCost !== undefined && after.currentStock > 0) {
//     const average = r4((before * previousCost + qty * unitCost) / after.currentStock);
//     await Item.updateOne({ _id: item }, { costPrice: average });
//   }

//   const movement = await StockMovement.create({
//     item,
//     type,
//     qty,
//     balance: after.currentStock,
//     unitCost: unitCost !== undefined ? unitCost : previousCost,
//     refType,
//     refNo,
//     note,
//   });

//   return {
//     balance: after.currentStock,
//     undo: async () => {
//       await Item.updateOne(
//         { _id: item },
//         { $inc: { currentStock: -qty }, costPrice: previousCost }
//       );
//       await StockMovement.deleteOne({ _id: movement._id });
//     },
//   };
// };

// const stockOut = async ({ item, qty, type, refType, refNo, note }) => {
//   qty = r3(qty);
//   must(qty > 0, "Quantity must be greater than zero");

//   const after = await Item.findOneAndUpdate(
//     { _id: item, currentStock: { $gte: qty } },
//     { $inc: { currentStock: -qty } },
//     { new: true }
//   );

//   if (!after) {
//     const doc = await Item.findById(item);
//     throw bad(
//       `Insufficient stock for ${doc ? doc.name : "item"}. Required ${qty}, available ${doc ? doc.currentStock : 0}`
//     );
//   }

//   const movement = await StockMovement.create({
//     item,
//     type,
//     qty: -qty,
//     balance: after.currentStock,
//     unitCost: after.costPrice,
//     refType,
//     refNo,
//     note,
//   });

//   return {
//     unitCost: after.costPrice,
//     balance: after.currentStock,
//     undo: async () => {
//       await Item.updateOne({ _id: item }, { $inc: { currentStock: qty } });
//       await StockMovement.deleteOne({ _id: movement._id });
//     },
//   };
// };

// const addPayment = (Model, label) =>
//   wrap(async (req, res) => {
//     const doc = await getDoc(Model, req.params.id, label);
//     must(doc.status !== "CANCELLED", `This ${label.toLowerCase()} is cancelled`);
//     const amount = r2(num(req.body.amount));
//     must(amount > 0, "Amount must be greater than zero");
//     must(amount <= doc.dueAmount, `Amount cannot be more than the due amount (${doc.dueAmount})`);
//     doc.payments.push({
//       amount,
//       method: ["CASH", "BANK", "UPI", "CHEQUE"].includes(req.body.method)
//         ? req.body.method
//         : "CASH",
//       note: req.body.note,
//       date: req.body.date ? new Date(req.body.date) : new Date(),
//     });
//     await doc.save();
//     res.json(doc);
//   });

// const popPurchase = (query) =>
//   query.populate("supplier", "name phone").populate("items.item", "name sku unit");

// const popProduction = (query) =>
//   query
//     .populate("product", "name sku unit")
//     .populate("consumption.item", "name sku unit");

// const popOrder = (query) =>
//   query
//     .populate("customer", "name company phone")
//     .populate("items.product", "name sku unit")
//     .populate("dispatches.items.product", "name sku unit");

// const itemInUse = async (id) =>
//   (await StockMovement.exists({ item: id })) ||
//   (await Bom.exists({ $or: [{ product: id }, { "materials.item": id }] })) ||
//   (await Purchase.exists({ "items.item": id })) ||
//   (await ProductionOrder.exists({ product: id })) ||
//   (await SalesOrder.exists({ "items.product": id }));

// export const listSuppliers = wrap(async (req, res) => {
//   const filter = req.query.q ? searchFilter(req.query.q, ["name", "phone", "email"]) : {};
//   res.json(await Supplier.find(filter).sort("name"));
// });

// export const getSupplier = wrap(async (req, res) => {
//   const supplier = await getDoc(Supplier, req.params.id, "Supplier");
//   const purchases = await popPurchase(
//     Purchase.find({ supplier: supplier._id }).sort({ createdAt: -1 })
//   );
//   const active = purchases.filter((p) => p.status !== "CANCELLED");
//   res.json({
//     ...supplier.toJSON(),
//     summary: {
//       purchases: active.length,
//       totalBilled: r2(active.reduce((s, p) => s + p.total, 0)),
//       totalPaid: r2(active.reduce((s, p) => s + p.paidAmount, 0)),
//       totalDue: r2(active.reduce((s, p) => s + p.dueAmount, 0)),
//     },
//     purchases,
//   });
// });

// export const createSupplier = wrap(async (req, res) => {
//   const supplier = await Supplier.create(
//     pick(req.body, ["name", "phone", "email", "address", "gstNumber"])
//   );
//   res.status(201).json(supplier);
// });

// export const updateSupplier = wrap(async (req, res) => {
//   const supplier = await getDoc(Supplier, req.params.id, "Supplier");
//   supplier.set(
//     pick(req.body, ["name", "phone", "email", "address", "gstNumber", "isActive"])
//   );
//   await supplier.save();
//   res.json(supplier);
// });

// export const deleteSupplier = wrap(async (req, res) => {
//   const supplier = await getDoc(Supplier, req.params.id, "Supplier");
//   must(
//     !(await Purchase.exists({ supplier: supplier._id })),
//     "This supplier has purchases and cannot be deleted"
//   );
//   await Item.updateMany({ suppliers: supplier._id }, { $pull: { suppliers: supplier._id } });
//   await supplier.deleteOne();
//   res.json({ ok: true });
// });

// export const listCustomers = wrap(async (req, res) => {
//   const filter = req.query.q
//     ? searchFilter(req.query.q, ["name", "company", "phone", "email"])
//     : {};
//   res.json(await Customer.find(filter).sort("name"));
// });

// export const getCustomer = wrap(async (req, res) => {
//   const customer = await getDoc(Customer, req.params.id, "Customer");
//   const orders = await popOrder(
//     SalesOrder.find({ customer: customer._id }).sort({ createdAt: -1 })
//   );
//   const active = orders.filter((o) => o.status !== "CANCELLED");
//   res.json({
//     ...customer.toJSON(),
//     summary: {
//       orders: active.length,
//       totalBilled: r2(active.reduce((s, o) => s + o.total, 0)),
//       totalPaid: r2(active.reduce((s, o) => s + o.paidAmount, 0)),
//       totalDue: r2(active.reduce((s, o) => s + o.dueAmount, 0)),
//     },
//     orders,
//   });
// });

// export const createCustomer = wrap(async (req, res) => {
//   const customer = await Customer.create(
//     pick(req.body, ["name", "company", "phone", "email", "address", "gstNumber"])
//   );
//   res.status(201).json(customer);
// });

// export const updateCustomer = wrap(async (req, res) => {
//   const customer = await getDoc(Customer, req.params.id, "Customer");
//   customer.set(
//     pick(req.body, ["name", "company", "phone", "email", "address", "gstNumber", "isActive"])
//   );
//   await customer.save();
//   res.json(customer);
// });

// export const deleteCustomer = wrap(async (req, res) => {
//   const customer = await getDoc(Customer, req.params.id, "Customer");
//   must(
//     !(await SalesOrder.exists({ customer: customer._id })),
//     "This customer has orders and cannot be deleted"
//   );
//   await customer.deleteOne();
//   res.json({ ok: true });
// });

// const ITEM_FIELDS = [
//   "name",
//   "sku",
//   "type",
//   "unit",
//   "costPrice",
//   "sellingPrice",
//   "reorderLevel",
//   "suppliers",
//   "isActive",
// ];

// export const listItems = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.type) filter.type = req.query.type;
//   if (req.query.q) Object.assign(filter, searchFilter(req.query.q, ["name", "sku"]));
//   let items = await Item.find(filter).populate("suppliers", "name").sort("name");
//   if (req.query.low) items = items.filter((i) => i.isLow);
//   res.json(items);
// });

// export const getItem = wrap(async (req, res) => {
//   const item = await Item.findById(req.params.id).populate("suppliers", "name");
//   if (!item) throw new HttpError(404, "Item not found");
//   res.json(item);
// });

// export const createItem = wrap(async (req, res) => {
//   const item = await Item.create(pick(req.body, ITEM_FIELDS));
//   res.status(201).json(await item.populate("suppliers", "name"));
// });

// export const updateItem = wrap(async (req, res) => {
//   const item = await getDoc(Item, req.params.id, "Item");
//   const data = pick(req.body, ITEM_FIELDS);
//   if (data.type && data.type !== item.type) {
//     must(!(await itemInUse(item._id)), "Item type cannot be changed once it is used");
//   }
//   item.set(data);
//   await item.save();
//   res.json(await item.populate("suppliers", "name"));
// });

// export const deleteItem = wrap(async (req, res) => {
//   const item = await getDoc(Item, req.params.id, "Item");
//   must(
//     !(await itemInUse(item._id)),
//     "This item is used in stock, BOM, purchases or orders and cannot be deleted"
//   );
//   await item.deleteOne();
//   res.json({ ok: true });
// });

// const populateBom = (query) =>
//   query
//     .populate("product", "name sku unit sellingPrice costPrice")
//     .populate("materials.item", "name sku unit costPrice currentStock");

// const bomView = (bom) => {
//   const data = bom.toJSON();
//   let materialCost = 0;
//   data.materials = data.materials.map((m) => {
//     const effectiveQty = r3(m.qty * (1 + m.wastagePct / 100));
//     const lineCost = r2(effectiveQty * (m.item?.costPrice || 0));
//     materialCost += lineCost;
//     return { ...m, effectiveQty, lineCost };
//   });
//   data.materialCost = r2(materialCost);
//   data.totalCost = r2(materialCost + bom.labourCost + bom.overheadCost);
//   data.sellingPrice = data.product?.sellingPrice || 0;
//   data.profit = r2(data.sellingPrice - data.totalCost);
//   data.margin = data.sellingPrice ? r2((data.profit / data.sellingPrice) * 100) : 0;
//   return data;
// };

// const cleanBom = async (body, existingId) => {
//   const product = await getDoc(Item, body.product, "Product");
//   must(product.type === "FINISHED", "BOM product must be a finished product");
//   const clash = await Bom.findOne({
//     product: product._id,
//     ...(existingId ? { _id: { $ne: existingId } } : {}),
//   });
//   must(!clash, "This product already has a BOM. Edit the existing one");
//   must(
//     Array.isArray(body.materials) && body.materials.length > 0,
//     "Add at least one raw material"
//   );

//   const seen = new Set();
//   const materials = [];
//   for (const row of body.materials) {
//     const item = await getDoc(Item, row.item, "Raw material");
//     must(item.type === "RAW", `${item.name} is not a raw material`);
//     must(!seen.has(String(item._id)), `${item.name} is added more than once`);
//     seen.add(String(item._id));
//     const qty = num(row.qty);
//     const wastagePct = num(row.wastagePct);
//     must(qty > 0, `Quantity for ${item.name} must be greater than zero`);
//     must(wastagePct >= 0 && wastagePct <= 100, "Wastage % must be between 0 and 100");
//     materials.push({ item: item._id, qty, wastagePct });
//   }

//   const labourCost = num(body.labourCost);
//   const overheadCost = num(body.overheadCost);
//   must(labourCost >= 0 && overheadCost >= 0, "Costs cannot be negative");

//   return {
//     product: product._id,
//     name: String(body.name || "Standard BOM").trim(),
//     materials,
//     labourCost,
//     overheadCost,
//   };
// };

// export const listBoms = wrap(async (req, res) => {
//   const filter = req.query.product ? { product: req.query.product } : {};
//   const boms = await populateBom(Bom.find(filter).sort({ createdAt: -1 }));
//   res.json(boms.map(bomView));
// });

// export const createBom = wrap(async (req, res) => {
//   const bom = await Bom.create(await cleanBom(req.body));
//   res.status(201).json(bomView(await populateBom(Bom.findById(bom._id))));
// });

// export const updateBom = wrap(async (req, res) => {
//   const bom = await getDoc(Bom, req.params.id, "BOM");
//   bom.set(await cleanBom({ ...req.body, product: req.body.product || bom.product }, bom._id));
//   await bom.save();
//   res.json(bomView(await populateBom(Bom.findById(bom._id))));
// });

// export const deleteBom = wrap(async (req, res) => {
//   const bom = await getDoc(Bom, req.params.id, "BOM");
//   must(
//     !(await ProductionOrder.exists({ bom: bom._id })),
//     "This BOM is used by production orders and cannot be deleted"
//   );
//   await bom.deleteOne();
//   res.json({ ok: true });
// });

// const planFor = async (productId, qtyInput) => {
//   const bom = await Bom.findOne({ product: productId })
//     .populate("materials.item")
//     .populate("product", "name sku unit sellingPrice");
//   if (!bom) throw new HttpError(404, "No BOM found for this product. Create a BOM first");

//   const qty = r3(num(qtyInput));
//   const lines = [];
//   let maxQty = null;
//   let bottleneck = null;
//   let materialUnitCost = 0;

//   for (const m of bom.materials) {
//     const perUnit = m.qty * (1 + m.wastagePct / 100);
//     const available = m.item.currentStock;
//     const required = r3(perUnit * qty);
//     const shortage = Math.max(0, r3(required - available));
//     const possible = perUnit > 0 ? Math.floor(available / perUnit) : 0;
//     if (maxQty === null || possible < maxQty) {
//       maxQty = possible;
//       bottleneck = m.item.name;
//     }
//     materialUnitCost += perUnit * m.item.costPrice;
//     lines.push({
//       item: m.item._id,
//       name: m.item.name,
//       sku: m.item.sku,
//       unit: m.item.unit,
//       qtyPerUnit: m.qty,
//       wastagePct: m.wastagePct,
//       required,
//       available,
//       shortage,
//       unitCost: m.item.costPrice,
//       lineCost: r2(required * m.item.costPrice),
//     });
//   }

//   const materialCost = r2(materialUnitCost * qty);
//   const labourCost = r2(bom.labourCost * qty);
//   const overheadCost = r2(bom.overheadCost * qty);
//   const totalCost = r2(materialCost + labourCost + overheadCost);
//   const sellingValue = r2(bom.product.sellingPrice * qty);

//   return {
//     bom: bom._id,
//     bomName: bom.name,
//     product: bom.product,
//     qty,
//     lines,
//     shortages: lines.filter((l) => l.shortage > 0).map((l) => l.name),
//     canProduce: qty > 0 && lines.every((l) => l.shortage === 0),
//     maxQty: maxQty || 0,
//     bottleneck,
//     estimate: {
//       materialCost,
//       labourCost,
//       overheadCost,
//       totalCost,
//       unitCost: qty > 0 ? r2(totalCost / qty) : 0,
//       sellingValue,
//       profit: r2(sellingValue - totalCost),
//     },
//   };
// };

// export const productionPlan = wrap(async (req, res) => {
//   must(req.query.product, "Select a product");
//   res.json(await planFor(req.query.product, req.query.qty));
// });

// export const listProduction = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.status) filter.status = req.query.status;
//   if (req.query.product) filter.product = req.query.product;
//   res.json(await popProduction(ProductionOrder.find(filter).sort({ createdAt: -1 })));
// });

// export const getProduction = wrap(async (req, res) => {
//   const order = await popProduction(ProductionOrder.findById(req.params.id));
//   if (!order) throw new HttpError(404, "Production order not found");
//   const plan = ["PLANNED", "IN_PROGRESS"].includes(order.status)
//     ? await planFor(order.product._id, order.qty)
//     : null;
//   res.json({ ...order.toJSON(), plan });
// });

// export const createProduction = wrap(async (req, res) => {
//   const product = await getDoc(Item, req.body.product, "Product");
//   must(product.type === "FINISHED", "Please select a finished product");
//   const bom = await Bom.findOne({ product: product._id });
//   must(bom, "This product has no BOM. Create a BOM first");
//   const qty = r3(num(req.body.qty));
//   must(qty > 0, "Quantity must be greater than zero");

//   const order = await ProductionOrder.create({
//     orderNo: await nextNo("production", "PRD"),
//     product: product._id,
//     bom: bom._id,
//     qty,
//     startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
//     note: req.body.note,
//   });
//   res.status(201).json(await popProduction(ProductionOrder.findById(order._id)));
// });

// export const updateProduction = wrap(async (req, res) => {
//   const order = await getDoc(ProductionOrder, req.params.id, "Production order");
//   must(order.status === "PLANNED", "Only planned orders can be edited");
//   if (req.body.qty !== undefined) {
//     const qty = r3(num(req.body.qty));
//     must(qty > 0, "Quantity must be greater than zero");
//     order.qty = qty;
//   }
//   if (req.body.startDate !== undefined) {
//     order.startDate = req.body.startDate ? new Date(req.body.startDate) : undefined;
//   }
//   if (req.body.note !== undefined) order.note = req.body.note;
//   await order.save();
//   res.json(await popProduction(ProductionOrder.findById(order._id)));
// });

// export const startProduction = wrap(async (req, res) => {
//   const order = await getDoc(ProductionOrder, req.params.id, "Production order");
//   must(order.status === "PLANNED", "Only planned orders can be started");
//   order.status = "IN_PROGRESS";
//   if (!order.startDate) order.startDate = new Date();
//   await order.save();
//   res.json(await popProduction(ProductionOrder.findById(order._id)));
// });

// export const cancelProduction = wrap(async (req, res) => {
//   const order = await getDoc(ProductionOrder, req.params.id, "Production order");
//   must(["PLANNED", "IN_PROGRESS"].includes(order.status), "Only open orders can be cancelled");
//   order.status = "CANCELLED";
//   await order.save();
//   res.json(await popProduction(ProductionOrder.findById(order._id)));
// });

// export const deleteProduction = wrap(async (req, res) => {
//   const order = await getDoc(ProductionOrder, req.params.id, "Production order");
//   must(["PLANNED", "CANCELLED"].includes(order.status), "Only planned or cancelled orders can be deleted");
//   await order.deleteOne();
//   res.json({ ok: true });
// });

// export const completeProduction = wrap(async (req, res) => {
//   const order = await getDoc(ProductionOrder, req.params.id, "Production order");
//   must(["PLANNED", "IN_PROGRESS"].includes(order.status), "This order is already closed");

//   const bom = await Bom.findById(order.bom);
//   must(bom, "BOM no longer exists");

//   const plan = await planFor(order.product, order.qty);
//   must(plan.shortages.length === 0, `Not enough material to complete: ${plan.shortages.join(", ")}`);

//   const undos = [];
//   try {
//     const consumption = [];
//     let materialCost = 0;

//     for (const m of bom.materials) {
//       const netQty = r3(m.qty * order.qty);
//       const wastageQty = r3((netQty * m.wastagePct) / 100);
//       const used = await stockOut({
//         item: m.item,
//         qty: netQty + wastageQty,
//         type: "PRODUCTION_USE",
//         refType: "PRODUCTION",
//         refNo: order.orderNo,
//         note: `Used for ${order.orderNo}`,
//       });
//       undos.push(used.undo);
//       const cost = r2((netQty + wastageQty) * used.unitCost);
//       materialCost += cost;
//       consumption.push({ item: m.item, qty: netQty, wastageQty, cost });
//     }

//     materialCost = r2(materialCost);
//     const labourCost = r2(bom.labourCost * order.qty);
//     const overheadCost = r2(bom.overheadCost * order.qty);
//     const totalCost = r2(materialCost + labourCost + overheadCost);
//     const unitCost = r4(totalCost / order.qty);

//     const output = await stockIn({
//       item: order.product,
//       qty: order.qty,
//       unitCost,
//       type: "PRODUCTION_OUTPUT",
//       refType: "PRODUCTION",
//       refNo: order.orderNo,
//       note: `Produced by ${order.orderNo}`,
//     });
//     undos.push(output.undo);

//     Object.assign(order, {
//       status: "COMPLETED",
//       completedAt: new Date(),
//       consumption,
//       materialCost,
//       labourCost,
//       overheadCost,
//       totalCost,
//       unitCost,
//     });
//     if (!order.startDate) order.startDate = order.completedAt;
//     await order.save();
//   } catch (error) {
//     await rollback(undos);
//     throw error;
//   }

//   res.json(await popProduction(ProductionOrder.findById(order._id)));
// });

// const cleanPurchaseItems = async (rows) => {
//   must(Array.isArray(rows) && rows.length > 0, "Add at least one item");
//   const merged = new Map();
//   for (const row of rows) {
//     const item = await getDoc(Item, row.item, "Item");
//     must(item.type === "RAW", `${item.name} is not a raw material`);
//     const qty = r3(num(row.qty));
//     const rate = num(row.rate, item.costPrice);
//     must(qty > 0, `Quantity for ${item.name} must be greater than zero`);
//     must(rate >= 0, `Rate for ${item.name} cannot be negative`);
//     const key = String(item._id);
//     const existing = merged.get(key);
//     merged.set(key, existing ? { ...existing, qty: r3(existing.qty + qty), rate } : { item: item._id, qty, rate });
//   }
//   return [...merged.values()];
// };

// export const listPurchases = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.status) filter.status = req.query.status;
//   if (req.query.supplier) filter.supplier = req.query.supplier;
//   if (req.query.q) filter.purchaseNo = new RegExp(esc(req.query.q), "i");
//   res.json(await popPurchase(Purchase.find(filter).sort({ createdAt: -1 })));
// });

// export const getPurchase = wrap(async (req, res) => {
//   const purchase = await popPurchase(Purchase.findById(req.params.id));
//   if (!purchase) throw new HttpError(404, "Purchase not found");
//   res.json(purchase);
// });

// export const createPurchase = wrap(async (req, res) => {
//   const supplier = await getDoc(Supplier, req.body.supplier, "Supplier");
//   const items = await cleanPurchaseItems(req.body.items);
//   const tax = num(req.body.tax);
//   must(tax >= 0 && tax <= 100, "Tax must be between 0 and 100");

//   const purchase = await Purchase.create({
//     purchaseNo: await nextNo("purchase", "PUR"),
//     supplier: supplier._id,
//     items,
//     tax,
//     orderDate: req.body.orderDate ? new Date(req.body.orderDate) : new Date(),
//     expectedDate: req.body.expectedDate ? new Date(req.body.expectedDate) : undefined,
//     note: req.body.note,
//   });
//   res.status(201).json(await popPurchase(Purchase.findById(purchase._id)));
// });

// export const updatePurchase = wrap(async (req, res) => {
//   const purchase = await getDoc(Purchase, req.params.id, "Purchase");
//   must(purchase.status === "ORDERED", "Only open purchases can be edited");

//   if (req.body.supplier) {
//     const supplier = await getDoc(Supplier, req.body.supplier, "Supplier");
//     purchase.supplier = supplier._id;
//   }
//   if (req.body.items) purchase.items = await cleanPurchaseItems(req.body.items);
//   if (req.body.tax !== undefined) {
//     const tax = num(req.body.tax);
//     must(tax >= 0 && tax <= 100, "Tax must be between 0 and 100");
//     purchase.tax = tax;
//   }
//   if (req.body.expectedDate !== undefined) {
//     purchase.expectedDate = req.body.expectedDate ? new Date(req.body.expectedDate) : undefined;
//   }
//   if (req.body.note !== undefined) purchase.note = req.body.note;

//   await purchase.save();
//   res.json(await popPurchase(Purchase.findById(purchase._id)));
// });

// export const receivePurchase = wrap(async (req, res) => {
//   const purchase = await getDoc(Purchase, req.params.id, "Purchase");
//   must(purchase.status === "ORDERED", "Only open purchases can be received");

//   const undos = [];
//   try {
//     for (const row of purchase.items) {
//       const result = await stockIn({
//         item: row.item,
//         qty: row.qty,
//         unitCost: row.rate,
//         type: "PURCHASE",
//         refType: "PURCHASE",
//         refNo: purchase.purchaseNo,
//         note: `Received from supplier`,
//       });
//       undos.push(result.undo);
//       await Item.updateOne({ _id: row.item }, { $addToSet: { suppliers: purchase.supplier } });
//     }
//     purchase.status = "RECEIVED";
//     purchase.receivedAt = new Date();
//     await purchase.save();
//   } catch (error) {
//     await rollback(undos);
//     throw error;
//   }

//   res.json(await popPurchase(Purchase.findById(purchase._id)));
// });

// export const cancelPurchase = wrap(async (req, res) => {
//   const purchase = await getDoc(Purchase, req.params.id, "Purchase");
//   must(purchase.status === "ORDERED", "Only open purchases can be cancelled");
//   must(purchase.payments.length === 0, "Purchases with payments cannot be cancelled");
//   purchase.status = "CANCELLED";
//   await purchase.save();
//   res.json(await popPurchase(Purchase.findById(purchase._id)));
// });

// export const addPurchasePayment = addPayment(Purchase, "Purchase");

// const cleanOrderItems = async (rows) => {
//   must(Array.isArray(rows) && rows.length > 0, "Add at least one product");
//   const merged = new Map();
//   for (const row of rows) {
//     const product = await getDoc(Item, row.product, "Product");
//     must(product.type === "FINISHED", `${product.name} is not a finished product`);
//     const qty = r3(num(row.qty));
//     const price = num(row.price, product.sellingPrice);
//     must(qty > 0, `Quantity for ${product.name} must be greater than zero`);
//     must(price >= 0, `Price for ${product.name} cannot be negative`);
//     const key = String(product._id);
//     const existing = merged.get(key);
//     merged.set(
//       key,
//       existing
//         ? { ...existing, qty: r3(existing.qty + qty), price }
//         : { product: product._id, qty, price, dispatchedQty: 0 }
//     );
//   }
//   return [...merged.values()];
// };

// export const listOrders = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.status) filter.status = req.query.status;
//   if (req.query.customer) filter.customer = req.query.customer;
//   if (req.query.pending) filter.status = { $in: ["PENDING", "PARTIAL"] };
//   if (req.query.q) filter.orderNo = new RegExp(esc(req.query.q), "i");
//   res.json(await popOrder(SalesOrder.find(filter).sort({ createdAt: -1 })));
// });

// export const getOrder = wrap(async (req, res) => {
//   const order = await popOrder(SalesOrder.findById(req.params.id));
//   if (!order) throw new HttpError(404, "Order not found");
//   res.json(order);
// });

// export const createOrder = wrap(async (req, res) => {
//   const customer = await getDoc(Customer, req.body.customer, "Customer");
//   const items = await cleanOrderItems(req.body.items);
//   const discount = num(req.body.discount);
//   const tax = num(req.body.tax);
//   must(discount >= 0 && discount <= 100, "Discount must be between 0 and 100");
//   must(tax >= 0 && tax <= 100, "Tax must be between 0 and 100");

//   const order = await SalesOrder.create({
//     orderNo: await nextNo("order", "SO"),
//     customer: customer._id,
//     items,
//     discount,
//     tax,
//     deliveryDate: req.body.deliveryDate ? new Date(req.body.deliveryDate) : undefined,
//     note: req.body.note,
//   });
//   res.status(201).json(await popOrder(SalesOrder.findById(order._id)));
// });

// export const updateOrder = wrap(async (req, res) => {
//   const order = await getDoc(SalesOrder, req.params.id, "Order");
//   must(!["CANCELLED", "DELIVERED"].includes(order.status), "This order can no longer be edited");

//   if (req.body.deliveryDate !== undefined) {
//     order.deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : undefined;
//   }
//   if (req.body.note !== undefined) order.note = req.body.note;

//   const locked = order.dispatches.length > 0;
//   const wantsStructure =
//     req.body.items !== undefined ||
//     req.body.customer !== undefined ||
//     req.body.discount !== undefined ||
//     req.body.tax !== undefined;
//   must(!(locked && wantsStructure), "Items, customer, discount and tax cannot change after dispatch has started");

//   if (!locked) {
//     if (req.body.customer) {
//       const customer = await getDoc(Customer, req.body.customer, "Customer");
//       order.customer = customer._id;
//     }
//     if (req.body.items) order.items = await cleanOrderItems(req.body.items);
//     if (req.body.discount !== undefined) {
//       const discount = num(req.body.discount);
//       must(discount >= 0 && discount <= 100, "Discount must be between 0 and 100");
//       order.discount = discount;
//     }
//     if (req.body.tax !== undefined) {
//       const tax = num(req.body.tax);
//       must(tax >= 0 && tax <= 100, "Tax must be between 0 and 100");
//       order.tax = tax;
//     }
//   }

//   await order.save();
//   res.json(await popOrder(SalesOrder.findById(order._id)));
// });

// export const dispatchOrder = wrap(async (req, res) => {
//   const order = await getDoc(SalesOrder, req.params.id, "Order");
//   must(["PENDING", "PARTIAL"].includes(order.status), "This order has nothing left to dispatch");

//   const requested =
//     Array.isArray(req.body.items) && req.body.items.length > 0
//       ? req.body.items
//       : order.items
//           .map((i) => ({ product: String(i.product), qty: r3(i.qty - i.dispatchedQty) }))
//           .filter((i) => i.qty > 0);

//   const plan = new Map();
//   for (const row of requested) {
//     const key = String(row.product);
//     plan.set(key, r3((plan.get(key) || 0) + num(row.qty)));
//   }

//   const lines = [];
//   for (const [productId, qty] of plan) {
//     const line = order.items.find((i) => String(i.product) === productId);
//     must(line, "Product is not part of this order");
//     must(qty > 0, "Dispatch quantity must be greater than zero");
//     const pending = r3(line.qty - line.dispatchedQty);
//     must(qty <= pending, `Cannot dispatch more than the pending quantity (${pending})`);
//     lines.push({ line, productId, qty });
//   }
//   must(lines.length > 0, "Enter the quantity to dispatch");

//   const undos = [];
//   try {
//     const dispatchItems = [];
//     let cost = 0;
//     let revenue = 0;

//     for (const { line, productId, qty } of lines) {
//       const out = await stockOut({
//         item: productId,
//         qty,
//         type: "DISPATCH",
//         refType: "ORDER",
//         refNo: order.orderNo,
//         note: "Dispatched to customer",
//       });
//       undos.push(out.undo);
//       cost += qty * out.unitCost;
//       revenue += qty * line.price * (1 - order.discount / 100);
//       dispatchItems.push({ product: productId, qty, unitCost: out.unitCost });
//       line.dispatchedQty = r3(line.dispatchedQty + qty);
//     }

//     order.dispatches.push({
//       date: new Date(),
//       vehicleNo: req.body.vehicleNo,
//       note: req.body.note,
//       items: dispatchItems,
//       cost: r2(cost),
//       revenue: r2(revenue),
//     });
//     order.status = order.items.every((i) => i.dispatchedQty >= i.qty) ? "DISPATCHED" : "PARTIAL";
//     await order.save();
//   } catch (error) {
//     await rollback(undos);
//     throw error;
//   }

//   res.json(await popOrder(SalesOrder.findById(order._id)));
// });

// export const deliverOrder = wrap(async (req, res) => {
//   const order = await getDoc(SalesOrder, req.params.id, "Order");
//   must(order.status === "DISPATCHED", "Only fully dispatched orders can be marked delivered");
//   order.status = "DELIVERED";
//   order.deliveredAt = new Date();
//   await order.save();
//   res.json(await popOrder(SalesOrder.findById(order._id)));
// });

// export const cancelOrder = wrap(async (req, res) => {
//   const order = await getDoc(SalesOrder, req.params.id, "Order");
//   must(order.status === "PENDING", "Only orders with no dispatch can be cancelled");
//   must(order.payments.length === 0, "Orders with payments cannot be cancelled");
//   order.status = "CANCELLED";
//   await order.save();
//   res.json(await popOrder(SalesOrder.findById(order._id)));
// });

// export const addOrderPayment = addPayment(SalesOrder, "Order");

// export const stockSummary = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.type) filter.type = req.query.type;
//   if (req.query.q) Object.assign(filter, searchFilter(req.query.q, ["name", "sku"]));
//   let items = await Item.find(filter).sort("name");
//   if (req.query.low) items = items.filter((i) => i.isLow);

//   res.json({
//     totals: {
//       items: items.length,
//       stockValue: r2(items.reduce((s, i) => s + i.stockValue, 0)),
//       lowStock: items.filter((i) => i.isLow).length,
//     },
//     rows: items,
//   });
// });

// export const stockMovements = wrap(async (req, res) => {
//   const filter = {};
//   if (req.query.item) filter.item = req.query.item;
//   if (req.query.type) filter.type = req.query.type;
//   if (req.query.from || req.query.to) {
//     filter.date = {};
//     if (req.query.from) filter.date.$gte = new Date(req.query.from);
//     if (req.query.to) {
//       const end = new Date(req.query.to);
//       end.setHours(23, 59, 59, 999);
//       filter.date.$lte = end;
//     }
//   }
//   const limit = Math.min(num(req.query.limit, 200), 1000);
//   res.json(
//     await StockMovement.find(filter)
//       .populate("item", "name sku unit type")
//       .sort({ date: -1, _id: -1 })
//       .limit(limit)
//   );
// });

// export const adjustStock = wrap(async (req, res) => {
//   const item = await getDoc(Item, req.body.item, "Item");
//   const qty = r3(num(req.body.qty));
//   must(qty !== 0, "Quantity cannot be zero");
//   must(req.body.note && String(req.body.note).trim(), "Please enter a reason");

//   const refNo = await nextNo("adjust", "ADJ");
//   const base = {
//     item: item._id,
//     type: "ADJUSTMENT",
//     refType: "ADJUSTMENT",
//     refNo,
//     note: String(req.body.note).trim(),
//   };

//   if (qty > 0) {
//     const unitCost = req.body.unitCost !== undefined && req.body.unitCost !== "" ? num(req.body.unitCost) : undefined;
//     await stockIn({ ...base, qty, unitCost });
//   } else {
//     await stockOut({ ...base, qty: Math.abs(qty) });
//   }

//   res.status(201).json(await Item.findById(item._id));
// });

// export const dashboard = wrap(async (req, res) => {
//   const items = await Item.find({ isActive: true });
//   const raw = items.filter((i) => i.type === "RAW");
//   const finished = items.filter((i) => i.type === "FINISHED");
//   const lowItems = items.filter((i) => i.isLow);

//   const purchases = await Purchase.find({ status: { $ne: "CANCELLED" } });
//   const orders = await SalesOrder.find({ status: { $ne: "CANCELLED" } });

//   const monthStart = new Date();
//   monthStart.setDate(1);
//   monthStart.setHours(0, 0, 0, 0);

//   let monthRevenue = 0;
//   let monthCost = 0;
//   for (const order of orders) {
//     for (const d of order.dispatches) {
//       if (d.date >= monthStart) {
//         monthRevenue += d.revenue;
//         monthCost += d.cost;
//       }
//     }
//   }

//   const openOrders = orders.filter((o) => ["PENDING", "PARTIAL"].includes(o.status));

//   const [planned, inProgress, recentProduction, recentOrders] = await Promise.all([
//     ProductionOrder.countDocuments({ status: "PLANNED" }),
//     ProductionOrder.countDocuments({ status: "IN_PROGRESS" }),
//     popProduction(ProductionOrder.find().sort({ createdAt: -1 }).limit(5)),
//     popOrder(SalesOrder.find().sort({ createdAt: -1 }).limit(5)),
//   ]);

//   res.json({
//     rawStockValue: r2(raw.reduce((s, i) => s + i.stockValue, 0)),
//     finishedStockValue: r2(finished.reduce((s, i) => s + i.stockValue, 0)),
//     lowStock: {
//       count: lowItems.length,
//       items: lowItems.slice(0, 8).map((i) => ({
//         _id: i._id,
//         name: i.name,
//         sku: i.sku,
//         unit: i.unit,
//         currentStock: i.currentStock,
//         reorderLevel: i.reorderLevel,
//       })),
//     },
//     toPay: r2(purchases.reduce((s, p) => s + p.dueAmount, 0)),
//     toReceive: r2(orders.reduce((s, o) => s + o.dueAmount, 0)),
//     pendingOrders: openOrders.length,
//     pendingDispatchQty: r3(openOrders.reduce((s, o) => s + o.pendingQty, 0)),
//     production: { planned, inProgress },
//     thisMonth: {
//       sales: r2(monthRevenue),
//       cost: r2(monthCost),
//       profit: r2(monthRevenue - monthCost),
//     },
//     recentProduction,
//     recentOrders,
//   });
// });