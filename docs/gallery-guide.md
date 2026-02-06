# Community Gallery Guide

## Overview

The Tanaghum Community Gallery is a Pinterest-style browsing experience where users can discover, preview, and use Arabic listening comprehension lessons created by the community.

## Features

### Gallery Display
- **Responsive Grid Layout**: 4 columns → 3 → 2 → 1 based on screen size
- **Beautiful Lesson Cards** with:
  - Thumbnail image or generated placeholder
  - Arabic and English titles
  - ILR level badge (color-coded)
  - Topic category with icon
  - Duration display
  - Star rating (1-5)
  - Usage count
  - Author name
  - Preview and Use buttons

### Filtering & Search

#### Search
- **Full-text search** across:
  - Arabic titles
  - English titles
  - Topics
  - Descriptions

#### Filters
- **ILR Level**: All, 1, 1+, 2, 2+, 3
- **Topic**: Economy, Politics, Culture, Science, Education, Sports, News, etc.
- **Duration**: Short (< 5 min), Medium (5-15 min), Long (> 15 min)
- **Sort**: Most Popular, Newest First, Highest Rated, Title (A-Z)

#### Active Filters Display
- Shows currently applied filters as removable tags
- "Clear All" button to reset filters
- Real-time results count

### Preview Modal

When clicking on a lesson card or Preview button:
- **Full lesson details**:
  - Arabic and English titles
  - ILR level, topic, duration, author
  - Description
  - Transcript preview
  - Statistics (rating, uses, question count)
- **Rating widget**: Rate the lesson or see your existing rating
- **Use Lesson button**: Opens lesson in player

### Lesson Sharing System

#### Shareable URLs
```javascript
// Generate shareable URL
const shareUrl = LessonSharing.generateShareUrl(lesson);
// Result: https://tanaghum.github.io/player.html#lessonId
```

#### IndexedDB Storage
- All community lessons stored locally in IndexedDB
- Fast retrieval and offline access
- Automatic syncing with gallery.json

#### Sharing Methods
1. **Copy Link**: Copy shareable URL to clipboard
2. **Export JSON**: Download lesson as JSON file
3. **Add to Gallery**: Save custom lessons to local gallery

### Rating System

#### User Ratings
- **1-5 star rating** for each lesson
- Stored in localStorage (no account required)
- "You rated this" indicator
- Ability to change rating

#### Average Rating Display
- Shows aggregate rating across all users
- Rating count displayed
- Color-coded stars (gold = filled)

#### Rating Widget
```javascript
// Render rating widget
RatingSystem.renderRatingWidget(container, lessonId, averageRating, ratingCount);
```

## Using the Gallery

### Browsing Lessons

1. Visit **gallery.html**
2. Browse the grid of lessons
3. Use filters to narrow results
4. Search for specific topics or keywords

### Previewing a Lesson

1. Click on any lesson card
2. Review lesson details in modal
3. Rate the lesson (optional)
4. Click "Use This Lesson" to open in player

### Using a Lesson

1. Click "Use Lesson" button
2. Shareable link is copied to clipboard
3. Lesson opens in player tab
4. Usage count increments automatically

### Adding Your Own Lesson

From the generator, after creating a lesson:

```javascript
// Add lesson to gallery
const result = await LessonSharing.addToGallery(lessonData);

if (result.success) {
  console.log('Lesson added!');
  console.log('Share URL:', result.shareUrl);
}
```

## Technical Details

### Data Structure

#### Lesson Object
```json
{
  "id": "unique-id",
  "title": "العنوان العربي",
  "titleEn": "English Title",
  "ilrLevel": "2.5",
  "topic": "economy",
  "duration": 512,
  "author": "Creator Name",
  "rating": 4.5,
  "ratingCount": 23,
  "uses": 127,
  "thumbnail": "image-url",
  "description": "Lesson description",
  "transcript": "Full Arabic transcript",
  "audioUrl": "audio-source",
  "questions": [...],
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Storage Systems

#### 1. Gallery JSON (gallery.json)
- Static collection of curated lessons
- Loaded on page initialization
- Merged with local lessons

#### 2. IndexedDB
- Stores user-created lessons
- Enables offline access
- Syncs with gallery display

#### 3. localStorage
- User ratings (tanaghum_ratings)
- Usage analytics (tanaghum_analytics)
- Gallery index (tanaghum_gallery_index)

### API Reference

#### GalleryManager
```javascript
const gallery = new GalleryManager();

// Apply filters
gallery.currentFilters.ilr = '2.5';
gallery.applyFilters();

// Open preview
gallery.openPreview('lesson-id');

// Use lesson
gallery.useLesson('lesson-id');
```

#### LessonSharing
```javascript
// Save lesson
await LessonSharing.saveLesson(lessonData);

// Load lesson
const lesson = await LessonSharing.loadLesson('lesson-id');

// Get all local lessons
const lessons = await LessonSharing.getAllLocalLessons();

// Generate share URL
const url = LessonSharing.generateShareUrl(lesson);

// Export as JSON
LessonSharing.exportLessonAsJson(lesson);
```

#### RatingSystem
```javascript
// Get user rating
const userRating = RatingSystem.getUserRating('lesson-id');

// Set rating
RatingSystem.setUserRating('lesson-id', 5);

// Render widget
RatingSystem.renderRatingWidget(container, 'lesson-id', 4.5, 23);

// Get stats
const stats = RatingSystem.getRatingStats();
```

## Customization

### Adding New Topics

Edit `gallery.html` filter pills:
```html
<button class="filter-pill" data-topic="your-topic">Your Topic</button>
```

Add icon in `gallery-manager.js`:
```javascript
getTopicIcon(topic) {
  const icons = {
    // ...existing icons
    'your-topic': '🎯'
  };
  return icons[topic] || '📄';
}
```

### Styling Cards

Modify `css/gallery.css`:
```css
.lesson-card {
  /* Customize card appearance */
}

.lesson-card:hover {
  /* Hover effects */
}
```

## Performance

### Optimizations
- **Loading skeleton**: Shows while data loads
- **Debounced search**: Prevents excessive filtering
- **Lazy rendering**: Only visible cards rendered
- **IndexedDB caching**: Fast local storage
- **CSS animations**: Hardware-accelerated transitions

### Best Practices
- Keep gallery.json under 100 lessons
- User lessons stored separately in IndexedDB
- Images lazy-loaded when scrolled into view
- Filters applied in-memory (no API calls)

## Troubleshooting

### No lessons appearing
1. Check browser console for errors
2. Verify gallery.json loads correctly
3. Clear browser cache and reload

### Ratings not saving
1. Check localStorage is enabled
2. Clear localStorage and try again
3. Verify browser supports localStorage

### Share links not working
1. Ensure lesson is saved to IndexedDB
2. Check URL format: `player.html#lessonId`
3. Verify player.html handles hash correctly

## Future Enhancements

- Server-side storage for true sharing
- User accounts and profiles
- Lesson collections and playlists
- Advanced search (by difficulty, vocabulary)
- Social features (comments, favorites)
- Analytics dashboard
