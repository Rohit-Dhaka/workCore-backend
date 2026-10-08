export const SERVICE_CATEGORIES = [
  "Website & Web Development",
  "Software Development",
  "UI/UX & Design",
  "Digital Marketing",
  "Other Services",
];

export const PRICING_TYPES = [
  "One Time",
  "Monthly",
  "Yearly",
  "Hourly",
  "Custom",
];

export const QUOTATION_STATUSES = [
  "Draft",
  "Sent",
  "Viewed",
  "Accepted",
  "Rejected",
  "Expired",
  "Converted",
];


export const STATUS_TRANSITIONS = {
  Draft: ["Sent"],
  Sent: ["Viewed", "Accepted", "Rejected", "Expired"],
  Viewed: ["Accepted", "Rejected", "Expired"],
  Accepted: ["Converted"],
  Rejected: ["Draft"],
  Expired: ["Draft", "Sent"],
  Converted: [],
};

export const PROJECT_PRIORITIES = ["Low", "Medium", "High"];

export const BUDGET_STATUSES = [
  "Within Budget",
  "Above Budget",
  "Below Budget",
  "Not Specified",
];

export const DEFAULT_TERMS = [
  "The quotation is valid until the mentioned validity date.",
  "Project development begins after advance payment.",
  "Client must provide required content and assets on time.",
  "Additional features outside the approved scope will be charged separately.",
  "Additional revisions may incur additional charges.",
  "Third-party services are billed separately unless explicitly included.",
  "Source code is delivered after full payment.",
  "Project timeline may change if client feedback or content is delayed.",
];

export const DEFAULT_EXCLUSIONS = [
  "Domain charges",
  "Hosting charges",
  "Paid third-party APIs",
  "Premium plugins",
  "Paid stock images",
  "Additional features outside agreed scope",
  "Additional revisions beyond agreed limit",
];

export const DEFAULT_PAYMENT_TEMPLATES = [
  {
    name: "40 / 40 / 20",
    isDefault: true,
    milestones: [
      { label: "Advance", percent: 40 },
      { label: "After Development", percent: 40 },
      { label: "Before Final Delivery", percent: 20 },
    ],
  },
  {
    name: "50 / 50",
    isDefault: false,
    milestones: [
      { label: "Advance", percent: 50 },
      { label: "On Completion", percent: 50 },
    ],
  },
  {
    name: "100% Advance",
    isDefault: false,
    milestones: [{ label: "Advance", percent: 100 }],
  },
];

export const round2 = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;


export const cleanList = (list) =>
  Array.isArray(list)
    ? list.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];