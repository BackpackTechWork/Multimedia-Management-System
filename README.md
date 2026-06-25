# Harbor Drive

A self-hosted file management application built with Node.js, Express.js, EJS, Tailwind CSS, MySQL, and Drizzle ORM.

## Features
- **Materialized Path Folders**: Efficient, recursive-free folder structures for rapid deep nesting lookups.
- **Sliding-Window Session Store**: Session verification tracked inside MySQL with sliding 7-day expirations and remote multi-device session revocations.
- **Resumeable Chunked Uploads**: High-speed chunk slicing on client side supporting >10GB file uploads and network interruption resumes with constant memory usage.
- **File Versioning**: Comprehensive file version archiving with simple one-click restoration or deletion.
- **30-Day Trash Purging**: Graceful file deletions with 30-day retention buffers and automated background purging.
- **Starred & Recent Filters**: Quick access to starred items and recently opened document lists.
- **MySQL Full-Text Search**: Fast matches on files based on FULLTEXT indexes.
- **Asynchronous Work Queue**: Background runner (using a database-backed table) to compile ZIP archives, process folder clones, and crop image thumbnails using `sharp`.
- **Completely Self-Hosted**: Zero CDN scripts. All fonts (Inter), icons (Bootstrap Icons), and viewers (marked, lightgallery, PDF.js, excel-viewer, js-beautify) are hosted locally.

---

## Technical Stack
- **Backend**: Node.js (latest LTS), Express.js
- **Database / ORM**: MySQL 8+, Drizzle ORM
- **Security & Speed**: Helmet headers, CSRF tokens, Rate limiters, Gzip compression
- **Frontend**: EJS templates, Tailwind CSS, Vanilla JavaScript

---

## Setup and Installation

### 1. Prerequisites
- **Node.js** (v18+ or v20+ recommended)
- **MySQL 8+** active server instance
- **npm** package manager

### 2. Install Dependencies
Clone the repository and run:
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in your database credentials:
```bash
cp .env.example .env
```
Ensure the database specified (e.g. `drive_clone`) is created inside your MySQL server.

### 4. Fetch Local Vendor Assets
Run the setup script to download and structure the self-hosted assets (fonts, icons, viewers) from `node_modules` into the `public/vendor/` folder:
```bash
npm run setup:vendors
```

### 5. Build CSS Stylesheets
Compile Tailwind CSS assets using the Tailwind CLI processor:
```bash
npm run build:css
```

### 6. Push Database Schema
Sync the Drizzle schema structure directly into your MySQL database:
```bash
npm run db:push
```

### 7. Run the Application
Start the development server with automatic file watchers:
```bash
npm run dev
```
Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser!

---

## Folder Structure
```
project/
├── app.js
├── tailwind.config.js
├── drizzle.config.js
├── package.json
├── config/
│   ├── db.js
│   └── sessionStore.js
├── models/
│   └── schema.js
├── repositories/
│   ├── UserRepository.js
│   ├── FolderRepository.js
│   ├── FileRepository.js
│   ├── SessionRepository.js
│   ├── ShareRepository.js
│   └── JobRepository.js
├── services/
│   ├── AuthService.js
│   ├── StorageService.js
│   ├── DriveService.js
│   └── QueueService.js
├── middleware/
│   ├── auth.js
│   └── security.js
├── routes/
│   ├── auth.js
│   ├── drive.js
│   ├── share.js
│   └── preview.js
├── public/
│   ├── css/          # Compiled stylesheets
│   ├── js/           # Form validation, drag-and-drop, shortcuts
│   └── vendor/       # Self-hosted assets (Inter, Bootstrap Icons, lightgallery, embedpdf)
├── views/            # Server rendered template engine
└── storage/          # Local file and chunk storage root
```
