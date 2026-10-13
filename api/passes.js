const fs = require('fs');
const path = require('path');

let cachedPasses = null;

function loadPasses() {
  if (cachedPasses) return cachedPasses;
  try {
    const p = path.join(__dirname, '..', 'data', 'passes.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      cachedPasses = (Array.isArray(data) ? data : []).map(item => {
        const copy = { ...item };
        delete copy.photo;
        return copy;
      });
      return cachedPasses;
    }
  } catch (e) {
    console.error('[API passes] Error reading passes.json:', e.message);
  }
  return [];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { month, year, memberId, serialNo } = req.query || {};
  let passes = loadPasses();

  if (month) passes = passes.filter(p => String(p.month) === String(month));
  if (year) passes = passes.filter(p => String(p.year) === String(year));
  if (memberId) passes = passes.filter(p => String(p.memberId) === String(memberId));
  if (serialNo) passes = passes.filter(p => String(p.serialNo) === String(serialNo));

  return res.status(200).json({
    success: true,
    count: passes.length,
    passes: passes.slice(0, 100)
  });
};
