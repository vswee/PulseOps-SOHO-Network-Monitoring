# PulseOps Tab System

This document describes the new tab-based navigation system for PulseOps, which separates the previously monolithic overview page into individual HTML pages for better organization and direct linking.

## Overview

The tab system has been refactored from a single-page application (SPA) approach to individual HTML pages for each tab. This provides several benefits:

- **Direct linking**: Each tab can be accessed via a direct URL
- **Browser history**: Navigation between tabs is properly recorded in browser history
- **URL persistence**: Refreshing the page maintains the current tab
- **Better organization**: Each tab has its own complete HTML file
- **Improved SEO**: Each page can have its own title and meta tags

## File Structure

### HTML Pages
- `/overview.html` - Device overview and monitoring dashboard
- `/map.html` - Network topology maps
- `/logs.html` - Activity logs and filtering
- `/devices.html` - Device management and configuration
- `/keys.html` - SSH key management
- `/settings.html` - Application settings
- `/insights.html` - Device insights and analytics

### Shared Resources
- `/css/tabs.css` - Tab-specific styling
- `/js/tabs.js` - Tab navigation and active state management
- `/js/shared/auth.js` - Authentication utilities
- `/js/shared/utils.js` - Common utility functions
- `/templates/base.html` - Base template (for reference)

### JavaScript Modules
- `/js/dashboard/views/overview.js` - Overview page functionality
- `/js/dashboard/views/overview-map.js` - Map page functionality
- `/js/dashboard/views/logs.js` - Logs page functionality
- `/js/dashboard/views/devices.js` - Devices page functionality
- `/js/dashboard/views/keys.js` - Keys page functionality
- `/js/dashboard/views/settings.js` - Settings page functionality
- `/js/dashboard/views/insights.js` - Insights page functionality

## How It Works

### Navigation
Each tab in the navigation is now a regular HTML link (`<a>` tag) instead of a button. This allows for:
- Right-click to open in new tab
- Ctrl+click to open in new tab
- Direct URL sharing
- Proper browser history

### Active Tab Detection
The `tabs.js` module automatically detects the current page and highlights the corresponding tab. It uses:
1. URL pathname matching
2. Filename matching (fallback)
3. Hash-based routing (backward compatibility)

### Shared Functionality
Common functionality is shared through:
- **CSS**: Consistent styling across all pages
- **JavaScript modules**: Reusable code for authentication, utilities, etc.
- **Template structure**: Consistent HTML structure

## Usage

### Adding a New Tab
1. Create a new HTML file (e.g., `newtab.html`)
2. Use the existing pages as templates
3. Add the tab to the navigation in all HTML files
4. Update the `PAGE_TAB_MAP` in `tabs.js`
5. Create or update the corresponding JavaScript module

### Customizing a Tab
Each tab page can be customized independently:
- Add page-specific CSS
- Include additional JavaScript modules
- Modify the page title and meta tags
- Add page-specific modals or components

### Backward Compatibility
The system maintains backward compatibility with the original SPA routing:
- Hash-based URLs still work
- The main `index.html` redirects to `overview.html`
- Existing bookmarks continue to function

## Testing

### Test Pages
- `/test-tabs.html` - Comprehensive tab system testing
- `/debug.html` - Debug console for troubleshooting

### Manual Testing
1. Navigate between tabs using the navigation
2. Refresh the page and verify the active tab is maintained
3. Use browser back/forward buttons
4. Test direct URL access to each tab
5. Verify right-click "Open in new tab" functionality

## Migration Notes

### From Old System
The old system used:
- Single `index.html` with hidden sections
- JavaScript-based view switching
- Hash-based routing only

### To New System
The new system provides:
- Individual HTML files for each tab
- Direct URL access
- Improved browser integration
- Better organization and maintainability

## Browser Support

The tab system works with all modern browsers that support:
- ES6 modules
- CSS custom properties
- Modern DOM APIs

## Performance

Benefits of the new system:
- **Faster initial load**: Only the current page's resources are loaded
- **Better caching**: Each page can be cached independently
- **Reduced memory usage**: Unused pages are not kept in memory
- **Progressive loading**: Additional resources loaded only when needed

## Security

The system maintains the same security model:
- Authentication checks on each page
- Shared authentication state
- Secure session management
- CSRF protection (where applicable)
