# Metric Hiding Implementation

## Overview
This implementation adds automatic hiding of metrics that only show "n/a" values, with a toggle button to show/hide these metrics as requested.

## Features Implemented

### 1. Automatic Metric Hiding
- Metrics displaying only "n/a" or "--" values are automatically hidden from the grid
- Each device's metric visibility is tracked independently
- Hidden state is recalculated whenever metrics are refreshed

### 2. Toggle Functionality
- A small text button appears below the metrics grid when there are hidden metrics
- Button shows count of hidden metrics (e.g., "Show 3 hidden metrics")
- When toggled to show hidden metrics, button text changes to "Hide metrics without data"
- Toggle state is per-device (each device can be toggled independently)

### 3. Tooltip Information
- Hover tooltip on the toggle button explains the auto-hiding behavior
- Tooltip text: "Metrics without data are automatically hidden"

## Files Modified

### 1. `web/css/style.css`
Added CSS classes and styling:
- `.metric-hidden` - Hides metric items with `display: none`
- `.metrics-toggle-container` - Container for the toggle button
- `.metrics-toggle-btn` - Styling for the toggle button
- `.metrics-toggle-tooltip` - Tooltip wrapper and styling

### 2. `web/index.html`
Modified JavaScript functions:
- Added global variables: `deviceHiddenMetricsVisible`, `metricVisibilityState`
- Modified `createMetricsSummary()` to include toggle container
- Added `updateMetricVisibility()` function to check and hide/show metrics per device
- Added `toggleHiddenMetrics()` function to handle per-device toggle action
- Modified `deviceCard()` to include device ID attribute
- Integrated visibility update into `refreshLatest()` function
- Reset state in `renderDevices()` function

## How It Works

1. **Detection**: When metrics are loaded/refreshed, `updateMetricVisibility()` checks each metric value
2. **Hiding**: Metrics with "n/a" or "--" values get the `metric-hidden` class applied
3. **Toggle Display**: If any metrics are hidden, the toggle button becomes visible
4. **User Control**: Users can click the toggle to show/hide metrics without data for that specific device
5. **Per-Device State**: Each device maintains its own toggle state independently

## Testing

### Test Files Created
1. `simple_test.html` - Basic functionality test with hardcoded values
2. `integration_test.html` - Full integration test using actual application structure
3. `test_metric_hiding.html` - Original comprehensive test

### How to Test
1. Open any of the test files in a browser
2. Observe that metrics with "n/a" values are automatically hidden
3. Look for toggle buttons below metrics grids where there are hidden metrics
4. Click toggle buttons to show/hide metrics without data
5. Hover over toggle buttons to see tooltips

### Expected Behavior
- **Device with mixed data**: Some metrics hidden, toggle button visible
- **Device with all n/a**: All metrics hidden, toggle shows count
- **Device with all data**: No metrics hidden, no toggle button
- **Per-device toggle**: Clicking a toggle only affects that specific device

## Integration with Main Application

The implementation is fully integrated and will work automatically when:
1. The application loads devices
2. Metrics are refreshed via `refreshLatest()`
3. Users interact with the interface

No additional setup or configuration is required.

## Browser Compatibility

The implementation uses standard CSS and JavaScript features:
- CSS Grid (for metrics layout)
- CSS Variables (for theming)
- Modern JavaScript (ES6+ features)
- DOM manipulation APIs

Should work in all modern browsers (Chrome, Firefox, Safari, Edge).

## Performance Considerations

- Minimal performance impact
- Visibility checks only run when metrics are updated
- Uses efficient DOM queries and caching
- No continuous polling or heavy computations

## Future Enhancements

Possible improvements:
1. User preference persistence (remember toggle states across sessions)
2. Animation transitions for show/hide
3. Keyboard accessibility improvements
4. Custom threshold for "no data" detection
5. Bulk toggle for all devices
