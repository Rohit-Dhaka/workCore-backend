import mongoose from "mongoose";

const announcementReadSchema = new mongoose.Schema(
  {
    announcement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
    },

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

announcementReadSchema.index(
  {
    announcement: 1,
    employee: 1,
  },
  {
    unique: true,
  }
);

const AnnouncementRead = mongoose.model(
  "AnnouncementRead",
  announcementReadSchema
);

export default AnnouncementRead;