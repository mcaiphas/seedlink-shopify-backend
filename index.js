const express = require('express');
const fetch = require('node-fetch');
const { jsPDF } = require("jspdf");
require('jspdf-autotable');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_VARIANT_ID = '43813143773238';

// --- PDF Generation Functions ---
// (These functions are assumed to be correct and are omitted for brevity)
function generateFinancialComments(farmTotals) { /* ... same as before ... */ }
function createReportPdf(budgetData) { /* ... same as before ... */ }


// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v10-debug)');
});

app.post('/create-draft-order', async (req, res) => {
  console.log("--- Received request to /create-draft-order ---");

  // --- Diagnostic Logging ---
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    console.error('[FATAL] Server is missing Shopify credentials in Environment Variables.');
    return res.status(500).json({ error: 'Server configuration error: Shopify credentials not set.' });
  }
  
  const tokenForLog = `${SHOPIFY_ADMIN_ACCESS_TOKEN.substring(0, 8)}...${SHOPIFY_ADMIN_ACCESS_TOKEN.substring(SHOPIFY_ADMIN_ACCESS_TOKEN.length - 4)}`;
  console.log(`[DIAGNOSTIC] Using Store Domain: ${SHOPIFY_STORE_DOMAIN}`);
  console.log(`[DIAGNOSTIC] Using Access Token (masked): ${tokenForLog}`);
  // --- End Diagnostic Logging ---

  try {
    const { variantId, budgetData } = req.body;
    if (!variantId || !budgetData) {
      return res.status(400).json({ error: 'Missing variantId or budgetData.' });
    }
    
    const decodedDataString = Buffer.from(budgetData, 'base64').toString('utf-8');
    const lineItems = [{
      variant_id: variantId,
      quantity: 1,
      properties: [{ name: "_budget_data", value: decodedDataString }]
    }];

    const draftOrderData = { draft_order: { line_items: lineItems } };
    const shopifyApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/draft_orders.json`;

    console.log(`Sending request to Shopify: ${shopifyApiUrl}`);
    const shopifyResponse = await fetch(shopifyApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify(draftOrderData),
    });

    const responseData = await shopifyResponse.json();
    if (!shopifyResponse.ok) {
      console.error('Shopify API returned an error:', JSON.stringify(responseData, null, 2));
      throw new Error(responseData.errors ? JSON.stringify(responseData.errors) : 'Failed to create draft order on Shopify.');
    }
    
    console.log("Successfully created draft order. Sending back invoice URL.");
    res.status(200).json({ invoiceUrl: responseData.draft_order.invoice_url });

  } catch (error) {
    console.error('Error in /create-draft-order:', error.message);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

// The /generate-and-deliver-pdf endpoint remains unchanged for now.

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
