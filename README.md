# Commander City Shuttle Pass — Online Payment & Self-Service Portal

Instant online shuttle pass renewal portal for **Commander City Shuttle Service**. Residents can enter their unique Member ID, select their pass type (Full or Half month), upload payment proof (AI OCR verified), and immediately receive their digital shuttle pass formatted in the official PVC card layout.

---

## 🚀 Live Vercel Deployment Guide

1. Go to your **[Vercel Dashboard](https://vercel.com/dashboard)**.
2. Click **"Add New..."** > **"Project"**.
3. Under **Import Git Repository**, select **`amaanyousaf123-ops/commander-shuttle-portal`**.
4. Leave **Framework Preset** as **Other** (Root directory: `./`).
5. Click **"Deploy"**.
6. In ~20 seconds, your portal will be live at:
   `https://commander-shuttle-portal.vercel.app` (or your chosen domain).

---

## 🚌 Features & Workflow

1. **Step 1: Member ID Lookup Only**
   - User enters their unique Member ID (e.g., `42`, `CC-42`, `CC-00042`).
   - Serverless endpoint `/api/members?q=` verifies their identity from `data/members.json`.
   - Displays Member Name, CNIC, House No, and Photo.

2. **Step 2: Half vs Full Pass (15th of the Month Rule)**
   - **Full Pass**: 30-day shuttle pass (PKR 8,000).
   - **Half Pass**: 15-day shuttle pass (PKR 4,000) — strictly locked before the 15th of each month.
   - Shows real-time date verification and pricing.

3. **Step 3: Online Bank Transfer & AI OCR Receipt Scanning**
   - Displays payment accounts (Meezan Bank, JazzCash, EasyPaisa, Raast Instant).
   - Screenshot upload scanned via client-side AI OCR (`js/ocr-engine.js`).
   - Validates Transaction ID (TID), detects amount paid, prevents duplicate receipts, and flags underpayments.
   - Includes quick sample receipt button for testing.

4. **Step 4: Official Digital Pass Card (PVC Format)**
   - Renders the exact `.commander-shuttle-card` format used by the layout software.
   - 12 Dynamic monthly themes (`theme-month-1` to `12`).
   - Conductor QR Code with encoded validation payload.
   - Print-ready with exact physical PVC card dimensions (**85.6mm × 54.0mm**).

5. **Auto-Sync to Google Sheets & Local System**
   - Every issued pass is automatically forwarded to the Google Sheets webhook:
     `https://script.google.com/macros/s/AKfycbyGXUJIPYrAcjE4FHzG97q6_kj95lCVKPgM9hxFANKZZt4_CL1YKukJVmjlRPLuDho/exec`
   - Keeps both online and local management systems in complete sync.
