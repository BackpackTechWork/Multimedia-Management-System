const PARENT_FOLDER_ID = 'YOUR_PARENT_FOLDER_ID'; 
const SHEET_NAME = 'Files';

let remarksCache = null;
let remarksCacheTime = 0;
const CACHE_DURATION = 30000; 

function initializeSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange("A1:H1").setValues([[
      "File ID", "File Name", "File Type", "Parent Folder ID",
      "Folder Path", "Remarks", "Last Modified", "File URL"
    ]]);
    sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#297373").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function doGet() {
  const userEmail = Session.getActiveUser().getEmail();

  if (!isEmailAllowed(userEmail)) {
    return HtmlService.createHtmlOutput(
      `<h3>Access denied</h3>
       <p>Your email (${userEmail || 'unknown'}) is not authorized.</p>`
    ).setTitle("Access Restricted");
  }

  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Multimedia Management System")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function isEmailAllowed(email) {
  if (!email) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Settings");
  if (!sheet) return false;

  const emails = sheet
    .getRange("B2:B")
    .getValues()
    .flat()
    .filter(String)
    .map(e => e.toLowerCase().trim());

  return emails.includes(email.toLowerCase().trim());
}

function getParentFolderInfo() {
  try {
    const folder = DriveApp.getFolderById(PARENT_FOLDER_ID);
    return {
      success: true,
      name: folder.getName(),
      id: folder.getId(),
      url: folder.getUrl()
    };
  } catch (e) {
    return {
      success: false,
      error: "Invalid parent folder ID. Please update PARENT_FOLDER_ID in Code.gs"
    };
  }
}

function createSubFolder(folderName, parentId) {
  try {
    const targetFolderId = parentId || PARENT_FOLDER_ID;
    const parentFolder = DriveApp.getFolderById(targetFolderId);
    const newFolder = parentFolder.createFolder(folderName);

    return {
      success: true,
      folder: {
        id: newFolder.getId(),
        name: newFolder.getName(),
        url: newFolder.getUrl(),
        hasSubfolders: false
      }
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


function getFolderContents(folderId) {
  folderId = folderId || PARENT_FOLDER_ID;

  try {
    const folder = DriveApp.getFolderById(folderId);
    const subfolders = [];
    const files = [];
    

    const allRemarks = getAllRemarks();


    const folderIterator = folder.getFolders();
    while (folderIterator.hasNext()) {
      const subfolder = folderIterator.next();
      subfolders.push({
        id: subfolder.getId(),
        name: subfolder.getName(),
        hasSubfolders: subfolder.getFolders().hasNext()
      });
    }


    const fileIterator = folder.getFiles();
    while (fileIterator.hasNext()) {
      const file = fileIterator.next();
      const fileId = file.getId();
      const mimeType = file.getMimeType();

      files.push({
        id: fileId,
        name: file.getName(),
        mimeType: mimeType,
        size: file.getSize(),
        lastModified: file.getLastUpdated().toISOString(),
        url: file.getUrl(),
        thumbnailUrl: (mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0) 
          ? "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400" 
          : null,
        remarks: allRemarks[fileId] || ""
      });
    }


    subfolders.sort(function(a, b) { return a.name.localeCompare(b.name); });
    files.sort(function(a, b) { return a.name.localeCompare(b.name); });

    return {
      success: true,
      folders: subfolders,
      files: files,
      currentFolder: {
        id: folder.getId(),
        name: folder.getName()
      },
      folderPath: getFolderPath(folderId)
    };
  } catch (e) {
    return {
      success: false,
      error: e.toString(),
      folders: [],
      files: [],
      folderPath: []
    };
  }
}

function getAllRemarks() {
  const now = Date.now();
  
  if (remarksCache && (now - remarksCacheTime) < CACHE_DURATION) {
    return remarksCache;
  }
  
  try {
    const sheet = initializeSheet();
    const data = sheet.getDataRange().getValues();
    const remarks = {};
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) {
        remarks[data[i][0]] = data[i][5] || "";
      }
    }
    
    remarksCache = remarks;
    remarksCacheTime = now;
    
    return remarks;
  } catch (e) {
    return {};
  }
}

function getFolderPath(folderId) {
  const path = [];
  
  try {
    let currentFolder = DriveApp.getFolderById(folderId);
    let iterations = 0;
    const maxIterations = 20;

    while (currentFolder.getId() !== PARENT_FOLDER_ID && iterations < maxIterations) {
      path.unshift({
        id: currentFolder.getId(),
        name: currentFolder.getName()
      });

      const parents = currentFolder.getParents();
      if (!parents.hasNext()) break;
      currentFolder = parents.next();
      iterations++;
    }

    const parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
    path.unshift({
      id: PARENT_FOLDER_ID,
      name: parentFolder.getName()
    });
  } catch (e) {

  }

  return path;
}

function renameFolder(folderId, newName) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    folder.setName(newName);
    return { success: true, message: "Folder renamed to \"" + newName + "\"" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


function moveFolder(sourceFolderId, targetFolderId) {
  try {
    if (!sourceFolderId || !targetFolderId) {
      return { success: false, error: "Invalid folder IDs" };
    }
    
    if (sourceFolderId === targetFolderId) {
      return { success: false, error: "Cannot move folder into itself" };
    }
    
    if (isDescendantOf(targetFolderId, sourceFolderId)) {
      return { success: false, error: "Cannot move folder into its subfolder" };
    }
    
    const sourceFolder = DriveApp.getFolderById(sourceFolderId);
    const targetFolder = DriveApp.getFolderById(targetFolderId);

    const parents = sourceFolder.getParents();
    while (parents.hasNext()) {
      parents.next().removeFolder(sourceFolder);
    }

    targetFolder.addFolder(sourceFolder);

    return { success: true, message: "Moved to \"" + targetFolder.getName() + "\"" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function isDescendantOf(potentialDescendantId, ancestorId) {
  try {
    let folder = DriveApp.getFolderById(potentialDescendantId);
    let iterations = 0;
    
    while (iterations < 20) {
      const parents = folder.getParents();
      if (!parents.hasNext()) return false;
      
      const parent = parents.next();
      if (parent.getId() === ancestorId) return true;
      folder = parent;
      iterations++;
    }
    
    return false;
  } catch (e) {
    return false;
  }
}


function searchFilesAndFolders(query, startFolderId) {
  startFolderId = startFolderId || PARENT_FOLDER_ID;
  const MAX_RESULTS = 50;

  try {
    const results = { folders: [], files: [] };
    const searchQuery = query.toLowerCase();
    const allRemarks = getAllRemarks();
    let totalFound = 0;

    function searchInFolder(folderId, path) {
      if (totalFound >= MAX_RESULTS) return;
      
      try {
        const folder = DriveApp.getFolderById(folderId);

        const folderIterator = folder.getFolders();
        while (folderIterator.hasNext() && totalFound < MAX_RESULTS) {
          const subfolder = folderIterator.next();
          const folderPath = path + " > " + subfolder.getName();

          if (subfolder.getName().toLowerCase().indexOf(searchQuery) !== -1) {
            results.folders.push({
              id: subfolder.getId(),
              name: subfolder.getName(),
              path: folderPath,
              hasSubfolders: subfolder.getFolders().hasNext()
            });
            totalFound++;
          }

          searchInFolder(subfolder.getId(), folderPath);
        }

        const fileIterator = folder.getFiles();
        while (fileIterator.hasNext() && totalFound < MAX_RESULTS) {
          const file = fileIterator.next();

          if (file.getName().toLowerCase().indexOf(searchQuery) !== -1) {
            const fileId = file.getId();
            const mimeType = file.getMimeType();
            
            results.files.push({
              id: fileId,
              name: file.getName(),
              mimeType: mimeType,
              size: file.getSize(),
              lastModified: file.getLastUpdated().toISOString(),
              url: file.getUrl(),
              thumbnailUrl: (mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0) 
                ? "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400" 
                : null,
              remarks: allRemarks[fileId] || "",
              path: path
            });
            totalFound++;
          }
        }
      } catch (e) {

      }
    }

    const rootFolder = DriveApp.getFolderById(startFolderId);
    searchInFolder(startFolderId, rootFolder.getName());

    return {
      success: true,
      results: results,
      query: query,
      limited: totalFound >= MAX_RESULTS
    };
  } catch (e) {
    return {
      success: false,
      error: e.toString(),
      results: { folders: [], files: [] }
    };
  }
}

function saveFileRemarks(fileId, fileName, fileType, parentFolderId, folderPath, remarks) {
  try {
    const sheet = initializeSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === fileId) {
        rowIndex = i + 1;
        break;
      }
    }

    const file = DriveApp.getFileById(fileId);
    const rowData = [
      fileId, fileName, fileType, parentFolderId,
      folderPath, remarks, new Date(file.getLastUpdated()), file.getUrl()
    ];

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1, 1, 8).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }


    remarksCache = null;

    return { success: true, message: "Remarks saved" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}