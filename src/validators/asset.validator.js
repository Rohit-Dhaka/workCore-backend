import { z } from "zod";

const CATEGORIES = [
  "laptop",
  "desktop",
  "mobile",
  "tablet",
  "monitor",
  "accessory",
  "furniture",
  "id_card",
  "other",
];
const CONDITIONS = ["new", "good", "fair", "poor"];

const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.error.issues[0].message,
      errors: result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  }

  req.body = result.data;
  next();
};

const assetBase = z.object({
  name: z.string().trim().min(2, "Asset name kam se kam 2 character ka ho"),
  assetCode: z.string().trim().min(2, "Asset code zaroori hai"),
  category: z.enum(CATEGORIES).optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  purchaseDate: z.coerce.date().optional(),
  purchasePrice: z.coerce.number().min(0, "Price negative nahi ho sakta").optional(),
  warrantyUntil: z.coerce.date().optional(),
  condition: z.enum(CONDITIONS).optional(),
  notes: z.string().trim().optional(),
});

const assignSchema = z.object({
  employeeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Valid employee select karo"),
  conditionOnAssign: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

const returnSchema = z.object({
  condition: z.enum(CONDITIONS).optional(),
  nextStatus: z.enum(["available", "under_repair"]).optional(),
  note: z.string().trim().optional(),
});

const statusSchema = z.object({
  status: z.enum(["available", "under_repair", "retired"]),
});

export const validateCreateAsset = validate(assetBase);
export const validateUpdateAsset = validate(assetBase.partial());
export const validateAssign = validate(assignSchema);
export const validateReturn = validate(returnSchema);
export const validateStatus = validate(statusSchema);