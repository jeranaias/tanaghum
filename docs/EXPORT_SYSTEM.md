# Tanaghum HTML Lesson Export System

Complete documentation for the self-contained HTML lesson export system.

## Overview

The export system allows teachers to download lessons as single, self-contained HTML files that work completely offline. No external dependencies, no internet connection required (except for YouTube videos).

## Architecture

### 1. **Standalone Player** (`js/export/standalone-player.js`)
- Self-contained, no external dependencies
- Lightweight (~50KB minified target)
- Features:
  - Audio/video playback with speed control
  - Synchronized transcript display
  - Question cards with timestamps
  - Vocabulary viewer
  - Progress tracking via localStorage
  - Keyboard shortcuts

### 2. **Lesson Template** (`templates/lesson-template.html`)
- HTML template with placeholders
- All CSS inline
- Responsive design
- Print-friendly
- Contains metadata in HTML comments

### 3. **Lesson Exporter** (`js/export/lesson-exporter.js`)
- Main export module
- Populates template with lesson data
- Handles audio embedding (optional)
- Generates downloadable blob

### 4. **Export Dialog UI** (`js/ui/export-dialog.js`)
- User interface for export configuration
- File size estimation
- Preview functionality
- Download trigger

## File Structure

```
tanaghum/
├── js/
│   ├── export/
│   │   ├── lesson-exporter.js       # Main export logic
│   │   └── standalone-player.js     # Self-contained player
│   └── ui/
│       └── export-dialog.js         # UI component
├── templates/
│   └── lesson-template.html         # HTML template
└── css/
    └── export-dialog.css            # Dialog styles
```

## Integration

### Basic Usage

```javascript
import { lessonExporter } from './js/export/lesson-exporter.js';

// Export with default options
const result = await lessonExporter.exportLesson(lesson, {
  embedAudio: false,
  includeTranslation: true,
  includeVocabulary: true,
  includeQuestions: true,
  theme: 'light'
});

// Download the file
lessonExporter.download(result.blob, result.filename);
```

### Using the Export Dialog

```javascript
import { exportDialog } from './js/ui/export-dialog.js';

// Show the dialog with a lesson
exportDialog.show(lesson);
```

### Integration in Generator Page

Add to `generator.html` after line 424 (before the export button):

```html
<!-- Add to head -->
<link rel="stylesheet" href="css/export-dialog.css">

<!-- Modify the export button click handler -->
<script type="module">
  import { exportDialog } from './js/ui/export-dialog.js';
  import { lessonExporter } from './js/export/lesson-exporter.js';

  // Get the export button
  const exportBtn = document.getElementById('export-btn');

  // Replace the existing click handler
  exportBtn.addEventListener('click', () => {
    const lesson = createPreviewLesson(); // or get current lesson
    exportDialog.show(lesson);
  });
</script>
```

## Export Options

### Default Options

```javascript
{
  embedAudio: false,           // Embed audio as base64 (increases file size)
  includeTranslation: true,    // Include translation tab
  includeVocabulary: true,     // Include vocabulary list
  includeQuestions: true,      // Include comprehension questions
  theme: 'light',              // 'light' or 'dark' theme
  maxAudioSize: 15 * 1024 * 1024  // 15MB max for audio embedding
}
```

### File Size Targets

| Content | Estimated Size |
|---------|---------------|
| Base HTML + CSS + JS | ~200KB |
| Transcript (5 min audio) | ~10-20KB |
| Vocabulary (50 items) | ~25KB |
| **Without embedded audio** | **~250-500KB** |
| With embedded audio (5 min) | **~5-10MB** |

## Features

### Standalone Player Features

1. **Media Playback**
   - Play/pause toggle
   - Speed control (0.5x - 2x)
   - Skip forward/backward (10s)
   - Progress bar with seeking

2. **Transcript**
   - Click to seek
   - Auto-scroll to active segment
   - Highlighted active segment

3. **Questions**
   - Pre-listening questions (on load)
   - While-listening questions (at timestamps)
   - Post-listening questions
   - Immediate feedback
   - Progress tracking

4. **Vocabulary**
   - Arabic word
   - Transliteration
   - English meaning
   - Part of speech (optional)

5. **Progress Tracking**
   - Saves to localStorage
   - Tracks answered questions
   - Shows completion percentage
   - Reset option

6. **Keyboard Shortcuts**
   - `Space` - Play/pause
   - `←/→` - Seek 5 seconds
   - `↑/↓` - Speed ±0.25x

### Exported HTML Features

- Works completely offline (except YouTube videos)
- No external dependencies
- Self-contained (all resources inline)
- Responsive design (mobile-friendly)
- Print-friendly
- Accessible (ARIA labels, keyboard navigation)
- Professional appearance

## API Reference

### LessonExporter

#### `exportLesson(lesson, options)`
Exports a lesson to a self-contained HTML blob.

**Parameters:**
- `lesson` (Object) - Lesson object from lesson-assembler
- `options` (Object) - Export options (optional)

**Returns:** Promise<Object>
```javascript
{
  blob: Blob,           // HTML file blob
  filename: string,     // Generated filename
  size: number,         // File size in bytes
  sizeFormatted: string // Formatted size string
}
```

#### `exportAndDownload(lesson, options)`
Exports and immediately downloads the lesson.

**Returns:** Promise<Object>
```javascript
{
  success: boolean,
  filename: string,
  size: string
}
```

#### `preview(lesson, options)`
Returns HTML string for preview (opens in new window).

**Returns:** Promise<string>

#### `getEstimatedSize(lesson, options)`
Calculates estimated export file size.

**Returns:** Object
```javascript
{
  base: number,          // Base size (KB)
  audio: number,         // Audio size (KB)
  vocabulary: number,    // Vocab size (KB)
  transcript: number,    // Transcript size (KB)
  total: number,         // Total size (KB)
  totalFormatted: string, // Formatted string
  warning: string|null    // Warning message if large
}
```

### ExportDialog

#### `show(lesson)`
Displays the export configuration dialog.

#### `close()`
Closes the dialog.

## YouTube Video Handling

When exporting lessons with YouTube videos:

1. **Default behavior (embedAudio: false)**:
   - Embeds YouTube iframe
   - Requires internet connection to play
   - Smallest file size
   - Note displayed to user

2. **Optional (embedAudio: true)**:
   - Downloads audio and embeds as base64
   - Works completely offline
   - Much larger file size
   - May fail if video is unavailable

## Browser Compatibility

The exported HTML files work in:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

Features used:
- ES6 JavaScript
- HTML5 Audio/Video
- localStorage
- CSS Grid/Flexbox

## Limitations

1. **Audio Embedding**
   - Maximum 15MB recommended (configurable)
   - Some audio formats may not work in all browsers
   - YouTube downloads require CORS proxy or worker

2. **YouTube Videos**
   - Require internet connection unless audio is downloaded
   - Subject to YouTube's terms of service
   - May be blocked in some regions

3. **File Size**
   - Large audio files create very large HTML files
   - Email attachment limits may apply
   - Consider hosting instead of emailing

## Best Practices

### For Teachers

1. **Without Audio Embedding** (Recommended for most cases)
   - Share HTML file + separate audio file
   - Or use YouTube videos
   - Keeps file size manageable

2. **With Audio Embedding** (For complete offline use)
   - Best for short lessons (< 5 minutes)
   - Test file size before sharing
   - Consider compression

3. **Distribution**
   - Can be emailed (if < 25MB)
   - Can be uploaded to LMS
   - Can be hosted on web server
   - Can be put on USB drive

### For Students

1. **Opening the File**
   - Save to desktop or documents folder
   - Double-click to open in browser
   - Or right-click → Open with → Browser

2. **Offline Use**
   - Works without internet (if audio embedded)
   - Progress saved in browser
   - Can be used multiple times

3. **Troubleshooting**
   - Clear browser cache if issues
   - Try different browser
   - Check that file is not blocked

## Customization

### Styling

The template uses CSS variables for easy theming:

```css
:root {
  --primary-color: #2563eb;
  --bg-primary: #ffffff;
  --text-primary: #0f172a;
  /* etc. */
}
```

### Adding Features

To extend the standalone player:

1. Edit `js/export/standalone-player.js`
2. Keep it dependency-free
3. Test file size impact
4. Update template if needed

### Template Customization

Edit `templates/lesson-template.html`:
- Add new sections
- Modify layout
- Add custom CSS
- Include additional metadata

## Development

### Testing

```javascript
// Test export
const lesson = { /* your lesson object */ };
const result = await lessonExporter.exportLesson(lesson);
console.log('Size:', result.sizeFormatted);

// Test preview
const html = await lessonExporter.preview(lesson);
console.log('HTML length:', html.length);

// Test size estimation
const estimate = lessonExporter.getEstimatedSize(lesson);
console.log('Estimated:', estimate);
```

### Debugging

1. **Preview Function**: Use preview() to open in new window and inspect
2. **Console Logs**: Check browser console for errors
3. **Network Tab**: Verify no external requests (offline test)
4. **File Size**: Compare estimate vs actual

### Performance

- Template loading is async and cached
- Player script is cached after first load
- Audio encoding is done in chunks
- No blocking operations during export

## Future Enhancements

Potential improvements:

1. **Compression**
   - Minify HTML/CSS/JS
   - Compress audio before embedding
   - Use WebP for images

2. **Advanced Features**
   - Multiple audio quality options
   - Video transcript sync
   - Annotations support
   - Student notes

3. **Export Formats**
   - SCORM package
   - PDF with QR codes
   - Mobile app package
   - Anki deck

4. **Batch Export**
   - Export multiple lessons at once
   - Create course packages
   - Generate index page

## Support

For issues or questions:
1. Check browser console for errors
2. Verify lesson object structure
3. Test with sample lesson
4. Check file size limits

## License

Part of the Tanaghum project. See main LICENSE file.
