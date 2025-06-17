const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON bodies and allow CORS
// This is crucial for allowing the calculator to talk to this server.
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
  res.send('Seedlink Shopify Backend is running and ready.');
});

// The main endpoint that will create the draft order
app.post('/create-draft-order', async (req, res) => {
  // Check if API keys are configured on the server
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    console.error('Server is missing Shopify credentials.');
    return res.status(500).json({ error: 'Server is not configured with Shopify credentials.' });
  }

  try {
    const { variantId, budgetData } = req.body;

    if (!variantId || !budgetData) {
      return res.status(400).json({ error: 'Missing variantId or budgetData in request.' });
    }
    
    // The data sent from the calculator is already a base64 string
    const decodedData = atob(budgetData);

    // Prepare the line item with custom properties for the draft order
    const lineItems = [
      {
        variant_id: variantId,
        quantity: 1,
        properties: [
          {
            name: "_budget_data",
            value: decodedData, // Use the decoded, human-readable data
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
      console.error('Shopify API Error:', responseData);
      throw new Error('Failed to create draft order on Shopify.');
    }
    
    // Send the secure invoice URL (checkout link) back to the client
    res.status(200).json({ invoiceUrl: responseData.draft_order.invoice_url });

  } catch (error) {
    console.error('Error creating draft order:', error);
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
