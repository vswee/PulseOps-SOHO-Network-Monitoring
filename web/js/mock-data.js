/**
 * Mock Data Service for Testing
 * Provides sample device data when API is not available
 */

// Helper function for metric units
function getMetricUnit(metricType) {
  const units = {
    'ping_ms': 'ms',
    'iperf_mbps': 'Mbps',
    'cpu_usage': '%',
    'memory_usage': '%',
    'temperature': '°C'
  };
  return units[metricType] || '';
}

// Sample device data
const SAMPLE_DEVICES = [
  {
    id: 'device-001',
    name: 'Main Router',
    host: '192.168.1.1',
    platform: 'openwrt',
    platform_display: 'OpenWrt',
    kind: 'router',
    user: 'root',
    status: 'online',
    site: 'Main Office',
    tags: ['critical', 'gateway'],
    updated_at: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
    meta: {
      uptime: 86400,
      cpu_usage: 15,
      memory_usage: 45,
      temperature: 42
    }
  },
  {
    id: 'device-002',
    name: 'Access Point 1',
    host: '192.168.1.10',
    platform: 'openwrt',
    platform_display: 'OpenWrt',
    kind: 'access_point',
    user: 'root',
    status: 'online',
    site: 'Main Office',
    tags: ['wifi'],
    updated_at: new Date(Date.now() - 600000).toISOString(), // 10 minutes ago
    meta: {
      uptime: 172800,
      cpu_usage: 8,
      memory_usage: 32,
      temperature: 38,
      clients_connected: 12
    }
  },
  {
    id: 'device-003',
    name: 'Edge Switch',
    host: '192.168.1.20',
    platform: 'edgeos',
    platform_display: 'EdgeOS',
    kind: 'switch',
    user: 'ubnt',
    status: 'warning',
    site: 'Main Office',
    tags: ['network', 'managed'],
    updated_at: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    meta: {
      uptime: 259200,
      cpu_usage: 25,
      memory_usage: 55,
      temperature: 48,
      ports_active: 18
    }
  },
  {
    id: 'device-004',
    name: 'Backup Router',
    host: '192.168.1.2',
    platform: 'openwrt',
    platform_display: 'OpenWrt',
    kind: 'router',
    user: 'root',
    status: 'offline',
    site: 'Branch Office',
    tags: ['backup'],
    updated_at: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    meta: {
      uptime: 0,
      cpu_usage: 0,
      memory_usage: 0,
      temperature: null
    }
  },
  {
    id: 'device-005',
    name: 'IoT Gateway',
    host: '192.168.1.50',
    platform: 'huawei',
    platform_display: 'Huawei VRP',
    kind: 'gateway',
    user: 'admin',
    status: 'online',
    site: 'Data Center',
    tags: ['iot', 'sensors'],
    updated_at: new Date(Date.now() - 900000).toISOString(), // 15 minutes ago
    meta: {
      uptime: 432000,
      cpu_usage: 12,
      memory_usage: 28,
      temperature: 35,
      connected_devices: 45
    }
  }
];

// Sample SSH keys
const SAMPLE_SSH_KEYS = [
  {
    id: 'key-001',
    name: 'datacenter-main',
    fingerprint: 'SHA256:abc123def456...',
    created_at: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'key-002',
    name: 'branch-office',
    fingerprint: 'SHA256:xyz789uvw012...',
    created_at: new Date(Date.now() - 172800000).toISOString()
  }
];

// Sample templates
const SAMPLE_TEMPLATES = [
  {
    id: 'template-001',
    name: 'OpenWrt Router',
    platform: 'openwrt',
    description: 'Standard OpenWrt router configuration'
  },
  {
    id: 'template-002',
    name: 'EdgeOS Switch',
    platform: 'edgeos',
    description: 'Ubiquiti EdgeOS switch configuration'
  }
];

/**
 * Mock API responses
 */
class MockAPI {
  static isEnabled() {
    // Enable mock data only as fallback when API is not available
    // Check if we should force mock mode (for testing)
    return window.location.search.includes('mock=true');
  }

  static async handleRequest(url, options = {}) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const method = options.method || 'GET';
    const urlPath = new URL(url, window.location.origin).pathname;

    console.log(`[MockAPI] ${method} ${urlPath}`);

    // Helper to create mock response with proper headers
    function createMockResponse(data, status = 200) {
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: {
          get: (name) => {
            if (name.toLowerCase() === 'content-type') {
              return 'application/json';
            }
            return null;
          }
        },
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data))
      };
    }

    // Route requests
    if (urlPath === '/api/devices') {
      if (method === 'GET') {
        return createMockResponse(SAMPLE_DEVICES);
      }
    }

    if (urlPath.startsWith('/api/devices/')) {
      const deviceId = urlPath.split('/')[3];
      const action = urlPath.split('/')[4];

      if (method === 'GET' && !action) {
        const device = SAMPLE_DEVICES.find(d => d.id === deviceId);
        if (device) {
          return createMockResponse(device);
        }
        return createMockResponse({ error: 'Device not found' }, 404);
      }

      if (method === 'PUT' && !action) {
        console.log(`[MockAPI] Updating device ${deviceId}`, options.body);
        return createMockResponse({ success: true });
      }

      if (method === 'DELETE' && !action) {
        console.log(`[MockAPI] Deleting device ${deviceId}`);
        return createMockResponse({ success: true });
      }

      if (method === 'POST' && action === 'validate') {
        console.log(`[MockAPI] Validating device ${deviceId}`, options.body);
        return createMockResponse({
          success: true,
          message: 'Device configuration is valid',
          issues: []
        });
      }

      if (method === 'POST' && action === 'reboot') {
        console.log(`[MockAPI] Rebooting device ${deviceId}`);
        return createMockResponse({ success: true });
      }
    }

    if (urlPath === '/api/ssh-keys') {
      if (method === 'GET') {
        return createMockResponse(SAMPLE_SSH_KEYS);
      }
      if (method === 'POST') {
        console.log(`[MockAPI] Creating SSH key`, options.body);
        return createMockResponse({ success: true });
      }
    }

    if (urlPath === '/api/templates') {
      if (method === 'GET') {
        return createMockResponse(SAMPLE_TEMPLATES);
      }
    }

    // Metrics endpoints
    if (urlPath === '/api/metrics') {
      if (method === 'GET') {
        const params = new URLSearchParams(url.split('?')[1] || '');
        const deviceId = params.get('device_id');
        const metric = params.get('metric');
        const since = params.get('since');
        const limit = parseInt(params.get('limit')) || 144;

        console.log(`[MockAPI] Loading metrics: device=${deviceId}, metric=${metric}, since=${since}, limit=${limit}`);

        // Generate sample time series data
        const now = new Date();
        const sinceDate = since ? new Date(since) : new Date(now.getTime() - 6 * 60 * 60 * 1000);
        const timeSpan = now.getTime() - sinceDate.getTime();
        const interval = timeSpan / limit;

        const metrics = [];
        for (let i = 0; i < limit; i++) {
          const timestamp = new Date(sinceDate.getTime() + i * interval);
          let value;

          // Generate realistic values based on metric type
          switch (metric) {
            case 'ping_ms':
              value = 10 + Math.random() * 20 + Math.sin(i / 10) * 5;
              break;
            case 'iperf_mbps':
              value = 80 + Math.random() * 40 + Math.sin(i / 15) * 10;
              break;
            case 'cpu_usage':
              value = 20 + Math.random() * 30 + Math.sin(i / 8) * 15;
              break;
            case 'memory_usage':
              value = 40 + Math.random() * 20 + Math.sin(i / 12) * 10;
              break;
            case 'temperature':
              value = 35 + Math.random() * 15 + Math.sin(i / 20) * 5;
              break;
            default:
              value = Math.random() * 100;
          }

          metrics.push({
            id: i + 1,
            device_id: parseInt(deviceId) || deviceId,
            ts: timestamp.toISOString(),
            metric: metric,
            value: Math.max(0, value),
            unit: getMetricUnit(metric)
          });
        }

        return createMockResponse(metrics);
      }
    }

    if (urlPath === '/api/metrics/latest') {
      if (method === 'GET') {
        const params = new URLSearchParams(url.split('?')[1] || '');
        const deviceId = params.get('device_id');
        const metric = params.get('metric');

        console.log(`[MockAPI] Loading latest metric: device=${deviceId}, metric=${metric}`);

        let value;
        switch (metric) {
          case 'ping_ms':
            value = 15 + Math.random() * 10;
            break;
          case 'iperf_mbps':
            value = 95 + Math.random() * 20;
            break;
          case 'cpu_usage':
            value = 25 + Math.random() * 20;
            break;
          case 'memory_usage':
            value = 45 + Math.random() * 15;
            break;
          case 'temperature':
            value = 42 + Math.random() * 8;
            break;
          default:
            value = Math.random() * 100;
        }

        const latestMetric = {
          id: 1,
          device_id: parseInt(deviceId) || deviceId,
          ts: new Date().toISOString(),
          metric: metric,
          value: value,
          unit: getMetricUnit(metric)
        };

        return createMockResponse(latestMetric);
      }
    }

    // Handle both /api/logs and /api/device-logs endpoints
    if (urlPath === '/api/logs' || urlPath === '/api/device-logs') {
      if (method === 'GET') {
        const params = new URLSearchParams(url.split('?')[1] || '');
        const deviceId = params.get('device_id');
        const limit = parseInt(params.get('limit')) || 10;

        console.log(`[MockAPI] Loading device logs: device=${deviceId}, limit=${limit}`);

        const logs = [
          {
            id: 1,
            device_id: parseInt(deviceId) || deviceId,
            ts: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
            timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
            level: 'info',
            message: 'Interface ge-0/0/0 transitioned to up.'
          },
          {
            id: 2,
            device_id: parseInt(deviceId) || deviceId,
            ts: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
            timestamp: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
            level: 'warn',
            message: 'Packet loss threshold exceeded for WAN circuit.'
          },
          {
            id: 3,
            device_id: parseInt(deviceId) || deviceId,
            ts: new Date(Date.now() - 80 * 60 * 1000).toISOString(),
            timestamp: new Date(Date.now() - 80 * 60 * 1000).toISOString(),
            level: 'info',
            message: 'Configuration backup completed.'
          },
          {
            id: 4,
            device_id: parseInt(deviceId) || deviceId,
            ts: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
            timestamp: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
            level: 'info',
            message: 'System health check completed successfully.'
          },
          {
            id: 5,
            device_id: parseInt(deviceId) || deviceId,
            ts: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
            timestamp: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
            level: 'warn',
            message: 'High CPU usage detected (85%).'
          }
        ].slice(0, limit);

        return createMockResponse(logs);
      }
    }

    // Default response for unhandled routes
    console.warn(`[MockAPI] Unhandled request: ${method} ${urlPath}`);
    return createMockResponse({ error: 'Not found' }, 404);
  }
}

/**
 * Enhanced fetch with mock fallback
 * Try real API first, use mock data only if API fails
 */
const originalFetch = window.fetch;

window.fetch = async function(url, options = {}) {
  // Only handle API requests
  if (typeof url === 'string' && url.startsWith('/api/')) {
    try {
      // First, try the real API
      const response = await originalFetch(url, options);

      // If we get a successful response, use it
      if (response.ok) {
        return response;
      }

      // If API returns error and we're on localhost, try mock fallback
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log(`[MockAPI] Real API failed (${response.status}), falling back to mock data for ${url}`);
        return await MockAPI.handleRequest(url, options);
      }

      // Otherwise return the failed response
      return response;

    } catch (error) {
      // If API is completely unavailable and we're on localhost, use mock fallback
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log(`[MockAPI] Real API unavailable, falling back to mock data for ${url}`);
        try {
          return await MockAPI.handleRequest(url, options);
        } catch (mockError) {
          console.error('[MockAPI] Mock fallback also failed:', mockError);
          throw error; // Throw original error
        }
      }

      // Re-throw the original error if not on localhost
      throw error;
    }
  }

  // Pass through non-API requests
  return originalFetch(url, options);
};

// Force mock mode if requested
if (MockAPI.isEnabled()) {
  console.log('[MockAPI] Force mock mode enabled via ?mock=true');
}

// Export for manual testing
window.MockAPI = MockAPI;
window.SAMPLE_DEVICES = SAMPLE_DEVICES;
