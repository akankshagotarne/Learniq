# 🎓 Learniq — Complete Full-Stack EdTech Platform

> **Learn Smarter. Grow Better.**  
> An interactive, full-stack educational platform connecting teachers with students across India (Standards 1 to 10) through live tuition, recorded video courses, downloadable study notes, interactive quizzes, active recall flashcards, and gamified analytics.

---

## 🌟 Key Features

### 👨‍🎓 For Students
- **Standard-Specific Portal (Std 1–10)**: Tailored dashboard and curriculum mapping for CBSE, ICSE, and State Boards.
- **Interactive Lecture Player**:
  - Speed-controlled video player (0.75x to 2x) with responsive progress tracking.
  - Downloadable study notes and formula sheets.
  - Real-time practice quizzes with explanations and instant scoring.
  - 3D flip flashcards for active recall and revision.
  - XP rewards (+50 XP) and course progress indicators.
- **Live Classroom**:
  - Live video and audio sessions with teachers.
  - Real-time student-teacher chat with role badges.
  - Live pop-quizzes and interactive participant lists.
- **Gamification & Analytics**:
  - Daily learning streaks (🔥 streak tracker), points, and achievement badges.
  - Visual charts of attendance, quiz averages, and syllabus completion.
- **Seamless Checkout**: Multi-mode payment gateway (UPI, QR code, Cards, Net Banking) with instant receipt generation.

### 👩‍🏫 For Teachers
- **Teacher Command Center**: Overview of enrolled students, active courses, scheduled live sessions, and assignment submissions.
- **Live Class Management**: Generate instant 8-character live session codes, share links, and control start/end class states.
- **Roster & Performance**: Search and track performance of enrolled students across taught standards.

### 🛡️ For Administrators
- **Executive Analytics Dashboard**: Platform-wide KPIs (students, teachers, courses, lectures, revenue).
- **Teacher Approvals**: Verification and 1-click approval/rejection workflow for educator applications.
- **User & Content Management**: Full administrative control over user accounts and course listings.

### 🤖 AI Interview (included with a purchased Olympiad exam)
- **🤖 Start AI Interview** appears directly under **Start Exam** on the exam card and unlocks only after a verified exam payment (checked on the server).
- A real-time voice interview with an avatar: one question at a time, live subtitles, server-side scoring, and a result page with strengths and areas to improve.
- One interview per purchase. Setup, environment variables, deployment and troubleshooting: see [`docs/AI_INTERVIEW.md`](docs/AI_INTERVIEW.md).

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 8, TailwindCSS, React Router 7, Recharts, Lucide React, Socket.IO Client, React Hot Toast |
| **Backend** | Node.js, Express, Socket.IO (WebSockets), JWT, Mongoose, Multer, Helmet, Morgan, bcryptjs |
| **AI Interview** | OpenAI (structured outputs + Realtime transcription), HeyGen LiveAvatar |
| **Database** | MongoDB (Atlas or Local) |

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)
- [MongoDB](https://www.mongodb.com/) (local instance or MongoDB Atlas cluster)

### 2. Installation

Clone the repository and install dependencies:

```bash
# Clone the repo
git clone <your-repo-url>
cd LearnIQ

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 3. Environment Configuration

#### Backend (`backend/.env`)
Copy the example environment file:
```bash
cp backend/.env.example backend/.env
```
Update `backend/.env` with your values:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/learniq
JWT_SECRET=your_secret_key
CLIENT_URL=http://localhost:5173
```

#### Frontend (`frontend/.env`)
```bash
cp frontend/.env.example frontend/.env
```
```env
VITE_API_URL=http://localhost:5000/api
```

### 4. Seed Database with Realistic Demo Data

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` first (see `backend/.env.example`), then:

```bash
cd backend
node src/seed/seedData.js
```
This populates:
- 19 Courses across Standards 1, 5, 8, 10
- 106 Video lectures with notes
- 15 Student accounts
- 5 Teacher accounts
- 4 Live sessions & quizzes

### 5. Running the Application

In terminal 1 (Backend):
```bash
cd backend
npm run dev
# Server starts at http://localhost:5000
```

In terminal 2 (Frontend):
```bash
cd frontend
npm run dev
# Vite dev server starts at http://localhost:5173
```

---

## 🔑 Accounts & Credentials

No passwords are published in this repository.

- **Admin**: the seed script creates the admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` (password of at least 12 characters). Choose your own; never commit it.
- **Demo teachers/students** (`teacher1@learniq.in`, `student1@learniq.in`, ...): their password is `SEED_DEMO_PASSWORD` from `backend/.env`. If it is not set, random passwords are generated and the demo accounts cannot be logged into.
- The seed script wipes users, courses and payments, so it refuses to run when `NODE_ENV=production`. Use it only on a local/dev database.


---

## 📁 Project Structure

```
LearnIQ/
├── backend/
│   ├── src/
│   │   ├── config/          # DB & Server configuration
│   │   ├── controllers/     # Route business logic
│   │   ├── middleware/      # Auth, upload, validation
│   │   ├── models/          # Mongoose models (User, Course, Lecture, etc.)
│   │   ├── routes/          # Express route definitions (incl. /api/ai-interviews)
│   │   ├── seed/            # Comprehensive seed script
│   │   ├── socket/          # Real-time WebSocket signaling
│   │   └── server.js        # Server entry point
│   ├── .env.example
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI & layout components
│   │   ├── context/         # AuthContext & global state
│   │   ├── pages/           # All application routes
│   │   │   ├── admin/       # Admin Dashboard
│   │   │   ├── student/     # Student portals & Classroom
│   │   │   ├── teacher/     # Teacher portals
│   │   │   └── ...          # Public pages (Home, Courses, About, Contact)
│   │   ├── services/        # Axios API & Socket client
│   │   ├── types/           # TypeScript interfaces
│   │   ├── App.tsx          # Application routing
│   │   └── main.tsx         # Root DOM render
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── .gitignore
└── README.md
```

---

## 📄 License
This project is proprietary and intended for educational demonstration purposes.
