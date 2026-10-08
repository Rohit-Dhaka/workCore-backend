import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ref = (name, extra = {}) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  ...extra,
});

const opts = {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
};

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const supplierSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  opts
);

const Supplier = model("Supplier", supplierSchema);
Supplier.syncIndexes().catch((err) =>
  console.error("Supplier index sync failed:", err.message)
);

const warehouseSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Warehouse name is required"],
      unique: true,
      trim: true,
    },
  },
  opts
);

const Warehouse = model("Warehouse", warehouseSchema);

const itemSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, "SKU is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["RAW", "FINISHED"],
      required: true,
    },
    category: {
      type: String,
      trim: true,
    },
    unit: {
      type: String,
      required: [true, "Unit is required"],
      default: "pcs",
      trim: true,
    },
    cost: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    reorderLevel: {
      type: Number,
      default: 0,
      min: 0,
    },
    batchTracking: {
      type: Boolean,
      default: true,
    },
    suppliers: [ref("Supplier")],
  },
  opts
);

const Item = model("Item", itemSchema);

const bomSchema = new Schema(
  {
    product: ref("Item", {
      required: true,
    }),
    name: {
      type: String,
      default: "Standard",
      trim: true,
    },
    materials: [
      {
        item: ref("Item", {
          required: true,
        }),
        qtyPerUnit: {
          type: Number,
          required: true,
          min: 0,
        },
        wastagePct: {
          type: Number,
          default: 0,
          min: 0,
          max: 100,
        },
      },
    ],
    labourCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    overheadCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  opts
);

const BOM = model("BOM", bomSchema);

const stockBatchSchema = new Schema(
  {
    item: ref("Item", {
      required: true,
    }),
    warehouse: ref("Warehouse", {
      required: true,
    }),
    batchNo: {
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      default: 0,
      min: 0,
    },
    unitCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    supplier: ref("Supplier"),
    receivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  opts
);

stockBatchSchema.index(
  {
    item: 1,
    warehouse: 1,
    batchNo: 1,
  },
  {
    unique: true,
  }
);

const StockBatch = model("StockBatch", stockBatchSchema);

const movementSchema = new Schema(
  {
    date: {
      type: Date,
      default: Date.now,
    },
    item: ref("Item", {
      required: true,
    }),
    warehouse: ref("Warehouse", {
      required: true,
    }),
    batchNo: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        "RECEIVE",
        "TRANSFER_IN",
        "TRANSFER_OUT",
        "DAMAGE",
        "ADJUST",
        "PRODUCTION_CONSUME",
        "PRODUCTION_WASTAGE",
        "PRODUCTION_OUTPUT",
        "DISPATCH",
      ],
      required: true,
    },
    qty: {
      type: Number,
      required: true,
    },
    unitCost: {
      type: Number,
      default: 0,
    },
    refType: {
      type: String,
      trim: true,
    },
    refNo: {
      type: String,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
    },
  },
  opts
);

movementSchema.index({
  batchNo: 1,
});

movementSchema.index({
  date: -1,
});

const Movement = model("Movement", movementSchema);

const counterSchema = new Schema({
  _id: String,
  seq: {
    type: Number,
    default: 0,
  },
});

const Counter =
  mongoose.models.Counter ||
  model("Counter", counterSchema);

const productionOrderSchema = new Schema(
  {
    orderNo: {
      type: String,
      unique: true,
    },
    product: ref("Item", {
      required: true,
    }),
    bom: ref("BOM", {
      required: true,
    }),
    rmWarehouse: ref("Warehouse", {
      required: true,
    }),
    fgWarehouse: ref("Warehouse", {
      required: true,
    }),
    plannedQty: {
      type: Number,
      required: true,
      min: 0,
    },
    fgBatchNo: {
      type: String,
      required: true,
      trim: true,
    },
    startDate: Date,
    endDate: Date,
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: [
        "PLANNED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "PLANNED",
    },
    completedAt: Date,
    consumption: [
      {
        item: ref("Item"),
        consumedQty: {
          type: Number,
          default: 0,
        },
        wastageQty: {
          type: Number,
          default: 0,
        },
        cost: {
          type: Number,
          default: 0,
        },
      },
    ],
    materialCost: {
      type: Number,
      default: 0,
    },
    labourCost: {
      type: Number,
      default: 0,
    },
    overheadCost: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    unitCost: {
      type: Number,
      default: 0,
    },
  },
  opts
);

const ProductionOrder = model(
  "ProductionOrder",
  productionOrderSchema
);

const orderSchema = new Schema(
  {
    orderNo: {
      type: String,
      unique: true,
    },
    customer: {
      type: String,
      required: [true, "Customer is required"],
      trim: true,
    },
    product: ref("Item", {
      required: true,
    }),
    qty: {
      type: Number,
      required: true,
      min: 0,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    deliveryDate: Date,
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID"],
      default: "UNPAID",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PARTIAL",
        "DISPATCHED",
        "CANCELLED",
      ],
      default: "PENDING",
    },
    dispatchedQty: {
      type: Number,
      default: 0,
    },
    dispatches: [
      {
        date: {
          type: Date,
          default: Date.now,
        },
        warehouse: ref("Warehouse"),
        qty: {
          type: Number,
          default: 0,
        },
        cost: {
          type: Number,
          default: 0,
        },
        revenue: {
          type: Number,
          default: 0,
        },
        batches: [
          {
            batchNo: {
              type: String,
              trim: true,
            },
            qty: {
              type: Number,
              default: 0,
            },
            unitCost: {
              type: Number,
              default: 0,
            },
          },
        ],
      },
    ],
  },
  opts
);

orderSchema.virtual("pending").get(function () {
  return Math.max(0, r3(this.qty - this.dispatchedQty));
});

orderSchema.virtual("subtotal").get(function () {
  return r2(this.qty * this.price);
});

orderSchema.virtual("discountAmount").get(function () {
  return r2(
    (this.qty * this.price * this.discount) / 100
  );
});

orderSchema.virtual("taxAmount").get(function () {
  return r2(
    (this.qty *
      this.price *
      (1 - this.discount / 100) *
      this.tax) /
      100
  );
});

orderSchema.virtual("total").get(function () {
  const net =
    this.qty *
    this.price *
    (1 - this.discount / 100);

  return r2(net + (net * this.tax) / 100);
});

orderSchema.virtual("netUnitPrice").get(function () {
  return this.price * (1 - this.discount / 100);
});

const CustomerOrder = model("CustomerOrder", orderSchema);

export {
  Supplier,
  Warehouse,
  Item,
  BOM,
  StockBatch,
  Movement,
  Counter,
  ProductionOrder,
  CustomerOrder,
};



// import mongoose from "mongoose";

// const { Schema, model, models } = mongoose;

// const ref = (name, extra = {}) => ({
//   type: Schema.Types.ObjectId,
//   ref: name,
//   ...extra,
// });

// const opts = {
//   timestamps: true,
//   toJSON: { virtuals: true },
//   toObject: { virtuals: true },
// };

// const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// const UNIT_PATTERN = /^[A-Za-z][A-Za-z .\/]{0,19}$/;

// const supplierSchema = new Schema(
//   {
//     name: { type: String, required: [true, "Supplier name is required"], trim: true },
//     phone: { type: String, trim: true },
//     email: { type: String, trim: true, lowercase: true },
//     address: { type: String, trim: true },
//     gstNumber: { type: String, trim: true, uppercase: true },
//     isActive: { type: Boolean, default: true },
//   },
//   opts
// );

// const customerSchema = new Schema(
//   {
//     name: { type: String, required: [true, "Customer name is required"], trim: true },
//     company: { type: String, trim: true },
//     phone: { type: String, trim: true },
//     email: { type: String, trim: true, lowercase: true },
//     address: { type: String, trim: true },
//     gstNumber: { type: String, trim: true, uppercase: true },
//     isActive: { type: Boolean, default: true },
//   },
//   opts
// );

// const itemSchema = new Schema(
//   {
//     name: { type: String, required: [true, "Item name is required"], trim: true },
//     sku: {
//       type: String,
//       required: [true, "SKU is required"],
//       unique: true,
//       uppercase: true,
//       trim: true,
//     },
//     type: { type: String, enum: ["RAW", "FINISHED"], required: true },
//     unit: {
//       type: String,
//       required: [true, "Unit is required"],
//       default: "pcs",
//       trim: true,
//       match: [UNIT_PATTERN, "Unit must be text only, like pcs, kg or litre"],
//     },
//     costPrice: { type: Number, default: 0, min: 0 },
//     sellingPrice: { type: Number, default: 0, min: 0 },
//     reorderLevel: { type: Number, default: 0, min: 0 },
//     currentStock: { type: Number, default: 0, min: 0 },
//     suppliers: [ref("Supplier")],
//     isActive: { type: Boolean, default: true },
//   },
//   opts
// );

// itemSchema.virtual("stockValue").get(function () {
//   return r2(this.currentStock * this.costPrice);
// });

// itemSchema.virtual("isLow").get(function () {
//   return this.reorderLevel > 0 && this.currentStock <= this.reorderLevel;
// });

// const bomSchema = new Schema(
//   {
//     product: ref("Item", { required: true, unique: true }),
//     name: { type: String, default: "Standard BOM", trim: true },
//     materials: [
//       {
//         item: ref("Item", { required: true }),
//         qty: { type: Number, required: true, min: 0.001 },
//         wastagePct: { type: Number, default: 0, min: 0, max: 100 },
//       },
//     ],
//     labourCost: { type: Number, default: 0, min: 0 },
//     overheadCost: { type: Number, default: 0, min: 0 },
//   },
//   opts
// );

// const stockMovementSchema = new Schema(
//   {
//     date: { type: Date, default: Date.now },
//     item: ref("Item", { required: true }),
//     type: {
//       type: String,
//       enum: [
//         "PURCHASE",
//         "PRODUCTION_USE",
//         "PRODUCTION_OUTPUT",
//         "DISPATCH",
//         "ADJUSTMENT",
//       ],
//       required: true,
//     },
//     qty: { type: Number, required: true },
//     balance: { type: Number, default: 0 },
//     unitCost: { type: Number, default: 0 },
//     refType: { type: String, trim: true },
//     refNo: { type: String, trim: true },
//     note: { type: String, trim: true },
//   },
//   opts
// );

// stockMovementSchema.index({ item: 1, date: -1 });

// const counterSchema = new Schema({
//   _id: String,
//   seq: { type: Number, default: 0 },
// });

// const paymentSchema = new Schema({
//   amount: { type: Number, required: true, min: 0.01 },
//   date: { type: Date, default: Date.now },
//   method: {
//     type: String,
//     enum: ["CASH", "BANK", "UPI", "CHEQUE"],
//     default: "CASH",
//   },
//   note: { type: String, trim: true },
// });

// const purchaseSchema = new Schema(
//   {
//     purchaseNo: { type: String, unique: true },
//     supplier: ref("Supplier", { required: true }),
//     items: [
//       {
//         item: ref("Item", { required: true }),
//         qty: { type: Number, required: true, min: 0.001 },
//         rate: { type: Number, required: true, min: 0 },
//       },
//     ],
//     tax: { type: Number, default: 0, min: 0, max: 100 },
//     orderDate: { type: Date, default: Date.now },
//     expectedDate: Date,
//     receivedAt: Date,
//     note: { type: String, trim: true },
//     status: {
//       type: String,
//       enum: ["ORDERED", "RECEIVED", "CANCELLED"],
//       default: "ORDERED",
//     },
//     payments: [paymentSchema],
//   },
//   opts
// );

// purchaseSchema.virtual("subtotal").get(function () {
//   return r2(this.items.reduce((s, i) => s + i.qty * i.rate, 0));
// });

// purchaseSchema.virtual("taxAmount").get(function () {
//   return r2((this.subtotal * this.tax) / 100);
// });

// purchaseSchema.virtual("total").get(function () {
//   return r2(this.subtotal + this.taxAmount);
// });

// purchaseSchema.virtual("paidAmount").get(function () {
//   return r2(this.payments.reduce((s, p) => s + p.amount, 0));
// });

// purchaseSchema.virtual("dueAmount").get(function () {
//   return r2(Math.max(0, this.total - this.paidAmount));
// });

// purchaseSchema.virtual("paymentStatus").get(function () {
//   if (this.paidAmount <= 0) return "UNPAID";
//   return this.dueAmount <= 0 ? "PAID" : "PARTIAL";
// });

// const productionOrderSchema = new Schema(
//   {
//     orderNo: { type: String, unique: true },
//     product: ref("Item", { required: true }),
//     bom: ref("Bom", { required: true }),
//     qty: { type: Number, required: true, min: 0.001 },
//     status: {
//       type: String,
//       enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
//       default: "PLANNED",
//     },
//     startDate: Date,
//     completedAt: Date,
//     note: { type: String, trim: true },
//     consumption: [
//       {
//         item: ref("Item"),
//         qty: { type: Number, default: 0 },
//         wastageQty: { type: Number, default: 0 },
//         cost: { type: Number, default: 0 },
//       },
//     ],
//     materialCost: { type: Number, default: 0 },
//     labourCost: { type: Number, default: 0 },
//     overheadCost: { type: Number, default: 0 },
//     totalCost: { type: Number, default: 0 },
//     unitCost: { type: Number, default: 0 },
//   },
//   opts
// );

// const salesOrderSchema = new Schema(
//   {
//     orderNo: { type: String, unique: true },
//     customer: ref("Customer", { required: true }),
//     items: [
//       {
//         product: ref("Item", { required: true }),
//         qty: { type: Number, required: true, min: 0.001 },
//         price: { type: Number, required: true, min: 0 },
//         dispatchedQty: { type: Number, default: 0 },
//       },
//     ],
//     discount: { type: Number, default: 0, min: 0, max: 100 },
//     tax: { type: Number, default: 0, min: 0, max: 100 },
//     deliveryDate: Date,
//     deliveredAt: Date,
//     note: { type: String, trim: true },
//     status: {
//       type: String,
//       enum: ["PENDING", "PARTIAL", "DISPATCHED", "DELIVERED", "CANCELLED"],
//       default: "PENDING",
//     },
//     dispatches: [
//       {
//         date: { type: Date, default: Date.now },
//         vehicleNo: { type: String, trim: true },
//         note: { type: String, trim: true },
//         items: [
//           {
//             product: ref("Item"),
//             qty: { type: Number, default: 0 },
//             unitCost: { type: Number, default: 0 },
//           },
//         ],
//         cost: { type: Number, default: 0 },
//         revenue: { type: Number, default: 0 },
//       },
//     ],
//     payments: [paymentSchema],
//   },
//   opts
// );

// salesOrderSchema.virtual("subtotal").get(function () {
//   return r2(this.items.reduce((s, i) => s + i.qty * i.price, 0));
// });

// salesOrderSchema.virtual("discountAmount").get(function () {
//   return r2((this.subtotal * this.discount) / 100);
// });

// salesOrderSchema.virtual("taxAmount").get(function () {
//   return r2(((this.subtotal - this.discountAmount) * this.tax) / 100);
// });

// salesOrderSchema.virtual("total").get(function () {
//   return r2(this.subtotal - this.discountAmount + this.taxAmount);
// });

// salesOrderSchema.virtual("paidAmount").get(function () {
//   return r2(this.payments.reduce((s, p) => s + p.amount, 0));
// });

// salesOrderSchema.virtual("dueAmount").get(function () {
//   return r2(Math.max(0, this.total - this.paidAmount));
// });

// salesOrderSchema.virtual("paymentStatus").get(function () {
//   if (this.paidAmount <= 0) return "UNPAID";
//   return this.dueAmount <= 0 ? "PAID" : "PARTIAL";
// });

// salesOrderSchema.virtual("totalQty").get(function () {
//   return this.items.reduce((s, i) => s + i.qty, 0);
// });

// salesOrderSchema.virtual("pendingQty").get(function () {
//   return this.items.reduce((s, i) => s + Math.max(0, i.qty - i.dispatchedQty), 0);
// });

// const Supplier = models.Supplier || model("Supplier", supplierSchema);
// const Customer = models.Customer || model("Customer", customerSchema);
// const Item = models.Item || model("Item", itemSchema);
// const Bom = models.Bom || model("Bom", bomSchema);
// const StockMovement =
//   models.StockMovement || model("StockMovement", stockMovementSchema);
// const Counter = models.Counter || model("Counter", counterSchema);
// const Purchase = models.Purchase || model("Purchase", purchaseSchema);
// const ProductionOrder =
//   models.ProductionOrder || model("ProductionOrder", productionOrderSchema);
// const SalesOrder = models.SalesOrder || model("SalesOrder", salesOrderSchema);

// export {
//   Supplier,
//   Customer,
//   Item,
//   Bom,
//   StockMovement,
//   Counter,
//   Purchase,
//   ProductionOrder,
//   SalesOrder,
// };