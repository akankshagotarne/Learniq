const mongoose = require('mongoose');

// Helper to sanitize error messages so credentials are never logged or exposed
const sanitizeError = (message) => {
  if (!message) return '';
  return message.replace(/:([^@\s]+)@/g, ':****@');
};

/**
 * Reusable MongoDB connection function using Mongoose.
 * Prevents duplicate connections and handles errors gracefully.
 */
const connectDB = async () => {
  // Check if connection is already established (readyState === 1: connected)
  if (mongoose.connection.readyState === 1) {
    console.log('✅ MongoDB connected (cached)');
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MongoDB connection failed: MONGODB_URI environment variable is missing.');
    throw new Error('MONGODB_URI is not set');
  }

  const primaryUri = uri;
  const fallbackUri = 'mongodb://127.0.0.1:27017/learniq';

  try {
    await mongoose.connect(primaryUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ MongoDB connected');
    return mongoose.connection;
  } catch (primaryError) {
    const safeMsg = sanitizeError(primaryError.message);

    // If remote connection fails (e.g. network outage), try fallback to local MongoDB if available
    if (primaryUri !== fallbackUri) {
      try {
        console.warn(`⚠️  Primary MongoDB failed (${safeMsg}). Attempting fallback to local MongoDB...`);
        await mongoose.connect(fallbackUri, {
          serverSelectionTimeoutMS: 3000,
        });
        console.log('✅ MongoDB connected (local fallback)');
        return mongoose.connection;
      } catch (fallbackError) {
        console.error(`❌ MongoDB connection failed: ${safeMsg}`);
        throw primaryError;
      }
    } else {
      console.error(`❌ MongoDB connection failed: ${safeMsg}`);
      throw primaryError;
    }
  }
};

module.exports = connectDB;
