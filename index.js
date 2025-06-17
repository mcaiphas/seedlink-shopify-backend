const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON bodies and allow CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  next();
});
app.use(express.json());


// Get Shopify credentials from environment variables
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

// A simple route to check if the server is alive
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v2)');
});

// The main endpoint that will create the draft order
app.post('/create-draft-order', async (req, res) => {
  console.log("Received request to /create-draft-order");

  if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    console.error('Server is missing Shopify credentials.');
    return res.status(500).json({ error: 'Server is not configured with Shopify credentials.' });
  }

  try {
    const { variantId, budgetData } = req.body;

    if (!variantId || !budgetData) {
      console.log("Request failed: Missing variantId or budgetData.");
      return res.status(400).json({ error: 'Missing variantId or budgetData in request.' });
    }
    
    // Use Buffer for more robust Base64 decoding
    const decodedDataString = Buffer.from(budgetData, 'base64').toString('utf-8');

    // Prepare the line item with custom properties for the draft order
    const lineItems = [
      {
        variant_id: variantId,
        quantity: 1,
        properties: [
          {
            name: "_budget_data",
            value: decodedDataString, 
          }
        ]
      }
    ];

    // Prepare the data to send to the Shopify API
    const draftOrderData = {
      draft_order: {
        line_items: lineItems,
      },
    };

    const shopifyApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/draft_orders.json`;
    console.log("Sending request to Shopify API:", shopifyApiUrl);

    // Make the API call to Shopify
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
      // Log the detailed error from Shopify for debugging
      console.error('Shopify API Error:', JSON.stringify(responseData, null, 2));
      throw new Error(responseData.errors ? JSON.stringify(responseData.errors) : 'Failed to create draft order on Shopify.');
    }
    
    console.log("Successfully created draft order. Invoice URL:", responseData.draft_order.invoice_url);
    res.status(200).json({ invoiceUrl: responseData.draft_order.invoice_url });

  } catch (error) {
    console.error('Final error in catch block:', error.message);
    res.status(500).json({ error: `An internal server error occurred: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
