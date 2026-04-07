const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("Missing MONGODB_URI in environment variables");
    }

    const conn = await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    if (error && error.code === 8000) {
      console.error("MongoDB authentication failed (AtlasError 8000). Check username/password in MONGODB_URI.");
    } else {
      console.error(error.message || error);
    }
    process.exit(1);
  }
};

module.exports = connectDB;