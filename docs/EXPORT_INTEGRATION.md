# Export System Integration Guide

Quick guide to integrate the HTML export system into the Tanaghum generator.

## Step 1: Add CSS to generator.html

Add this line in the `<head>` section (after other CSS links):

```html
<link rel="stylesheet" href="css/export-dialog.css">
```

## Step 2: Update the Export Button Handler

In `generator.html`, find the export button click handler (around line 936) and replace it with:

```javascript
// Replace the existing export button handler with this:
import { exportDialog } from './js/ui/export-dialog.js';

$('#export-btn').addEventListener('click', () => {
  const lesson = StateManager.get('lesson') || createPreviewLesson();
  exportDialog.show(lesson);
});
```

## Step 3: That's it!

The export system is now integrated. When users click "Export Lesson", they'll see a dialog with options to:
- Configure export settings
- Preview the HTML
- Download the HTML file

## Alternative: Direct Export (No Dialog)

If you want to skip the dialog and export directly:

```javascript
import { lessonExporter } from './js/export/lesson-exporter.js';

$('#export-btn').addEventListener('click', async () => {
  const lesson = StateManager.get('lesson') || createPreviewLesson();

  try {
    const result = await lessonExporter.exportAndDownload(lesson, {
      embedAudio: false,
      includeTranslation: true,
      includeVocabulary: true,
      theme: 'light'
    });

    showToast('success', 'Exported', `Downloaded: ${result.filename}`);
  } catch (error) {
    showToast('error', 'Export failed', error.message);
  }
});
```

## Testing

1. Generate a lesson in the UI
2. Click "Export Lesson"
3. Configure options in the dialog
4. Click "Preview" to see the result in a new window
5. Click "Download HTML" to save the file
6. Open the downloaded HTML file in a browser
7. Verify it works offline (disconnect internet)

## Lesson Object Requirements

The exporter expects a lesson object with this structure:

```javascript
{
  id: 'lesson_xxx',
  createdAt: '2024-01-01T00:00:00.000Z',
  metadata: {
    title: 'Lesson Title',
    duration: 180,  // seconds
    durationFormatted: '3:00',
    wordCount: 150,
    ilr: { level: '2.0', name: 'Limited Working' },
    topic: { code: 'economy', nameEn: 'Economy' },
    dialect: 'MSA'
  },
  content: {
    transcript: {
      text: 'Full Arabic text...',
      segments: [
        { start: 0, end: 5, text: 'Arabic text' },
        // ...
      ]
    },
    translation: {
      text: 'Full English translation...'
    },
    vocabulary: {
      items: [
        { arabic: 'كلمة', meaning: 'word', transliteration: 'kalima' },
        // ...
      ]
    },
    questions: {
      pre: [...],
      while: [...],
      post: [...]
    }
  },
  audio: {
    type: 'youtube' | 'local',
    url: 'audio URL or YouTube URL',
    videoId: 'YouTube ID (if applicable)'
  }
}
```

## Troubleshooting

### Dialog doesn't appear
- Check browser console for errors
- Verify CSS file is loaded
- Check that export-dialog.js is imported correctly

### Export fails
- Verify lesson object has required fields
- Check that template files are accessible
- Look for CORS errors in console

### File size is huge
- Don't enable embedAudio for long videos
- Check audio quality/format
- Use YouTube embedding instead

### HTML doesn't work offline
- embedAudio must be enabled for offline audio
- YouTube videos always require internet
- Check browser console for errors

## Advanced: Custom Export Button

You can also create a custom export button anywhere:

```javascript
import { lessonExporter } from './js/export/lesson-exporter.js';

// Create button
const exportBtn = document.createElement('button');
exportBtn.textContent = 'Export as HTML';
exportBtn.className = 'btn btn-primary';

// Add click handler
exportBtn.addEventListener('click', async () => {
  const lesson = getCurrentLesson(); // Your function to get lesson

  const result = await lessonExporter.exportLesson(lesson, {
    embedAudio: false,
    includeTranslation: true
  });

  lessonExporter.download(result.blob, result.filename);
});

// Add to page
document.querySelector('.action-bar').appendChild(exportBtn);
```

## File Naming

By default, files are named:
```
tanaghum-[sanitized-title]-[date].html
```

Example:
```
tanaghum-economic-growth-discussion-2024-01-15.html
```

You can customize this by editing the `generateFilename()` method in `lesson-exporter.js`.

## Next Steps

1. Test with real lessons from your LLM pipeline
2. Customize styling in the template if needed
3. Add analytics/tracking if desired
4. Consider adding batch export for multiple lessons
5. Create example lessons for the gallery

## Questions?

See the full documentation in `docs/EXPORT_SYSTEM.md` or check the code comments in the source files.
