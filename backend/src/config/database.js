const mongoose = require('mongoose');

// Helper to remove credentials from connection error strings
const sanitizeError = (message) => {
  if (!message) return '';
  return message.replace(/:([^@\s]+)@/g, ':****@');
};

const connectDB = async () => {
  const primaryUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/learniq';
  const fallbackUri = 'mongodb://127.0.0.1:27017/learniq';

  try {
    const conn = await mongoose.connect(primaryUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB connected successfully');
    return conn;
  } catch (primaryError) {
    const safeMsg = sanitizeError(primaryError.message);

    // If primary URI is remote and failed (e.g. network/SRV issue), try local MongoDB
    if (primaryUri !== fallbackUri) {
      try {
        const conn = await mongoose.connect(fallbackUri, {
          serverSelectionTimeoutMS: 3000,
        });
        console.log('MongoDB connected successfully');
        return conn;
      } catch (fallbackError) {
        console.error(`MongoDB connection failed: ${safeMsg}`);
        process.exit(1);
      }
    } else {
      console.error(`MongoDB connection failed: ${safeMsg}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
