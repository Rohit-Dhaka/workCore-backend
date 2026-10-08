const validSlots = ["morning", "afternoon", "evening"];

export const validateProgressSlot = (req, res, next) => {
  try {
    const { slot, work, achievements, blockers, hours } = req.body;

    if (!slot) {
      return res.status(400).json({
        success: false,
        message: "Progress slot is required",
      });
    }

    if (!validSlots.includes(slot)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid slot. Use morning, afternoon or evening.",
      });
    }

    if (
      work !== undefined &&
      typeof work !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Work must be a string",
      });
    }

    if (
      achievements !== undefined &&
      typeof achievements !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Achievements must be a string",
      });
    }

    if (
      blockers !== undefined &&
      typeof blockers !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Blockers must be a string",
      });
    }

    if (
      hours !== undefined &&
      (typeof hours !== "number" || hours < 0 || hours > 24)
    ) {
      return res.status(400).json({
        success: false,
        message: "Hours must be between 0 and 24",
      });
    }

    next();
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: "Invalid progress data",
    });
  }
};