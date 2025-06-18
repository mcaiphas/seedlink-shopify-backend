const express = require('express');
const fetch = require('node-fetch');
const { jsPDF } = require("jspdf");
require('jspdf-autotable');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- CONFIGURATION & DATA ---
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_VARIANT_ID = '43813143773238'; 

const costCategories = [
    { id: "land_prep", name: "Land Preparation / Camp Maintenance" }, 
    { id: "seed", name: "Seed/Planting Material" }, 
    { id: "fertilizer", name: "Fertilizer (Incl. Manure/Compost)" },
    { id: "chemicals", name: "Chemicals (Pesticides, Herbicides, etc.)" }, 
    { id: "irrigation", name: "Irrigation (Energy, Water, Maintenance)" },
    { id: "livestock_purchase", name: "Breeding Stock/Young Animals Purchase" },
    { id: "feed", name: "Feed Costs" },
    { id: "vet_medication", name: "Veterinary, Medication & Health" },
    { id: "housing_bedding", name: "Housing, Bedding & Kraal Maintenance" },
    { id: "labour", name: "Labour (Casual & Permanent Allocation)" },
    { id: "machinery_fuel_repairs", name: "Machinery, Fuel, Oil & Repairs" },
    { id: "transport_marketing", name: "Transport & Marketing" },
    { id: "other_variable", name: "Other Variable Costs" }
];


// --- SERVER-SIDE CALCULATION ENGINE ---
function recalculateBudgetFromServer(budgetData) {
    let farmTotalVariableCosts = 0;
    let farmTotalGrossIncome = 0;
    const aggregatedCosts = {};
    let enterpriseSummaries = [];

    budgetData.enterprises.forEach(enterprise => {
        let totalVariableCostsPerUnitOrBatch = 0;
        Object.values(enterprise.costs).forEach(categoryItems => {
            categoryItems.forEach(item => {
                totalVariableCostsPerUnitOrBatch += item.total || 0;
            });
        });

        const totalVariableCostsEnterprise = totalVariableCostsPerUnitOrBatch * enterprise.area;
        
        Object.keys(enterprise.costs).forEach(catId => {
            if (!aggregatedCosts[catId]) aggregatedCosts[catId] = 0;
            enterprise.costs[catId].forEach(item => {
                 aggregatedCosts[catId] += (item.total || 0) * enterprise.area;
            });
        });

        const totalExpectedProduction = enterprise.area * enterprise.expectedYieldPerUnit;
        const grossIncomeEnterprise = totalExpectedProduction * enterprise.expectedPrice;
        const netIncomeEnterprise = grossIncomeEnterprise - totalVariableCostsEnterprise;
        const profitMarginEnterprise = (grossIncomeEnterprise !== 0) ? (netIncomeEnterprise / grossIncomeEnterprise) * 100 : 0;

        enterpriseSummaries.push({
            name: enterprise.name,
            areaLabel: enterprise.type === 'crop' ? 'Area (ha)' : `Number of ${enterprise.unit}`,
            area: enterprise.area,
            grossIncome: grossIncomeEnterprise,
            variableCosts: totalVariableCostsEnterprise,
            costsPerUnit: enterprise.area > 0 ? (totalVariableCostsEnterprise / enterprise.area) : 0,
            netIncome: netIncomeEnterprise,
            profitMargin: profitMarginEnterprise,
            unitLabel: `per ${enterprise.unit}`,
            costs: enterprise.costs
        });

        farmTotalVariableCosts += totalVariableCostsEnterprise;
        farmTotalGrossIncome += grossIncomeEnterprise;
    });

    const farmTotalNetIncome = farmTotalGrossIncome - farmTotalVariableCosts;
    const farmProfitMargin = (farmTotalGrossIncome !== 0) ? (farmTotalNetIncome / farmTotalGrossIncome) * 100 : 0;

    return {
        farmName: budgetData.farmName,
        productionRegion: budgetData.productionRegion,
        farmTotals: {
            totalVariableCosts: farmTotalVariableCosts,
            totalGrossIncome: farmTotalGrossIncome,
            totalNetIncome: farmTotalNetIncome,
            farmProfitMargin: farmProfitMargin,
        },
        aggregatedCosts,
        enterpriseSummaries
    };
}


// --- PDF GENERATION FUNCTIONS ---
function generateFinancialComments(farmTotals) {
    // ... (This function remains the same as before)
}
function createReportPdf(budgetResults) {
    // ... (This function remains the same as before)
}


// --- API ENDPOINTS ---
app.get('/', (req, res) => {
  res.send('Seedlink Shopify Backend is running and ready. (v12-final)');
});

app.post('/create-draft-order', async (req, res) => {
    // ... (This endpoint remains the same as before)
});

// UPDATED ENDPOINT FOR SHOPIFY FLOW
app.post('/generate-and-deliver-pdf', async (req, res) => {
    console.log("Received fulfillment request from Shopify Flow.");
    res.sendStatus(200); 

    try {
        const orderIdGid = req.body.orderId;
        if (!orderIdGid) throw new Error('Flow ERROR: No orderId received.');

        const orderId = orderIdGid.split('/').pop();
        console.log(`Processing Order ID: ${orderId}`);

        const orderDetailsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`;
        const orderResponse = await fetch(orderDetailsUrl, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN } });
        const { order: orderData } = await orderResponse.json();
        if (!orderData) throw new Error(`Could not fetch order details for ID: ${orderId}`);

        const budgetLineItem = orderData.line_items.find(item => item.variant_id && item.variant_id.toString() === SHOPIFY_VARIANT_ID);
        if (!budgetLineItem) {
            console.log(`Order ${orderData.name} does not contain the budget product. Skipping.`);
            return;
        }

        const budgetProperty = budgetLineItem.properties.find(prop => prop.name === '_budget_data');
        if (!budgetProperty || !budgetProperty.value) throw new Error(`Budget data missing on order ${orderData.id}.`);
        
        const rawBudgetData = JSON.parse(budgetProperty.value);
        
        // ** NEW STEP: Recalculate all totals on the server **
        const finalBudgetData = recalculateBudgetFromServer(rawBudgetData);
        
        console.log(`Generating PDF for order ${orderData.name}...`);
        const pdfBuffer = createReportPdf(finalBudgetData); // Use the recalculated data

        // Upload and delivery logic...
        console.log("Creating file upload URL on Shopify...");
        const stagedUploadsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/staged_uploads.json`;
        const stagedUploadResponse = await fetch(stagedUploadsUrl, { /* ... */ });
        // ... rest of the upload and delivery logic ...
        
    } catch (error) {
        console.error('Error in /generate-and-deliver-pdf:', error.message);
    }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;

