

import Ledger from "../models/ledger.model.js";

const calculateLedgerValues = (entry) => {
  const amount = Number(entry.amount || 0);
  const paidAmount = Number(entry.paidAmount || 0);

  const remainingAmount = Math.max(amount - paidAmount, 0);

  let status = entry.status;

  if (remainingAmount <= 0) {
    status = "completed";
  } else if (paidAmount > 0) {
    status = "partial";
  } else {
    status = "pending";
  }

  return {
    amount,
    paidAmount,
    remainingAmount,
    status,
  };
};



export const createLedger = async (req, res) => {
  try {
    const {
      partyName,
      partyPhone,
      type,
      amount,
      date,
      dueDate,
      note,
    } = req.body;

    

    if (!partyName?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Party name is required",
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Ledger type is required",
      });
    }

    if (!["to_receive", "to_pay"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ledger type",
      });
    }

    if (amount === undefined || amount === null || amount === "") {
      return res.status(400).json({
        success: false,
        message: "Amount is required",
      });
    }

    const numericAmount = Number(amount);

    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    

    const ledger = await Ledger.create({
      partyName: partyName.trim(),
      partyPhone: partyPhone?.trim() || "",
      type,
      amount: numericAmount,
      paidAmount: 0,
      remainingAmount: numericAmount,
      date: date || new Date(),
      dueDate: dueDate || null,
      note: note?.trim() || "",
      status: "pending",
      payments: [],
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      success: true,
      message: "Ledger entry created successfully",
      entry: ledger,
    });
  } catch (error) {
    console.error("CREATE LEDGER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create ledger entry",
    });
  }
};




export const getLedger = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      status,
      search,
      startDate,
      endDate,
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(
      Math.max(Number(limit) || 10, 1),
      100
    );

    const skip = (currentPage - 1) * pageLimit;

    

    const filter = {};

    

    if (type) {
      if (!["to_receive", "to_pay"].includes(type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ledger type",
        });
      }

      filter.type = type;
    }

    

    if (status) {
      if (
        !["pending", "partial", "completed"].includes(
          status
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid ledger status",
        });
      }

      filter.status = status;
    }

    

    if (search?.trim()) {
      filter.$or = [
        {
          partyName: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          partyPhone: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          note: {
            $regex: search.trim(),
            $options: "i",
          },
        },
      ];
    }

    

    if (startDate || endDate) {
      filter.date = {};

      if (startDate) {
        filter.date.$gte = new Date(startDate);
      }

      if (endDate) {
        const end = new Date(endDate);

        end.setHours(23, 59, 59, 999);

        filter.date.$lte = end;
      }
    }

    

    const [entries, total] = await Promise.all([
      Ledger.find(filter)
        .sort({
          date: -1,
          createdAt: -1,
        })
        .skip(skip)
        .limit(pageLimit)
        .lean(),

      Ledger.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / pageLimit);

    return res.status(200).json({
      success: true,

      entries,

      pagination: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("GET LEDGER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch ledger",
    });
  }
};




export const getLedgerById = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Ledger.findById(id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: "Ledger entry not found",
      });
    }

    return res.status(200).json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error("GET LEDGER BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch ledger entry",
    });
  }
};




export const updateLedger = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      partyName,
      partyPhone,
      type,
      amount,
      date,
      dueDate,
      note,
    } = req.body;

    

    const ledger = await Ledger.findById(id);

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger entry not found",
      });
    }

    

    if (partyName !== undefined) {
      if (!partyName.trim()) {
        return res.status(400).json({
          success: false,
          message: "Party name cannot be empty",
        });
      }

      ledger.partyName = partyName.trim();
    }

    if (partyPhone !== undefined) {
      ledger.partyPhone = partyPhone.trim();
    }

    if (type !== undefined) {
      if (!["to_receive", "to_pay"].includes(type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ledger type",
        });
      }

      ledger.type = type;
    }

    

    if (amount !== undefined) {
      const numericAmount = Number(amount);

      if (
        Number.isNaN(numericAmount) ||
        numericAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Amount must be greater than 0",
        });
      }

      if (numericAmount < ledger.paidAmount) {
        return res.status(400).json({
          success: false,
          message:
            "Amount cannot be less than already paid amount",
        });
      }

      ledger.amount = numericAmount;
    }

    

    if (date !== undefined) {
      ledger.date = date;
    }

    if (dueDate !== undefined) {
      ledger.dueDate = dueDate || null;
    }

    if (note !== undefined) {
      ledger.note = note.trim();
    }

    

    const values = calculateLedgerValues(ledger);

    ledger.paidAmount = values.paidAmount;
    ledger.remainingAmount = values.remainingAmount;
    ledger.status = values.status;

    await ledger.save();

    return res.status(200).json({
      success: true,
      message: "Ledger updated successfully",
      entry: ledger,
    });
  } catch (error) {
    console.error("UPDATE LEDGER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update ledger",
    });
  }
};




export const deleteLedger = async (req, res) => {
  try {
    const { id } = req.params;

    const ledger = await Ledger.findById(id);

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger entry not found",
      });
    }

    await Ledger.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message:
        "Ledger entry and payment history deleted successfully",
    });
  } catch (error) {
    console.error("DELETE LEDGER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete ledger",
    });
  }
};




export const addPayment = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      amount,
      date,
      note,
      paymentMethod,
    } = req.body;

    

    if (
      amount === undefined ||
      amount === null ||
      amount === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment amount is required",
      });
    }

    const paymentAmount = Number(amount);

    if (
      Number.isNaN(paymentAmount) ||
      paymentAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment amount must be greater than 0",
      });
    }

    

    const ledger = await Ledger.findById(id);

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger entry not found",
      });
    }

    const currentPaid = Number(
      ledger.paidAmount || 0
    );

    const remaining =
      Number(ledger.amount || 0) - currentPaid;

    

    if (paymentAmount > remaining) {
      return res.status(400).json({
        success: false,
        message: `Payment cannot be greater than remaining amount (${remaining})`,
      });
    }

    

    const payment = {
      amount: paymentAmount,
      date: date || new Date(),
      note: note?.trim() || "",
      paymentMethod:
        paymentMethod || "cash",
      createdBy: req.user?._id || null,
    };

    

    ledger.payments.push(payment);

    ledger.paidAmount =
      currentPaid + paymentAmount;

    ledger.remainingAmount =
      Number(ledger.amount) -
      ledger.paidAmount;

    

    if (ledger.remainingAmount <= 0) {
      ledger.remainingAmount = 0;
      ledger.status = "completed";
    } else {
      ledger.status = "partial";
    }

    await ledger.save();

    return res.status(201).json({
      success: true,
      message: "Payment added successfully",
      entry: ledger,
      payment,
    });
  } catch (error) {
    console.error("ADD PAYMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to add payment",
    });
  }
};




export const deletePayment = async (req, res) => {
  try {
    const {
      id,
      paymentId,
    } = req.params;

    const ledger = await Ledger.findById(id);

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger entry not found",
      });
    }

    const payment = ledger.payments.id(paymentId);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const paymentAmount = Number(
      payment.amount || 0
    );

    

    payment.deleteOne();

    ledger.paidAmount = Math.max(
      Number(ledger.paidAmount || 0) -
        paymentAmount,
      0
    );

    ledger.remainingAmount = Math.max(
      Number(ledger.amount || 0) -
        ledger.paidAmount,
      0
    );

    

    if (ledger.paidAmount <= 0) {
      ledger.status = "pending";
    } else if (
      ledger.remainingAmount <= 0
    ) {
      ledger.status = "completed";
    } else {
      ledger.status = "partial";
    }

    await ledger.save();

    return res.status(200).json({
      success: true,
      message: "Payment deleted successfully",
      entry: ledger,
    });
  } catch (error) {
    console.error("DELETE PAYMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to delete payment",
    });
  }
};




export const getLedgerSummary = async (req, res) => {
  try {
    const [
      toReceiveResult,
      toPayResult,
      statusResult,
    ] = await Promise.all([
      Ledger.aggregate([
        {
          $match: {
            type: "to_receive",
          },
        },
        {
          $group: {
            _id: null,

            total: {
              $sum: "$amount",
            },

            paid: {
              $sum: "$paidAmount",
            },

            pending: {
              $sum: "$remainingAmount",
            },
          },
        },
      ]),

      Ledger.aggregate([
        {
          $match: {
            type: "to_pay",
          },
        },
        {
          $group: {
            _id: null,

            total: {
              $sum: "$amount",
            },

            paid: {
              $sum: "$paidAmount",
            },

            pending: {
              $sum: "$remainingAmount",
            },
          },
        },
      ]),

      Ledger.aggregate([
        {
          $group: {
            _id: "$status",
            count: {
              $sum: 1,
            },
          },
        },
      ]),
    ]);

    const toReceive =
      toReceiveResult[0] || {
        total: 0,
        paid: 0,
        pending: 0,
      };

    const toPay =
      toPayResult[0] || {
        total: 0,
        paid: 0,
        pending: 0,
      };

    const statuses = {
      pending: 0,
      partial: 0,
      completed: 0,
    };

    statusResult.forEach((item) => {
      if (statuses[item._id] !== undefined) {
        statuses[item._id] = item.count;
      }
    });

    return res.status(200).json({
      success: true,

      toReceive: {
        total: toReceive.total || 0,
        paid: toReceive.paid || 0,
        pending: toReceive.pending || 0,
      },

      toPay: {
        total: toPay.total || 0,
        paid: toPay.paid || 0,
        pending: toPay.pending || 0,
      },

      statuses,
    });
  } catch (error) {
    console.error("GET LEDGER SUMMARY ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message || "Failed to fetch ledger summary",
    });
  }
};



export const getOverdueLedger = async (req, res) => {
  try {
    const today = new Date();

    today.setHours(23, 59, 59, 999);

    const entries = await Ledger.find({
      status: {
        $ne: "completed",
      },

      remainingAmount: {
        $gt: 0,
      },

      dueDate: {
        $lt: today,
      },
    }).sort({
      dueDate: 1,
    });

    return res.status(200).json({
      success: true,
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error(
      "GET OVERDUE LEDGER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch overdue entries",
    });
  }
};




export const getLedgerByType = async (req, res) => {
  try {
    const { type } = req.params;

    if (!["to_receive", "to_pay"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ledger type",
      });
    }

    const entries = await Ledger.find({
      type,
    }).sort({
      date: -1,
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      type,
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error(
      "GET LEDGER BY TYPE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch ledger entries",
    });
  }
};