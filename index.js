const express = require('express');
const fetch = require('node-fetch');
const { jsPDF } = require("jspdf");
require('jspdf-autotable');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Environment Variables
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_VARIANT_ID = '43813143773238';

// --- PDF Generation Functions ---
function generateFinancialComments(farmTotals) {
    const { totalGrossIncome, farmProfitMargin } = farmTotals;
    let comments = [];
    if (totalGrossIncome <= 0) {
        comments.push("The budget shows no gross income. Please review income projections.");
    } else if (farmProfitMargin > 25) {
        comments.push("Excellent Profitability: The projected profit margin of " + farmProfitMargin.toFixed(1) + "% is strong.");
    } else if (farmProfitMargin > 10) {
        comments.push("Good Profitability: A profit margin of " + farmProfitMargin.toFixed(1) + "% is healthy.");
    } else if (farmProfitMargin > 0) {
        comments.push("Marginal Profitability: The projected profit margin is low at " + farmProfitMargin.toFixed(1) + "%. This budget is sensitive to market changes.");
    } else {
        comments.push("Projected Loss: The budget indicates a net loss. An urgent review of all cost items and income assumptions is required.");
    }
    comments.push("Disclaimer: These comments are generated automatically based on the user's inputs and are for guidance only. SEEDLINK (PTY) LTD does not provide financial advice. It is strongly recommended to consult with a professional financial advisor.");
    return comments.join('\n\n');
}

function createReportPdf(budgetData) {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const { farmName, productionRegion, farmTotals, enterpriseSummaries } = budgetData;
    const pageWidth = doc.internal.pageSize.getWidth();
    
    doc.setFontSize(22).text(farmName, pageWidth / 2, 40, { align: 'center' });
    doc.setFontSize(14).text(`Production Region: ${productionRegion}`, pageWidth / 2, 50, { align: 'center' });
    doc.setFontSize(11).setTextColor(100).text(`Report Generated: ${new Date().toLocaleDateString('en-ZA')}`, pageWidth / 2, 60, { align: 'center' });
    doc.text('Report compiled by SEEDLINK (PTY) LTD', pageWidth / 2, 65, { align: 'center' });
    
    const disclaimerText = "This budget and the related comments are based on the data provided by the user. The figures and examples are for guidance and illustrative purposes only. SEEDLINK (PTY) LTD does not provide financial advice, and farmers are strongly encouraged to consult with a professional financial advisor before making any financial decisions.";
    doc.setFontSize(8).text(doc.splitTextToSize(disclaimerText, pageWidth - 40), pageWidth / 2, 75, { align: 'center' });

    doc.autoTable({
        startY: 95,
        head: [['Overall Farm Summary', 'Total (R)']],
        body: [
            ['Total Gross Income', `R ${farmTotals.totalGrossIncome.toFixed(2)}`],
            ['Total Variable Costs', `R ${farmTotals.totalVariableCosts.toFixed(2)}`],
            ['Total Farm Net Income (Profit/Loss)', `R ${farmTotals.totalNetIncome.toFixed(2)}`],
            ['Overall Farm Profit Margin', `${farmTotals.farmProfitMargin.toFixed(2)} %`],
        ]
    });
    
    // Return PDF as a Buffer for uploading
    return Buffer.from(doc.output('arraybuffer'));
}

// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v11-final)');
});

app.post('/create-draft-order', async (req, res) => {
    // This endpoint remains the same and is working correctly.
    if (!SHOPIFY_ADMIN_ACCESS_TOKEN || !SHOPIFY_STORE_DOMAIN) {
        return res.status(500).json({ error: 'Server is not configured with Shopify credentials.' });
    }
    try {
        const { variantId, budgetData } = req.body;
        if (!variantId || !budgetData) return res.status(400).json({ error: 'Missing variantId or budgetData.' });
        const decodedDataString = Buffer.from(budgetData, 'base64').toString('utf-8');
        const lineItems = [{ variant_id: variantId, quantity: 1, properties: [{ name: "_budget_data", value: decodedDataString }] }];
        const draftOrderData = { draft_order: { line_items: lineItems } };
        const shopifyApiUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/draft_orders.json`;
        const shopifyResponse = await fetch(shopifyApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify(draftOrderData),
        });
        const responseData = await shopifyResponse.json();
        if (!shopifyResponse.ok) throw new Error(responseData.errors ? JSON.stringify(responseData.errors) : 'Failed to create draft order.');
        res.status(200).json({ invoiceUrl: responseData.draft_order.invoice_url });
    } catch (error) {
        console.error('Error in /create-draft-order:', error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});

// THIS IS THE NEW, FULLY FUNCTIONAL ENDPOINT FOR SHOPIFY FLOW
app.post('/generate-and-deliver-pdf', async (req, res) => {
    console.log("Received fulfillment request from Shopify Flow.");
    // Acknowledge the request immediately to prevent Flow from timing out
    res.sendStatus(200); 

    try {
        const orderIdGid = req.body.orderId;
        if (!orderIdGid) {
            console.error('Flow ERROR: No orderId received.');
            return;
        }

        const orderId = orderIdGid.split('/').pop();
        console.log(`Processing Order ID: ${orderId}`);

        // 1. Fetch full order details
        const orderDetailsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        const orderResponse = await fetch(orderDetailsUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN } });
        const { order: orderData } = await orderResponse.json();
        if (!orderData) throw new Error(`Could not fetch order details for ID: ${orderId}`);

        // 2. Find the correct line item and extract budget data
        const budgetLineItem = orderData.line_items.find(item => item.variant_id && item.variant_id.toString() === SHOPIFY_VARIANT_ID);
        if (!budgetLineItem) {
            console.log(`Order ${orderData.name} does not contain the budget product. Skipping.`);
            return;
        }
        const budgetProperty = budgetLineItem.properties.find(prop => prop.name === '_budget_data');
        if (!budgetProperty || !budgetProperty.value) throw new Error(`Budget data missing on order ${orderData.id}.`);
        
        const budgetData = JSON.parse(budgetProperty.value);
        console.log(`Generating PDF for order ${orderData.name}...`);
        
        // 3. Generate the PDF
        const pdfBuffer = createReportPdf(budgetData);

        // 4. Create a staged upload URL on Shopify
        const stagedUploadsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/staged_uploads.json`;
        const stagedUploadResponse = await fetch(stagedUploadsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify({ staged_uploads: [{ resource: 'FILE', filename: `FarmBudget_Order_${orderData.name}.pdf`, mime_type: 'application/pdf' }] })
        });
        const stagedUploadData = await stagedUploadResponse.json();
        const uploadTarget = stagedUploadData.staged_targets[0];
        if (!uploadTarget) throw new Error("Failed to create Shopify staged upload target.");

        // 5. Upload the PDF to the Shopify URL
        await fetch(uploadTarget.url, { method: 'PUT', body: pdfBuffer, headers: { 'Content-Type': 'application/pdf' } });
        console.log("PDF uploaded to Shopify's temporary storage.");

        // 6. Create the file record on Shopify from the uploaded file
        const fileCreateMutation = {
            query: `mutation fileCreate($files: [FileCreateInput!]!) {
                fileCreate(files: $files) {
                    files { id ... on GenericFile { url } }
                    userErrors { field message }
                }
            }`,
            variables: { files: { contentType: 'PDF', originalSource: uploadTarget.resource_url, filename: `FarmBudget_Order_${orderData.name}.pdf` } }
        };
        const fileCreateResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify(fileCreateMutation)
        });
        const fileCreateData = await fileCreateResponse.json();
        if (fileCreateData.data.fileCreate.userErrors.length > 0) {
            throw new Error(`Shopify FileCreate Error: ${fileCreateData.data.fileCreate.userErrors[0].message}`);
        }
        const fileId = fileCreateData.data.fileCreate.files[0].id;
        console.log(`PDF record created in Shopify Files. File GID: ${fileId}`);
        
        // At this point, your Digital Downloads app should be configured to automatically
        // detect the fulfillment of the product and attach this new file.
        // As a backup, we can add the file ID as a note.
        const filePermalink = `https://admin.shopify.com/store/${SHOPIFY_STORE_DOMAIN.split('.')[0]}/files/${fileId.split('/').pop()}`;
        const note = `Custom Budget PDF has been generated. Your Digital Downloads app should handle delivery. File link: ${filePermalink}`;

        const updateOrderUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        await fetch(updateOrderUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify({ order: { id: orderId, note: note } })
        });
        console.log("Process complete. Added download link as a note to the order.");

    } catch (error) {
        console.error('Error in /generate-and-deliver-pdf:', error.message);
    }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
