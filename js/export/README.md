# Tanaghum Export Module

Self-contained HTML lesson export system for Tanaghum.

## Files in This Directory

### `lesson-exporter.js` (17 KB)
Main export engine that:
- Loads and caches HTML template
- Populates template with lesson data
- Handles audio embedding (base64)
- Generates downloadable blob
- Manages file downloads

**Usage:**
```javascript
import { lessonExporter } from './lesson-exporter.js';

const result = await lessonExporter.exportAndDownload(lesson, options);
```

### `standalone-player.js` (26 KB)
Self-contained lesson player with zero dependencies:
- Media playback controls (play, pause, seek, speed)
- Synchronized transcript display
- Question management with timestamps
- Vocabulary viewer
- Progress tracking via localStorage
- Keyboard shortcuts

This file is embedded into the exported HTML and runs completely standalone.

### `example-usage.js` (15 KB)
10 complete usage examples:
1. Basic export with dialog
2. Direct export without dialog
3. Export with embedded audio
4. Preview before export
5. Size estimation
6. Batch export multiple lessons
7. Smart export based on duration
8. Dark theme export
9. Minimal export (no extras)
10. Complete workflow (generate + export)

**Usage:**
```javascript
import { example1_exportWithDialog } from './example-usage.js';

// Show export dialog
example1_exportWithDialog();
```

## Quick Start

### Method 1: Using the Export Dialog (Recommended)

```javascript
import { exportDialog } from '../ui/export-dialog.js';

const lesson = getCurrentLesson();
exportDialog.show(lesson);
```

### Method 2: Direct Export

```javascript
import { lessonExporter } from './lesson-exporter.js';

const result = await lessonExporter.exportAndDownload(lesson, {
  embedAudio: false,
  includeTranslation: true,
  includeVocabulary: true,
  includeQuestions: true,
  theme: 'light'
});

console.log(`Exported: ${result.filename} (${result.sizeFormatted})`);
```

## Export Options

```javascript
{
  embedAudio: false,           // Embed audio as base64 (larger file)
  includeTranslation: true,    // Include English translation tab
  includeVocabulary: true,     // Include vocabulary list
  includeQuestions: true,      // Include comprehension questions
  theme: 'light',              // 'light' or 'dark' theme
  maxAudioSize: 15 * 1024 * 1024  // Max audio size (15MB default)
}
```

## API Reference

### LessonExporter

#### `exportLesson(lesson, options)`
Export lesson to HTML blob.

**Returns:** `Promise<{ blob, filename, size, sizeFormatted }>`

#### `exportAndDownload(lesson, options)`
Export and immediately download.

**Returns:** `Promise<{ success, filename, size }>`

#### `preview(lesson, options)`
Generate HTML string for preview.

**Returns:** `Promise<string>`

#### `getEstimatedSize(lesson, options)`
Calculate estimated file size.

**Returns:** `{ base, audio, vocabulary, transcript, total, totalFormatted, warning }`

#### `download(blob, filename)`
Trigger browser download.

**Returns:** `void`

## File Sizes

| Configuration | Size |
|--------------|------|
| Base (no audio) | ~200-500 KB |
| With 3-min audio | ~3-5 MB |
| With 10-min audio | ~10-15 MB |

## Dependencies

This module requires:
- `../core/utils.js` - For logging and time formatting
- `../templates/lesson-template.html` - HTML template
- No external libraries

The exported HTML has **zero dependencies** - everything is self-contained.

## Integration

See `../../docs/EXPORT_INTEGRATION.md` for complete integration guide.

Quick integration:
1. Add CSS to generator.html
2. Update export button handler
3. Done!

## Testing

```javascript
// Test export
import { lessonExporter } from './lesson-exporter.js';

const testLesson = {
  id: 'test_123',
  metadata: { title: 'Test Lesson', duration: 180 },
  content: { transcript: { text: 'Test', segments: [] } }
};

const result = await lessonExporter.exportLesson(testLesson);
console.log('Test passed:', result.filename);
```

## Documentation

- Full documentation: `../../docs/EXPORT_SYSTEM.md`
- Integration guide: `../../docs/EXPORT_INTEGRATION.md`
- Quick reference: `../../docs/EXPORT_SYSTEM_README.md`
- Examples: `./example-usage.js`

## Browser Compatibility

Exported HTML works in:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

## License

Part of the Tanaghum project.
