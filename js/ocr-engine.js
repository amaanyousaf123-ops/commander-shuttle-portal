/**
 * ============================================================
 * Commander City Shuttle Pass System — Advanced OCR Engine
 * Handles Receipt Image Preprocessing, OCR Extraction & Parser
 * Supports: JazzCash, EasyPaisa, Raast, Meezan, Bank Alfalah, HBL, UBL, SadaPay
 * ============================================================
 */

const ShuttleOCR = {
    tesseractLoaded: false,
    worker: null,

    /**
     * Initialize Tesseract.js worker
     */
    async init() {
        if (this.worker) return this.worker;

        if (typeof Tesseract === 'undefined') {
            await this.loadTesseractScript();
        }

        try {
            console.log('[ShuttleOCR] Initializing Tesseract worker...');
            // Tesseract v5 API
            if (Tesseract.createWorker) {
                this.worker = await Tesseract.createWorker('eng');
            }
            this.tesseractLoaded = true;
            return this.worker;
        } catch (err) {
            console.error('[ShuttleOCR] Worker init error:', err);
            // Fallback: Tesseract.recognize will be used directly
            return null;
        }
    },

    loadTesseractScript() {
        return new Promise((resolve, reject) => {
            if (window.Tesseract) return resolve();
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.async = true;
            script.onload = () => {
                console.log('[ShuttleOCR] Tesseract.js loaded from CDN');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
            document.head.appendChild(script);
        });
    },

    /**
     * Preprocess image using Canvas: Grayscale, Contrast Enhancement & Thresholding
     */
    preprocessImage(imageSource) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Resize if necessary for optimal OCR resolution (width ~ 1200px)
                    let width = img.width;
                    let height = img.height;
                    const maxDim = 1600;
                    if (width > maxDim || height > maxDim) {
                        const ratio = Math.min(maxDim / width, maxDim / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    } else if (width < 800) {
                        const ratio = 800 / width;
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }

                    canvas.width = width;
                    canvas.height = height;

                    ctx.drawImage(img, 0, 0, width, height);

                    const imgData = ctx.getImageData(0, 0, width, height);
                    const d = imgData.data;

                    // Compute average brightness
                    let totalBrightness = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                        totalBrightness += gray;
                    }
                    const avgBrightness = totalBrightness / (d.length / 4);

                    // Contrast boost factor
                    const contrastFactor = 1.35;
                    const factor = (259 * (contrastFactor + 255)) / (255 * (259 - contrastFactor));

                    for (let i = 0; i < d.length; i += 4) {
                        // Grayscale
                        let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

                        // Contrast
                        gray = factor * (gray - 128) + 128;
                        if (gray < 0) gray = 0;
                        if (gray > 255) gray = 255;

                        // Slight thresholding for crisp text
                        if (avgBrightness > 120) {
                            // Light theme receipt (like JazzCash white or Bank slips)
                            if (gray < 90) gray = Math.max(0, gray * 0.7);
                        }

                        d[i] = gray;
                        d[i + 1] = gray;
                        d[i + 2] = gray;
                    }

                    ctx.putImageData(imgData, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch (err) {
                    // Fallback to original image
                    resolve(imageSource);
                }
            };
            img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
            img.src = imageSource;
        });
    },

    /**
     * Run OCR on image data URL or file
     */
    async scanReceipt(imageSrc, onProgress) {
        if (!imageSrc) throw new Error('No image provided for OCR scan');

        if (onProgress) onProgress({ status: 'preprocessing', progress: 0.15, message: 'Optimizing receipt image...' });
        
        let processedSrc = imageSrc;
        try {
            processedSrc = await this.preprocessImage(imageSrc);
        } catch (e) {
            console.warn('[ShuttleOCR] Preprocessing skipped:', e.message);
        }

        if (onProgress) onProgress({ status: 'initializing', progress: 0.3, message: 'Loading OCR engine...' });
        await this.init();

        if (onProgress) onProgress({ status: 'recognizing', progress: 0.45, message: 'Scanning transaction details...' });

        let rawText = '';
        let confidence = 0;

        try {
            if (this.worker && this.worker.recognize) {
                const res = await this.worker.recognize(processedSrc);
                rawText = res.data.text || '';
                confidence = res.data.confidence || 75;
            } else {
                const res = await Tesseract.recognize(processedSrc, 'eng', {
                    logger: (m) => {
                        if (m.status === 'recognizing text' && onProgress) {
                            onProgress({
                                status: 'recognizing',
                                progress: 0.45 + (m.progress || 0) * 0.45,
                                message: `Reading text: ${Math.round((m.progress || 0) * 100)}%`
                            });
                        }
                    }
                });
                rawText = res.data.text || '';
                confidence = res.data.confidence || 75;
            }
        } catch (ocrErr) {
            console.error('[ShuttleOCR] OCR recognition failed:', ocrErr);
            throw new Error('OCR recognition failed. Please upload a clearer screenshot.');
        }

        if (onProgress) onProgress({ status: 'parsing', progress: 0.95, message: 'Extracting transaction fields...' });

        const parsed = this.parseTransactionText(rawText);
        parsed.confidence = Math.round(confidence);
        parsed.rawText = rawText;

        if (onProgress) onProgress({ status: 'complete', progress: 1.0, message: 'Scan complete!' });

        return parsed;
    },

    /**
     * Intelligent Parser tailored for Pakistani Banking & Fintech Receipts
     */
    parseTransactionText(text) {
        const clean = text.replace(/\r\n/g, '\n');
        const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

        let provider = 'Unknown Bank / Wallet';
        let transactionId = null;
        let amount = null;
        let date = null;
        let recipient = null;
        let isSuccessful = false;

        const lower = clean.toLowerCase();

        // 1. Detect Provider
        if (lower.includes('jazzcash') || lower.includes('mobilink')) {
            provider = 'JazzCash';
        } else if (lower.includes('easypaisa') || lower.includes('telenor')) {
            provider = 'EasyPaisa';
        } else if (lower.includes('meezan') || lower.includes('mezn')) {
            provider = 'Meezan Bank';
        } else if (lower.includes('alfalah')) {
            provider = 'Bank Alfalah';
        } else if (lower.includes('hbl') || lower.includes('habib bank')) {
            provider = 'HBL';
        } else if (lower.includes('ubl') || lower.includes('united bank')) {
            provider = 'UBL';
        } else if (lower.includes('sadapay')) {
            provider = 'SadaPay';
        } else if (lower.includes('nayapay')) {
            provider = 'NayaPay';
        } else if (lower.includes('raast')) {
            provider = 'Raast (1Link)';
        } else if (lower.includes('faysal')) {
            provider = 'Faysal Bank';
        } else if (lower.includes('mcb')) {
            provider = 'MCB Bank';
        }

        // 2. Detect Success / Completed Status
        const successKeywords = [
            'successful', 'success', 'completed', 'paid', 'transferred', 
            'done', 'confirmed', 'transaction receipt', 'money sent', 
            'payment successful', 'debit successful'
        ];
        isSuccessful = successKeywords.some(kw => lower.includes(kw));

        // 3. Extract Transaction ID / TID / Ref No
        // Priority 1: Explicit JazzCash TID (e.g. TID: 1234567890 or TID 028192819)
        const jazzCashTidMatch = clean.match(/(?:TID|T|D)[\s:.-]*([0-9]{8,14})\b/i);
        if (jazzCashTidMatch) {
            transactionId = jazzCashTidMatch[1];
        }

        // Priority 2: EasyPaisa / Generic Transaction ID
        if (!transactionId) {
            const epMatch = clean.match(/(?:Transaction\s*ID|Txn\s*ID|TRX\s*ID|Trx\s*Id|TrxID)[\s:.-]*([A-Za-z0-9]{8,20})\b/i);
            if (epMatch) transactionId = epMatch[1];
        }

        // Priority 3: Ref No / Reference # / STAN / RRN
        if (!transactionId) {
            const refMatch = clean.match(/(?:Reference\s*(?:No|Number|#|ID)?|Ref\s*(?:No|#)?)[\s:.-]*([A-Za-z0-9]{6,20})\b/i);
            if (refMatch) transactionId = refMatch[1];
        }

        // Priority 4: Raast RRN / STAN
        if (!transactionId) {
            const rrnMatch = clean.match(/(?:RRN|STAN)[\s:.-]*([0-9]{6,16})\b/i);
            if (rrnMatch) transactionId = rrnMatch[1];
        }

        // Priority 5: Fallback standalone 10-12 digit sequence that looks like a TID
        if (!transactionId) {
            const genericDigits = clean.match(/\b([0-9]{10,14})\b/);
            if (genericDigits && !genericDigits[1].startsWith('03') && !genericDigits[1].startsWith('92')) {
                // not a phone number
                transactionId = genericDigits[1];
            }
        }

        // 4. Extract Amount (PKR)
        // Common formats: "Rs. 8,000", "PKR 8,000", "8,000.00", "Amount: 8,000", "Rs 4000"
        const amountRegexes = [
            /(?:Rs\.?|PKR|Amount|Paid|Total)[\s:.-]*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]{4,5})\b/i,
            /\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:PKR|Rs\.?)/i,
            /\b(8,?000|4,?000|6,?000|3,?000|16,?000)\b/
        ];

        for (const reg of amountRegexes) {
            const m = clean.match(reg);
            if (m && m[1]) {
                const parsedVal = parseFloat(m[1].replace(/,/g, ''));
                if (parsedVal >= 500 && parsedVal <= 100000) {
                    amount = parsedVal;
                    break;
                }
            }
        }

        // 5. Extract Date & Time
        // Formats: 12-10-2026, 12/10/2026, 12 Oct 2026, Oct 12, 2026
        const dateMatch = clean.match(/\b(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})\b/) ||
                          clean.match(/\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i) ||
                          clean.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i);
        if (dateMatch) {
            date = dateMatch[1];
        } else {
            // fallback current date formatted
            const now = new Date();
            date = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        }

        // 6. Detect Recipient Keywords (Commander City Shuttle, etc.)
        const recipientKeywords = ['commander', 'city', 'shuttle', 'pass', 'housing', 'transport'];
        const recipientFound = recipientKeywords.some(kw => lower.includes(kw));
        if (recipientFound) {
            recipient = 'Commander City Shuttle Service';
        }

        return {
            provider,
            transactionId: transactionId || 'NOT_DETECTED',
            amount: amount || 0,
            date,
            recipient: recipient || 'Commander City Account',
            isSuccessful: isSuccessful || Boolean(transactionId && amount),
            hasCommanderKeywords: recipientFound
        };
    },

    /**
     * Generate realistic Demo Receipt Canvas image data URL for instant 1-click testing
     */
    generateDemoReceipt(type = 'jazzcash_8000') {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 920;
        const ctx = canvas.getContext('2d');

        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')} Oct, ${now.getFullYear()} at 11:42 AM`;

        if (type === 'jazzcash_8000') {
            const randomTid = '0129' + Math.floor(10000000 + Math.random() * 90000000);

            // JazzCash signature styling (Orange & White)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 600, 920);

            // Header Banner
            ctx.fillStyle = '#eb1c24';
            ctx.fillRect(0, 0, 600, 140);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('JazzCash', 300, 60);

            ctx.font = '20px sans-serif';
            ctx.fillText('Transaction Successful', 300, 100);

            // Checkmark Circle
            ctx.beginPath();
            ctx.arc(300, 200, 45, 0, Math.PI * 2);
            ctx.fillStyle = '#10b981';
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 44px sans-serif';
            ctx.fillText('✓', 300, 215);

            // Amount
            ctx.fillStyle = '#111827';
            ctx.font = 'bold 42px sans-serif';
            ctx.fillText('Rs. 8,000.00', 300, 290);

            ctx.fillStyle = '#6b7280';
            ctx.font = '18px sans-serif';
            ctx.fillText('Monthly Shuttle Pass Fee', 300, 325);

            // Divider
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(40, 360);
            ctx.lineTo(560, 360);
            ctx.stroke();

            // Details Table
            ctx.textAlign = 'left';
            const drawRow = (label, value, y) => {
                ctx.fillStyle = '#6b7280';
                ctx.font = '20px sans-serif';
                ctx.fillText(label, 50, y);

                ctx.fillStyle = '#111827';
                ctx.font = 'bold 20px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(value, 550, y);
                ctx.textAlign = 'left';
            };

            drawRow('Transaction ID (TID)', randomTid, 410);
            drawRow('Paid To', 'Commander City Shuttle', 470);
            drawRow('Account Number', '0300-8271629', 530);
            drawRow('Payment Purpose', 'Monthly Shuttle Pass', 590);
            drawRow('Date & Time', dateStr, 650);
            drawRow('Fee', 'Rs. 0.00', 710);
            drawRow('Status', 'Successful', 770);

            // Footer
            ctx.fillStyle = '#f3f4f6';
            ctx.fillRect(0, 830, 600, 90);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('JazzCash Digital Receipt — Verified Transaction', 300, 875);

            return { dataUrl: canvas.toDataURL('image/png'), tid: randomTid, amount: 8000, provider: 'JazzCash' };
        } 
        
        else if (type === 'easypaisa_4000') {
            const randomTid = '3091' + Math.floor(1000000 + Math.random() * 9000000);

            // EasyPaisa Green & White styling
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 600, 920);

            ctx.fillStyle = '#00a950';
            ctx.fillRect(0, 0, 600, 140);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 34px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('easypaisa', 300, 60);

            ctx.font = '20px sans-serif';
            ctx.fillText('Money Sent Successfully', 300, 100);

            // Checkmark Circle
            ctx.beginPath();
            ctx.arc(300, 200, 45, 0, Math.PI * 2);
            ctx.fillStyle = '#00a950';
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 44px sans-serif';
            ctx.fillText('✓', 300, 215);

            ctx.fillStyle = '#111827';
            ctx.font = 'bold 42px sans-serif';
            ctx.fillText('Rs. 4,000.00', 300, 290);

            ctx.fillStyle = '#6b7280';
            ctx.font = '18px sans-serif';
            ctx.fillText('Half Month Shuttle Pass', 300, 325);

            ctx.strokeStyle = '#e5e7eb';
            ctx.beginPath();
            ctx.moveTo(40, 360);
            ctx.lineTo(560, 360);
            ctx.stroke();

            const drawRow = (label, value, y) => {
                ctx.fillStyle = '#6b7280';
                ctx.font = '20px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, 50, y);

                ctx.fillStyle = '#111827';
                ctx.font = 'bold 20px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(value, 550, y);
            };

            drawRow('Transaction ID', randomTid, 410);
            drawRow('Receiver', 'Commander City Shuttle', 470);
            drawRow('Transfer Type', 'Wallet to Wallet', 530);
            drawRow('Date', dateStr, 590);
            drawRow('Transfer Amount', 'Rs. 4,000.00', 650);
            drawRow('Charges', 'Free', 710);
            drawRow('Status', 'Transferred', 770);

            ctx.fillStyle = '#f3f4f6';
            ctx.fillRect(0, 830, 600, 90);
            ctx.fillStyle = '#9ca3af';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Telenor Microfinance Bank — easypaisa', 300, 875);

            return { dataUrl: canvas.toDataURL('image/png'), tid: randomTid, amount: 4000, provider: 'EasyPaisa' };
        } 
        
        else if (type === 'meezan_8000') {
            const randomTid = 'MEZN' + Math.floor(10000000 + Math.random() * 90000000);

            // Meezan Bank Deep Blue styling
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, 600, 920);

            ctx.fillStyle = '#0f2744';
            ctx.fillRect(0, 0, 600, 150);

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 30px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Meezan Bank', 300, 60);

            ctx.font = '18px sans-serif';
            ctx.fillText('Funds Transfer Receipt', 300, 95);

            ctx.font = '14px sans-serif';
            ctx.fillStyle = '#38bdf8';
            ctx.fillText('The Premier Islamic Bank', 300, 125);

            ctx.fillStyle = '#0f2744';
            ctx.font = 'bold 40px sans-serif';
            ctx.fillText('PKR 8,000.00', 300, 240);

            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText('● Transfer Successful', 300, 280);

            ctx.strokeStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.moveTo(40, 320);
            ctx.lineTo(560, 320);
            ctx.stroke();

            const drawRow = (label, value, y) => {
                ctx.fillStyle = '#64748b';
                ctx.font = '19px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(label, 50, y);

                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 19px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(value, 550, y);
            };

            drawRow('Reference No (Ref)', randomTid, 370);
            drawRow('Beneficiary Title', 'Commander City Shuttle', 430);
            drawRow('Beneficiary Account', '0102-0105847291', 490);
            drawRow('Transfer Channel', 'Raast Instant Payment', 550);
            drawRow('Date & Time', dateStr, 610);
            drawRow('Amount', 'PKR 8,000.00', 670);
            drawRow('Charges', 'PKR 0.00', 730);
            drawRow('Remarks', 'OCTOBER PASS RENEWAL', 790);

            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(0, 840, 600, 80);
            ctx.fillStyle = '#64748b';
            ctx.font = '15px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Electronic Receipt issued by Meezan Internet Banking', 300, 885);

            return { dataUrl: canvas.toDataURL('image/png'), tid: randomTid, amount: 8000, provider: 'Meezan Bank' };
        }

        else {
            // Invalid / Tampered receipt with insufficient amount for testing rejection
            const randomTid = '0112' + Math.floor(10000000 + Math.random() * 90000000);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 600, 920);

            ctx.fillStyle = '#ef4444';
            ctx.fillRect(0, 0, 600, 140);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 30px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('JazzCash Transfer', 300, 70);

            ctx.fillStyle = '#111827';
            ctx.font = 'bold 40px sans-serif';
            ctx.fillText('Rs. 1,500.00', 300, 260);

            ctx.fillStyle = '#dc2626';
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText('(Insufficient Shuttle Fee - Testing Rejection)', 300, 300);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#6b7280';
            ctx.font = '20px sans-serif';
            ctx.fillText('Transaction ID (TID)', 50, 400);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#111827';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText(randomTid, 550, 400);

            return { dataUrl: canvas.toDataURL('image/png'), tid: randomTid, amount: 1500, provider: 'JazzCash' };
        }
    }
};

window.ShuttleOCR = ShuttleOCR;
