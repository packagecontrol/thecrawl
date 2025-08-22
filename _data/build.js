module.exports = () => {
  const now = new Date()
  return {
    timestamp: now.toISOString(),
    formatted: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    fullYear: now.getFullYear(),
  }
}
