// Simple public configuration loader

let configPromise = null;

/**
 * Fetches the public configuration from the server
 * Only fetches once, subsequent calls return cached result
 * @returns {Promise<Object>} The configuration object
 */
function loadPublicConfig() {
  // Return existing promise if one exists (resolved or pending)
  if (configPromise) {
    return configPromise;
  }

  // Create and cache the promise
  const cacheBuster = `?v=${Date.now()}`;
  configPromise = fetch(`./public_config.json${cacheBuster}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }
      return response.json();
    })
    .catch(error => {
      // Clear promise on error so it can be retried
      configPromise = null;
      throw error;
    });

  return configPromise;
}
