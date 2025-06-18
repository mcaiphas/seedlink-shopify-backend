const express = require('express');
const fetch = require('node-fetch');
const { jsPDF } = require("jspdf");
require('jspdf-autotable');
const cors = require('cors'); // Import the cors package

const app = express();
const PORT = process.env.PORT || 3000;

// Use the cors middleware to handle all CORS issues
app.use(cors());

// Middleware to parse incoming JSON bodies
app.use(express.json({ limit: '10mb' })); 


// Get Shopify credentials from environment variables
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_VARIANT_ID = '43813143773238'; 

// --- PDF Generation Helper Functions ---
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
    
    const costRatio = (farmTotals.totalVariableCosts / totalGrossIncome) * 100;
    comments.push("Cost Structure: Variable costs make up " + costRatio.toFixed(1) + "% of the total gross income. Understanding which enterprises or cost categories contribute most to this figure is key to managing financial risk.");
    comments.push("Disclaimer: These comments are generated automatically based on the farmer's inputs and are for guidance only. SEEDLINK (PTY) LTD does not provide financial advice. All figures and assumptions should be verified by the user, and it is strongly recommended to consult with a professional financial advisor.");
    return comments.join('\n\n');
}

function createReportPdf(budgetData) {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const { farmName, productionRegion, farmTotals, enterpriseSummaries } = budgetData;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(22);
    doc.text(farmName, pageWidth / 2, 40, { align: 'center' });
    doc.setFontSize(14);
    doc.text(`Production Region: ${productionRegion}`, pageWidth / 2, 50, { align: 'center' });
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Report Generated: ${new Date().toLocaleDateString('en-ZA')}`, pageWidth / 2, 60, { align: 'center' });
    doc.text('Report compiled by SEEDLINK (PTY) LTD', pageWidth / 2, 65, { align: 'center' });
    
    doc.setFontSize(8);
    const disclaimerText = "This budget and the related comments are based on the data provided by the user. The figures and examples are for guidance and illustrative purposes only. SEEDLINK (PTY) LTD does not provide financial advice, and farmers are strongly encouraged to consult with a professional financial advisor before making any financial decisions.";
    const splitDisclaimer = doc.splitTextToSize(disclaimerText, pageWidth - 40);
    doc.text(splitDisclaimer, pageWidth / 2, 75, { align: 'center' });

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
    
    enterpriseSummaries.forEach(summary => {
        doc.addPage();
        doc.setFontSize(16);
        doc.text(`Enterprise Details: ${summary.name}`, 14, 20);
        doc.autoTable({ startY: 30, head: [['Item', 'Value']], body: [
            [summary.areaLabel, summary.area.toFixed(2)],
            ['Gross Income', `R ${summary.grossIncome.toFixed(2)}`],
            ['Total Variable Costs', `R ${summary.variableCosts.toFixed(2)}`],
            [`Variable Costs ${summary.unitLabel}`, `R ${summary.costsPerUnit.toFixed(2)}`],
            ['Net Income (Profit/Loss)', `R ${summary.netIncome.toFixed(2)}`],
            ['Profit Margin', `${summary.profitMargin.toFixed(2)} %`],
        ]});
    });

    const comments = generateFinancialComments(farmTotals);
    doc.addPage();
    doc.setFontSize(16);
    doc.text('General Financial Comments', 14, 20);
    doc.setFontSize(10);
    doc.text(comments, 14, 30, { maxWidth: pageWidth - 28, align: 'justify' });

    return doc.output('arraybuffer');
}

// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v9)');
});

app.post('/create-draft-order', async (req, res) => {
    // ... (This function remains the same as before)
});

app.post('/generate-and-deliver-pdf', async (req, res) => {
    console.log("Received fulfillment request from Shopify Flow.");
    res.sendStatus(200); // Acknowledge immediately

    try {
        const orderIdGid = req.body.order.id;
        if (!orderIdGid) {
            console.error('No order.id received from Flow.');
            return;
        }

        const orderId = orderIdGid.split('/').pop();

        const orderDetailsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json?fields=id,name,line_items,fulfillment_orders`;
        const orderResponse = await fetch(orderDetailsUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN } });
        const { order: orderData } = await orderResponse.json();

        const budgetLineItem = orderData.line_items.find(item => item.variant_id && item.variant_id.toString() === SHOPIFY_VARIANT_ID);
        if (!budgetLineItem) {
            console.log(`Order ${orderData.name} does not contain the budget product. Skipping.`);
            return;
        }

        const budgetProperty = budgetLineItem.properties.find(prop => prop.name === '_budget_data');
        if (!budgetProperty || !budgetProperty.value) {
            throw new Error(`Budget data missing on line item for order ${orderData.id}.`);
        }

        const budgetData = JSON.parse(budgetProperty.value);
        console.log(`Generating PDF for order ${orderData.name}...`);
        const pdfArrayBuffer = createReportPdf(budgetData);
        
        console.log("Uploading PDF to Shopify Files...");
        const fileName = `FarmBudget_Order_${orderData.name}.pdf`;

        const uploadMutation = {
            query: `mutation fileCreate($files: [FileCreateInput!]!) {
                fileCreate(files: $files) {
                    files { id ... on GenericFile { url } }
                    userErrors { field message }
                }
            }`,
            variables: { files: { contentType: 'PDF', originalSource: '', filename: fileName } }
        };
        
        const uploadResponse = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify(uploadMutation),
        });

        const uploadData = await uploadResponse.json();
        if (uploadData.data.fileCreate.userErrors.length > 0) {
            throw new Error(`Shopify FileCreate Error: ${uploadData.data.fileCreate.userErrors[0].message}`);
        }

        const signedUploadUrl = uploadData.data.fileCreate.files[0].url;
        const fileGid = uploadData.data.fileCreate.files[0].id;
        
        await fetch(signedUploadUrl, { method: 'PUT', body: pdfArrayBuffer, headers: { 'Content-Type': 'application/pdf' } });
        console.log(`PDF uploaded successfully. File GID: ${fileGid}`);
        
        // This is where you would call your Digital Download App's API
        // For now, we add it as a note to the order for manual fulfillment
        const note = `Custom Budget PDF generated. Download Link (internal): ${filePermalink}`;
        const updateOrderUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        await fetch(updateOrderUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN },
            body: JSON.stringify({ order: { id: orderId, note: note } })
        });
        console.log("Added download link as a note to the order for manual fulfillment.");

    } catch (error) {
        console.error('Error processing fulfillment webhook:', error.message);
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
