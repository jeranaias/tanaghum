/**
 * Example Usage of Tanaghum Lesson Export System
 *
 * This file demonstrates how to use the lesson exporter in various scenarios.
 * Copy and adapt these examples for your use case.
 */

import { lessonExporter } from './lesson-exporter.js';
import { exportDialog } from '../ui/export-dialog.js';
import { lessonAssembler } from '../generation/lesson-assembler.js';

// ============================================================================
// EXAMPLE 1: Basic Export with Dialog (Recommended for UI)
// ============================================================================

/**
 * Show export dialog - simplest way to export from UI
 */
function example1_exportWithDialog() {
  // Get the current lesson (from state manager, or create it)
  const lesson = lessonAssembler.getCurrentLesson();

  if (!lesson) {
    console.error('No lesson available to export');
    return;
  }

  // Show the dialog - it handles everything else
  exportDialog.show(lesson);
}

// Usage: Add to button click handler
// document.getElementById('export-btn').addEventListener('click', example1_exportWithDialog);

// ============================================================================
// EXAMPLE 2: Direct Export without Dialog
// ============================================================================

/**
 * Export directly with custom options
 */
async function example2_directExport() {
  const lesson = lessonAssembler.getCurrentLesson();

  try {
    // Export with custom options
    const result = await lessonExporter.exportAndDownload(lesson, {
      embedAudio: false,         // Don't embed audio (smaller file)
      includeTranslation: true,  // Include English translation
      includeVocabulary: true,   // Include vocabulary list
      includeQuestions: true,    // Include all questions
      theme: 'light'            // Light theme
    });

    console.log(`✓ Export successful!`);
    console.log(`  Filename: ${result.filename}`);
    console.log(`  Size: ${result.size}`);

    // Show success message to user
    showNotification('success', `Lesson exported: ${result.filename}`);

  } catch (error) {
    console.error('Export failed:', error);
    showNotification('error', `Export failed: ${error.message}`);
  }
}

// ============================================================================
// EXAMPLE 3: Export with Embedded Audio (Offline Use)
// ============================================================================

/**
 * Export with embedded audio for complete offline use
 */
async function example3_offlineExport() {
  const lesson = lessonAssembler.getCurrentLesson();

  // Check if audio is available
  if (!lesson.audio?.url) {
    console.warn('No audio available - cannot embed');
    return;
  }

  // Warn user about file size
  const estimate = lessonExporter.getEstimatedSize(lesson, { embedAudio: true });

  if (estimate.total > 10000) { // > 10MB
    const confirmMsg = `This will create a large file (~${estimate.totalFormatted}). Continue?`;
    if (!confirm(confirmMsg)) {
      return;
    }
  }

  try {
    const result = await lessonExporter.exportAndDownload(lesson, {
      embedAudio: true,  // Embed audio as base64
      includeTranslation: true,
      includeVocabulary: true,
      includeQuestions: true,
      theme: 'light'
    });

    console.log(`✓ Offline lesson exported: ${result.filename} (${result.size})`);
    showNotification('success', 'Lesson ready for offline use!');

  } catch (error) {
    console.error('Export failed:', error);
    showNotification('error', `Failed to embed audio: ${error.message}`);
  }
}

// ============================================================================
// EXAMPLE 4: Preview Before Export
// ============================================================================

/**
 * Preview the exported HTML before downloading
 */
async function example4_previewExport() {
  const lesson = lessonAssembler.getCurrentLesson();

  try {
    // Generate HTML without downloading
    const html = await lessonExporter.preview(lesson, {
      embedAudio: false,
      includeTranslation: true,
      includeVocabulary: true,
      theme: 'light'
    });

    // Open in new window for preview
    const previewWindow = window.open('', '_blank', 'width=1200,height=800');
    previewWindow.document.write(html);
    previewWindow.document.close();

    console.log('✓ Preview opened in new window');

  } catch (error) {
    console.error('Preview failed:', error);
    showNotification('error', `Preview failed: ${error.message}`);
  }
}

// ============================================================================
// EXAMPLE 5: Size Estimation Before Export
// ============================================================================

/**
 * Check estimated file size before exporting
 */
function example5_estimateSize() {
  const lesson = lessonAssembler.getCurrentLesson();

  // Estimate size without audio
  const estimateNoAudio = lessonExporter.getEstimatedSize(lesson, {
    embedAudio: false
  });

  // Estimate size with audio
  const estimateWithAudio = lessonExporter.getEstimatedSize(lesson, {
    embedAudio: true
  });

  console.log('Export Size Estimates:');
  console.log(`  Without audio: ${estimateNoAudio.totalFormatted}`);
  console.log(`  With audio: ${estimateWithAudio.totalFormatted}`);

  if (estimateWithAudio.warning) {
    console.warn(`  ⚠️  ${estimateWithAudio.warning}`);
  }

  // Show breakdown
  console.log('\nSize Breakdown:');
  console.log(`  Base (HTML/CSS/JS): ${lessonExporter.formatFileSize(estimateNoAudio.base * 1024)}`);
  console.log(`  Transcript: ${lessonExporter.formatFileSize(estimateNoAudio.transcript * 1024)}`);
  console.log(`  Vocabulary: ${lessonExporter.formatFileSize(estimateNoAudio.vocabulary * 1024)}`);
  if (estimateWithAudio.audio > 0) {
    console.log(`  Audio: ${lessonExporter.formatFileSize(estimateWithAudio.audio * 1024)}`);
  }

  return {
    withoutAudio: estimateNoAudio.totalFormatted,
    withAudio: estimateWithAudio.totalFormatted
  };
}

// ============================================================================
// EXAMPLE 6: Batch Export Multiple Lessons
// ============================================================================

/**
 * Export multiple lessons at once
 */
async function example6_batchExport(lessons) {
  console.log(`Starting batch export of ${lessons.length} lessons...`);

  const results = [];

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    console.log(`Exporting ${i + 1}/${lessons.length}: ${lesson.metadata?.title}`);

    try {
      const result = await lessonExporter.exportLesson(lesson, {
        embedAudio: false,
        includeTranslation: true,
        includeVocabulary: true
      });

      // Download the file
      lessonExporter.download(result.blob, result.filename);

      results.push({
        success: true,
        lesson: lesson.metadata?.title,
        filename: result.filename,
        size: result.sizeFormatted
      });

      // Wait a bit between downloads to avoid browser blocking
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`Failed to export lesson ${i + 1}:`, error);
      results.push({
        success: false,
        lesson: lesson.metadata?.title,
        error: error.message
      });
    }
  }

  console.log('✓ Batch export complete');
  console.table(results);

  return results;
}

// ============================================================================
// EXAMPLE 7: Custom Export Options Based on Lesson Duration
// ============================================================================

/**
 * Smart export that chooses options based on lesson characteristics
 */
async function example7_smartExport() {
  const lesson = lessonAssembler.getCurrentLesson();
  const duration = lesson.metadata?.duration || 0; // in seconds

  // Choose options based on duration
  let options;

  if (duration < 180) { // < 3 minutes
    // Short lesson - embed audio for offline use
    options = {
      embedAudio: true,
      includeTranslation: true,
      includeVocabulary: true,
      includeQuestions: true,
      theme: 'light'
    };
    console.log('Short lesson detected - embedding audio for offline use');

  } else if (duration < 600) { // 3-10 minutes
    // Medium lesson - ask user
    const embedAudio = confirm(
      'This lesson is ' + Math.floor(duration / 60) + ' minutes long.\n' +
      'Embed audio for offline use? (Larger file size)'
    );

    options = {
      embedAudio,
      includeTranslation: true,
      includeVocabulary: true,
      includeQuestions: true,
      theme: 'light'
    };

  } else { // > 10 minutes
    // Long lesson - don't embed audio
    options = {
      embedAudio: false,
      includeTranslation: true,
      includeVocabulary: true,
      includeQuestions: true,
      theme: 'light'
    };
    console.log('Long lesson detected - audio will not be embedded (use YouTube link)');
  }

  // Export with chosen options
  try {
    const result = await lessonExporter.exportAndDownload(lesson, options);
    console.log(`✓ Smart export complete: ${result.filename}`);
    return result;

  } catch (error) {
    console.error('Smart export failed:', error);
    throw error;
  }
}

// ============================================================================
// EXAMPLE 8: Export with Custom Theme
// ============================================================================

/**
 * Export with dark theme for better viewing at night
 */
async function example8_darkThemeExport() {
  const lesson = lessonAssembler.getCurrentLesson();

  const result = await lessonExporter.exportAndDownload(lesson, {
    embedAudio: false,
    includeTranslation: true,
    includeVocabulary: true,
    includeQuestions: true,
    theme: 'dark'  // Dark theme
  });

  console.log(`✓ Dark theme lesson exported: ${result.filename}`);
  return result;
}

// ============================================================================
// EXAMPLE 9: Export Minimal Version (No Translation/Vocabulary)
// ============================================================================

/**
 * Export minimal version with just transcript and questions
 */
async function example9_minimalExport() {
  const lesson = lessonAssembler.getCurrentLesson();

  const result = await lessonExporter.exportAndDownload(lesson, {
    embedAudio: false,
    includeTranslation: false,  // No translation
    includeVocabulary: false,   // No vocabulary
    includeQuestions: true,     // Only questions
    theme: 'light'
  });

  console.log(`✓ Minimal lesson exported: ${result.filename} (${result.size})`);
  return result;
}

// ============================================================================
// EXAMPLE 10: Integration with Lesson Assembler
// ============================================================================

/**
 * Complete workflow: Generate lesson and export
 */
async function example10_generateAndExport() {
  try {
    // Step 1: Generate lesson (example - adapt to your needs)
    console.log('Step 1: Generating lesson...');

    const components = {
      source: {
        type: 'youtube',
        videoId: 'example123',
        url: 'https://youtube.com/watch?v=example123'
      },
      transcript: {
        text: 'Arabic transcript...',
        segments: [
          { start: 0, end: 5, text: 'First segment' },
          // ...
        ]
      },
      analysis: {
        level: '2.0',
        score: 2.0,
        confidence: 0.85
      },
      targetIlr: '2.0',
      topic: 'economy'
    };

    const lesson = await lessonAssembler.assemble(components);
    console.log('✓ Lesson generated:', lesson.id);

    // Step 2: Export the lesson
    console.log('Step 2: Exporting lesson...');

    const result = await lessonExporter.exportAndDownload(lesson, {
      embedAudio: false,
      includeTranslation: true,
      includeVocabulary: true,
      theme: 'light'
    });

    console.log('✓ Complete workflow finished!');
    console.log(`  Lesson ID: ${lesson.id}`);
    console.log(`  Exported: ${result.filename}`);
    console.log(`  Size: ${result.size}`);

    return { lesson, export: result };

  } catch (error) {
    console.error('Workflow failed:', error);
    throw error;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Show notification to user (example - adapt to your UI)
 */
function showNotification(type, message) {
  console.log(`[${type.toUpperCase()}] ${message}`);

  // If you have a toast/notification system, use it here:
  // toast.show(type, message);
  // or dispatch custom event:
  document.dispatchEvent(new CustomEvent('show-toast', {
    detail: { type, title: type === 'success' ? 'Success' : 'Error', message }
  }));
}

// ============================================================================
// EXPORT EXAMPLES FOR USE IN OTHER FILES
// ============================================================================

export {
  example1_exportWithDialog,
  example2_directExport,
  example3_offlineExport,
  example4_previewExport,
  example5_estimateSize,
  example6_batchExport,
  example7_smartExport,
  example8_darkThemeExport,
  example9_minimalExport,
  example10_generateAndExport
};

// ============================================================================
// QUICK START TEMPLATES
// ============================================================================

/**
 * TEMPLATE 1: Add to generator.html export button
 */
/*
import { exportDialog } from './js/ui/export-dialog.js';

document.getElementById('export-btn').addEventListener('click', () => {
  const lesson = StateManager.get('lesson');
  exportDialog.show(lesson);
});
*/

/**
 * TEMPLATE 2: Add to lesson viewer/player
 */
/*
import { lessonExporter } from './js/export/lesson-exporter.js';

const exportBtn = document.createElement('button');
exportBtn.textContent = 'Export as HTML';
exportBtn.addEventListener('click', async () => {
  const result = await lessonExporter.exportAndDownload(currentLesson);
  alert(`Exported: ${result.filename}`);
});
*/

/**
 * TEMPLATE 3: Add to lesson list/gallery
 */
/*
document.querySelectorAll('.lesson-card').forEach(card => {
  const exportBtn = card.querySelector('.export-btn');
  exportBtn.addEventListener('click', async () => {
    const lessonId = card.dataset.lessonId;
    const lesson = await loadLesson(lessonId);
    exportDialog.show(lesson);
  });
});
*/
