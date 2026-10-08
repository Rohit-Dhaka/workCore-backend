import mongoose from "mongoose";


const counterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number },
  },
  { versionKey: false },
);


counterSchema.statics.next = async function (key) {
  const counter = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  return counter.seq;
};

const Counter = mongoose.model("Counter", counterSchema);

export default Counter;