import mongoose from "mongoose";

const { Schema } = mongoose;



const paymentSchema = new Schema(
  {
    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
      min: [0, "Payment amount cannot be negative"],
    },

    paymentDate: {
      type: Date,
      default: Date.now,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);



const ledgerSchema = new Schema(
  {
    partyName: {
      type: String,
      required: [true, "Party name is required"],
      trim: true,
      minlength: [2, "Party name must be at least 2 characters"],
      maxlength: [100, "Party name cannot exceed 100 characters"],
    },

    type: {
      type: String,
      required: [true, "Ledger type is required"],
      enum: {
        values: ["to_receive", "to_pay"],
        message: "Ledger type must be either to_receive or to_pay",
      },
      index: true,
    },

    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },

    paidAmount: {
      type: Number,
      default: 0,
      min: [0, "Paid amount cannot be negative"],
    },

    date: {
      type: Date,
      required: [true, "Date is required"],
      default: Date.now,
    },

    dueDate: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: {
        values: ["pending", "partial", "completed", "cancelled"],
        message: "Status must be pending, partial, completed or cancelled",
      },
      default: "pending",
      index: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: [1000, "Note cannot exceed 1000 characters"],
      default: "",
    },

    payments: {
      type: [paymentSchema],
      default: [],
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);


ledgerSchema.virtual("remainingAmount").get(function () {
  const amount = Number(this.amount || 0);
  const paidAmount = Number(this.paidAmount || 0);
  return Math.max(amount - paidAmount, 0);
});

ledgerSchema.virtual("isFullyPaid").get(function () {
  return Number(this.paidAmount || 0) >= Number(this.amount || 0);
});

ledgerSchema.virtual("isOverdue").get(function () {
  if (this.status === "completed" || this.status === "cancelled") {
    return false;
  }

  if (!this.dueDate) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueDate = new Date(this.dueDate);
  dueDate.setHours(0, 0, 0, 0);

  return dueDate < today;
});


const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

ledgerSchema.pre("validate", function () {
  const amount = round2(this.amount);


  if (this.payments && this.payments.length > 0) {
    this.paidAmount = round2(
      this.payments.reduce(
        (total, payment) => total + Number(payment.amount || 0),
        0
      )
    );
  }

  const paidAmount = round2(this.paidAmount);

  
  if (paidAmount > amount) {
    throw new Error("Paid amount cannot be greater than total amount");
  }

  
  if (this.status !== "cancelled") {
    if (paidAmount === 0) {
      this.status = "pending";
    } else if (paidAmount >= amount) {
      this.status = "completed";
    } else {
      this.status = "partial";
    }
  }
});


ledgerSchema.index({ type: 1, status: 1 });
ledgerSchema.index({ type: 1, date: -1 });
ledgerSchema.index({ dueDate: 1 });
ledgerSchema.index({ partyName: 1 });
ledgerSchema.index({ createdBy: 1, createdAt: -1 });



ledgerSchema.set("toJSON", { virtuals: true });
ledgerSchema.set("toObject", { virtuals: true });



const Ledger = mongoose.model("Ledger", ledgerSchema);

export default Ledger;