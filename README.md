# Harbor Drive

A self-hosted file management application built with Node.js, Express.js, EJS, Tailwind CSS, MySQL, and Drizzle ORM.

## Features
- **Materialized Path Folders**: Efficient, recursive-free folder structures for rapid deep nesting lookups.
- **Sliding-Window Session Store**: Session verification tracked inside MySQL with sliding 7-day expirations and remote multi-device session revocations.
- **Resumable Staged Uploads**: Concurrent chunk transfer with request timeouts, automatic recovery, private fast-disk staging, and server-side finalization that continues after the browser closes.
- **Installable PWA**: Service-worker app shell, persisted background-finalization tracking, and operating-system upload completion notifications.
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

For installations where `STORAGE_ROOT` is a slower NAS or mounted drive, set
`UPLOAD_TEMP_ROOT` to a private directory on a fast local SSD. Do not place it
under `public/`, because Express serves that directory without file-level
authorization. `JOB_CONCURRENCY` controls how many users' finalize and media
jobs can run together (the default is 4).

Uploads stream directly into private staging rather than buffering each chunk
in server memory. Cross-disk finalization and file copies use bounded streams;
`STORAGE_COPY_CONCURRENCY` limits simultaneous copies to final storage (default
2). Start with 1 or 2 for HDD/NAS storage: adding more jobs cannot increase the
disk's or network's bandwidth. Shared-link uploads also stream to staging, with
their existing 50 MB per-file limit; signed-in Drive uploads use resumable chunks
for larger files.

To compare buffered and streamed intake on your server, run
`node scripts/benchmark-uploads.js 8 128` (8 simulated users, 128 MiB each).
It creates and removes isolated temporary files, without using the database or
live storage. Results include throughput, peak memory and the longest event-loop
stall. This is a local intake benchmark; actual upload speed also depends on
network bandwidth, database latency and final storage. Streaming prioritizes
bounded memory and responsiveness under load; buffered intake can be faster on
an otherwise idle, fast local disk.

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

### Updating the Server Without Replacing Uploads

`storage/`, `.upload-temp/`, and the legacy `public/temp/` directory are ignored
by Git. This keeps uploaded photos, files, saved versions, thumbnails, and staged
uploads out of code commits. The application creates its storage directories
automatically. With these directories untracked, normal `git pull` updates leave
their contents in place. Keep your existing server `.env`, which is also ignored.

Before the first update, back up your upload directories and MySQL database.
Check whether any upload files are already tracked on the server:

```bash
git ls-files -- storage .upload-temp public/temp
```

If this prints files, `.gitignore` alone does not protect them. Stop the app,
copy those directories outside the checkout, and remove them from Git tracking
in the source repository using `git rm -r --cached --ignore-unmatch -- storage
.upload-temp public/temp` (this leaves that source checkout's local files on
disk). Commit and push that removal together with the ignore rules. Pull the
change on the server, then restore the backed-up directories before restarting
the app: pulling a commit that removes tracked files can delete the server's
copies. This checkout currently has no tracked files in those directories.

For custom `STORAGE_ROOT` or `UPLOAD_TEMP_ROOT` settings, use absolute paths
outside the repository, such as `/srv/harbor-drive-data/storage` and
`/srv/harbor-drive-data/staging`. If moving existing storage, stop the app, copy
the existing contents to the new directories, update the server `.env`, and
restart. Keep staging private and outside `public/`.

Avoid `git clean -fdx` in the server checkout: it deletes ignored files,
including local storage and `.env`. Continue backing up storage and MySQL;
Git does not back up your uploads or database.

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
