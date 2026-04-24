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
let currentChartType = 'bar';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initNetworkStatus();
    initRealtimeListeners();
    initForms();
    initModals();

    const chartSelector = document.getElementById('chart-type-selector');
    if (chartSelector) {
        chartSelector.addEventListener('change', (e) => {
            currentChartType = e.target.value;
            renderAnalytics();
        });
    }

    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Global Chart Defaults
    Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
});

// --- Theme System ---
function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('theme');
    
    let currentTheme = 'light';
    if (savedTheme) {
        currentTheme = savedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        currentTheme = 'dark';
    }
    
    applyTheme(currentTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            currentTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', currentTheme);
            applyTheme(currentTheme);
        });
    }
}

function applyTheme(theme) {
    const root = document.documentElement;
    const themeToggle = document.getElementById('theme-toggle');
    
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.innerHTML = '<i class="ph ph-sun"></i>';
        updateChartTheme('dark');
    } else {
        root.removeAttribute('data-theme');
        if (themeToggle) themeToggle.innerHTML = '<i class="ph ph-moon"></i>';
        updateChartTheme('light');
    }
}

function updateChartTheme(theme) {
    const isDark = theme === 'dark';
    Chart.defaults.color = isDark ? "#94a3b8" : "#64748b";
    Chart.defaults.scale.grid.color = isDark ? "#334155" : "#f1f5f9";
    Chart.defaults.plugins.tooltip.backgroundColor = isDark ? "#0f172a" : "#1e293b";
    
    if (salesChart) salesChart.update();
    if (profitLossChart) profitLossChart.update();
}

// --- Toast System ---
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '<i class="ph-fill ph-check-circle" style="font-size:20px;"></i>';
    if (type === 'error') icon = '<i class="ph-fill ph-x-circle" style="font-size:20px;"></i>';
    if (type === 'warning') icon = '<i class="ph-fill ph-warning" style="font-size:20px;"></i>';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Network Status ---
function initNetworkStatus() {
    const statusDiv = document.getElementById('network-status');
    if (!statusDiv) return;
    const statusText = statusDiv.querySelector('.status-text');

    const updateOnlineStatus = () => {
        if (navigator.onLine) {
            statusDiv.className = 'network-status syncing';
            statusText.textContent = 'Syncing...';
            setTimeout(() => {
                statusDiv.className = 'network-status online';
                statusText.textContent = 'Online';
            }, 1500);
        } else {
            statusDiv.className = 'network-status offline';
            statusText.textContent = 'Offline Mode';
        }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    if (!navigator.onLine) updateOnlineStatus();
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
            const navText = link.querySelector('.nav-text');
            pageTitle.textContent = navText ? navText.textContent : link.textContent.trim();

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
        renderRestockRecommendations();
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
        renderCreditDashboard();
        renderRestockRecommendations();
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
    const salePaymentMode = document.getElementById('sale-payment-mode');
    const creditFields = document.getElementById('credit-fields');
    if (salePaymentMode && creditFields) {
        salePaymentMode.addEventListener('change', (e) => {
            if (e.target.value === 'Credit') {
                creditFields.classList.remove('hidden');
                document.getElementById('sale-customer').required = true;
                document.getElementById('sale-due-date').required = true;
            } else {
                creditFields.classList.add('hidden');
                document.getElementById('sale-customer').required = false;
                document.getElementById('sale-due-date').required = false;
            }
        });
    }

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

            const paymentMode = document.getElementById('sale-payment-mode').value;
            let customerName = null;
            let dueDate = null;
            let paymentStatus = 'Completed';
            let dueAmount = 0;

            if (paymentMode === 'Credit') {
                customerName = document.getElementById('sale-customer').value;
                dueDate = document.getElementById('sale-due-date').value;
                paymentStatus = 'Pending';
                dueAmount = totalRevenue;
            }

            const saleRecord = {
                productId: product.id,
                productName: product.productName,
                quantitySold: qtySold,
                salePrice: salePrice,
                totalRevenue: totalRevenue,
                totalCost: totalCost,
                profitLoss: profitLoss,
                paymentMode: paymentMode,
                customerName: customerName,
                dueDate: dueDate,
                dueAmount: dueAmount,
                paymentStatus: paymentStatus,
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
            const prodRef = doc(db,"products", product.id);
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

    // Search & Sort Inventory
    const sortInventory = document.getElementById('sort-inventory');
    if (sortInventory) {
        sortInventory.addEventListener('change', () => {
            renderInventoryTable(searchInventory.value);
        });
    }
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
            await updateDoc(doc(db,"products", id), {
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

    const sortVal = document.getElementById('sort-inventory') ? document.getElementById('sort-inventory').value : 'name_asc';
    
    filteredProducts.sort((a, b) => {
        if (sortVal === 'name_asc') {
            return (a.productName || '').localeCompare(b.productName || '');
        } else if (sortVal === 'qty_asc') {
            return a.quantity - b.quantity;
        } else if (sortVal === 'qty_desc') {
            return b.quantity - a.quantity;
        } else if (sortVal === 'price_desc') {
            return b.price - a.price;
        }
        return 0;
    });

    if (filteredProducts.length === 0) {
        inventoryTbody.innerHTML = `<tr><td colspan="10" class="text-center empty-state">No products found.</td></tr>`;
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
                <button class="btn btn-sm btn-primary btn-edit" data-id="${product.id}" data-qty="${product.quantity}"><i class="ph ph-pencil-simple"></i> Edit</button>
                <button class="btn btn-sm btn-danger btn-delete" data-id="${product.id}"><i class="ph ph-trash"></i> Delete</button>
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
                    await deleteDoc(doc(db,"products", id));
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
                        await updateDoc(doc(db,"alerts", a.id), { resolved: true, updatedAt: new Date() });
                    }
                }
            }
        } else {
            // Not alertable (IN_STOCK), but has alerts? Resolve them!
            if (existingStockAlerts.length > 0) {
                for (const a of existingStockAlerts) {
                    await updateDoc(doc(db,"alerts", a.id), { resolved: true, updatedAt: new Date() });
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
                await updateDoc(doc(db,"alerts", a.id), { resolved: true, updatedAt: new Date() });
            }
        }
    }
}


alertsFeed.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-clear-alert')) {
        const alertId = e.target.getAttribute('data-id');
        try {
            await updateDoc(doc(db,"alerts", alertId), { 
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
    const activeAlerts = alerts.filter(a => !a.resolved).slice(0, 5);

    if (activeAlerts.length === 0) {
        alertsFeed.innerHTML = `<div class="empty-state">All good! No active alerts.</div>`;
        return;
    }

    activeAlerts.forEach(a => {
        const timeStr = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
        
        let iconClass = 'ph-fill ph-warning';
        let cardClass = 'warning';
        
        if (a.alertLevel === 'CRITICAL' || a.alertLevel === 'OUT_OF_STOCK') { 
            iconClass = 'ph-fill ph-warning-octagon'; 
            cardClass = 'critical'; 
        } else if (a.alertType === 'EXPIRY_WARNING') { 
            iconClass = 'ph-fill ph-hourglass-high'; 
        }

        alertsFeed.innerHTML += `
            <div class="alert-card ${cardClass}">
                <div class="alert-content">
                    <i class="${iconClass} alert-icon"></i>
                    <div>
                        <div class="alert-text">${a.message}</div>
                        <div class="alert-time">${timeStr}</div>
                    </div>
                </div>
                <button class="btn-clear-alert" data-id="${a.id}">Clear</button>
            </div>
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
                <div style="display:flex; align-items:center; gap:8px;">
                    <i class="ph-fill ph-shopping-cart text-muted"></i>
                    <span>Sold ${s.quantitySold}x ${s.productName} | Revenue ${formatINR(revenue)} | ${plString}</span>
                </div>
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
    const dateSalesMap = {}; // For Line chart

    sales.forEach(sale => {
        // Product aggregations
        if (!productSalesMap[sale.productName]) {
            productSalesMap[sale.productName] = 0;
            productProfitMap[sale.productName] = 0;
        }
        productSalesMap[sale.productName] += sale.quantitySold;
        if (sale.profitLoss) productProfitMap[sale.productName] += sale.profitLoss;

        // Date aggregations for Line chart
        if (sale.soldAt && sale.soldAt.toDate) {
            const dateStr = sale.soldAt.toDate().toLocaleDateString();
            if (!dateSalesMap[dateStr]) {
                dateSalesMap[dateStr] = 0;
            }
            dateSalesMap[dateStr] += (sale.totalRevenue || sale.totalAmount || 0);
        }
    });

    if (salesChart) {
        salesChart.destroy();
    }

    if (currentChartType === 'line') {
        // Line Chart: Sales trend over time
        // Sort dates
        const sortedDates = Object.keys(dateSalesMap).sort((a, b) => new Date(a) - new Date(b));
        const dateValues = sortedDates.map(d => dateSalesMap[d]);

        salesChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedDates.length ? sortedDates : ['No Data'],
                datasets: [{
                    label: 'Daily Revenue (₹)',
                    data: dateValues.length ? dateValues : [0],
                    borderColor: 'rgba(79, 70, 229, 1)',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

    } else if (currentChartType === 'pie') {
        // Pie Chart: Product-wise sales share
        const sortedProducts = Object.keys(productSalesMap).sort((a, b) => productSalesMap[b] - productSalesMap[a]).slice(0, 5);
        const dataValues = sortedProducts.map(p => productSalesMap[p]);
        const pieColors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

        salesChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: sortedProducts.length ? sortedProducts : ['No Data'],
                datasets: [{
                    label: 'Units Sold',
                    data: dataValues.length ? dataValues : [1],
                    backgroundColor: sortedProducts.length ? pieColors : ['#e2e8f0'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

    } else {
        // Bar Chart (Default)
        const sortedProducts = Object.keys(productSalesMap).sort((a, b) => productSalesMap[b] - productSalesMap[a]).slice(0, 5);
        const dataValues = sortedProducts.map(p => productSalesMap[p]);

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
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                plugins: { legend: { display: false } }
            }
        });
    }

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
                plugins: { legend: { display: false } }
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

// --- Credit Dashboard ---
function renderCreditDashboard() {
    const statPendingDues = document.getElementById('stat-pending-dues');
    const statOverduePayments = document.getElementById('stat-overdue-payments');
    const statTotalReceivables = document.getElementById('stat-total-receivables');
    const creditTbody = document.getElementById('credit-tbody');

    if (!statPendingDues || !creditTbody) return;

    let pendingCount = 0;
    let overdueCount = 0;
    let totalReceivables = 0;

    const pendingCredits = sales.filter(s => s.paymentMode === 'Credit' && s.paymentStatus === 'Pending');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    creditTbody.innerHTML = "";

    if (pendingCredits.length === 0) {
        creditTbody.innerHTML = `<tr><td colspan="7" class="text-center empty-state">No pending credits.</td></tr>`;
    } else {
        pendingCredits.forEach(credit => {
            pendingCount++;
            totalReceivables += (credit.dueAmount || 0);

            let isOverdue = false;
            let dueDateStr = credit.dueDate || '-';
            
            if (credit.dueDate) {
                const dueDate = new Date(credit.dueDate);
                if (dueDate < today) {
                    isOverdue = true;
                    overdueCount++;
                }
            }

            const saleDate = credit.soldAt && credit.soldAt.toDate ? credit.soldAt.toDate().toLocaleDateString() : '-';
            const statusBadge = isOverdue 
                ? `<span class="badge badge-critical">Overdue</span>` 
                : `<span class="badge badge-warning">Pending</span>`;

            creditTbody.innerHTML += `
                <tr>
                    <td>${saleDate}</td>
                    <td><strong>${credit.customerName || 'Unknown'}</strong></td>
                    <td>${credit.productName} (x${credit.quantitySold})</td>
                    <td class="text-danger">${formatINR(credit.dueAmount || 0)}</td>
                    <td>${dueDateStr}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-success btn-mark-paid" data-id="${credit.id}">Mark as Paid</button>
                    </td>
                </tr>
            `;
        });
    }

    statPendingDues.textContent = pendingCount;
    statOverduePayments.textContent = overdueCount;
    statTotalReceivables.textContent = formatINR(totalReceivables);

    // Attach event listeners for Mark as Paid
    document.querySelectorAll('.btn-mark-paid').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const saleId = e.target.getAttribute('data-id');
            if (confirm("Mark this credit sale as fully paid?")) {
                try {
                    await updateDoc(doc(db, "sales",  saleId), {
                        paymentStatus: 'Paid',
                        dueAmount: 0
                    });
                    showToast("Payment recorded successfully!");
                } catch (err) {
                    console.error("Error updating payment:", err);
                    showToast("Failed to record payment", "error");
                }
            }
        });
    });
}

// --- Restock Recommendations ---
function renderRestockRecommendations() {
    const restockList = document.getElementById('restock-list');
    if (!restockList) return;

    restockList.innerHTML = "";

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Calculate sales velocity per product
    const productVelocity = {};

    sales.forEach(sale => {
        if (sale.soldAt && sale.soldAt.toDate) {
            const saleDate = sale.soldAt.toDate();
            if (saleDate >= thirtyDaysAgo) {
                if (!productVelocity[sale.productId]) productVelocity[sale.productId] = 0;
                productVelocity[sale.productId] += sale.quantitySold;
            }
        }
    });

    const recommendations = [];

    products.forEach(p => {
        const unitsSoldLast30Days = productVelocity[p.id] || 0;
        const dailyVelocity = unitsSoldLast30Days / 30;
        
        let daysUntilStockout = 9999;
        if (dailyVelocity > 0) {
            daysUntilStockout = p.quantity / dailyVelocity;
        }

        let priority = null;
        let reason = '';
        let recommendedUnits = 0;

        // Smart Logic
        if (daysUntilStockout <= 5 && p.quantity > 0 && dailyVelocity > 0) {
            priority = 'High';
            reason = `High demand: Stock will run out in ~${Math.ceil(daysUntilStockout)} days!`;
            recommendedUnits = Math.ceil(dailyVelocity * 30) - p.quantity;
        } else if (p.quantity <= p.lowStockLimit) {
            priority = 'Medium';
            reason = `Current stock (${p.quantity}) is below threshold (${p.lowStockLimit}).`;
            recommendedUnits = Math.max(p.lowStockLimit * 2, Math.ceil(dailyVelocity * 30));
        } else if (p.quantity === 0) {
            priority = 'High';
            reason = 'Out of stock!';
            recommendedUnits = Math.max(20, Math.ceil(dailyVelocity * 30));
        }

        if (priority) {
            recommendations.push({
                product: p,
                priority,
                reason,
                recommendedUnits: recommendedUnits <= 0 ? 20 : recommendedUnits, // Default fallback
                velocity: dailyVelocity.toFixed(1)
            });
        }
    });

    // Sort: High priority first
    recommendations.sort((a, b) => {
        if (a.priority === 'High' && b.priority === 'Medium') return -1;
        if (a.priority === 'Medium' && b.priority === 'High') return 1;
        return 0;
    });

    if (recommendations.length === 0) {
        restockList.innerHTML = `<li class="empty-state">Stock levels look healthy. No recommendations at this time.</li>`;
        return;
    }

    recommendations.forEach(rec => {
        const badgeClass = rec.priority === 'High' ? 'badge-priority-high' : 'badge-priority-medium';
        restockList.innerHTML += `
            <li>
                <div>
                    <strong>${rec.product.productName}</strong>
                    <br>
                    <span class="text-muted" style="font-size: 12px;">${rec.reason} (Velocity: ${rec.velocity} units/day)</span>
                </div>
                <div style="text-align: right;">
                    <span class="badge ${badgeClass}">${rec.priority} Priority</span>
                    <br>
                    <span style="font-size: 13px; font-weight: bold; color: var(--primary);">Restock: +${rec.recommendedUnits}</span>
                </div>
            </li>
        `;
    });
}
