const fs = require('fs');
const path = require('path');

async function copyFile(src, dest) {
  try {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
    console.log(`Copied: ${path.basename(src)} -> ${path.relative(process.cwd(), dest)}`);
  } catch (err) {
    console.error(`Error copying ${src}:`, err.message);
  }
}

async function copyDir(src, dest) {
  try {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (let entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
    console.log(`Copied Dir: ${path.basename(src)} -> ${path.relative(process.cwd(), dest)}`);
  } catch (err) {
    console.error(`Error copying directory ${src}:`, err.message);
  }
}

async function main() {
  console.log('Setting up local vendor directories...');
  
  // 1. Inter Font
  const interSrc = path.join(__dirname, '../node_modules/@fontsource/inter');
  const interDest = path.join(__dirname, '../public/vendor/inter');
  if (fs.existsSync(interSrc)) {
    await copyFile(path.join(interSrc, 'index.css'), path.join(interDest, 'index.css'));
    if (fs.existsSync(path.join(interSrc, 'files'))) {
      await copyDir(path.join(interSrc, 'files'), path.join(interDest, 'files'));
    }
  } else {
    console.error('@fontsource/inter not found in node_modules');
  }

  // 2. Bootstrap Icons
  const biSrc = path.join(__dirname, '../node_modules/bootstrap-icons');
  const biDest = path.join(__dirname, '../public/vendor/bootstrap-icons');
  if (fs.existsSync(biSrc)) {
    await copyFile(path.join(biSrc, 'font/bootstrap-icons.min.css'), path.join(biDest, 'bootstrap-icons.css'));
    if (fs.existsSync(path.join(biSrc, 'font/fonts'))) {
      await copyDir(path.join(biSrc, 'font/fonts'), path.join(biDest, 'fonts'));
    }
  } else {
    console.error('bootstrap-icons not found in node_modules');
  }

  // 3. LightGallery
  const lgSrc = path.join(__dirname, '../node_modules/lightgallery');
  const lgDest = path.join(__dirname, '../public/vendor/lightgallery');
  if (fs.existsSync(lgSrc)) {
    await copyFile(path.join(lgSrc, 'lightgallery.min.js'), path.join(lgDest, 'lightgallery.min.js'));
    await copyFile(path.join(lgSrc, 'css/lightgallery-bundle.min.css'), path.join(lgDest, 'css/lightgallery-bundle.css'));
    if (fs.existsSync(path.join(lgSrc, 'fonts'))) {
      await copyDir(path.join(lgSrc, 'fonts'), path.join(lgDest, 'fonts'));
    }
    if (fs.existsSync(path.join(lgSrc, 'images'))) {
      await copyDir(path.join(lgSrc, 'images'), path.join(lgDest, 'images'));
    }
  } else {
    console.error('lightgallery not found in node_modules');
  }

  // 4. PDF.js (for EmbedPDF)
  const pdfSrc = path.join(__dirname, '../node_modules/pdfjs-dist');
  const pdfDest = path.join(__dirname, '../public/vendor/embedpdf');
  if (fs.existsSync(pdfSrc)) {
    await copyFile(path.join(pdfSrc, 'build/pdf.min.js'), path.join(pdfDest, 'pdf.min.js'));
    await copyFile(path.join(pdfSrc, 'build/pdf.worker.min.js'), path.join(pdfDest, 'pdf.worker.min.js'));
  } else {
    console.error('pdfjs-dist not found in node_modules');
  }

  // 5. Excel Viewer (SuperYesifang / excel-viewer)
  const excelSrc = path.join(__dirname, '../node_modules/excel-viewer');
  const excelDest = path.join(__dirname, '../public/vendor/excel-viewer');
  if (fs.existsSync(excelSrc)) {
    // excel-viewer files: check built distribution files
    const distPath = path.join(excelSrc, 'dist');
    if (fs.existsSync(distPath)) {
      await copyDir(distPath, excelDest);
    } else {
      // fallback to copying js files directly
      const jsFile = path.join(excelSrc, 'index.js');
      if (fs.existsSync(jsFile)) {
        await copyFile(jsFile, path.join(excelDest, 'excel-viewer.js'));
      }
    }
  } else {
    console.error('excel-viewer not found in node_modules');
  }

  // 6. Marked
  const markedSrc = path.join(__dirname, '../node_modules/marked');
  const markedDest = path.join(__dirname, '../public/vendor/marked');
  if (fs.existsSync(markedSrc)) {
    await copyFile(path.join(markedSrc, 'marked.min.js'), path.join(markedDest, 'marked.min.js'));
  } else {
    console.error('marked not found in node_modules');
  }

  // 7. js-beautify
  const jbSrc = path.join(__dirname, '../node_modules/js-beautify');
  const jbDest = path.join(__dirname, '../public/vendor/js-beautify');
  if (fs.existsSync(jbSrc)) {
    await copyFile(path.join(jbSrc, 'js/lib/beautify.js'), path.join(jbDest, 'beautify.js'));
    await copyFile(path.join(jbSrc, 'js/lib/beautify-css.js'), path.join(jbDest, 'beautify-css.js'));
    await copyFile(path.join(jbSrc, 'js/lib/beautify-html.js'), path.join(jbDest, 'beautify-html.js'));
  } else {
    console.error('js-beautify not found in node_modules');
  }

  // 8. pptx-preview
  const pptxSrc = path.join(__dirname, '../node_modules/pptx-preview');
  const pptxDest = path.join(__dirname, '../public/vendor/pptx-preview');
  if (fs.existsSync(pptxSrc)) {
    await copyFile(path.join(pptxSrc, 'dist/pptx-preview.umd.js'), path.join(pptxDest, 'pptx-preview.js'));
  } else {
    console.error('pptx-preview not found in node_modules');
  }

  console.log('Vendor setup complete!');
}

main().catch(err => {
  console.error('Fatal error setting up vendors:', err);
});
