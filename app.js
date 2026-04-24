import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, getDocs, where } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

// --- DOM Elements ---
const navLinks = document.querySelectorAll('.nav-link');
const pageSections = document.querySelectorAll('.page-section');
const pageTitle = document.getElementById('page-title');

// Stats
const statTotalProducts = document.getElementById('stat-total-products');
const statTotalStock = document.getElementById('stat-total-stock');
const statLowStock = document.getElementById('stat-low-stock');
const statCriticalStock = document.getElementById('stat-critical-stock');
const statOutOfStock = document.getElementById('stat-out-of-stock');
const statSalesToday = document.getElementById('stat-sales-today');
const statNearExpiry = document.getElementById('stat-near-expiry');
const statExpired = document.getElementById('stat-expired');
const statTotalRevenue = document.getElementById('stat-total-revenue');
const statTotalCost = document.getElementById('stat-total-cost');
const statTotalProfit = document.getElementById('stat-total-profit');
const statTotalLoss = document.getElementById('stat-total-loss');

// Formatting
const formatINR = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

function getExpiryStatus(expiryDateStr) {
    if (!expiryDateStr) return { status: 'Unknown', badge: 'badge-warning', daysLeft: 999 };
    const expDate = new Date(expiryDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { status: 'Expired', badge: 'badge-danger', daysLeft: diffDays };
    if (diffDays <= 30) return { status: 'Expiring Soon', badge: 'badge-warning', daysLeft: diffDays };
    return { status: 'Safe', badge: 'badge-success', daysLeft: diffDays };
}

function getStockLevel(qty, lowLimit) {
    if (qty <= 0) return 'OUT_OF_STOCK';
    if (qty <= 5) return 'CRITICAL';
    if (qty <= lowLimit) return 'LOW';
    return 'IN_STOCK';
}

// Forms
const addProductForm = document.getElementById('add-product-form');
const recordSaleForm = document.getElementById('record-sale-form');

// Tables & Feeds
const inventoryTbody = document.getElementById('inventory-tbody');
const searchInventory = document.getElementById('search-inventory');
const saleProductDropdown = document.getElementById('sale-product');
const saleCurrentStock = document.getElementById('sale-current-stock');
const saleQtyInput = document.getElementById('sale-qty');
const alertsFeed = document.getElementById('alerts-feed');
const salesFeed = document.getElementById('sales-feed');

// Modals
const editModal = document.getElementById('edit-modal');
const closeEditModalBtn = document.querySelector('.close-modal');
const editProductForm = document.getElementById('edit-product-form');

// --- Application State ---
let products = [];
let sales = [];
let alerts = [];
let salesChart = null;
let profitLossChart = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initRealtimeListeners();
    initForms();
    initModals();
});

// --- Toast System ---
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Navigation ---
function initNavigation() {
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');

            // Update Active Link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update Page Title
            pageTitle.textContent = link.textContent.replace(/[^\x00-\x7F]/g, "").trim(); // Remove emoji

            // Show Target Section
            pageSections.forEach(sec => sec.classList.add('hidden'));
            document.getElementById(targetId).classList.remove('hidden');

            // Refresh chart if navigating to analytics
            if (targetId === 'analytics-section' && salesChart) {
                salesChart.update();
            }
        });
    });
}

// --- Real-time Listeners ---
function initRealtimeListeners() {
    // 1. Products Listener
    const qProducts = query(collection(db, "products"), orderBy("createdAt", "desc"));
    onSnapshot(qProducts, (snapshot) => {
        products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderInventoryTable();
        updateDashboardStats();
        updateSaleDropdown();
        generateAlerts();
    }, (error) => {
        console.error("Error listening to products:", error);
        showToast("Error connecting to database", "error");
    });

    // 2. Sales Listener
    const qSales = query(collection(db, "sales"), orderBy("soldAt", "desc"));
    onSnapshot(qSales, (snapshot) => {
        sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderSalesFeed();
        updateDashboardStats();
        renderAnalytics();
    });

    // 3. Alerts Listener
    const qAlerts = query(collection(db, "alerts"), orderBy("createdAt", "desc"));
    onSnapshot(qAlerts, (snapshot) => {
        alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAlertsFeed();
    });
}

// --- Forms & Inputs ---
function initForms() {
    // Add Product
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save-product');
        btn.disabled = true;
        btn.textContent = "Saving...";

        const newProduct = {
            productName: document.getElementById('prod-name').value,
            sku: document.getElementById('prod-sku').value,
            category: document.getElementById('prod-category').value,
            costPrice: parseFloat(document.getElementById('prod-cost').value) || 0,
            price: parseFloat(document.getElementById('prod-price').value) || 0,
            quantity: parseInt(document.getElementById('prod-qty').value) || 0,
            lowStockLimit: parseInt(document.getElementById('prod-threshold').value) || 0,
            manufactureDate: document.getElementById('prod-mfg-date').value,
            expiryDate: document.getElementById('prod-expiry-date').value,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        try {
            await addDoc(collection(db, "products"), newProduct);
            showToast("Product added successfully!");
            addProductForm.reset();
            // Switch back to inventory
            document.querySelector('[data-target="inventory-section"]').click();
        } catch (error) {
            console.error("Error adding product:", error.message || error);
            showToast("Failed to add product. Check console.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Product";
        }
    });

    // Record Sale
    saleProductDropdown.addEventListener('change', (e) => {
        const prodId = e.target.value;
        const product = products.find(p => p.id === prodId);
        if (product) {
            saleCurrentStock.value = product.quantity;
            saleQtyInput.max = product.quantity;
            document.getElementById('sale-price').value = product.price;
        } else {
            saleCurrentStock.value = "-";
            document.getElementById('sale-price').value = "";
        }
    });

    recordSaleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-record-sale');

        const productId = saleProductDropdown.value;
        const qtySold = parseInt(saleQtyInput.value);
        const salePrice = parseFloat(document.getElementById('sale-price').value);

        if (!productId) {
            showToast("Please select a product.", "warning");
            return;
        }

        const product = products.find(p => p.id === productId);
        if (!product || product.quantity < qtySold) {
            showToast("Insufficient stock for this sale.", "error");
            return;
        }

        if (isNaN(salePrice) || salePrice < 0) {
            showToast("Invalid sale price.", "error");
            return;
        }

        const expiryInfo = getExpiryStatus(product.expiryDate);
        if (expiryInfo.status === 'Expired') {
            showToast("Cannot sell expired product.", "error");
            return;
        }

        const currentLvl = getStockLevel(product.quantity, product.lowStockLimit);
        const postSaleQty = product.quantity - qtySold;
        const postSaleLvl = getStockLevel(postSaleQty, product.lowStockLimit);

        if (postSaleLvl !== 'IN_STOCK' && postSaleLvl !== currentLvl) {
            let lvlName = postSaleLvl.replace(/_/g, ' ');
            showToast(`Sale caused ${product.productName} to enter ${lvlName} level`, "warning");
        }

        btn.disabled = true;
        btn.textContent = "Processing...";

        try {
            const totalRevenue = salePrice * qtySold;
            const totalCost = (product.costPrice || 0) * qtySold;
            const profitLoss = totalRevenue - totalCost;

            const saleRecord = {
                productId: product.id,
                productName: product.productName,
                quantitySold: qtySold,
                salePrice: salePrice,
                totalRevenue: totalRevenue,
                totalCost: totalCost,
                profitLoss: profitLoss,
                soldAt: new Date()
            };
            await addDoc(collection(db, "sales"), saleRecord);

            if (salePrice < (product.costPrice || 0)) {
                await addDoc(collection(db, "alerts"), {
                    productId: product.id,
                    productName: product.productName,
                    alertType: 'LOSS_WARNING',
                    alertLevel: 'WARNING',
                    message: `Loss Warning: ${product.productName} sold below cost price.`,
                    createdAt: new Date(),
                    resolved: false
                });
                showToast(`Loss Warning: Product sold below cost price`, "warning");
            }

            // 2. Reduce Product Stock
            const prodRef = doc(db, "products", product.id);
            await updateDoc(prodRef, {
                quantity: product.quantity - qtySold,
                updatedAt: new Date()
            });

            showToast("Sale recorded successfully!");
            recordSaleForm.reset();
            saleCurrentStock.value = "-";
        } catch (error) {
            console.error("Error recording sale:", error);
            showToast("Failed to record sale.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Confirm Sale";
        }
    });

    // Search Inventory
    searchInventory.addEventListener('input', (e) => {
        renderInventoryTable(e.target.value);
    });
}

function initModals() {
    closeEditModalBtn.addEventListener('click', () => editModal.classList.add('hidden'));

    // Close modal if clicked outside
    window.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.classList.add('hidden');
        }
    });

    // Handle Stock Update
    editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-prod-id').value;
        const newQty = parseInt(document.getElementById('edit-prod-qty').value);
        const btn = editProductForm.querySelector('button[type="submit"]');

        btn.disabled = true;
        btn.textContent = "Updating...";

        try {
            await updateDoc(doc(db, "products", id), {
                quantity: newQty,
                updatedAt: serverTimestamp()
            });
            showToast("Stock updated successfully!");
            editModal.classList.add('hidden');
        } catch (error) {
            console.error("Error updating stock:", error);
            showToast("Failed to update stock.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Update Stock";
        }
    });
}

// --- Logic & Render Functions ---

function renderInventoryTable(searchTerm = "") {
    inventoryTbody.innerHTML = "";

    const term = searchTerm.toLowerCase();
    const filteredProducts = products.filter(p =>
        (p.productName || '').toLowerCase().includes(term) ||
        (p.sku || '').toLowerCase().includes(term) ||
        (p.category || '').toLowerCase().includes(term)
    );

    if (filteredProducts.length === 0) {
        inventoryTbody.innerHTML = `<tr><td colspan="7" class="text-center empty-state">No products found.</td></tr>`;
        return;
    }

    filteredProducts.forEach(product => {
        const tr = document.createElement('tr');

        const stockLevel = getStockLevel(product.quantity, product.lowStockLimit);
        let statusBadge = `<span class="badge badge-success">In Stock</span>`;
        if (stockLevel === 'OUT_OF_STOCK') {
            statusBadge = `<span class="badge badge-out-of-stock">Out of Stock</span>`;
        } else if (stockLevel === 'CRITICAL') {
            statusBadge = `<span class="badge badge-critical">Critical</span>`;
        } else if (stockLevel === 'LOW') {
            statusBadge = `<span class="badge badge-warning">Low Stock</span>`;
        }

        const expiryInfo = getExpiryStatus(product.expiryDate);
        let expiryBadge = `<span class="badge ${expiryInfo.badge}">${expiryInfo.status}</span>`;

        tr.innerHTML = `
            <td><strong>${product.sku}</strong></td>
            <td>${product.productName}</td>
            <td>${product.category}</td>
            <td>${formatINR(product.price)}</td>
            <td><strong>${product.quantity}</strong></td>
            <td>${product.manufactureDate || '-'}</td>
            <td>${product.expiryDate || '-'}</td>
            <td>${expiryBadge}</td>
            <td>${statusBadge}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-primary btn-edit" data-id="${product.id}" data-qty="${product.quantity}">Edit Stock</button>
                <button class="btn btn-sm btn-danger btn-delete" data-id="${product.id}">Delete</button>
            </td>
        `;
        inventoryTbody.appendChild(tr);
    });

    // Attach Event Listeners to dynamic buttons
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const qty = e.target.getAttribute('data-qty');
            document.getElementById('edit-prod-id').value = id;
            document.getElementById('edit-prod-qty').value = qty;
            editModal.classList.remove('hidden');
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if (confirm("Are you sure you want to delete this product?")) {
                try {
                    await deleteDoc(doc(db, "products", id));
                    showToast("Product deleted.");
                } catch (error) {
                    showToast("Failed to delete product.", "error");
                }
            }
        });
    });
}

function updateSaleDropdown() {
    // Save current selection if exists
    const currentVal = saleProductDropdown.value;

    saleProductDropdown.innerHTML = `<option value="" disabled selected>Select Product...</option>`;
    products.forEach(p => {
        if (p.quantity > 0) {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = `${p.productName} (Stock: ${p.quantity}) - ${formatINR(p.price)}`;
            saleProductDropdown.appendChild(option);
        }
    });

    if (currentVal && products.find(p => p.id === currentVal && p.quantity > 0)) {
        saleProductDropdown.value = currentVal;
    }
}

function updateDashboardStats() {
    statTotalProducts.textContent = products.length;

    const totalStock = products.reduce((sum, p) => sum + p.quantity, 0);
    statTotalStock.textContent = totalStock;

    let lowCount = 0;
    let criticalCount = 0;
    let outOfStockCount = 0;

    products.forEach(p => {
        const level = getStockLevel(p.quantity, p.lowStockLimit);
        if (level === 'LOW') lowCount++;
        if (level === 'CRITICAL') criticalCount++;
        if (level === 'OUT_OF_STOCK') outOfStockCount++;
    });

    if (statLowStock) statLowStock.textContent = lowCount;
    if (statCriticalStock) statCriticalStock.textContent = criticalCount;
    if (statOutOfStock) statOutOfStock.textContent = outOfStockCount;

    // Calculate today's sales and P&L
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailySalesTotal = 0;
    let totalRevenue = 0;
    let totalCostAmt = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    sales.forEach(sale => {
        if(sale.totalRevenue) totalRevenue += sale.totalRevenue;
        if(sale.totalCost) totalCostAmt += sale.totalCost;
        if(sale.profitLoss > 0) totalProfit += sale.profitLoss;
        if(sale.profitLoss < 0) totalLoss += Math.abs(sale.profitLoss);

        if (sale.soldAt && sale.soldAt.toDate) {
            const saleDate = sale.soldAt.toDate();
            if (saleDate >= today) {
                dailySalesTotal += (sale.totalRevenue || sale.totalAmount || 0);
            }
        }
    });
    statSalesToday.textContent = formatINR(dailySalesTotal);

    if (statTotalRevenue) statTotalRevenue.textContent = formatINR(totalRevenue);
    if (statTotalCost) statTotalCost.textContent = formatINR(totalCostAmt);
    if (statTotalProfit) statTotalProfit.textContent = formatINR(totalProfit);
    if (statTotalLoss) statTotalLoss.textContent = formatINR(totalLoss);

    let nearExpiryCount = 0;
    let expiredCount = 0;
    products.forEach(p => {
        if (p.quantity > 0) {
            const exp = getExpiryStatus(p.expiryDate);
            if (exp.status === 'Expiring Soon') nearExpiryCount++;
            if (exp.status === 'Expired') expiredCount++;
        }
    });
    if (statNearExpiry) statNearExpiry.textContent = nearExpiryCount;
    if (statExpired) statExpired.textContent = expiredCount;
}

async function generateAlerts() {
    for (const p of products) {
        
        // 1. Stock Escalation Alerts
        const currentLevel = getStockLevel(p.quantity, p.lowStockLimit);
        const isAlertable = ['LOW', 'CRITICAL', 'OUT_OF_STOCK'].includes(currentLevel);
        
        // Find ANY active stock alert for this product
        const existingStockAlerts = alerts.filter(a => a.productId === p.id && !a.resolved && ['LOW', 'CRITICAL', 'OUT_OF_STOCK'].includes(a.alertLevel));
        
        let shouldAlert = false;

        if (isAlertable) {
            if (existingStockAlerts.length === 0) {
                shouldAlert = true;
            } else {
                // If there's an existing alert, check if the quantity has changed
                const latestAlert = existingStockAlerts[0];
                if (latestAlert.lastAlertQty !== p.quantity) {
                    shouldAlert = true;
                    // Resolve ALL old stock alerts for this product to prevent duplicates
                    for (const a of existingStockAlerts) {
                        await updateDoc(doc(db, "alerts", a.id), { resolved: true, updatedAt: new Date() });
                    }
                }
            }
        } else {
            // Not alertable (IN_STOCK), but has alerts? Resolve them!
            if (existingStockAlerts.length > 0) {
                for (const a of existingStockAlerts) {
                    await updateDoc(doc(db, "alerts", a.id), { resolved: true, updatedAt: new Date() });
                }
            }
        }

        if (shouldAlert) {
            let msg = '';
            if (currentLevel === 'OUT_OF_STOCK') msg = `Out of Stock: ${p.productName} unavailable`;
            else if (currentLevel === 'CRITICAL') msg = `Critical Stock: ${p.productName} only ${p.quantity} units remaining`;
            else if (currentLevel === 'LOW') msg = `Low Stock: ${p.productName} has ${p.quantity} units remaining`;

            await addDoc(collection(db, "alerts"), {
                productId: p.id,
                productName: p.productName,
                alertType: 'STOCK_ALERT',
                alertLevel: currentLevel,
                lastAlertQty: p.quantity,
                message: msg,
                createdAt: new Date(),
                resolved: false
            });
            showToast(msg, "warning");
        }

        // 2. Expiry Alert
        const expInfo = getExpiryStatus(p.expiryDate);
        if (expInfo.status === 'Expiring Soon' || expInfo.status === 'Expired') {
            const existingExpiry = alerts.find(a => a.productId === p.id && a.alertType === 'EXPIRY_WARNING' && !a.resolved);
            if (!existingExpiry) {
                let msg = expInfo.status === 'Expired'
                    ? `${p.productName} has expired!`
                    : `${p.productName} expires in ${expInfo.daysLeft} days.`;
                await addDoc(collection(db, "alerts"), {
                    productId: p.id,
                    productName: p.productName,
                    alertType: 'EXPIRY_WARNING',
                    message: msg,
                    createdAt: new Date(),
                    resolved: false
                });
                showToast(`Expiry Alert: ${p.productName}`, "warning");
            }
        } else {
            const activeExpiry = alerts.filter(a => a.productId === p.id && a.alertType === 'EXPIRY_WARNING' && !a.resolved);
            for (const a of activeExpiry) {
                await updateDoc(doc(db, "alerts", a.id), { resolved: true, updatedAt: new Date() });
            }
        }
    }
}


alertsFeed.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-clear-alert')) {
        const alertId = e.target.getAttribute('data-id');
        try {
            await updateDoc(doc(db, "alerts", alertId), { 
                resolved: true, 
                updatedAt: serverTimestamp() 
            });
            showToast("Alert cleared");
        } catch(err) {
            console.error("Error clearing alert:", err);
            showToast("Failed to clear alert", "error");
        }
    }
});

function renderAlertsFeed() {
    alertsFeed.innerHTML = "";
    // Only show unresolved
    const activeAlerts = alerts.filter(a => !a.resolved).slice(0, 5);

    if (activeAlerts.length === 0) {
        alertsFeed.innerHTML = `<li class="empty-state">All good! No active alerts.</li>`;
        return;
    }

    activeAlerts.forEach(a => {
        const timeStr = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
        
        let icon = '⚠️';
        let style = '';
        if (a.alertLevel === 'CRITICAL') { icon = '🚨'; style = 'color: #dc2626; font-weight: bold;'; }
        else if (a.alertLevel === 'OUT_OF_STOCK') { icon = '⛔'; style = 'color: #7f1d1d; font-weight: bold;'; }
        else if (a.alertType === 'EXPIRY_WARNING') { icon = '⏳'; style = 'color: #d97706;'; }
        else if (a.alertLevel === 'LOW') { icon = '⚠️'; style = 'color: #d97706;'; }

        alertsFeed.innerHTML += `
            <li>
                <span style="${style}">${icon} ${a.message}</span>
                <div>
                    <span class="activity-time">${timeStr}</span>
                    <button class="btn-clear-alert" data-id="${a.id}">Clear</button>
                </div>
            </li>
        `;
    });
}

function renderSalesFeed() {
    salesFeed.innerHTML = "";
    const recentSales = sales.slice(0, 5); // Take top 5 recent (since it's ordered desc)

    if (recentSales.length === 0) {
        salesFeed.innerHTML = `<li class="empty-state">No recent sales.</li>`;
        return;
    }

    recentSales.forEach(s => {
        const timeStr = s.soldAt && s.soldAt.toDate ? s.soldAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
        
        let plString = '';
        if (s.profitLoss > 0) plString = `<span class="text-success">Profit ${formatINR(s.profitLoss)}</span>`;
        else if (s.profitLoss < 0) plString = `<span class="text-danger">Loss ${formatINR(Math.abs(s.profitLoss))}</span>`;
        else if (s.profitLoss === 0) plString = `<span>Break-even</span>`;

        const revenue = s.totalRevenue || s.totalAmount || 0;

        salesFeed.innerHTML += `
            <li>
                <span>🛒 Sold ${s.quantitySold}x ${s.productName} | Revenue ${formatINR(revenue)} | ${plString}</span>
                <span class="activity-time">${timeStr}</span>
            </li>
        `;
    });
}

function renderAnalytics() {
    const ctx = document.getElementById('salesChart').getContext('2d');
    const ctxPL = document.getElementById('profitLossChart');
    if (ctxPL) {
        ctxPL.getContext('2d');
    }

    // Aggregate sales by product
    const productSalesMap = {};
    const productProfitMap = {};

    sales.forEach(sale => {
        if (!productSalesMap[sale.productName]) {
            productSalesMap[sale.productName] = 0;
            productProfitMap[sale.productName] = 0;
        }
        productSalesMap[sale.productName] += sale.quantitySold;
        if (sale.profitLoss) productProfitMap[sale.productName] += sale.profitLoss;
    });

    // Sort to get Top 5 Sales
    const sortedProducts = Object.keys(productSalesMap).sort((a, b) => productSalesMap[b] - productSalesMap[a]).slice(0, 5);
    const dataValues = sortedProducts.map(p => productSalesMap[p]);

    if (salesChart) {
        salesChart.destroy();
    }

    salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedProducts.length ? sortedProducts : ['No Data'],
            datasets: [{
                label: 'Units Sold (Top 5)',
                data: dataValues.length ? dataValues : [0],
                backgroundColor: 'rgba(79, 70, 229, 0.6)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });

    // Profit vs Loss Chart
    if (ctxPL) {
        const sortedPL = Object.keys(productProfitMap).sort((a, b) => productProfitMap[b] - productProfitMap[a]).slice(0, 5);
        const plValues = sortedPL.map(p => productProfitMap[p]);
        const plColors = plValues.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)');

        if (profitLossChart) profitLossChart.destroy();
        profitLossChart = new Chart(ctxPL.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedPL.length ? sortedPL : ['No Data'],
                datasets: [{
                    label: 'Profit/Loss (₹)',
                    data: plValues.length ? plValues : [0],
                    backgroundColor: plColors,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    // Update Top Profitable and Loss Making lists
    const listProfitable = document.getElementById('list-profitable');
    const listLossMaking = document.getElementById('list-loss-making');
    
    if (listProfitable && listLossMaking) {
        listProfitable.innerHTML = "";
        listLossMaking.innerHTML = "";
        
        const allProdsByProfit = Object.keys(productProfitMap).sort((a, b) => productProfitMap[b] - productProfitMap[a]);
        
        let hasProfitable = false;
        let hasLoss = false;

        allProdsByProfit.forEach(p => {
            const val = productProfitMap[p];
            if (val > 0) {
                listProfitable.innerHTML += `<li><span>${p}</span><span class="text-success">${formatINR(val)}</span></li>`;
                hasProfitable = true;
            } else if (val < 0) {
                listLossMaking.innerHTML += `<li><span>${p}</span><span class="text-danger">${formatINR(Math.abs(val))}</span></li>`;
                hasLoss = true;
            }
        });

        if (!hasProfitable) listProfitable.innerHTML = `<li class="empty-state">No profitable products yet.</li>`;
        if (!hasLoss) listLossMaking.innerHTML = `<li class="empty-state">No loss-making products!</li>`;
    }
}
