try {
  require.cache[require.resolve('server-only')] = { exports: {} };
} catch {}
