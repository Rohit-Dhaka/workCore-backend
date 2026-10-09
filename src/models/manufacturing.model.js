

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


