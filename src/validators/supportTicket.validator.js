const VALID_CATEGORIES = [
  "IT Support",
  "HR",
  "Finance",
  "Payroll",
  "Other",
];

const VALID_PRIORITIES = [
  "Low",
  "Medium",
  "High",
  "Urgent",
];

export const validateCreateTicket = ({
  subject,
  category,
  priority,
  description,
}) => {
  const errors = {};

  if (!subject?.trim()) {
    errors.subject = "Subject is required";
  } else if (subject.trim().length < 5) {
    errors.subject =
      "Subject must be at least 5 characters";
  }

  if (!category) {
    errors.category = "Category is required";
  } else if (!VALID_CATEGORIES.includes(category)) {
    errors.category = "Invalid category";
  }

  if (!priority) {
    errors.priority = "Priority is required";
  } else if (!VALID_PRIORITIES.includes(priority)) {
    errors.priority = "Invalid priority";
  }

  if (!description?.trim()) {
    errors.description =
      "Description is required";
  } else if (description.trim().length < 10) {
    errors.description =
      "Description must be at least 10 characters";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};