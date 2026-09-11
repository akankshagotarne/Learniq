const multer = require('multer');
const path = require('path');
const fs = require('fs');

const createStorage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads', folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (allowedTypes) => (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`), false);
  }
};

const uploadVideo = multer({
  storage: createStorage('videos'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: fileFilter(['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm']),
});

const uploadPDF = multer({
  storage: createStorage('pdfs'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: fileFilter(['application/pdf']),
});

const uploadAvatar = multer({
  storage: createStorage('avatars'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']),
});

const uploadAssignment = multer({
  storage: createStorage('assignments'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: fileFilter(['application/pdf', 'image/jpeg', 'image/png', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
});

// Screenshots/photos attached to Help & Support ticket messages
const uploadSupportAttachment = multer({
  storage: createStorage('support'),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']),
});

// Screenshots/photos attached to course doubt-chat messages (student <-> teacher)
const uploadDoubtAttachment = multer({
  storage: createStorage('doubts'),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: fileFilter(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']),
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

module.exports = { uploadVideo, uploadPDF, uploadAvatar, uploadAssignment, uploadSupportAttachment, uploadDoubtAttachment, handleMulterError };
