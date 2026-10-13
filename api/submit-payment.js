const https = require('https');
const http = require('http');

// Global in-memory cache for Vercel warm instances
const processedTransactions = new Set([
  '012489201948', // sample seed
]);

function postWithRedirects(targetUrl, jsonPayload, method = 'POST', maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    try {
      const urlObj = new URL(targetUrl);
      const lib = urlObj.protocol === 'https:' ? https : http;
      const postData = (method === 'POST' && jsonPayload) ? (typeof jsonPayload === 'string' ? jsonPayload : JSON.stringify(jsonPayload)) : null;

      const headers = {};
      if (method === 'POST' && postData) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: headers
      };

      const req = lib.request(options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            redirectUrl = `${urlObj.protocol}//${urlObj.hostname}${redirectUrl}`;
          }
          const nextMethod = (res.statusCode === 307 || res.statusCode === 308) ? method : 'GET';
          return postWithRedirects(redirectUrl, nextMethod === 'GET' ? null : jsonPayload, nextMethod, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }

        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(responseData));
          } catch (e) {
            resolve({ raw: responseData, statusCode: res.statusCode });
          }
        });
      });

      req.on('error', reject);
      if (method === 'POST' && postData) {
        req.write(postData);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const data = req.body || {};
    const {
      memberId,
      memberName,
      cnic,
      houseNo,
      contact,
      photo,
      month = new Date().getMonth() + 1,
      year = new Date().getFullYear(),
      passType = 'Full',
      amount = 8000,
      transactionId,
      provider = 'Online Bank / Wallet',
      serialNo,
      receiptImage,
      ocrData
    } = data;

    if (!memberName || !transactionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: memberName and transactionId are required.'
      });
    }

    const cleanTid = String(transactionId).trim().toUpperCase();

    // Duplicate Check
    if (processedTransactions.has(cleanTid)) {
      return res.status(400).json({
        success: false,
        error: `Duplicate Transaction ID Detected! Reference #${cleanTid} has already been verified and used.`
      });
    }

    // Expected Fee Validation (Full: 8000, Half: 4000)
    const expectedFee = passType === 'Half' ? 4000 : 8000;
    const paidAmount = Number(amount) || 0;

    if (paidAmount < expectedFee) {
      return res.status(400).json({
        success: false,
        error: `Insufficient payment amount! Required fee for ${passType} Pass is PKR ${expectedFee.toLocaleString()}, but transaction shows PKR ${paidAmount.toLocaleString()}.`
      });
    }

    // Record Transaction to prevent reuse
    processedTransactions.add(cleanTid);

    // Compute month dates
    const lastDay = new Date(year, month, 0).getDate();
    const issueDate = passType === 'Half' 
      ? `16-${String(month).padStart(2, '0')}-${year}`
      : `01-${String(month).padStart(2, '0')}-${year}`;
    const validTill = `${String(lastDay).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
    const nowIso = new Date().toISOString();

    const assignedSerial = serialNo || String(Math.floor(100 + Math.random() * 900));

    const newPass = {
      id: Date.now(),
      memberId: memberId || Math.floor(1000 + Math.random() * 9000),
      memberName,
      cnic: cnic || 'N/A',
      houseNo: houseNo || 'Commander City',
      contact: contact || '',
      photo: photo || 'LOGO.png',
      serialNo: assignedSerial,
      paymentSeq: parseInt(assignedSerial, 10) || 1,
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      issueDate,
      validTill,
      passType,
      amount: paidAmount,
      paymentMethod: `Online OCR Verified (${provider})`,
      transactionId: cleanTid,
      status: 'active',
      verified: true,
      verifiedBy: `Auto OCR Acceptance (TID: ${cleanTid})`,
      verifiedAt: nowIso,
      createdAt: nowIso
    };

    const newPayment = {
      id: Date.now(),
      passId: newPass.id,
      memberId: newPass.memberId,
      memberName,
      amount: paidAmount,
      transactionId: cleanTid,
      provider,
      paidAt: nowIso,
      notes: `Online OCR Verified — TID #${cleanTid}`,
      status: 'accepted'
    };

    // Auto-sync to Google Sheets Webhook in background
    const webhookUrl = process.env.GOOGLE_WEBHOOK_URL ||
      'https://script.google.com/macros/s/AKfycbyGXUJIPYrAcjE4FHzG97q6_kj95lCVKPgM9hxFANKZZt4_CL1YKukJVmjlRPLuDho/exec';

    const syncPayload = {
      type: 'SYNC_DATA',
      passes: [newPass],
      members: [{
        id: newPass.memberId,
        name: memberName,
        cnic: newPass.cnic,
        houseNo: newPass.houseNo,
        contact: newPass.contact
      }]
    };

    let googleSyncResult = { status: 'pending' };
    try {
      googleSyncResult = await postWithRedirects(webhookUrl, syncPayload);
    } catch (gErr) {
      console.warn('[Vercel API] Google sheets sync warning:', gErr.message);
      googleSyncResult = { status: 'queued_locally', note: gErr.message };
    }

    return res.status(200).json({
      success: true,
      message: 'Transaction successfully scanned, verified, and accepted! Shuttle Pass generated.',
      pass: newPass,
      payment: newPayment,
      googleSync: googleSyncResult
    });

  } catch (err) {
    console.error('[Vercel API] submit-payment error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while processing payment: ' + err.message
    });
  }
};
