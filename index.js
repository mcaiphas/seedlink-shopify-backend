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
// The specific variant ID for the budget product
const SHOPIFY_VARIANT_ID = '43813143773238'; 

// A simple route to check if the server is alive
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v5)');
});

// Endpoint for the Calculator to create a checkout link
app.post('/create-draft-order', async (req, res) => {
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
    return res.status(500).json({ error: 'Server is not configured with Shopify credentials.' });
  }

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
      throw new Error(responseData.errors ? JSON.stringify(responseData.errors) : 'Failed to create draft order.');
    }
    
    res.status(200).json({ invoiceUrl: responseData.draft_order.invoice_url });

  } catch (error) {
    console.error('Error in /create-draft-order:', error);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});


// New Endpoint for Shopify Flow to trigger PDF delivery
app.post('/generate-and-deliver-pdf', async (req, res) => {
    console.log("Received request from Shopify Flow.");

    if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
        console.error('Server is missing Shopify credentials for PDF generation.');
        return res.status(500).send('Server is not configured.');
    }

    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).send('No orderId received from Flow.');
        }

        // Fetch the full order details from Shopify using the orderId
        const orderDetailsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        const orderResponse = await fetch(orderDetailsUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
            },
        });
        
        const { order: orderData } = await orderResponse.json();

        if (!orderData || !orderData.line_items) {
            console.error('Invalid or missing order data from Shopify API.');
            return res.status(400).send('Could not fetch order details from Shopify.');
        }

        // Find the correct line item for the budget product
        const budgetLineItem = orderData.line_items.find(item => item.variant_id && item.variant_id.toString() === SHOPIFY_VARIANT_ID);
        
        if (!budgetLineItem) {
            console.log(`Order ${orderData.id} does not contain the budget product. Skipping.`);
            return res.status(200).send('Not a budget order.');
        }

        // Find the budget data property within the correct line item
        const budgetProperty = budgetLineItem.properties.find(prop => prop.name === '_budget_data');
        if (!budgetProperty || !budgetProperty.value) {
            console.error(`Budget data missing on line item for order ${orderData.id}.`);
            return res.status(400).send('Budget data missing from order properties.');
        }

        const budgetData = JSON.parse(budgetProperty.value);

        // --- PDF Generation Logic would go here ---
        console.log(`Simulating PDF generation for order ${orderData.name}...`);
        const pdfDownloadLink = `https://www.seedlink.co.za/downloads/order_${orderData.name}_${Date.now()}.pdf`;
        console.log(`Generated mock download link: ${pdfDownloadLink}`);
        
        // --- Digital Downloads App Integration Logic would go here ---
        console.log(`Simulating attachment of link to order via Digital Downloads App...`);

        // Respond to Shopify Flow to let it know the action was received.
        res.sendStatus(200);

    } catch (error) {
        console.error('Error processing fulfillment webhook:', error);
        res.status(500).send(`Webhook processing error: ${error.message}`);
    }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
