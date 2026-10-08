const allowedTypes = [
  "general",
  "notice",
  "event",
  "holiday",
  "policy",
  "urgent",
];

const allowedPriorities = [
  "low",
  "medium",
  "high",
];

const allowedAudiences = [
  "all",
  "employees",
  "admins",
];

export const validateAnnouncement = (data) => {
  const {
    title,
    content,
    type,
    priority,
    audience,
  } = data;

  if (!title || !title.trim()) {
    return "Announcement title is required";
  }

  if (!content || !content.trim()) {
    return "Announcement content is required";
  }

  if (
    type &&
    !allowedTypes.includes(type)
  ) {
    return "Invalid announcement type";
  }

  if (
    priority &&
    !allowedPriorities.includes(priority)
  ) {
    return "Invalid priority";
  }

  if (
    audience &&
    !allowedAudiences.includes(audience)
  ) {
    return "Invalid audience";
  }

  return null;
};