const express = require('express');
const fetch = require('node-fetch');
const { jsPDF } = require("jspdf");
require('jspdf-autotable');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON bodies and allow CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  next();
});
app.use(express.json({ limit: '10mb' })); // Increase payload limit for large orders

// Get Shopify credentials from environment variables
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_VARIANT_ID = '43813143773238'; 

// --- PDF Generation Helper Functions (copied from calculator) ---
function generateFinancialComments(farmTotals) {
    const { totalGrossIncome, farmProfitMargin } = farmTotals;
    let comments = [];

    if (totalGrossIncome <= 0) {
        comments.push("The budget shows no gross income, resulting in a 100% loss. Please review income projections, including yield and price, to ensure they are entered correctly.");
        return comments.join('\n\n');
    }
    if (farmProfitMargin > 25) comments.push("Excellent Profitability: The projected profit margin of " + farmProfitMargin.toFixed(1) + "% is strong. This indicates an efficient cost structure relative to the expected income.");
    else if (farmProfitMargin > 10) comments.push("Good Profitability: A profit margin of " + farmProfitMargin.toFixed(1) + "% is healthy. There may be opportunities to enhance profitability by reviewing the highest cost categories for potential savings without impacting yield.");
    else if (farmProfitMargin > 0) comments.push("Marginal Profitability: The projected profit margin is low at " + farmProfitMargin.toFixed(1) + "%. This budget is sensitive to cost increases or price decreases. It is critical to review all costs and seek efficiency gains.");
    else comments.push("Projected Loss: The budget indicates a net loss, with a profit margin of " + farmProfitMargin.toFixed(1) + "%. This is unsustainable. An urgent and thorough review of all cost items and income assumptions is required.");
    
    comments.push("Disclaimer: These comments are generated automatically based on the farmer's inputs and are for guidance only. SEEDLINK (PTY) LTD does not provide financial advice. All figures and assumptions should be verified by the user, and it is strongly recommended to consult with a professional financial advisor.");
    return comments.join('\n\n');
}

function createReportPdf(budgetResults) {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const { farmName, productionRegion, farmTotals, enterpriseSummaries } = budgetResults;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    // -- Title Page --
    doc.setFontSize(22);
    doc.text(farmName, pageWidth / 2, 40, { align: 'center' });
    doc.setFontSize(14);
    doc.text(`Production Region: ${productionRegion}`, pageWidth / 2, 50, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Report Generated: ${new Date().toLocaleDateString('en-ZA')}`, pageWidth / 2, 60, { align: 'center' });
    doc.text('Report compiled by SEEDLINK (PTY) LTD', pageWidth / 2, 65, { align: 'center' });
    
    // Disclaimer
    doc.setFontSize(8);
    const disclaimerText = "This budget and the related comments are based on the data provided by the user. The figures and examples are for guidance and illustrative purposes only. SEEDLINK (PTY) LTD does not provide financial advice, and farmers are strongly encouraged to consult with a professional financial advisor before making any financial decisions.";
    const splitDisclaimer = doc.splitTextToSize(disclaimerText, pageWidth - 40);
    doc.text(splitDisclaimer, pageWidth / 2, 75, { align: 'center' });

    // Overall Summary
    doc.autoTable({
        startY: 95,
        head: [['Overall Farm Summary', 'Total (R)']],
        body: [
            ['Total Gross Income', `R ${farmTotals.totalGrossIncome.toFixed(2)}`],
            ['Total Variable Costs', `R ${farmTotals.totalVariableCosts.toFixed(2)}`],
            { content: 'Total Farm Net Income (Profit/Loss)', styles: { fontStyle: 'bold' } },
            { content: `R ${farmTotals.totalNetIncome.toFixed(2)}`, styles: { fontStyle: 'bold' } },
            { content: 'Overall Farm Profit Margin', styles: { fontStyle: 'bold' } },
            { content: `${farmTotals.farmProfitMargin.toFixed(2)} %`, styles: { fontStyle: 'bold' } },
        ],
        columnStyles: { 0: { cellWidth: 100 }, 1: { halign: 'right' } },
    });
    
    // Enterprise Details
    enterpriseSummaries.forEach(summary => {
        doc.addPage();
        doc.setFontSize(16);
        doc.text(`Enterprise Details: ${summary.name}`, 14, 20);
        doc.autoTable({ startY: 30, head: [['Item', 'Value']], body: [
            [summary.areaLabel, summary.area.toFixed(2)],
            ['Gross Income', `R ${summary.grossIncome.toFixed(2)}`],
            ['Total Variable Costs', `R ${summary.variableCosts.toFixed(2)}`],
            [`Variable Costs ${summary.unitLabel}`, `R ${summary.costsPerUnit.toFixed(2)}`],
            { content: 'Net Income (Profit/Loss)', styles: { fontStyle: 'bold' } },
            { content: `R ${summary.netIncome.toFixed(2)}`, styles: { fontStyle: 'bold' } },
            { content: 'Profit Margin', styles: { fontStyle: 'bold' } },
            { content: `${summary.profitMargin.toFixed(2)} %`, styles: { fontStyle: 'bold' } },
        ]});
    });

    // Financial Comments
    const comments = generateFinancialComments(farmTotals);
    doc.addPage();
    doc.setFontSize(16);
    doc.text('General Financial Comments', 14, 20);
    doc.setFontSize(10);
    doc.text(comments, 14, 30, { maxWidth: pageWidth - 28, align: 'justify' });

    // Return PDF as a Base64 string
    return doc.output('datauristring').split(',')[1];
}

// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v6)');
});

app.post('/generate-and-deliver-pdf', async (req, res) => {
    console.log("Received fulfillment request from Shopify Flow.");
    // Acknowledge the request immediately to prevent Flow from timing out
    res.sendStatus(200); 

    try {
        const orderId = req.body.orderId;
        if (!orderId) {
            console.error('No orderId received from Flow.');
            return;
        }

        // Fetch the full order details from Shopify
        const orderDetailsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        const orderResponse = await fetch(orderDetailsUrl, {
            headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
        });
        const { order: orderData } = await orderResponse.json();

        if (!orderData) {
            console.error(`Could not fetch order details for order ID: ${orderId}`);
            return;
        }

        const budgetLineItem = orderData.line_items.find(item => item.variant_id && item.variant_id.toString() === SHOPIFY_VARIANT_ID);
        if (!budgetLineItem) {
            console.log(`Order ${orderId} does not contain the budget product. Skipping.`);
            return;
        }

        const budgetProperty = budgetLineItem.properties.find(prop => prop.name === '_budget_data');
        if (!budgetProperty || !budgetProperty.value) {
            console.error(`Budget data missing on line item for order ${orderId}.`);
            return;
        }

        const budgetData = JSON.parse(budgetProperty.value);
        
        // --- Generate the PDF ---
        console.log(`Generating PDF for order ${orderData.name}...`);
        const pdfBase64 = createReportPdf(budgetData);

        // --- Upload PDF to Shopify Files ---
        console.log("Creating file upload URL on Shopify...");
        const createUploadUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/files.json`;
        const fileUploadResponse = await fetch(createUploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify({
                files: [{
                    filename: `FarmBudget_Order_${orderData.name}.pdf`,
                    mimeType: 'application/pdf',
                    resource: 'FILE'
                }]
            })
        });

        const fileUploadData = await fileUploadResponse.json();
        const uploadUrl = fileUploadData.files[0].url;
        
        if (!uploadUrl) {
            throw new Error("Failed to get Shopify file upload URL.");
        }
        
        console.log("Uploading PDF to Shopify...");
        await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/pdf' },
            body: Buffer.from(pdfBase64, 'base64')
        });

        const fileGid = fileUploadData.files[0].id;
        console.log(`PDF uploaded successfully. File GID: ${fileGid}`);

        // --- Attach the file to the order fulfillment using metafields ---
        console.log(`Attaching file to order ${orderId}...`);
        const attachFileMutation = {
          query: `mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
              fulfillment { id }
              userErrors { field message }
            }
          }`,
          variables: {
            fulfillment: {
              lineItemsByFulfillmentOrder: [{
                  fulfillmentOrderId: orderData.fulfillment_orders[0].id,
              }],
              notifyCustomer: true,
              trackingInfo: { company: "Digital Download" },
              // This is where you would attach if the digital downloads app supports it
              // For now, we will rely on the app to detect the product
            }
          }
        };

        const fulfillmentResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify(attachFileMutation)
        });
        const fulfillmentData = await fulfillmentResponse.json();
        
        if (fulfillmentData.errors || fulfillmentData.data.fulfillmentCreateV2.userErrors.length > 0) {
            console.error("Error attaching file to fulfillment:", JSON.stringify(fulfillmentData, null, 2));
        } else {
            console.log("Successfully created fulfillment and notified customer.");
        }
        
    } catch (error) {
        console.error('Error in /generate-and-deliver-pdf:', error.message);
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
