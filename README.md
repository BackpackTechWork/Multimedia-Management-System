# Multimedia Management System

A comprehensive system for managing and organizing multimedia files stored in Google Drive. The system provides an intuitive web interface for browsing, searching, and managing your media files with advanced features like file remarks, folder organization, and drag-and-drop functionality.

## Overview

The Multimedia Management System is currently implemented as a **Google Apps Script** web application that integrates seamlessly with Google Drive and Google Sheets. It provides a modern, responsive interface for managing your multimedia files, making it easy to organize, search, and annotate your media library.

### Current Status

- **App Script System** - Fully functional and ready to use
- **Web System Node + EJS** - Coming soon

## Features

### File Management
- **Browse Files & Folders**: Navigate through your Google Drive structure with an intuitive folder tree
- **Search Functionality**: Quickly find files and folders by name across your entire media library
- **File Previews**: Automatic thumbnail generation for images and videos
- **File Metadata**: View file size, type, and last modified date
- **File Remarks**: Add and save custom notes/remarks for each file

### Folder Management
- **Create Folders**: Easily create new subfolders within your media library
- **Rename Folders**: Update folder names directly from the interface
- **Move Folders**: Drag-and-drop folders to reorganize your structure
- **Breadcrumb Navigation**: Navigate back through folder hierarchy with visual breadcrumbs
- **Folder Indicators**: See which folders contain subfolders at a glance

### User Experience
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Modern UI**: Clean, modern interface with smooth animations and transitions
- **Access Control**: Email-based authentication to restrict access
- **Real-time Updates**: Instant feedback for all operations
- **Error Handling**: Clear error messages and success notifications

## System Architecture

```
Multimedia-Management-System/
│
├── App Script System/          # Google Apps Script implementation
│   ├── Code.js                 # Backend logic and Google Apps Script functions
│   ├── index.html              # Frontend HTML, CSS, and JavaScript
│   └── appsscript.json         # Apps Script configuration
│
└── Web System Node + EJS/      # Future Node.js implementation (coming soon)
```

### Components

1. **Google Apps Script Backend** (`Code.js`)
   - Handles Google Drive API interactions
   - Manages Google Sheets for file metadata storage
   - Implements access control and security
   - Provides server-side functions for the frontend

2. **Frontend Interface** (`index.html`)
   - Modern, responsive web interface
   - Client-side JavaScript for interactivity
   - Drag-and-drop functionality
   - Real-time search and filtering

3. **Data Storage** (Google Sheets)
   - Stores file metadata (ID, name, type, path)
   - Maintains file remarks/notes
   - Tracks file URLs and modification dates

## Setup Instructions

### Prerequisites

- A Google account with access to Google Drive
- Google Apps Script access (included with Google Workspace or personal Google account)
- A Google Drive folder containing your multimedia files (or create a new one)

### Step 1: Create a New Google Apps Script Project

1. Go to [Google Apps Script](https://script.google.com/)
2. Click **"New Project"**
3. Give your project a name (e.g., "Multimedia Management System")

### Step 2: Upload Project Files

1. In the Apps Script editor, delete the default `Code.gs` file
2. Create new files and copy the contents:
   - **Code.js** → Copy contents from `App Script System/Code.js`
   - **index.html** → Copy contents from `App Script System/index.html`
   - **appsscript.json** → Copy contents from `App Script System/appsscript.json`

### Step 3: Configure Parent Folder

1. Open `Code.js` in the Apps Script editor
2. Find the line: `const PARENT_FOLDER_ID = 'YOUR_PARENT_FOLDER_ID';`
3. Get your Google Drive folder ID:
   - Open the folder in Google Drive
   - Copy the ID from the URL (the long string after `/folders/`)
   - Example: `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j` → ID is `1a2b3c4d5e6f7g8h9i0j`
4. Replace `'YOUR_PARENT_FOLDER_ID'` with your actual folder ID

### Step 4: Set Up Access Control

1. Create a new Google Sheet (or use an existing one)
2. Name a sheet tab **"Settings"**
3. In column B, starting from row 2, add authorized email addresses (one per row)
4. Link this spreadsheet to your Apps Script project:
   - In Apps Script, go to **Resources** → **Libraries**
   - Or ensure the script has access to the spreadsheet

### Step 5: Deploy as Web App

1. In the Apps Script editor, click **Deploy** → **New deployment**
2. Click the gear icon next to **"Select type"** → Choose **"Web app"**
3. Configure the deployment:
   - **Description**: "Multimedia Management System v1.0"
   - **Execute as**: "User accessing the web app"
   - **Who has access**: "Anyone" (or restrict as needed)
4. Click **Deploy**
5. Copy the **Web App URL** - this is your application URL

### Step 6: Grant Permissions

1. When you first access the web app, you'll be prompted to authorize
2. Click **Review permissions**
3. Select your Google account
4. Click **Advanced** → **Go to [Project Name] (unsafe)** (if shown)
5. Click **Allow** to grant necessary permissions:
   - View and manage Google Drive files
   - View and manage Google Sheets

## Configuration

### Environment Variables

In `Code.js`, you can configure:

```javascript
const PARENT_FOLDER_ID = 'YOUR_PARENT_FOLDER_ID';  // Your main media folder ID
const SHEET_NAME = 'Files';                        // Name of the sheet tab for file data
const CACHE_DURATION = 30000;                      // Cache duration in milliseconds (30 seconds)
```

### Access Control Setup

The system uses a **Settings** sheet in your Google Spreadsheet for access control:

| Column A | Column B |
|----------|----------|
| Username | Email Address |
|     someperson     | user1@example.com |
|     someperson 2     | user2@example.com |

Only emails listed in column B (starting from row 2) will have access to the system.

## Usage Guide

### Navigating the Interface

1. **Breadcrumb Navigation**: Click on any folder in the breadcrumb trail to navigate directly to that folder
2. **Folder Cards**: Click the folder icon button to open a folder, or use the rename button to rename it
3. **File Cards**: Click on a file preview to open it in Google Drive

### Searching Files

1. Type at least 2 characters in the search box
2. The system will search across all folders and files
3. Results show the folder path for each file
4. Clear the search to return to normal browsing

### Managing Folders

- **Create Folder**: Click "New Folder" button, enter a name, and click "Create"
- **Rename Folder**: Click the edit icon (pencil) on any folder card
- **Move Folder**: Drag a folder card and drop it onto another folder card

### Adding File Remarks

1. Find the file you want to annotate
2. Type your notes in the "Remarks" textarea
3. Click "Save" to store the remarks
4. Remarks are saved to Google Sheets and persist across sessions

### File Types Supported

- **Images**: JPEG, PNG, GIF, WebP, etc. (with thumbnail previews)
- **Videos**: MP4, AVI, MOV, etc. (with thumbnail previews)
- **Documents**: PDF, DOCX, etc.
- **Other Files**: All file types supported by Google Drive

## Access Control

The system implements email-based access control:

- Only users whose email addresses are listed in the **Settings** sheet can access the web app
- Access is checked on every page load
- Unauthorized users see an "Access denied" message
- The email check is case-insensitive

### Adding Users

1. Open your Google Spreadsheet
2. Navigate to the **Settings** sheet
3. Add email addresses in column B (one per row, starting from row 2)
4. Changes take effect immediately (no redeployment needed)

## Future Development

### Web System Node + EJS

A standalone Node.js implementation is planned for the future, which will:

- Provide a self-hosted alternative to Google Apps Script
- Use Express.js and EJS templating
- Include RESTful API endpoints
- Support custom authentication methods
- Offer more flexibility for advanced features

**Status**: Coming soon

## Technical Details

### Technologies Used

- **Google Apps Script**: Server-side JavaScript runtime
- **Google Drive API**: File and folder management
- **Google Sheets API**: Data persistence
- **HTML5/CSS3**: Modern web interface
- **Vanilla JavaScript**: Client-side interactivity
- **Font Awesome**: Icon library

### Performance Optimizations

- **Caching**: Remarks are cached for 30 seconds to reduce API calls
- **Lazy Loading**: File thumbnails load on demand
- **Search Debouncing**: Search queries are debounced to reduce server load
- **Result Limiting**: Search results limited to 50 items for performance

### API Functions

The system exposes the following server-side functions:

- `doGet()` - Main entry point for the web app
- `getParentFolderInfo()` - Gets root folder information
- `getFolderContents(folderId)` - Retrieves folder contents
- `createSubFolder(folderName, parentId)` - Creates a new folder
- `renameFolder(folderId, newName)` - Renames a folder
- `moveFolder(sourceFolderId, targetFolderId)` - Moves a folder
- `searchFilesAndFolders(query, startFolderId)` - Searches for files/folders
- `saveFileRemarks(...)` - Saves file remarks to Google Sheets
- `isEmailAllowed(email)` - Checks if email has access

### Data Structure

The Google Sheets "Files" sheet stores:

| Column | Description |
|--------|-------------|
| A | File ID |
| B | File Name |
| C | File Type |
| D | Parent Folder ID |
| E | Folder Path |
| F | Remarks |
| G | Last Modified |
| H | File URL |

## Notes

- The system requires appropriate Google Drive permissions
- File thumbnails are generated by Google Drive
- The system works best with folders containing multimedia files
- Large folder structures may take longer to load
- Search is case-insensitive and matches partial strings